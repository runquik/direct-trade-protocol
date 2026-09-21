# Independent authorized change-feed helper review

Date: 2026-09-12. Reviewer: `capability_audit`. Implementer: `release_architect`.

Scope: `sdk/src/foundation/changes.ts`, shared datatype/canonical dependencies, `sdk/tests/foundation/changes.test.ts` and `docs/foundation/changes.md`, against F5. The reviewer used the code-review skill and authored separate fixtures in `sdk/tests/foundation/changes-review.test.ts`. No production fixes or acceptance-evidence writes were made by this reviewer.

## Disposition

**The reviewed bounded helper passes after the implementer's FEED-01 through FEED-03 fixes; full F5 is separately incomplete.** The code is a synchronous, pure authorized-view oracle. It neither authenticates the source/current binding nor persists an outbox or a consumer projection. No network, PostgreSQL or actual concurrent authority race was exercised by these helper tests.

| Dimension | Assessment |
|---|---|
| Correctness | Snapshot-plus-feed reconstruction, predecessor chains, replay identity, retention boundaries and scope invalidation passed; freshness metadata defects reproduced |
| Privacy/security | Equal-watermark hidden activity produces identical public pages; changed binding fields invalidate uniformly. Binding authenticity and authority revalidation remain the host's responsibility |
| Recovery | Serialized consumer restart and overlapping at-least-once deliveries converge without duplicate records. Atomic snapshot/outbox capture and consumer persistence are not implemented here |
| Performance | Explicit item, byte, history, dedup and view TTL limits exist. No measured latency/throughput or constant-time claim was reviewed |
| Maintainability | Detached data, explicit partial/complete state and uniform invalidation are useful boundaries; freshness metadata must remain consistent across every retry path |

## Findings

### FEED-01: snapshot delivery loses the latest observed watermark — closed after initial fix

`consumeSnapshotPage` originally assigned `current_as_of` from a new page unconditionally, and its exact-retry path ignored a newer watermark. Independent tests reproduced both cases:

- A delayed immutable second page generated at 00:00 lowered the 02:00 watermark already observed from a newer first page.
- A repeated first page with unchanged snapshot contents but a newer 02:00 scan watermark left the consumer's watermark at 00:00.

The documented meaning is the latest observed authoritative scan watermark. The implementer changed both paths to retain the maximum without advancing the complete projection's `as_of`. Both independent regressions now pass. These were metadata correctness defects, not demonstrated cross-company disclosure or lost record effects.

### FEED-02: newer snapshot retry leaves a stale live projection marked complete — closed

The initial watermark fix exposed a related state-label problem. A consumer already live and complete at 00:00 can receive an immutable snapshot retry carrying a 02:00 watermark after an unseen authoritative change. The consumer correctly keeps its old record and `as_of=00:00`, and observes `current_as_of=02:00`, but still reports `completeness=complete`.

Independent regression `newer snapshot retry cannot mark an already-live projection caught up to that newer watermark` initially failed (`complete` versus expected `partial`). A snapshot retry does not perform feed catch-up. The implementer now marks the projection partial when a newer observed watermark is ahead of its complete `as_of`. Independent reread and rerun confirm the regression passes without advancing `as_of` prematurely.

### FEED-03: exact snapshot retry conflicts after live catch-up advances the projection boundary — closed

`consumeSnapshotPage` compares the incoming immutable `snapshot_as_of` to the consumer's mutable complete projection `as_of` before inspecting its retained snapshot receipt. After feed catch-up advances `as_of` from 00:00 to 01:00, replaying the previously accepted exact 00:00 snapshot page throws `snapshot context conflict`. The page is already authenticated and remembered under the same binding/base checkpoint; this is a valid at-least-once retry, not a new snapshot or new page.

Independent regression `historical exact snapshot retry is harmless after complete live catchup advances as_of` reproduced the conflict. The implementer now derives the immutable snapshot boundary from the retained original snapshot receipt, checks binding/base/context and exact retry contents, and leaves new-page mode/cursor checks intact. Independent production reread and rerun confirm the historical retry is harmless after catch-up, and changed/reordered deliveries still reject.

## Reproduction and coverage

Run from `sdk` with `STORE_URL` and `DTP_TEST_DATABASE_URL` unset:

```powershell
& 'C:/Users/runqu/AppData/Local/npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe' --test tests/foundation/changes.test.ts tests/foundation/changes-review.test.ts
```

Initial independent run: 9 passed, 2 failed, zero skipped/cancelled/TODO. The first fixes produced 23 combined passes and 1 failure on FEED-02. After its correction, all 24 combined tests passed. A further exact historical retry regression then produced 12 independent passes and 1 failure on FEED-03. After the final implementer correction, a fresh independent combined run passed **25 tests** (13 independent and 12 implementer), zero failed/skipped/cancelled/TODO, exit 0. No full-gate success is claimed.

Independent probes cover:

- A 130-record immutable three-page snapshot, with concurrent correction, deletion and addition, reconstructs exactly the host's current projection after feed catch-up; completing snapshot pages alone stays partial.
- Reordered or omitted events fail before returning a new state. Overlapping batches with seen events deduplicate and converge after serialized consumer restart.
- A stable event ID cannot gain different body, checkpoint, acceptance time or profile digest, even after delivery history is pruned. Exact duplicates do not reapply effects.
- Two otherwise equal authorized views with different hidden-only source batch counts/positions and the same scan watermark return byte-equivalent snapshot/feed pages. Visible checkpoints do not encode internal source positions or version counters.
- Every current binding component is checked: view, subject, audience, organization, authority identity, authority epoch and policy epoch. Changed binding returns only `resnapshot_required`, and consumed invalidation clears active records and retained snapshot receipts.
- Retention past the original boundary prevents completing an unusable snapshot; the recognized retention floor can still retrieve remaining events. Exact absolute expiry rejects both snapshot and feed pages.
- Source continuity gaps, stale expected versions, wrong predecessors and conflicting delivered identities cannot partially mutate the caller's projection.
- Empty authorized scans can advance freshness/completeness without advancing the visible event checkpoint or exposing a source checkpoint.
- Returned pages and appended state do not alias caller-owned data; getter input is rejected without invocation.
- Delayed and duplicate snapshot freshness regressions remain explicit tests rather than inferred from final item equality.

The functions are synchronous. No artificial asynchronous permission test is claimed: a real host that awaits a database read or signing operation must revalidate the current binding before releasing a page. Supplying the old matching binding still permits a page by design because that input is trusted, not independently authenticated by this helper.

## Full F5 integration obligations

1. Atomic authoritative business effect, operation receipt and outbox persistence, plus snapshot/source checkpoint capture under a consistent database boundary.
2. Authenticated requester and current permission intersection, including installation/mandate/profile/record scope. Policy changes must update the epoch, and an endpoint must derive it rather than accept a client's assertion.
3. Database CAS for view updates, durable consumer projection-plus-progress commit, acknowledgments after persistence, bounded retention and actual restart/restore evidence.
4. Fresh authority binding on each response, including checks after any asynchronous work. Token randomness, epochs resistant to rollback, host migration and retained obligations need integrated tests.
5. Real independent application reconstruction and PostgreSQL races, rate/tenant quotas, resource measurements and CI evidence. These helper tests do not establish production capacity or availability.

Historical received copies cannot be recalled by invalidation. Constant-time resistance to resource/timing side channels was not demonstrated. A complete authorized scan is not real-time physical truth, and cached availability cannot authorize commitments or money movement. Signed webhooks are explicitly unimplemented. These limits remain required disclosures even after the helper findings close.
