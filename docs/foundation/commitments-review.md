# Independent commitment and coordination helper review

Date: 2026-09-12. Reviewer: `capability_audit`. Implementer: `profile_contracts`.

Scope: `sdk/src/foundation/commitments.ts`, decimal/datatype/canonical dependencies, `sdk/tests/foundation/commitments.test.ts` and `docs/foundation/commitments.md`, against the approved F7 plan. The reviewer used the code-review skill, added independent tests and made no commitment production fixes or acceptance-evidence writes.

## Disposition

**The reviewed bounded helper passes after the implementer's COM-01 fix; full F7 is separately incomplete.** Pure transitions do not establish authenticated provider authority, durable storage, real inventory allocation or crash-safe networking.

| Dimension | Finding |
|---|---|
| Correctness | Actual sweep agrees with an independent discrete-window capacity oracle; elapsed-window confirmation defect reproduced, fixed by implementer and independently closed |
| Security | Exact provider/command/receipt binding and plain-data rejection passed tested paths; caller identity, state authenticity, approvals and accepted time are trusted integration inputs |
| Recovery | Lost confirmation/cancellation and fulfillment racing compensation tested against actual provider transitions, not stubbed successful callbacks; external persistence and CAS remain unimplemented here |
| Performance | Explicit state/history/leg/input limits prevent unbounded growth in the helper; throughput and whole-system resource limits still require F9 measurement |
| Maintainability | Clear historical receipt and settlement labels; resource-kind limits and host obligations documented. Generic windowed capacity must not be promoted to consumptive goods accounting |

## COM-01: elapsed service window can be newly accepted — closed

Priority: high correctness. In `applyProviderCommand`, creating a hold checks that `q.window.end > now`; confirming the hold originally checked quote and hold expiry/current revision but omitted the service-window end. A quote with a 01:00–02:00 capacity window and noon expiry, held before 01:00, was accepted by a new confirmation at exactly 02:00. The half-open window has ended, so no available service interval remains to promise.

Independent regression `independent commitments: new confirmation cannot accept a capacity window that has already ended` initially failed with `Missing expected rejection`. Ten other independent tests passed in that first run. The test also requires failed confirmation to leave input state unchanged. This is not the exact retry of a previously accepted historical command; those receipts should remain replayable under their documented contract.

The implementer added `q.window.end > now` to new confirmation's precondition. Independent reread of the production branch and a fresh run of both suites confirm the regression now rejects at the exact end boundary, while existing accepted obligations and historical retries retain their behavior. No production edit was made by this reviewer.

## Independent evidence and coverage

The reviewer added `sdk/tests/foundation/commitments-review.test.ts` with separately constructed synthetic fixtures. Provider responses in coordination tests come from real `applyProviderCommand` calls and their real receipts. Tests serialize and restore coordinator objects to exercise the declared persistence boundary; they do not claim an actual process crash or durable database commit occurred.

Run from `sdk`, with `STORE_URL` and `DTP_TEST_DATABASE_URL` unset:

```powershell
& 'C:/Users/runqu/AppData/Local/npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe' --test tests/foundation/commitments.test.ts tests/foundation/commitments-review.test.ts
```

Coverage includes:

- Ten alternating reservations compared with a separate hour-grid peak oracle, including adjacent half-open boundaries, valid disjoint overlaps and unchanged state on capacity refusal.
- Completed and disputed bookings retain their original window capacity; provider-accepted cancellation frees capacity. This is bounded booking accounting, not goods replenishment.
- Exact hold expiry blocks new confirmation. A replayed historical `held` receipt does not make the projected current hold unexpired or allow coordination to skip confirmation.
- Changed business-ID reuse binds action, hold, quote, expiry and fulfillment evidence; exact fulfillment retry does not count units twice.
- Short/damaged fulfillment, zero-unit final shortage and fulfillment closure remain distinct from completion and payment settlement. Invalid/oversized and empty nonfinal fulfillment cannot mutate input.
- Every independently altered response binding (provider, operation, command digest, hold, action, status, quote digest and receipt digest) is rejected.
- A lost actual confirmation acknowledgment remains uncertain and retries the same command after serialization/restart without a duplicate firm commitment.
- An expired hold triggers explicit release/compensation rather than a committed order.
- Actual fulfillment arriving before compensation makes cancellation fail and preserves the provider's fulfilling obligation in an exception. The other provider's hold is explicitly released.
- A lost actual cancellation acknowledgment cannot claim compensation before the exact provider receipt is recovered; retry does not cancel twice.
- Mutation of caller-owned state, command or quote after an awaited hash starts does not change the copied operation. Accessor payloads are rejected without executing the getter.

Initial independent execution was 10 passed, 1 failed, zero cancelled/skipped/TODO. Two additional independent tests were then added for cancellation-timeout and malformed fulfillment behavior. Following the implementer's timing fix, the fresh combined run passed **28 tests** (13 independent and 15 implementer), zero failed/cancelled/skipped/TODO, exit 0. This is local implementation-slice evidence only, not full F7 approval.

## Required integration work, not waived by helper approval

1. Authenticate provider/customer/agent operations and exact-input approvals; validate revision signatures, state provenance and a host-controlled accepted clock. The helper accepts asserted identities and supplied state, not credentials.
2. Atomically compare provider/coordinator revisions and persist effects, operation receipts and an outbox. Concurrent pure calls against the same input are not database concurrency protection. Durable receipts must survive restart and bounded-history exhaustion without silent eviction.
3. Authenticate definitive provider refusals and responses; connect timeout/retry to actual durable messaging. Serialization tests do not prove PostgreSQL recovery, network partition behavior or cross-host atomicity.
4. Connect goods to consumptive inventory/lot handlers and preserve unit/resource-specific semantics for warehouse, transport and staffing. The `kind` field does not implement those four allocation engines.
5. Wire authoritative current-state queries, permissions/revocation, company-host relocation and outstanding commitments into the other foundation packages. A historical receipt proves an earlier accepted operation, not an indefinitely current physical or commercial state.
6. Implement the bounded reference commerce integration, including approval/change conditions and provider substitution reconciliation. Quote parsing alone does not validate externally agreed responsibility or legal terms. Settlement remains `external_pending`; no payment or legal guarantee is created here.

These remain full-F7 blockers. No independent approval of the whole gate, deployment, production operation or external publication is implied by this helper review.
