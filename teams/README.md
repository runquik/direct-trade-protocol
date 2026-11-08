# Standing teams

DTP is maintained partly by scheduled, automated teams. Each team is one recurring job: a fresh session starts, reads its charter in this directory, works through its queue for one **work session**, reports, and stops. The charters are the whole configuration: to change what a team does, change its file here in a pull request. The schedule and model for each team are set by the owner outside this repository.

| Team | Charter | Job |
| --- | --- | --- |
| Maintainer | [maintainer.md](maintainer.md) | Keeps the protocol, SDK and docs correct: fixes findings, builds what the owner decided, triages reports, keeps its own pull requests green, reviews the red team's gap tests. |
| Red team | [red-team.md](red-team.md) | Reviews the other teams' pull requests, then tries to break the protocol and the reference implementation, and files what it finds. Never fixes. |
| Project lead | [project-lead.md](project-lead.md) | Keeps the teams moving: finds what is stuck, nudges, batches the owner's decisions, carries the answers back, records them, and reports daily. Never builds protocol changes. |

Pull requests merge through the [merge gate](#merging), not by hand: the teams never merge.

Outside builders, human or automated, report gaps through issues labelled `implementer-report` (see [Reporting a gap](#reporting-a-gap)). Those reports are the maintainer's most important input: they are the only evidence that comes from someone who did not write the code.

## Every run, every team

1. **Set up.** Use the Node version in `/.node-version`; if the machine has another, say so in your report rather than working around it. From `sdk/`, run `npm ci`.
2. **Check whether you are paused.** Find your team's log issue (open issue titled `Team log: <team>`). If it carries the label `team-paused`, post nothing and stop.
3. **Read before choosing.** Read your charter, the last five comments on your log issue, the open issues and pull requests carrying your team's label, and any comment the project lead left for your team since your last run. Do not redo work a previous run finished or already has open.
4. **Work your queue** in your charter's priority order, one item at a time, until the session budget below is used or the queue is empty. Finish and verify each item before starting the next.
5. **Verify every item.** Run the checks from [CONTRIBUTING.md](../CONTRIBUTING.md) that cover what you touched; for anything beyond a docs change that means at least `npm run typecheck` and `npm test` from `sdk/`, plus the suite for the layer you changed. A pull request you open must be green on your machine first.
6. **Report.** Add one comment to your log issue in the format below, covering everything the session did. This is the record the owner and the project lead read, and the only way the next run knows what you did.
7. **Stop.**

### Log comment format

```
**Run <UTC date>** · <team>
Did: <one line per item>
Links: <PRs / issues opened, updated or closed; for a stack, bottom first>
Verified: <commands run and their result, or "docs only">
Next: <what the next run should pick up, if anything>
Blocked: <what needs the owner, with the item and its decision date, or "nothing">
```

## Limits

- **Session budget.** At most **3 pull requests** or about **60 minutes of work**, whichever comes first; a finding filed or a triage pass counts as one item toward the same budget. Reviews (see [Merging](#merging)) count toward the time, not the pull-request count. Stop earlier if the next item needs an owner decision, if you are no longer confident of your changes, or if your context is getting long. Unfinished work is described in the report, not pushed half-done.
- **Stop rule.** If after a reasonable attempt the unit of work is not converging (the fix keeps failing, the scope keeps growing, the spec is ambiguous), stop, write up what you learned in the issue, and follow [When you are blocked](#when-you-are-blocked). A clear write-up is a successful run; a sprawling half-fix is not.
- **No-progress rule.** If your last three log comments (this run included) record no pull request made ready to merge, no review, no new finding and no triage outcome, add the label `team-paused` to your log issue and say why. The owner removes it.
- **Scope.** Each pull request covers one issue or one item, kept to what it needs. Never widen it with unrelated clean-up, and never combine unrelated items into one pull request.

### Stacked pull requests

When an item depends on one of your own pull requests that is not merged yet, build on it instead of waiting:

- Branch from your earlier branch, not from `main`. Every pull request in a stack still targets `main`.
- Put `Depends on #N (merge first)` on the first line of the description, and keep a stack to at most 3 pull requests.
- The merge gate merges a stack bottom first, with merge commits.
- At the start of every session, check your stacks: when a lower pull request has merged, bring the rest of the stack up to date with `main` (merge `main` into your branch; never force-push a branch you did not create) and keep them green. If a lower pull request was closed unmerged or needs rework, fix the bottom before adding anything on top.
- Never stack on another team's unmerged work.

## When you are blocked

1. **Check the decisions record first.** [docs/decisions.md](../docs/decisions.md) lists every owner decision so far. If an entry answers your question, it is answered: proceed, and cite the entry (and its issue or pull request) where you act on it. Do not ask the owner again.
2. **Otherwise ask, in this form.** Label the item `needs-owner` and put this at the top of its description, or in a comment if you did not open it:
   ```
   **Decision for the owner:** <the question, in one sentence, in protocol terms>
   **Options:** <each option and what it changes, one line each>
   **Recommendation:** <the option you would take, and why, in one or two sentences>
   **Decide by:** <a date one week from today, YYYY-MM-DD>
   ```
3. **What waits, and what proceeds.** Anything in the [Authority](#authority) list (wire formats, signing, canonicalization, identifiers, authority rules, a registered profile, a release gate) waits for the owner, however long that takes; its date only tells the project lead when to raise it again. Everything else proceeds with the recommendation once the date has passed with no answer: the project lead takes the default, removes `needs-owner`, says so on the item, and records it in the decisions record as a default the owner did not answer. The owner can still reverse it later; that reversal is a new decision.
4. Record what you are waiting for in your log comment's `Blocked:` line, and move to the next item in your queue. A question to the owner never stops the rest of your work.

## Authority

- Work on a branch named `claude/<team>-<short-slug>` (scheduled runs may only push branches that start with `claude/`) and open a pull request into `main`. **Never push to `main`, never merge, never approve**, never force-push a branch you did not create.
- Sign off every commit (`git commit -s`), as [CONTRIBUTING.md](../CONTRIBUTING.md) requires.
- Anything that changes wire formats, signing, canonicalization, identifiers, authority rules, a registered profile, or a release gate needs new or updated conformance vectors **and** an owner decision (`needs-owner` until the owner answers, then `owner-approved`). The owner decides those; a team proposes.
- **Who may add which label.** Only the owner, or the project lead carrying the owner's own answer, adds `owner-approved` or writes a comment that opens with "**Owner decision**". Only the red team adds `reviewed` to another team's pull request, and only the maintainer adds it to the red team's gap tests. No team labels its own work `reviewed` or `owner-approved`. The merge gate trusts these labels, so a label added outside these rules is a defect: report it on the project lead's log issue.
- Never mark a release or foundation gate green, and never skip, weaken or delete a test to get green. A test that is wrong is fixed in its own pull request that says why.
- This repository is public. Write nothing here you would not publish: no credentials, no real company or personal data, no internal details of any product built on DTP, and no product names. DTP is vendor-neutral (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

## Merging

The merge gate ([scripts/merge-gate.mjs](../scripts/merge-gate.mjs), run by [.github/workflows/merge-gate.yml](../.github/workflows/merge-gate.yml) after every CI run, on every relevant label or push, and every 15 minutes) merges an open pull request when all of these hold:

1. **It is approved for its head.** If it changes anything the [Authority](#authority) list reserves, it needs both: `owner-approved` and the red team's review of its head (`reviewed`, added after the head commit). However late `owner-approved` was added, and whatever head a decision comment names, an unreviewed head that changes a reserved path does not merge. If it changes nothing reserved, either is enough: `reviewed` added after the head commit, or `owner-approved` covering the head (the label was added after the head commit, an owner decision comment names the head commit, or the red team has reviewed the head since). The reserved paths are listed in the script: `spec/`, `SPEC.md`, `sdk/src/`, the normative and gate documents under `docs/foundation/` and `docs/release/`, the release and foundation gate scripts, and the packed SDK's `package.json` and lock file.
2. **Protocol conformance passed** on the head commit, and GitHub reports it mergeable.
3. **It is not waiting.** It carries no `needs-owner`, and no pull request named in a `Depends on #N` line is still open.
4. **`main` is green.** While the last Protocol conformance run on `main` failed, nothing merges.

A stack merges bottom first with merge commits; everything else is squashed; a draft is marked ready first. A new commit takes `reviewed` off (the gate removes it and says so once). `owner-approved` stays on after a new commit, because it records the decision, but the new head merges only after the red team reviews it. A pull request that touches a reserved path without `owner-approved` gets `needs-owner`. One that touches what runs the gate, CI or the teams (`.github/`, the gate script and its test, `.node-version`, `teams/`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, `NOTICE`) is never merged by the gate: it gets `owner-merges`, and the owner merges it by hand. The gate reports what it merged or held back on the issue `Team log: merge gate`.

If an approved pull request is not merging, read the gate's comment on it and its log issue before anything else; the reason is there.

### Repository settings the owner keeps

`main` is protected by a ruleset (Settings → Rules → Rulesets) that targets the default branch and:

- requires a pull request before merging, with **0** required approvals (the gate is the approval; GitHub reviews by the same account as the author cannot count);
- requires the status checks `local-conformance`, `postgres-concurrency` and `foundation-postgres` from Protocol conformance to pass, without requiring the branch to be up to date (the gate merges the exact head that passed, and stacks would otherwise churn);
- blocks force pushes and deletion of `main`;
- has an empty bypass list. In an emergency the owner edits the ruleset; nothing else bypasses it.

The gate acts as the owner's GitHub App `dtp-gate`, installed on this repository only, whose credentials are the secrets `GATE_APP_ID` and `GATE_APP_PRIVATE_KEY`.

## Labels

| Label | Meaning |
| --- | --- |
| `finding` | A defect or gap with a reproduction. Severity in the body. |
| `sev:critical` `sev:high` `sev:medium` `sev:low` | Severity, set by whoever files; the maintainer may change it with a reason. |
| `implementer-report` | Filed by someone building on DTP from outside this repository. |
| `needs-owner` | A decision only the owner can make, asked in the form in [When you are blocked](#when-you-are-blocked). |
| `owner-approved` | The owner decided: proceed as recommended (or as the owner's decision comment says). Replaces `needs-owner`. Stays on the item as the record. On a pull request that changes a reserved path it is never enough alone: the red team's `reviewed` on the head is needed too. |
| `reviewed` | The red team (or, for a gap test, the maintainer) reviewed the current head and found nothing that blocks it. Comes off with a new commit. |
| `owner-merges` | Set by the merge gate: the pull request touches what the owner merges by hand. |
| `team:maintainer` `team:red-team` `team:project-lead` | Which team owns or produced the item. |
| `team-paused` | On a log issue: that team stops until the owner removes it. |

### Severity windows

A finding should be closed by a merged fix (or by the owner) within its window, counted from when it was filed. The project lead reports every finding past its window. While a finding waits on an owner decision, its window is paused until the decision.

| Severity | Window |
| --- | --- |
| `sev:critical` | 2 days |
| `sev:high` | 7 days |
| `sev:medium` | 30 days |
| `sev:low` | 90 days |

## Reporting a gap

If you build on DTP and something is missing, wrong or hard, open an issue labelled `implementer-report` with: the DTP commit or SDK version you used; what you tried to do; what you expected; what happened; a minimal reproduction; how you worked around it, if you did. Describe the protocol gap in protocol terms. A report is useful even when the answer is "that is intended": it shows where the documentation failed.
