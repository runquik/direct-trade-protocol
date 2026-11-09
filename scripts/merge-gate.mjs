// The merge gate: which pull requests merge into `main`, and how (.github/workflows/merge-gate.yml).
//
//   node scripts/merge-gate.mjs        in the gate workflow: sweep every open pull request and merge what passes
//
// The scheduled teams (teams/README.md) may not merge. The gate applies the merge rules from a workflow, so decided
// and reviewed work lands within minutes of going green instead of waiting for someone to merge it by hand:
//   - Approval. A pull request touching what the owner reserves (RESERVED, from teams/README.md, Authority) needs
//     both: the owner decided it (`owner-approved`) and the red team reviewed its head (`reviewed`). One touching
//     nothing reserved needs either.
//   - Approval covers the head that merges. `reviewed` counts only when it was added after the head commit; a stale
//     one comes off, with one comment. `owner-approved` stays on, because it records the owner's decision. For a
//     reserved path only a fresh `reviewed` covers a head, so when the label was added cannot let an unreviewed head
//     through. Elsewhere, after a new commit the head needs the owner's label or a decision comment naming that head,
//     or a fresh `reviewed`.
//   - The "Protocol conformance" workflow passed on the head, GitHub reports it mergeable, and it is not labelled
//     `needs-owner`.
//   - A stack merges bottom first with merge commits: a pull request whose description says "Depends on #N" waits for
//     #N, and one that others depend on is not squashed. Everything else is squashed. Drafts are marked ready first.
//   - A pull request touching OWNER_ONLY (what runs the gate, CI and the teams) is never merged here: it gets
//     `owner-merges` and one comment. One touching RESERVED without `owner-approved` gets `needs-owner`.
//   - While the last "Protocol conformance" run on `main` failed, nothing merges.
// Each merge names the head commit, so a commit pushed between the check and the merge makes GitHub refuse it.
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const OWNER_APPROVED = 'owner-approved';
export const REVIEWED = 'reviewed';
export const NEEDS_OWNER = 'needs-owner';
export const OWNER_MERGES = 'owner-merges';
export const LOG_TITLE = 'Team log: merge gate';
/** The workflow whose success on a head lets it merge, and whose failure on `main` holds every merge. */
export const CI_WORKFLOW = 'protocol.yml';

/**
 * What teams/README.md (Authority) reserves for the owner: wire formats, signing, canonicalization, identifiers,
 * authority rules, registered profiles and conformance vectors (all under `spec/` and the normative documents), the
 * reference SDK's behaviour, the release and foundation gates, and the packed SDK's dependencies. A pull request
 * touching one merges only with `owner-approved` and a red-team review of its head.
 */
export const RESERVED = [
  'spec/', 'SPEC.md',
  'sdk/src/',
  'docs/foundation/', 'docs/release/', 'sdk/scripts/release-gates.ts', 'sdk/scripts/foundation-gates.ts',
  'sdk/package.json', 'sdk/package-lock.json',
];

/** What the owner merges by hand, whatever its labels: the gate itself, CI, the runtime, the teams' rules, the licence. */
export const OWNER_ONLY = [
  '.github/', 'scripts/merge-gate.mjs', 'scripts/merge-gate.test.mjs', '.node-version',
  'teams/', 'CONTRIBUTING.md', 'SECURITY.md', 'LICENSE', 'NOTICE',
];

/** Marks on the gate's own comments, so each is posted once (per head, where the head matters). */
export const MARK = {
  owner: '<!-- merge-gate: owner-merges -->',
  reserved: '<!-- merge-gate: needs-owner -->',
  stale: head => `<!-- merge-gate: stale ${head.slice(0, 7)} -->`,
  again: head => `<!-- merge-gate: review-again ${head.slice(0, 7)} -->`,
};

const matching = list => files => files.filter(file => list.some(path => (path.endsWith('/') ? file.startsWith(path) : file === path)));
export const reservedPaths = matching(RESERVED);
export const ownerOnlyPaths = matching(OWNER_ONLY);

/** The "Depends on #N" lines of a description: the pull requests that merge first. */
export function dependsOn(body = '') {
  return [...(body ?? '').matchAll(/depends on #(\d+)/gi)].map(match => Number(match[1]));
}

/** Whether the red team reviewed this head: `reviewed` was added after the head commit. */
export function reviewedHead({ headCommittedAt, reviewedAt }) {
  return Boolean(reviewedAt && reviewedAt > headCommittedAt);
}

/** The owner's decision comments open with "**Owner decision"; a team asking for one writes "Owner decision needed". */
export const isOwnerDecision = body => /^\*\*Owner decision\b(?! needed)/i.test(body.trim());

/** Whether the owner's approval covers this head: the label came after the head commit, or a decision comment names it. */
export function ownerCoversHead({ head, headCommittedAt, approvedAt, comments = [] }) {
  if (approvedAt && approvedAt > headCommittedAt) return true;
  const short = head.slice(0, 7);
  return comments.some(comment => isOwnerDecision(comment.body) && comment.body.includes(short));
}

/**
 * What to do with one pull request, from the facts `facts()` gathers. One of:
 *   { action: 'skip', reason }                 nothing yet: not approved, CI running, a conflict, waits for a lower one…
 *   { action: 'unreview', reason }             `reviewed` predates the head: take it off, say so once, decide again
 *   { action: 'review-again', reason }         owner-approved, but the head moved since: say so once, wait for a review
 *   { action: 'owner', reason, paths }         an owner-only path: label `owner-merges`, say so once, leave it
 *   { action: 'needs-owner', reason, paths }   a reserved path with no owner decision: label `needs-owner`, say so once
 *   { action: 'merge', method, reason }        merge it, with a merge commit for a stack and a squash otherwise
 */
export function decide(pr) {
  const skip = reason => ({ action: 'skip', reason });
  const labels = new Set(pr.labels);
  const approved = labels.has(OWNER_APPROVED);
  const reviewed = labels.has(REVIEWED);
  if (!approved && !reviewed) return skip(`labelled neither ${OWNER_APPROVED} nor ${REVIEWED}`);
  if (labels.has(NEEDS_OWNER)) return skip(`labelled ${NEEDS_OWNER}: waits for the owner`);
  const owner = ownerOnlyPaths(pr.files);
  if (owner.length) return { action: 'owner', reason: `touches ${owner.join(', ')}`, paths: owner };
  const fresh = reviewedHead(pr);
  if (reviewed && !fresh) return { action: 'unreview', reason: `the red team has not reviewed the head ${pr.head.slice(0, 7)}` };
  const reserved = reservedPaths(pr.files);
  if (approved) {
    if (reserved.length && !fresh) return { action: 'review-again', reason: `touches ${reserved.join(', ')}; the red team has not reviewed the head ${pr.head.slice(0, 7)}` };
    if (!ownerCoversHead(pr) && !fresh) return { action: 'review-again', reason: `commits since the owner's decision; the head ${pr.head.slice(0, 7)} needs a review` };
  } else if (reserved.length) {
    return { action: 'needs-owner', reason: `touches ${reserved.join(', ')} without ${OWNER_APPROVED}`, paths: reserved };
  }
  if (!pr.ciPassed) return skip('Protocol conformance has not passed on the head');
  if (pr.mergeable !== true) return skip(pr.mergeable === false ? 'GitHub reports a conflict' : 'GitHub has not said whether it is mergeable yet');
  const below = dependsOn(pr.body).filter(number => pr.openNumbers.includes(number));
  if (below.length) return skip(`waits for #${below.join(', #')}`);
  const inStack = dependsOn(pr.body).length > 0 || pr.dependedOnByOpen;
  return { action: 'merge', method: inStack ? 'merge' : 'squash', reason: inStack ? 'part of a stack, so a merge commit' : 'squash' };
}

/** The newest time a label was added, from an issue's events, or null. */
const labelledAt = (events, name) => events.filter(event => event.event === 'labeled' && event.label?.name === name).map(event => event.created_at).sort().at(-1) ?? null;

/** The facts `decide` needs about one open pull request, read through `api` (see `github`). */
export async function facts(api, pull, open) {
  const number = pull.number;
  const head = pull.head.sha;
  const [files, events, comments, headCommittedAt, ciPassed] = await Promise.all([
    api.files(number), api.events(number), api.comments(number), api.commitDate(head), api.ciPassed(head),
  ]);
  return {
    number, nodeId: pull.node_id, draft: pull.draft === true, labels: pull.labels.map(label => label.name), body: pull.body ?? '',
    head, headCommittedAt, approvedAt: labelledAt(events, OWNER_APPROVED), reviewedAt: labelledAt(events, REVIEWED),
    mergeable: pull.mergeable, ciPassed,
    files: files.flatMap(file => [file.filename, file.previous_filename].filter(Boolean)),
    comments: comments.map(comment => ({ createdAt: comment.created_at, body: comment.body ?? '' })),
    openNumbers: open.map(other => other.number),
    dependedOnByOpen: open.some(other => other.number !== number && dependsOn(other.body ?? '').includes(number)),
  };
}

/**
 * One sweep: every open pull request labelled `owner-approved` or `reviewed`, lowest number first, decided and acted
 * on. While the last CI run on `main` failed, nothing merges; the labels and hand-offs are still kept straight, and
 * the hold is reported. GitHub computes mergeability lazily after `main` moves, so a `null` answer is asked again a
 * few times before it counts as "not said yet".
 */
export async function sweep(api, { log = console.log, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const open = await api.openPulls();
  const outcome = { merged: [], owner: [], needsOwner: [], unreviewed: [], waiting: [], skipped: [], held: null };
  const lastMain = await api.lastCiOnMain();
  if (lastMain?.conclusion === 'failure') outcome.held = `the last Protocol conformance run on main failed (${lastMain.url}); nothing merges until main is green`;
  const once = async (pr, mark, body) => {
    if (!pr.comments.some(comment => comment.body.includes(mark))) await api.comment(pr.number, `${mark}\n${body} (merge gate)`);
  };
  const candidates = open.filter(pull => pull.labels.some(label => [OWNER_APPROVED, REVIEWED].includes(label.name))).sort((a, b) => a.number - b.number);
  for (const candidate of candidates) {
    let pull = await api.pull(candidate.number); // the list has no `mergeable`; the detail does
    for (let attempt = 0; pull.mergeable === null && attempt < 3; attempt++) { await sleep(4000); pull = await api.pull(candidate.number); }
    const pr = await facts(api, pull, open);
    let verdict = decide(pr);
    if (verdict.action === 'unreview') {
      await api.removeLabel(pr.number, REVIEWED);
      await once(pr, MARK.stale(pr.head), `New commits since the red team's review, so \`${REVIEWED}\` comes off. The red team reviews the head \`${pr.head.slice(0, 7)}\` on its next run.`);
      outcome.unreviewed.push({ number: pr.number, reason: verdict.reason });
      pr.labels = pr.labels.filter(label => label !== REVIEWED);
      const next = decide(pr); // an owner decision may still cover the head
      verdict = next.action === 'skip' ? { action: 'skip', reason: verdict.reason } : next;
    }
    log(`#${pr.number}: ${verdict.action} (${verdict.reason})`);
    if (verdict.action === 'skip') { outcome.skipped.push({ number: pr.number, reason: verdict.reason }); continue; }
    if (verdict.action === 'review-again') {
      await once(pr, MARK.again(pr.head), `The owner's decision stands. This head (\`${pr.head.slice(0, 7)}\`) ${reservedPaths(pr.files).length ? 'changes what the owner reserves, so it' : 'came after the decision. It'} merges once the red team has reviewed it and labelled it \`${REVIEWED}\`.`);
      outcome.waiting.push({ number: pr.number, reason: verdict.reason });
      continue;
    }
    if (verdict.action === 'owner') {
      const handed = !pr.labels.includes(OWNER_MERGES);
      if (handed) await api.addLabels(pr.number, [OWNER_MERGES]);
      await once(pr, MARK.owner, `This pull request changes ${verdict.paths.map(path => `\`${path}\``).join(', ')}, which the owner merges by hand. Labelled \`${OWNER_MERGES}\`.`);
      outcome.owner.push({ number: pr.number, paths: verdict.paths, handed });
      continue;
    }
    if (verdict.action === 'needs-owner') {
      await api.addLabels(pr.number, [NEEDS_OWNER]);
      await once(pr, MARK.reserved, `This pull request changes ${verdict.paths.map(path => `\`${path}\``).join(', ')}, which teams/README.md (Authority) reserves for the owner, and it has no owner decision. Labelled \`${NEEDS_OWNER}\`; the project lead puts it on the owner's list.`);
      outcome.needsOwner.push({ number: pr.number, paths: verdict.paths });
      continue;
    }
    if (outcome.held) { outcome.skipped.push({ number: pr.number, reason: 'held: main is red' }); continue; }
    try {
      if (pr.draft) await api.ready(pr.nodeId);
      await api.merge(pr.number, pr.head, verdict.method);
      outcome.merged.push({ number: pr.number, method: verdict.method, head: pr.head });
      open.splice(open.findIndex(other => other.number === pr.number), 1); // the ones above it in a stack may follow now
    } catch (error) {
      outcome.skipped.push({ number: pr.number, reason: `GitHub refused the merge: ${error.message}` });
    }
  }
  return outcome;
}

/** The sweep as the log comment the owner and the project lead read. */
export function report(outcome, when = new Date()) {
  const lines = [`**Merge gate, ${when.toISOString().slice(0, 16).replace('T', ' ')} UTC**`];
  const list = (title, items, line) => { if (items.length) lines.push(`${title}:`, ...items.map(item => `- ${line(item)}`)); };
  if (outcome.held) lines.push(`Held: ${outcome.held}`);
  list('Merged', outcome.merged, item => `#${item.number} (${item.method}, head ${item.head.slice(0, 7)})`);
  list('For the owner to merge', outcome.owner, item => `#${item.number}: touches ${item.paths.join(', ')}`);
  list('Needs an owner decision', outcome.needsOwner, item => `#${item.number}: touches ${item.paths.join(', ')}`);
  list('Review removed', outcome.unreviewed, item => `#${item.number}: ${item.reason}`);
  list('Waiting for a review', outcome.waiting, item => `#${item.number}: ${item.reason}`);
  list('Skipped', outcome.skipped, item => `#${item.number}: ${item.reason}`);
  if (lines.length === 1) lines.push(`Nothing labelled ${OWNER_APPROVED} or ${REVIEWED}.`);
  return lines.join('\n');
}

/** GitHub's REST API for one repository, with the few calls the gate makes. Lists are read whole. */
export function github({ repository, token, fetch = globalThis.fetch }) {
  const base = `https://api.github.com/repos/${repository}`;
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json' };
  async function call(method, path, body) {
    const response = await fetch(path.startsWith('https://') ? path : `${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${(await response.text()).slice(0, 300)}`);
    return response.status === 204 ? null : response.json();
  }
  async function all(path) {
    const items = [];
    for (let page = 1; ; page++) {
      const got = await call('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      items.push(...got);
      if (got.length < 100) return items;
    }
  }
  /** The newest run of the CI workflow matching `query`, or null. */
  async function newestRun(query) {
    const { workflow_runs: runs = [] } = await call('GET', `/actions/workflows/${CI_WORKFLOW}/runs?${query}&per_page=20`);
    return runs.sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  }
  return {
    openPulls: () => all('/pulls?state=open'),
    pull: number => call('GET', `/pulls/${number}`),
    files: number => all(`/pulls/${number}/files`),
    events: number => all(`/issues/${number}/events`),
    comments: number => all(`/issues/${number}/comments`),
    commitDate: async sha => (await call('GET', `/commits/${sha}`)).commit.committer.date,
    /** Whether the newest Protocol conformance run on this exact commit finished green. */
    async ciPassed(sha) {
      const run = await newestRun(`head_sha=${sha}`);
      return run?.head_sha === sha && run.status === 'completed' && run.conclusion === 'success';
    },
    /** The newest finished Protocol conformance run on `main`: `{ conclusion, url }`, or null when there is none. */
    async lastCiOnMain() {
      const run = await newestRun('branch=main&event=push&status=completed');
      return run ? { conclusion: run.conclusion, url: run.html_url } : null;
    },
    /** The open log issue's number, opened the first time something needs logging. */
    async logIssue() {
      const found = (await all('/issues?state=open')).find(issue => !issue.pull_request && issue.title === LOG_TITLE);
      if (found) return found.number;
      return (await call('POST', '/issues', { title: LOG_TITLE, body: 'What the merge gate (`scripts/merge-gate.mjs`) merged, handed to the owner, or held back. One comment per sweep that changed something.' })).number;
    },
    merge: (number, sha, method) => call('PUT', `/pulls/${number}/merge`, { sha, merge_method: method }),
    addLabels: (number, labels) => call('POST', `/issues/${number}/labels`, { labels }),
    removeLabel: (number, label) => call('DELETE', `/issues/${number}/labels/${encodeURIComponent(label)}`),
    comment: (number, body) => call('POST', `/issues/${number}/comments`, { body }),
    async ready(nodeId) {
      const answer = await call('POST', 'https://api.github.com/graphql', {
        query: 'mutation($id: ID!) { markPullRequestReadyForReview(input: {pullRequestId: $id}) { pullRequest { isDraft } } }',
        variables: { id: nodeId },
      });
      if (answer.errors?.length) throw new Error(`could not mark the draft ready: ${answer.errors[0].message}`);
    },
  };
}

/**
 * Whether a sweep is worth a log comment: something merged or was newly handed to the owner, or a merge was held
 * back and the log's last comment does not already say so (a red `main` would otherwise be logged every sweep).
 */
export function worthLogging(outcome, lastLogged = '') {
  if (outcome.merged.length > 0 || outcome.owner.some(item => item.handed) || outcome.needsOwner.length > 0) return true;
  return outcome.skipped.some(item => item.reason === 'held: main is red') && !lastLogged.includes(`Held: ${outcome.held}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { GITHUB_REPOSITORY: repository, GATE_TOKEN: token, GITHUB_STEP_SUMMARY: summary } = process.env;
  if (!repository || !token) throw new Error('merge-gate runs in the gate workflow, with GITHUB_REPOSITORY and GATE_TOKEN (minted from the gate\'s GitHub App)');
  const api = github({ repository, token });
  const outcome = await sweep(api);
  const text = report(outcome);
  console.log(text);
  if (summary) appendFileSync(summary, `${text}\n`);
  if (worthLogging(outcome)) {
    const issue = await api.logIssue();
    if (worthLogging(outcome, (await api.comments(issue)).at(-1)?.body ?? '')) await api.comment(issue, text);
  }
}
