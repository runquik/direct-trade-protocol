# Independent persistence finalization delta review

Date: 2026-09-12. Reviewer: `capability_audit`. Delta implementer: `root`. This reviews the later finalization changes, not the reviewer's earlier review artifacts or their authorship.

Scope: `finish`/`beforeCommit` in `sdk/src/foundation/persistence.ts`, the required-hook interface and documentation, the explicitly synthetic fixture callback, and root's `persistence-finalization.test.ts`. Added separate `persistence-finalization-review.test.ts`; no production edits or acceptance evidence were written.

## Disposition

**The reviewed host-library finalization delta passes its scoped tests.** This is not approval of a concrete authentication/deadline hook, authenticated routes or full F9. The `beforeCommit` implementation in the shared synthetic fixture is explicitly a no-op; its presence must not be represented as enforcing credential expiry at SQL commit.

The library now requires a hook instead of supplying an unsafe default. It captures a fresh time after provisional writes, rejects clock regression and rechecks authority from the original locked row. This matters because rechecking the already charged row would incorrectly charge or reject the same execution again. The recheck must agree with original-versus-replay status. The deadline includes the active grant chain and, for new effects, supplied approval expiries. The hook receives the exact detached/frozen original request, verified actor/grant, original authority, fresh time, deadline and replay indicator before a receipt can leave the transaction.

Historical retries bind the original grant ID in addition to intent and actor; substituting a new equivalent grant does not silently revive an old operation. They still need current active authority, but do not demand fresh approval of already accepted effects or recharge usage.

## Independent execution

Under Node v22.23.2 with shared database overrides unset, ran:

```text
--test tests/foundation/persistence-finalization.test.ts tests/foundation/persistence-finalization-review.test.ts tests/foundation-postgres/persistence.test.ts
```

**21 passed**, zero failed/cancelled/skipped/TODO, exit 0: 5 root finalization tests, 4 independent finalization tests and 12 separately reviewed real-PostgreSQL store tests. The 9 finalization tests use PGlite; they must not be mislabeled as real-server deadline qualification. A separate whole-SDK typecheck passed.

Independent probes establish:

- A command exhausting its budget succeeds exactly once. The final hook sees original used amount zero while provisional SQL stores the single accepted charge; a second charge is not persisted.
- A real SQL error raised by the final hook after observing an inserted receipt rolls back every exact row across all six tables, not just record counts.
- A delegated child grant and exact-plan approval yield the earlier deadline; an old accepted receipt can be retried after the old approval expires while its original grant remains live, without charging the parent again.
- A final hook detecting a changed live permission aborts all provisional effects and history.

Root cases additionally demonstrate missing-hook refusal, late grant/approval expiry, exact original request and immutable callback input, regression of the host clock, changed-grant retry conflict and hook execution on historical retries.

## Remaining boundaries

1. The concrete hook must enforce `min(valid_until, credential expiry)` at actual SQL commit, not merely compare a clock before another await. It must verify the original request and keep identity/origin/profile/installation/mandate reads serialized with relevant revocation until commit. That implementation is not present in the synthetic fixture and requires independent tests on the real server.
2. The represented organization's lock protects its grants but not other organizations' or resolver rows. Foreign/global authority requires correctly ordered locks or an equivalent reviewed serializable design.
3. This hook finalizes `execute`, including its historical retry path. Governance, bootstrap and import have different trusted-hook paths; the review does not imply this particular callback enforces their credential deadlines.
4. Finalization uses the supplied trusted clock. The concrete host must align its credential/authority time model and SQL deadline enforcement, including skew policy and the rejection boundary, and fail on deadline exhaustion without publishing success.
5. All supplied approval expiries conservatively contribute to the declared deadline even if additional approvals exceed a quorum. This is fail-closed; callers should not include irrelevant stale approvals. It is not a claim that approval selection has been optimized for availability.

No new defect was reproduced in the scoped delta. Independent finalization approval here does not close the authentication integration, recovery, migration, performance, external-builder or full-release requirements.
