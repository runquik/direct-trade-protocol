# Independent semantic-handler helper review

September 12, 2026. Scope: `sdk/src/foundation/semantics.ts`, its original tests
and `docs/foundation/semantics.md`, authored by the profile/contracts implementer.
This reviewer did not implement the helper or its production corrections. Eight
additional probes are in `sdk/tests/foundation/semantics-review.test.ts`.

## Disposition and evidence

**Scoped helper acceptance: no reproduced blocker under its documented trusted
operator and already-authorized-input boundary.** Independent run of the original
12 tests plus eight review probes: **20 passed, zero failed, zero skipped** with
Node 22.23.2. No production changes were required for these review probes.
This does not approve an operation endpoint, handler sandbox, full F4, or release.

The review tested contradictory revision/profile/body aliases before handler
invocation, wrong-company/kind CAS substitution, explicit nonexistence during
resource creation, output getters/custom prototypes, undeclared effects and
injected authority/receipt fields, output validator exceptions and promises,
cycles/depth/aggregate bounds, copied capabilities and recursively frozen inputs.
Positive controls use the same admitted contracts as denials; valid initialization
and exact supported update planning remain usable.

The input/snapshot consistency check compares exact scoped revision identity and
then digest, profile and body. Resource effects must stay in the represented
organization's declared resource set. Complete expected-resource CAS closure,
per-resource update uniqueness, within-plan new-ID uniqueness, admitted output
profiles and local output-body validators are independently enforced by the helper.
Unknown effect kinds and extra plan/effect fields cannot become arbitrary table
operations. Input/output JSON bounds are applied before the corresponding local
handler/validator execution, and their exceptions are redacted at this boundary.

## Important approval-binding decision

The existing `intent_digest` hashes `intent.inputs` but not every resource snapshot
revision automatically. A snapshot may be mutable concurrency state rather than
an explicitly named business input. Reevaluating an intent against a newer stock
snapshot can therefore preserve the intent digest while changing its effect plan.
Exact CAS prevents a stale write, but by itself does not bind a human approval to
the exact evaluated terms and dependency versions.

The integration lead explicitly selected this rule during review: **kernel
approvals bind both the exact intent digest and an evaluated-plan digest that
includes expected resources and exact revisions.** Changed snapshot/CAS or planned
effects require reevaluation and reapproval; an old approval cannot silently carry
forward. Pin the digest preimage/domain in the operation authority contract and
add desired-denial tests for changed quote, provider, quantity, price, deadline,
resource revision and operation ID. This is a required integration decision, not
functionality implemented by this helper.

## Trust and integration limits

- `evaluateAuthorized` does not authenticate anything. The caller must construct
  signature-verified, authorized inputs and authoritative snapshots in the same
  transaction/locking boundary as the later effect. Parsing a revision digest
  does not prove its body, issuer or availability. Caller-supplied accepted time
  is not automatically an authenticated acceptance timestamp.
- Descriptor digests are checked, but handler artifact digests and output validator
  profile associations are operator assertions. The wrapper cannot prove a local
  function was built from those artifact bytes. Deployment admission and conformance
  evidence must establish those associations. A validator returning true does not
  establish business truth, physical availability, identity or legal authority.
- Local functions remain trusted code with access to JavaScript globals. Freezing
  the provided copies prevents API-level mutation, not side effects, CPU exhaustion,
  network activity via globals, or arbitrary nondeterminism in malicious operator
  code. No runtime-uploaded code or sandbox is claimed. Promise-returning handlers
  are rejected, but a wrongly admitted async function could already have started
  side effects before returning its promise; rejecting the plan does not undo them.
- The kernel must prevent ordinary `record.append` from fabricating operation-managed
  commitments, reservations or payment authority. Existing generic write paths are
  unchanged, so no such authoritative new operation can yet be advertised as safe.
- New-ID collisions with historical database records, resource/profile admission,
  ancestry, current mandate/grant chains, distinct-human approvals, budget charging,
  idempotent receipts, effect/outbox atomicity and revocation races remain kernel
  obligations. A declaration in `required_grants` is not a presented credential.
- The returned plan is not a persisted operation receipt. Durable business-ID and
  intent/plan binding must prevent cross-request retry duplication and conflicting
  reuse. Current read permissions still govern receipt disclosure.
- Output plans must not manufacture trusted host/approval provenance inside a body
  accepted by an overpermissive profile validator. The kernel derives authoritative
  envelope/receipt fields, and the admitted profile distinguishes attributed body
  assertions from actual acceptance, approval and observed evidence.
- Whole-envelope 256 KiB, 8,192-node, depth-16 and nested collection bounds do not
  replace request-rate controls or execution-time isolation. Operator admission
  lists and callbacks are trusted local inputs, not public wire payloads.

## Required downstream graph evidence

Before claiming F4 integrated, require the generic-write bypass negative; current
identity/agency/data/operation authority checks; intent-plus-plan approval binding;
transactional CAS/ancestor-budget/receipt/outbox races; exact handler capability
migration preflight; and an independently implemented compatible consumer or an
explicit unsupported-semantics refusal. Planning-helper tests alone cannot close
those graph nodes.
