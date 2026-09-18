# Independent discovery helper review

Date: 2026-09-12. Reviewer: `capability_audit`. Implementer: `profile_contracts`.

Reviewed `sdk/src/foundation/discovery.ts`, its datatype/decimal/canonical dependencies, `discovery.test.ts`, and `docs/foundation/discovery.md` against the approved F6 plan. Used the code-review skill to separate security, correctness, performance and maintainability. The reviewer added tests but made no discovery production fixes.

## Disposition

**The revised bounded helper passes the reviewed invariants; full F6 is not complete.** An unknown-demand range contradiction was reproduced and fixed by the implementer, then independently rerun. This is not authentication, network trust, production availability or whole-gate approval. Missing integrations below must stay visible in the acceptance graph.

| Dimension | Result |
|---|---|
| Security | No body/count/cursor disclosure reproduced for hidden rows; mutation and withdrawal races fail closed. Caller authentication and authoritative revision/body verification remain trusted inputs, not implemented here |
| Correctness | Exact issuer/quantity/price/time matching, separately tagged min/max constraints, locator shape and head/tombstone replay checks pass after the known-range fix |
| Performance | Storage/input/page limits are explicit. No throughput, latency, constant-time privacy or durable recovery claim was tested |
| Maintainability | Closed data shapes, explicit limitations and a small replaceable interface are positive. Integration contracts must be completed before this helper becomes a supported index service |

## Independent tests

Added `sdk/tests/foundation/discovery-review.test.ts`. From `sdk`, with `STORE_URL` and `DTP_TEST_DATABASE_URL` unset:

```powershell
& 'C:/Users/runqu/AppData/Local/npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe' --test tests/foundation/discovery.test.ts tests/foundation/discovery-review.test.ts
```

Initial result: 24 passed. After the min/max and locator additions, an independent range test produced 15 independent passes and 1 failure. Following the implementer's fix, the fresh combined result is **30 passed** (16 independent plus 14 implementer tests), zero failed/cancelled/skipped/TODO, exit 0. The latest combined discovery and runner run also passed all 45 tests. Tests use synthetic publications and real asynchronous WebCrypto hashing, not stubbed digest callbacks or a live database/network service.

The independent probes cover:

- Two otherwise identical index instances with different hidden histories produce byte-equivalent authorized pages and cursors; hidden withdrawal during hashing does not invalidate the viewer's page.
- Visible withdrawal, visibility loss and demand replacement during a pending hash reject with `restart_required` rather than return stale offers.
- Caller mutation of configuration, accepted publications and query objects does not change indexed/authorized state across awaits.
- Identical business fields do not bridge different admitted compatibility groups or goods/service families; unknown profiles reject.
- Quantity units, currency, pricing basis, area and condition identifiers compare exact issuer scope, not merely text labels.
- Exact quantity and budget boundaries differ at one millionth without floating-point tolerances; touching half-open time windows do not overlap, and partial overlap is flagged.
- Withdrawn records cannot be resurrected by replaying an old revision ID with either its original or a changed digest.
- Private, absent, stale and withdrawn demands share the same unavailable error.
- Accessors are rejected without execution; sparse/cyclic/extra-field input and noncanonical, oversized or floating decimal values never enter the index.
- Hidden cursor anchors and cross-viewer cursor reuse cannot widen the returned scope.
- Known minimum and maximum quantities retain exact units; unknown limits are explicitly flagged rather than treated as unrestricted. An unknown exact demand with a known range cannot match contradictory supplier minimum, maximum or available capacity.
- Malformed bounds and a locator naming another provider reject. Locator changes in a replacement publication invalidate existing visible cursors without changing company identity; no endpoint is fetched.

The existing implementer tests additionally cover unknown versus zero, exact retry semantics, two-index replay, output cloning, expiry, excluded fees/taxes and various page bounds. These are useful complementary tests, not substitutes for the missing authenticated integration.

## Open F6 completion findings

### DISC-01: minimum/maximum contract and range matching — closed for helper

The initial single-quantity contract could not represent available capacity separately from a minimum order, maximum order or demand range. The implementer added required knowledge-tagged `min_quantity` and `max_quantity`, exact issuer-scoped units, publication consistency checks and an explicit unknown-order-limits limitation.

The first revision still matched a demand whose exact quantity was unknown but whose range was 10–20 cases against a supplier requiring at least 30 cases. Independent tests also exercised a supplier maximum of 5 and only 5 cases available. This was a real false-potential-match correctness defect, not merely an unimplemented feature. The reviewer did not change production code.

The implementer now intersects every known lower and upper bound, compares exact unit identity across all known quantity fields even when exact demand is unknown, and rejects an empty intersection. Independent reread and rerun confirm all three contradiction variants reject, while unknown coverage remains explicit. This closes the bounded helper's min/max finding; it does not establish inventory availability or authoritative booking.

### DISC-02: quote/booking locator shape — closed for helper; trust integration remains DISC-03

The revised contract requires an `authority_locator` with the exact provider organization, profile digest, quote operation and booking operation. Spoofed provider binding and unsupported extra URL fields reject. A changed locator under a new publication revision invalidates a prior visible cursor. The helper still follows no endpoint URLs, retaining its no-outbound-fetch boundary.

This closes the missing declared shape, not actual authority resolution. The advertised locator is a contract hint, not authenticated endpoint provenance. Resolver trust, real company hosting relocation, authoritative operation invocation and rechecking remain under DISC-03; a synthetic locator revision is not evidence that these network integrations work.

### DISC-03: verified-feed, revocation and authoritative recheck integration remains absent

`apply(publication, authenticatedProvider, acceptedAt)` accepts an asserted provider ID and trusted timestamp; it does not authenticate the caller, verify the publication digest against signed authoritative bytes, or verify publishing agency. `findPotentialOffers` similarly trusts caller-derived viewer identity and time. The documentation correctly states these limits.

Two in-memory replicas fed the same synthetic history demonstrate deterministic replacement, not durable authenticated catch-up, checkpoint/retention recovery, full permission revocation wiring or real host relocation. Nor does an index result perform an authoritative quote/hold/booking check. These required integrations must have their own passing evidence before F6 is green. No real-world availability or physical/legal verification follows from an issuer's signature alone.

## Additional limits and positive observations

The view digest excludes hidden result contents and global feed counters, and the code rechecks the authorized view after awaited hashing. That is stronger than checking permissions only before an asynchronous step. Returning cloned publications also prevents caller mutation of the stored index.

The implementation labels every result `potential`, `this-index-only` and `authoritative_recheck_required`, retains unknown quantity/RFQ limitations, and flags partial windows and excluded/unknown fees or taxes. It does not claim the asking price is a universally computed landed total. Operator-assigned compatibility groups are explicitly local assertions; no downloaded profile code is executed.

Cursor integrity here is a view-consistency mechanism, not an authentication token. A client can skip its own visible anchor, as documented; the tests require it cannot select hidden data. Output equality does not establish resistance to timing/resource side channels from scanning a differently sized index. The bounded O(number of publications) search and serialization of the visible matching set require measurement under F9's operational envelope.

No discovery production fix was made by this reviewer, and no F6 acceptance observation was recorded. DISC-01 and the helper portion of DISC-02 are closed by independent inspection and tests. DISC-03 remains a full-F6 completion blocker until authenticated feeds, permission/revocation wiring and authoritative resolution/rechecks have their own passing integration evidence.
