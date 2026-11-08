// The merge gate merges only what the owner decided or the red team reviewed, only on a head that approval covers,
// only when Protocol conformance passed and GitHub says mergeable, stacks bottom first with merge commits, and never
// what the owner reserves for himself. Run with `node --test scripts/merge-gate.test.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decide, dependsOn, isOwnerDecision, ownerCoversHead, ownerOnlyPaths, report, reservedPaths, reviewedHead, sweep, worthLogging,
  MARK, NEEDS_OWNER, OWNER_APPROVED, OWNER_MERGES, REVIEWED,
} from './merge-gate.mjs';

const HEAD = 'a'.repeat(40);
const T0 = '2026-11-02T10:00:00Z', T1 = '2026-11-02T11:00:00Z', T2 = '2026-11-02T12:00:00Z';

/** A reviewed pull request that passes every rule, to vary from. */
const passing = (changes = {}) => ({
  number: 10, nodeId: 'PR_10', draft: false, labels: [REVIEWED], body: '', head: HEAD, headCommittedAt: T0, approvedAt: null, reviewedAt: T1,
  mergeable: true, ciPassed: true, files: ['sdk/tests/v04/example.test.ts'], comments: [], openNumbers: [10], dependedOnByOpen: false, ...changes,
});

test('reserved paths: the specification, the SDK source, the gates and the packed dependencies', () => {
  const reserved = ['spec/v0.4/SPEC.md', 'spec/vectors/identity-log.json', 'spec/profiles/party/1.md', 'SPEC.md', 'sdk/src/v04/engine.ts',
    'docs/foundation/identity-log.md', 'docs/release/v04-gates.json', 'sdk/scripts/release-gates.ts', 'sdk/scripts/foundation-gates.ts',
    'sdk/package.json', 'sdk/package-lock.json'];
  assert.deepEqual(reservedPaths(reserved), reserved);
  assert.deepEqual(reservedPaths(['sdk/tests/v04/x.test.ts', 'progress.md', 'docs/EXTERNAL_BUILDER_BASELINE.md', 'sdk/scripts/build-party-profile.ts', 'specs.md', 'docs/decisions.md']), []);
});

test('owner-only paths: what runs the gate and CI, the runtime, the teams\' rules and the licence', () => {
  const owner = ['.github/workflows/protocol.yml', 'scripts/merge-gate.mjs', 'scripts/merge-gate.test.mjs', '.node-version',
    'teams/README.md', 'teams/red-team.md', 'CONTRIBUTING.md', 'SECURITY.md', 'LICENSE', 'NOTICE'];
  assert.deepEqual(ownerOnlyPaths(owner), owner);
  assert.deepEqual(ownerOnlyPaths(['scripts/run_acceptance.sh', 'docs/teams.md', 'sdk/LICENSE.md']), []);
});

test('"Depends on #N" lines name the pull requests that merge first', () => {
  assert.deepEqual(dependsOn('Depends on #111 (merge first)\n\n## Decision'), [111]);
  assert.deepEqual(dependsOn('depends on #1 and Depends on #2'), [1, 2]);
  assert.deepEqual(dependsOn('Closes #98. Replaces gap test #90.'), []);
  assert.deepEqual(dependsOn(null), []);
});

test('a review covers the head only when the label came after the head commit', () => {
  assert.equal(reviewedHead({ headCommittedAt: T0, reviewedAt: T1 }), true);
  assert.equal(reviewedHead({ headCommittedAt: T1, reviewedAt: T0 }), false, 'a commit after the review');
  assert.equal(reviewedHead({ headCommittedAt: T1, reviewedAt: null }), false);
});

test('the owner\'s approval covers the head when the label came after it, or a decision comment names it', () => {
  assert.equal(ownerCoversHead({ head: HEAD, headCommittedAt: T0, approvedAt: T1 }), true);
  assert.equal(ownerCoversHead({ head: HEAD, headCommittedAt: T1, approvedAt: T0 }), false, 'a commit after the decision');
  const named = body => ownerCoversHead({ head: HEAD, headCommittedAt: T1, approvedAt: T0, comments: [{ createdAt: T2, body }] });
  assert.equal(named(`**Owner decision, 2026-11-02: yes.** Merge \`${HEAD.slice(0, 7)}\`.`), true);
  assert.equal(named('**Owner decision, 2026-11-02: yes.** Merge.'), false, 'a decision that names no head');
  assert.equal(named(`**Owner decision needed.** Head ${HEAD.slice(0, 7)}.`), false, 'a team asking is not the owner deciding');
  assert.equal(named(`Maintainer: the owner decision covers ${HEAD.slice(0, 7)}`), false, 'only a decision comment counts');
  assert.equal(isOwnerDecision('  **Owner decision (2026-10-22): lexical rule.**'), true);
});

test('decide: each rule, in its order', () => {
  assert.equal(decide(passing({ labels: [] })).action, 'skip');
  assert.match(decide(passing({ labels: [REVIEWED, NEEDS_OWNER] })).reason, /waits for the owner/);
  assert.match(decide(passing({ labels: [OWNER_APPROVED, NEEDS_OWNER], approvedAt: T1 })).reason, /waits for the owner/);
  const owner = decide(passing({ labels: [OWNER_APPROVED], approvedAt: T1, files: ['sdk/src/v04/engine.ts', '.github/workflows/protocol.yml'] }));
  assert.deepEqual([owner.action, owner.paths], ['owner', ['.github/workflows/protocol.yml']], 'owner-only even when owner-approved');
  assert.equal(decide(passing({ reviewedAt: T0, headCommittedAt: T1 })).action, 'unreview', 'a commit after the review');
  const reserved = decide(passing({ files: ['sdk/tests/v04/x.test.ts', 'spec/vectors/nul-string.json'] }));
  assert.deepEqual([reserved.action, reserved.paths], ['needs-owner', ['spec/vectors/nul-string.json']], 'reviewed is not enough for a reserved path');
  const unreviewed = decide(passing({ labels: [OWNER_APPROVED], approvedAt: T1, reviewedAt: null, files: ['spec/vectors/nul-string.json'] }));
  assert.deepEqual([unreviewed.action, unreviewed.reason], ['review-again', `touches spec/vectors/nul-string.json; the red team has not reviewed the head ${HEAD.slice(0, 7)}`],
    'owner-approved is not enough for a reserved path, however late the label came');
  assert.equal(decide(passing({ labels: [OWNER_APPROVED], approvedAt: T1, reviewedAt: null, headCommittedAt: T0, files: ['spec/vectors/nul-string.json'],
    comments: [{ createdAt: T2, body: `**Owner decision, 2026-11-02: yes.** Merge at \`${HEAD.slice(0, 7)}\`.` }] })).action, 'review-again',
    'nor is a decision comment naming the head');
  assert.equal(decide(passing({ labels: [OWNER_APPROVED, REVIEWED], approvedAt: T1, reviewedAt: T1, files: ['spec/vectors/nul-string.json'] })).action, 'merge',
    'the owner\'s decision and a review of the head together merge a reserved path');
  assert.equal(decide(passing({ labels: [OWNER_APPROVED], approvedAt: T1, reviewedAt: null, files: ['docs/decisions.md'] })).action, 'merge',
    'outside reserved paths the owner\'s approval of the head is still enough');
  assert.equal(decide(passing({ labels: [OWNER_APPROVED], approvedAt: T0, headCommittedAt: T1, reviewedAt: null })).action, 'review-again');
  assert.equal(decide(passing({ labels: [OWNER_APPROVED, REVIEWED], approvedAt: T0, headCommittedAt: T1, reviewedAt: T2, files: ['sdk/src/x.ts'] })).action, 'merge',
    'a fresh review carries the owner\'s decision onto a new head');
  assert.match(decide(passing({ ciPassed: false })).reason, /Protocol conformance/);
  assert.match(decide(passing({ mergeable: false })).reason, /conflict/);
  assert.match(decide(passing({ mergeable: null })).reason, /not said/);
  assert.match(decide(passing({ body: 'Depends on #9 (merge first)', openNumbers: [9, 10] })).reason, /waits for #9/);
  assert.equal(decide(passing({ body: 'Depends on #9 (merge first)', openNumbers: [10] })).method, 'merge', 'the bottom merged: the top goes in with a merge commit');
  assert.equal(decide(passing({ dependedOnByOpen: true })).method, 'merge', 'a bottom others build on is not squashed');
  assert.equal(decide(passing()).method, 'squash');
});

/** GitHub in memory: pull requests with their labels, files, events, comments and CI, recording what the gate does. */
function fakeGitHub(pulls, { lastMain = { conclusion: 'success', url: 'https://x.test/run/1' } } = {}) {
  const state = new Map(pulls.map(p => [p.number, { ...p, labels: [...p.labels], comments: [...(p.comments ?? [])], events: [...(p.events ?? [])] }]));
  const done = { merges: [], readied: [], pulls: [] };
  const open = () => [...state.values()].filter(p => !p.merged);
  const asPull = p => ({ number: p.number, node_id: `PR_${p.number}`, draft: p.draft ?? false, body: p.body ?? '', mergeable: p.mergeable ?? true, head: { sha: p.head }, labels: p.labels.map(name => ({ name })) });
  const byHead = sha => [...state.values()].find(p => p.head === sha);
  return {
    done, state,
    lastCiOnMain: async () => lastMain,
    openPulls: async () => open().map(asPull),
    // `mergeableAfter` plays GitHub still computing: null for that many reads, then true.
    pull: async n => { const p = state.get(n); done.pulls.push(n); if (p.mergeableAfter > 0) { p.mergeableAfter -= 1; return { ...asPull(p), mergeable: null }; } return asPull(p); },
    files: async n => (state.get(n).files ?? ['sdk/tests/v04/x.test.ts']).map(filename => ({ filename })),
    events: async n => state.get(n).events,
    comments: async n => state.get(n).comments.map((c, i) => ({ id: i, created_at: c.createdAt, body: c.body })),
    commitDate: async sha => byHead(sha).headCommittedAt,
    ciPassed: async sha => byHead(sha).ciPassed ?? true,
    merge: async (n, sha, method) => { const p = state.get(n); assert.equal(sha, p.head, 'the merge names the head'); if (p.refuse) throw new Error(p.refuse); p.merged = true; done.merges.push([n, method]); },
    addLabels: async (n, labels) => { const p = state.get(n); p.labels.push(...labels.filter(l => !p.labels.includes(l))); },
    removeLabel: async (n, label) => { const p = state.get(n); p.labels = p.labels.filter(l => l !== label); },
    comment: async (n, body) => { state.get(n).comments.push({ createdAt: T2, body }); },
    ready: async id => { done.readied.push(id); },
  };
}

const labelled = (name, at) => ({ event: 'labeled', label: { name }, created_at: at });
const reviewed = at => labelled(REVIEWED, at);
const approved = at => labelled(OWNER_APPROVED, at);
const quiet = { log: () => {} };

test('a sweep merges a stack bottom first, squashes the rest, hands owner paths over, asks for decisions and takes stale reviews off', async () => {
  const api = fakeGitHub([
    { number: 10, labels: [REVIEWED], head: 'b'.repeat(40), headCommittedAt: T0, events: [reviewed(T1)] },
    { number: 11, labels: [OWNER_APPROVED, REVIEWED], head: 'c'.repeat(40), headCommittedAt: T0, events: [approved(T1), reviewed(T1)], files: ['sdk/src/v04/wire.ts'] },
    { number: 12, labels: [OWNER_APPROVED, REVIEWED], head: 'd'.repeat(40), headCommittedAt: T0, events: [approved(T1), reviewed(T1)], body: 'Depends on #11 (merge first)', draft: true, files: ['spec/v0.4/SPEC.md'] },
    { number: 13, labels: [REVIEWED], head: 'e'.repeat(40), headCommittedAt: T0, events: [reviewed(T1)], files: ['teams/maintainer.md'] },
    { number: 14, labels: [REVIEWED], head: 'f'.repeat(40), headCommittedAt: T2, events: [reviewed(T1)] },
    { number: 15, labels: [REVIEWED], head: 'g'.repeat(40), headCommittedAt: T0, events: [reviewed(T1)], ciPassed: false },
    { number: 16, labels: [REVIEWED], head: 'h'.repeat(40), headCommittedAt: T0, events: [reviewed(T1)], files: ['sdk/src/v04/engine.ts'] },
    { number: 17, labels: [OWNER_APPROVED], head: 'i'.repeat(40), headCommittedAt: T2, events: [approved(T1)] },
    { number: 18, labels: [], head: 'j'.repeat(40), headCommittedAt: T0 },
    { number: 19, labels: [OWNER_APPROVED], head: 'k'.repeat(40), headCommittedAt: T0, events: [approved(T1)], files: ['sdk/src/core1/record.ts'] },
  ]);
  const outcome = await sweep(api, quiet);
  assert.deepEqual(api.done.merges, [[10, 'squash'], [11, 'merge'], [12, 'merge']], 'the bottom first, then the top in the same sweep');
  assert.deepEqual(api.done.readied, ['PR_12'], 'the draft was marked ready before merging');
  assert.deepEqual(outcome.owner.map(o => [o.number, o.paths, o.handed]), [[13, ['teams/maintainer.md'], true]]);
  assert.ok(api.state.get(13).labels.includes(OWNER_MERGES));
  assert.match(api.state.get(13).comments.at(-1).body, /the owner merges by hand/);
  assert.deepEqual(outcome.unreviewed.map(u => u.number), [14]);
  assert.deepEqual(api.state.get(14).labels, [], 'the stale review came off');
  assert.match(api.state.get(14).comments.at(-1).body, /New commits since the red team's review/);
  assert.deepEqual(outcome.needsOwner.map(n => [n.number, n.paths]), [[16, ['sdk/src/v04/engine.ts']]]);
  assert.ok(api.state.get(16).labels.includes(NEEDS_OWNER));
  assert.deepEqual(outcome.waiting.map(w => w.number), [17, 19]);
  assert.deepEqual(api.state.get(17).labels, [OWNER_APPROVED], 'the decision stays recorded');
  assert.match(api.state.get(17).comments.at(-1).body, /decision stands\. This head \(`iiiiiii`\) came after the decision/);
  assert.match(api.state.get(19).comments.at(-1).body, /decision stands\. This head \(`kkkkkkk`\) changes what the owner reserves, so it merges once the red team has reviewed it/,
    'owner-approved on a reserved path waits for the red team, even with the label after the head');
  assert.deepEqual(outcome.skipped.map(s => s.number), [14, 15], 'the unreviewed one is skipped too, and the red one');
  assert.equal(api.state.get(18).comments.length, 0, 'an unlabelled pull request is not touched');
  assert.equal(worthLogging(outcome), true);

  const again = await sweep(api, quiet);
  assert.equal(api.done.merges.length, 3, 'nothing merges twice');
  for (const [n, mark] of [[13, MARK.owner], [16, MARK.reserved], [17, MARK.again('i'.repeat(40))], [19, MARK.again('k'.repeat(40))]]) {
    assert.equal(api.state.get(n).comments.filter(c => c.body.includes(mark)).length, 1, `#${n} is told once`);
  }
  assert.deepEqual(again.owner.map(o => o.handed), [false]);
  assert.equal(worthLogging(again), false, 'a sweep that changed nothing is not logged');
});

test('a review of the new head lets an owner-approved pull request merge after more commits', async () => {
  const api = fakeGitHub([
    { number: 20, labels: [OWNER_APPROVED, REVIEWED], head: 'b'.repeat(40), headCommittedAt: T1, events: [approved(T0), reviewed(T2)], files: ['sdk/src/v04/engine.ts'] },
    { number: 21, labels: [OWNER_APPROVED, REVIEWED], head: 'c'.repeat(40), headCommittedAt: T2, events: [approved(T0), reviewed(T1)],
      comments: [{ createdAt: T2, body: `**Owner decision, 2026-11-02: yes.** Merge at \`${'c'.repeat(7)}\`.` }] },
  ]);
  const outcome = await sweep(api, quiet);
  assert.deepEqual(api.done.merges, [[20, 'squash'], [21, 'squash']]);
  assert.deepEqual(outcome.unreviewed.map(u => u.number), [21], 'the stale review comes off even when the owner named the head');
});

test('while main\'s last CI run failed, nothing merges, the hold is reported once, and the bookkeeping still happens', async () => {
  const api = fakeGitHub([
    { number: 30, labels: [REVIEWED], head: 'b'.repeat(40), headCommittedAt: T0, events: [reviewed(T1)] },
    { number: 31, labels: [REVIEWED], head: 'c'.repeat(40), headCommittedAt: T2, events: [reviewed(T1)] },
    { number: 32, labels: [OWNER_APPROVED], head: 'd'.repeat(40), headCommittedAt: T0, events: [approved(T1)], files: ['.github/workflows/protocol.yml'] },
  ], { lastMain: { conclusion: 'failure', url: 'https://x.test/run/9' } });
  const outcome = await sweep(api, quiet);
  assert.deepEqual(api.done.merges, [], 'stop the line');
  assert.match(outcome.held, /failed \(https:\/\/x\.test\/run\/9\)/);
  assert.deepEqual(outcome.skipped, [{ number: 30, reason: 'held: main is red' }, { number: 31, reason: `the red team has not reviewed the head ${'c'.repeat(7)}` }]);
  assert.deepEqual(outcome.unreviewed.map(u => u.number), [31], 'a stale review still comes off');
  assert.deepEqual(outcome.owner.map(o => o.number), [32], 'an owner path is still handed over');
  const text = report(outcome);
  assert.match(text, /^\*\*Merge gate.*\*\*\nHeld: the last Protocol conformance run on main failed/);
  assert.equal(worthLogging({ ...outcome, owner: [] }), true);
  assert.equal(worthLogging({ ...outcome, owner: [] }, text), false, 'the same hold is not logged again');
});

test('a mergeability GitHub has not computed yet is asked again before it counts as unknown', async () => {
  const api = fakeGitHub([
    { number: 40, labels: [REVIEWED], head: 'b'.repeat(40), headCommittedAt: T0, events: [reviewed(T1)], mergeableAfter: 2 },
    { number: 41, labels: [REVIEWED], head: 'c'.repeat(40), headCommittedAt: T0, events: [reviewed(T1)], mergeableAfter: 9 },
  ]);
  const waits = [];
  const outcome = await sweep(api, { ...quiet, sleep: async ms => { waits.push(ms); } });
  assert.deepEqual(api.done.merges, [[40, 'squash']], 'answered on the third read, merged');
  assert.equal(api.done.pulls.filter(n => n === 41).length, 4, 'asked four times at most');
  assert.match(outcome.skipped[0].reason, /not said whether it is mergeable/);
  assert.equal(waits.length, 5, 'two waits for #40, three for #41');
});

test('a merge GitHub refuses is reported as skipped, and the sweep carries on', async () => {
  const api = fakeGitHub([
    { number: 50, labels: [REVIEWED], head: 'b'.repeat(40), headCommittedAt: T0, events: [reviewed(T1)], refuse: 'Head branch was modified' },
    { number: 51, labels: [REVIEWED], head: 'c'.repeat(40), headCommittedAt: T0, events: [reviewed(T1)] },
  ]);
  const outcome = await sweep(api, quiet);
  assert.deepEqual(api.done.merges, [[51, 'squash']]);
  assert.match(outcome.skipped[0].reason, /GitHub refused the merge: Head branch was modified/);
  assert.match(report(outcome), /Merged:\n- #51 \(squash, head ccccccc\)\nSkipped:\n- #50: GitHub refused/);
});

test('an empty sweep says so', () => {
  const text = report({ merged: [], owner: [], needsOwner: [], unreviewed: [], waiting: [], skipped: [], held: null }, new Date(T0));
  assert.equal(text, `**Merge gate, 2026-11-02 10:00 UTC**\nNothing labelled ${OWNER_APPROVED} or ${REVIEWED}.`);
});
