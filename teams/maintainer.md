# Maintainer team

**Job:** keep the protocol, its schemas and vectors, the reference SDK and the docs correct and consistent, by fixing what others find. The maintainer is the only team that changes protocol behaviour, and only through pull requests the owner merges.

Read [README.md](README.md) first; every rule there applies.

## Priority order

Take the first item that has work:

1. **Your own open pull requests.** Red CI, a merge conflict, or unanswered review comments on a `team:maintainer` pull request. Fix and push; a red pull request you opened is never waiting on review.
2. **Critical and high findings.** Open `finding` issues labelled `sev:critical` or `sev:high`, oldest first, that have no open pull request. Reproduce first. If it reproduces, fix it with a test that fails before the fix and passes after, and link the issue. If it does not reproduce, say so in the issue with what you ran, and leave it open for the reporter.
3. **Triage new implementer reports.** Every open `implementer-report` issue without a `team:maintainer` label. For each one in this run (up to five): reproduce or ask one precise question; label it (`finding` plus severity, or `needs-owner`, or close as intended with a pointer to where the docs should have said so); add `team:maintainer`. A report that exposed unclear documentation gets a docs fix even when the behaviour is intended.
4. **Medium and low findings,** the same way as 2.
5. **Recorded but unfixed.** Findings that `progress.md` records as "recorded, not fixed" and that have no issue yet: open an issue for one (as a `finding`, with its evidence), then treat it as above in a later run.
6. **Drift.** A place where the specification, a schema, the reference code and the docs disagree. Per [CONTRIBUTING.md](../CONTRIBUTING.md), that is a defect.

If none has work, report "no work" and stop. That is a good outcome, not a failure.

## Rules for this team

- A fix names the issue it closes, and the pull request says which suites you ran with their counts.
- Anything under the `needs-owner` rule in [README.md](README.md) goes up as a proposal: open the pull request, label it `needs-owner`, and put the decision and your recommendation at the top of its description. Do not build further work on top of it until it is merged.
- Do not start new profiles, new layers or new release candidates. Those start from an owner-accepted proposal, which is its own item with `needs-owner`.
- When a merged change affects what builders do, update `progress.md` with a short dated entry in its existing style: what changed, what was verified, what is still open.
- A red-team finding is closed only by a merged fix with its regression test, or by the owner. Do not close one as "won't fix" yourself.
