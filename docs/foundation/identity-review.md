# Independent identity-helper review

September 12, 2026. Scope: root-authored `sdk/src/foundation/identity.ts`, its
seven original tests and `docs/foundation/identity-contract.md`. This reviewer
previously proposed architecture boundaries but did not implement these helpers.
Independent desired-result tests live in `sdk/tests/foundation/identity-review.test.ts`.

The user-approved direction is separately enrolled user-controlled recovery keys
and a replaceable explicitly trusted resolver. Root ratified maximum 30-second
authorization leases plus a five-second effective-revocation margin, cooperative
resolver transfer only, and UUID-compatible permanent genesis identity with the
full genesis digest retained. Review does not reopen those product decisions or
mistake standalone helpers for an operating registry.

## Reproduced helper findings

### P2: issuance and verification disagree at the supported clock boundary

`clock` permits `now = Number.MAX_SAFE_INTEGER - 300000`. `createIdentity` and
`issueResolution` succeed there, but the resulting proof cannot be verified at
the same instant: its `expires_at = now + 30000` fails the same headroom-restricted
clock validator. Timestamp validity and arithmetic headroom are different checks.
The desired regression requires every successfully issued proof to verify at its
issuance time; rejecting all later new issuance before arithmetic overflow remains
valid. This is a formal bounded-contract defect, not a practical far-future outage.

### P2: signed control heads omit required predecessor-shape validation

`verifyResolution` initially accepts sequence zero with a non-null predecessor,
or positive sequence with a null/non-digest predecessor, provided the trusted
resolver signs and hashes that malformed head. Checking signatures and the head
digest does not replace validating the control contract. The independent test
re-signs exact synthetic heads and requires malformed predecessors to reject.
This does not claim protection from a malicious trusted resolver inventing a
well-formed history; that remains an explicit trust limit.

### P2: nested data can execute accessors before validation

`verifyResolution` initially canonicalizes the nested control head before checking
its descriptors; a `sequence` accessor runs twice before rejection. Key arrays are
also consumed through `.every`/`.forEach` without descriptor validation, and a
genesis containing an accessor key element is accepted. Signature arrays need the
same defensive treatment before iteration. Reject non-data/accessor elements,
extra properties and malformed array prototypes before reading or canonicalizing.

The reproductions are in-process JavaScript inputs, not a claim that JSON transport
transmits executable getters. This is relevant to a helper that already advertises
closed plain-data validation, and also prevents accidental side effects from local
objects. It does not establish a sandbox against arbitrary proxies or malicious
operator code. The signer helper remains a trusted local utility, not admission.

Initial combined run: 15 tests, 12 passed and three failed. An additional key/signature
array probe independently fails because accessor-bearing key arrays are accepted.
All regressions assert the intended result; none converts a known defect into an
expected-gap green result. Production corrections belong to root, not this reviewer.

First fix recheck: descriptor-safe key/signature arrays, nested head validation
before canonicalization, and predecessor shape checks pass independent tests.
Separating expiry timestamp validation from issuing-clock headroom fixes proof
verification at issuance. A strengthened assertion at the last millisecond of the
same valid lease still fails because verifier `now` retains the issuing-headroom
restriction. Verification does not issue a new future timestamp and should retain
the full valid lease interval. This remaining boundary case stays open until fixed
and independently rerun.

The same nested-shape recheck also found that `head_digest` was not validated as
a digest string before signature canonicalization. An object in that field can
carry another accessor (or deeply nested JSON). The existing accessor regression
now covers this position too; validating the field's bounded digest type before
canonicalization is required to close the original finding completely.

## Positive observations

- Permanent genesis-domain signatures reject wrong-domain and missing-key
  possession. Operational/recovery key sets are disjoint; thresholds count distinct
  keys within a control set. This is not a distinct-human quorum claim.
- Recovery works without ordinary credentials only with the full pre-enrolled
  recovery threshold and possession of new keys. Ordinary credentials cannot
  replace recovery policy. Retired recovery and operational keys cannot return.
- Multiple issued leases extend the persisted maximum expiry. Recovery drains the
  last lease plus the margin; neither old expired leases nor premature new-head
  issuance survives that barrier in the tested sequential helper flow.
- Resolver key, epoch, audience, challenge and identity are bound. Wrong resolver
  signatures and equal-sequence checkpoint conflicts reject. Returning cloned
  state rather than mutating the supplied state permits transactional orchestration.

## Integration blockers, not helper bugs

1. **First resolver enrollment.** The same signed genesis can initialize states at
   different supplied resolvers. That is useful for host-independent ID derivation,
   but not authority to choose or replace the identity's resolver. Verifiers need
   an owner-authorized initial resolver binding (separate from identity derivation)
   or an equally explicit enrolled trust policy. Trusted resolver discovery alone
   must not resurrect old genesis keys or select a sibling control history.
2. **Durable CAS and uniqueness.** Two calls to pure `transitionIdentity` on one old
   snapshot can both compute valid siblings. The registry must atomically accept
   at most one, persist receipts and reject conflicting same-ID/full-genesis-digest
   enrollment. There is no global concurrent-registration guarantee in these functions.
3. **Lease issuance and transitions share a transaction.** Dropping the returned
   issuance state or racing it with rotation invalidates the effective barrier.
   Persist maximum expiry and head change atomically; never reuse an earlier snapshot
   to issue a proof after a transition. A proof becomes deliverable only after its
   lease accounting commits durably.
4. **Verifier consumption.** Fresh unpredictable challenges, single-use consumption,
   live expiry at effect execution and rollback checkpoint persistence are caller
   obligations. Recalling `verifyResolution` alone does not consume a proof.
5. **Trust versus lineage.** A pinned resolver currently vouches for higher-sequence
   heads; the verifier does not prove a complete chain from a lower checkpoint or
   recalculate the genesis identity from a returned full genesis. Document that
   trust explicitly. If independent lineage verification is promised, add bounded
   transition proofs and full-genesis binding before making that claim. A trusted
   resolver signature is not global consensus or protection from resolver compromise.
6. **Replacement, recovery and legacy continuity.** Cooperative resolver transfer,
   durable freeze/readiness/receipt, draining old leases, third-host epoch adoption,
   legacy imports, and fencing a returning failed resolver are not implemented.
   Loss of every surviving recovery authority remains unrecoverable. No unilateral
   reset by any host or workspace operator, and no silent new resolver, may fill those gaps.

The full genesis digest must be checked on registration/restore; a matching
128-bit derived UUID alone must never merge two different genesis documents.
Similarly, issuing a new sequence must not convert resolver authority into company
membership, service grants, policy stewardship or commercial power. Those layers
require separate live authority checks.

## Disposition

All reproduced helper findings are now resolved. This reviewer independently read
the final corrections (`timestamp(now)` for verification, issuing-clock headroom
only for new issuance, bounded predecessor/digest validation before canonicalization,
and descriptor-safe key/signature arrays) and reran both suites: **16 passed, zero
failed, zero skipped**. The tests include the full last-millisecond lease boundary
and the nested `head_digest` accessor position. The helper slice has scoped
acceptance under its documented trusted-resolver/authoritative-snapshot boundary.

The contract now explicitly identifies owner-signed initial resolver enrollment
and trusted-resolver newer-head assertions versus independently proven lineage.
Those qualifications do not implement their missing integration. F1 and the
foundation release remain open: registry storage, execution integration,
transfer/restore and authority/privacy scenarios require their own graph evidence.
