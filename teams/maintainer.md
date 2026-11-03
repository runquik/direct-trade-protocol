# Maintainer team

**Job:** keep the protocol, its schemas and vectors, the reference SDK and the docs correct and consistent, by fixing what others find and building what the owner decided. The maintainer is the only team that changes protocol behaviour, and only through pull requests the merge gate merges once they are decided or reviewed.

Read [README.md](README.md) first; every rule there applies.

## Priority order

Work down this list for the whole session budget in [README.md](README.md), always taking the highest item that has work:

1. **Your own open pull requests.** Red CI, a merge conflict, a branch behind a merged stack bottom, unanswered review comments, or a red-team comment that blocks the merge, on a `team:maintainer` pull request. Fix and push; a red pull request you opened is never waiting on review. An `owner-approved` pull request that has not merged is yours to finish: bring it up to date with `main`, make it green, mark it ready, and answer what blocks it. The decision stands through all of that; do not ask the owner again. If the merge gate commented on it, do what the comment says.
2. **Critical and high findings.** Open `finding` issues labelled `sev:critical` or `sev:high`, oldest first, that have no open pull request. Reproduce first. If it reproduces, fix it with a test that fails before the fix and passes after, and link the issue. If it does not reproduce, say so in the issue with what you ran, and leave it open for the reporter.
3. **Decided work.** Issues labelled `owner-approved` that have no open pull request, oldest decision first. Build exactly what the owner's decision comment says, with its vectors, and label the pull request `owner-approved` only if the decision covers everything in it; anything you had to choose that the decision did not settle goes up as a new question (see [When you are blocked](README.md#when-you-are-blocked)), and the pull request carries `needs-owner` until it is answered.
4. **Triage new implementer reports.** Every open `implementer-report` issue without a `team:maintainer` label. For each one in this run (up to five): reproduce or ask one precise question; label it (`finding` plus severity, or `needs-owner`, or close as intended with a pointer to where the docs should have said so); add `team:maintainer`. A report that exposed unclear documentation gets a docs fix even when the behaviour is intended.
5. **Review the red team's gap tests.** Open red-team pull requests (branches `claude/red-team-…`) that add a gap test, with commits since your last review. Check out the head, run it, and confirm that it passes on `main`, that it records exactly the behaviour its finding describes (its `GAP` assertions would flip if the gap were closed), and that it contains a test and nothing else. Then label it `reviewed`, or comment what blocks it. Skip a gap test that the owner said lands with, or is replaced by, a fix: the fix's pull request closes it.
6. **Medium and low findings,** the same way as 2.
7. **Recorded but unfixed.** Findings that `progress.md` records as "recorded, not fixed" and that have no issue yet: open an issue for one (as a `finding`, with its evidence), then treat it as above in a later run.
8. **Drift.** A place where the specification, a schema, the reference code and the docs disagree. Per [CONTRIBUTING.md](../CONTRIBUTING.md), that is a defect.

If none has work, report "no work" and stop. That is a good outcome, not a failure.

Items waiting on the owner (`needs-owner` before its date) do not block the rest of the list: record them in the report and move to the next item. Use a stacked pull request (see [README.md](README.md)) when the next fix needs one of your unmerged ones.

## Rules for this team

- A fix names the issue it closes, and the pull request says which suites you ran with their counts.
- **Check the decisions record before asking.** If [docs/decisions.md](../docs/decisions.md) already answers a question (the same rule, an earlier option chosen for the same kind of case, a stated priority), act on it and cite the entry. Do not label `needs-owner` for something the record answers, and do not wait on the owner for it.
- Anything under the Authority rule in [README.md](README.md) that the record does not answer goes up as a proposal: open the pull request, label it `needs-owner`, and put the decision in the form from [When you are blocked](README.md#when-you-are-blocked) at the top of its description. You may stack further work on it, as on any of your unmerged pull requests, but nothing in the stack merges before the owner decides.
- Do not start new profiles, new layers or new release candidates. Those start from an owner-accepted proposal, which is its own item with `needs-owner`.
- When a merged change affects what builders do, update `progress.md` with a short dated entry in its existing style: what changed, what was verified, what is still open.
- A red-team finding is closed only by a merged fix with its regression test, or by the owner. Do not close one as "won't fix" yourself.
- Never add `reviewed` or `owner-approved` to your own pull requests.
