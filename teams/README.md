# Standing teams

DTP is maintained partly by scheduled, automated teams. Each team is one recurring job: a fresh session starts, reads its charter in this directory, works through its queue for one **work session**, reports, and stops. The charters are the whole configuration: to change what a team does, change its file here in a pull request. The schedule and model for each team are set by the owner outside this repository.

| Team | Charter | Job |
| --- | --- | --- |
| Maintainer | [maintainer.md](maintainer.md) | Keeps the protocol, SDK and docs correct: fixes findings, triages reports, keeps its own pull requests green. |
| Red team | [red-team.md](red-team.md) | Tries to break the protocol and the reference implementation, and files what it finds. Never fixes. |

Outside builders, human or automated, report gaps through issues labelled `implementer-report` (see [Reporting a gap](#reporting-a-gap)). Those reports are the maintainer's most important input: they are the only evidence that comes from someone who did not write the code.

## Every run, every team

1. **Set up.** Use the Node version in `/.node-version`; if the machine has another, say so in your report rather than working around it. From `sdk/`, run `npm ci`.
2. **Check whether you are paused.** Find your team's log issue (open issue titled `Team log: <team>`). If it carries the label `team-paused`, post nothing and stop.
3. **Read before choosing.** Read your charter, the last five comments on your log issue, and the open issues and pull requests carrying your team's label. Do not redo work a previous run finished or already has open.
4. **Work your queue** in your charter's priority order, one item at a time, until the session budget below is used or the queue is empty. Finish and verify each item before starting the next.
5. **Verify every item.** Run the checks from [CONTRIBUTING.md](../CONTRIBUTING.md) that cover what you touched; for anything beyond a docs change that means at least `npm run typecheck` and `npm test` from `sdk/`, plus the suite for the layer you changed. A pull request you open must be green on your machine first.
6. **Report.** Add one comment to your log issue in the format below, covering everything the session did. This is the record the owner and the digest read, and the only way the next run knows what you did.
7. **Stop.**

### Log comment format

```
**Run <UTC date>** · <team>
Did: <one line per item>
Links: <PRs / issues opened, updated or closed; for a stack, bottom first>
Verified: <commands run and their result, or "docs only">
Next: <what the next run should pick up, if anything>
Blocked: <what needs the owner, or "nothing">
```

## Limits

- **Session budget.** At most **3 pull requests** or about **60 minutes of work**, whichever comes first; a finding filed or a triage pass counts as one item toward the same budget. Stop earlier if the next item needs an owner decision, if you are no longer confident of your changes, or if your context is getting long. Unfinished work is described in the report, not pushed half-done.
- **Stop rule.** If after a reasonable attempt the unit of work is not converging (the fix keeps failing, the scope keeps growing, the spec is ambiguous), stop, write up what you learned in the issue, label it `needs-owner` if a decision is required, report, and end the run. A clear write-up is a successful run; a sprawling half-fix is not.
- **No-progress rule.** If your last three log comments (this run included) record no merged-ready pull request, no new finding and no triage outcome, add the label `team-paused` to your log issue and say why. The owner removes it.
- **Scope.** Each pull request covers one issue or one item, kept to what it needs. Never widen it with unrelated clean-up, and never combine unrelated items into one pull request.

### Stacked pull requests

When an item depends on one of your own pull requests that is not merged yet, build on it instead of waiting:

- Branch from your earlier branch, not from `main`. Every pull request in a stack still targets `main`.
- Put `Depends on #N (merge first)` on the first line of the description, and keep a stack to at most 3 pull requests.
- The owner merges a stack bottom first, with a merge commit.
- At the start of every session, check your stacks: when a lower pull request has merged, bring the rest of the stack up to date with `main` (merge `main` into your branch; never force-push a branch you did not create) and keep them green. If a lower pull request was closed unmerged or needs rework, fix the bottom before adding anything on top.
- Never stack on another team's unmerged work.

## Authority

- Work on a branch named `claude/<team>-<short-slug>` (scheduled runs may only push branches that start with `claude/`) and open a pull request into `main`. **Never push to `main`, never merge, never approve**, never force-push a branch you did not create.
- Sign off every commit (`git commit -s`), as [CONTRIBUTING.md](../CONTRIBUTING.md) requires.
- Anything that changes wire formats, signing, canonicalization, identifiers, authority rules, a registered profile, or a release gate needs new or updated conformance vectors **and** the `needs-owner` label. The owner decides those; a team proposes.
- Never mark a release or foundation gate green, and never skip, weaken or delete a test to get green. A test that is wrong is fixed in its own pull request that says why.
- This repository is public. Write nothing here you would not publish: no credentials, no real company or personal data, no internal details of any product built on DTP, and no product names. DTP is vendor-neutral (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

## Labels

| Label | Meaning |
| --- | --- |
| `finding` | A defect or gap with a reproduction. Severity in the body. |
| `sev:critical` `sev:high` `sev:medium` `sev:low` | Severity, set by whoever files; the maintainer may change it with a reason. |
| `implementer-report` | Filed by someone building on DTP from outside this repository. |
| `needs-owner` | A decision only the owner can make. Say exactly what the decision is and your recommendation. |
| `team:maintainer` `team:red-team` | Which team owns or produced the item. |
| `team-paused` | On a log issue: that team stops until the owner removes it. |

## Reporting a gap

If you build on DTP and something is missing, wrong or hard, open an issue labelled `implementer-report` with: the DTP commit or SDK version you used; what you tried to do; what you expected; what happened; a minimal reproduction; how you worked around it, if you did. Describe the protocol gap in protocol terms. A report is useful even when the answer is "that is intended": it shows where the documentation failed.
