# Operator-admitted semantic effect plans

Internal foundation draft, September 12, 2026. Direct import:
`sdk/src/foundation/semantics.ts`. This is a pure planning/admission helper, not
an integrated operation endpoint. Existing generic record writes are unchanged.
No new authoritative business operation is safe to advertise until the kernel
integration and bypass negatives below pass independent review.

## Contract and admitted implementations

`OperationDescriptor` declares `profile_digest`, `name`, exact
`input_profile_digests`, separate `output_profile_digests`, `required_grants`,
`allowed_effects` (`resource.update` and/or `record.append`), `max_inputs`,
`max_resources`, `max_effects`, `concurrency:'exact-revision'` and
`retry:'business-operation-id'`. Counts are bounded at 32; descriptor lists are
unique. Its digest is SHA-256 of canonical descriptor JSON. Required grants are
declarations, not credentials. A descriptor cannot implement arbitrary policy.

`createSemanticRegistry(admissions, outputValidators)` accepts only
operator-supplied local functions. Each admission has `descriptor`,
`descriptor_digest`, `handler_digest` and synchronous `evaluate`. Every declared
output profile needs a locally admitted `{profile_digest,validate}` whose
synchronous return is exactly true only for accepted bodies. Registry construction
copies/freezes declarations, rejects duplicate operation registrations and verifies
descriptor digests. Handler digests and validator/profile associations are
operator assertions about reviewed artifacts, not hashes verified from JavaScript
function text. There is no wire admission path, schema URL fetch, import, eval,
download or fallback to structural-only operation success.

The local function boundary is not a sandbox. Operator code can access JavaScript
globals; deployment must admit only reviewed deterministic implementations.
Handlers receive frozen authorized copies, explicit accepted time and no Context,
State, database client, clock, random generator or callback through this API.
They must return a synchronous plan; promises and malformed plans are rejected.
Determinism is a handler contract tested by repeated fixtures, not a theorem
established by this wrapper.

## Input and output

`AuthorizedOperationInput` consists of:

- `intent`: `{operation_id,organization_id,profile_digest,operation,
  descriptor_digest,handler_digest,resources,inputs,parameters}`. Resource refs
  are unique company-local `resource` references belonging to the represented
  organization. Input revision refs are unique and exact. Parameters are bounded
  plain JSON objects; their business schema is part of the admitted handler.
- `authorized_inputs`: exact `{revision,profile_digest,body}` copies matching all
  and only the intent's declared input revisions. Profile support is explicit.
- `snapshots`: exact `{resource,profile_digest,current_revision,body}` for all and
  only the declared resources. A nonexistent resource has null revision and null
  body. Existing state has a same-resource exact revision and object body.
- `accepted_at`: explicit UTC millisecond instant. Its authority/freshness is a
  kernel responsibility, not inferred from the caller's supplied timestamp.

The function name `evaluateAuthorized` does not authenticate these values. The
kernel must supply authorized, signature-verified copies and authoritative
snapshots while retaining its transaction/locks. No digest preimage is guessed
for externally supplied revision references.

Handlers return `EffectPlan` with exactly `expected_resources` and `effects`.
Expected resources must contain the complete snapshot CAS set, once each.
Resource updates include `resource`, exact `expected_revision`, a distinct new
`next_revision_id`, `profile_digest` and object `body`. They cannot silently
change the resource's profile. Record appends include `record_id`, `resource`,
`profile_digest` and object `body`. All effects stay within declared company
resources, kinds/count limits and output profiles; output bodies must pass their
local profile validator. Updates are unique per resource and new revision/record
IDs are unique within the proposed operation. Existing-table ID collisions remain
a kernel constraint. Input/snapshot identity overlaps must agree on exact digest,
profile and body. The returned `EvaluatedOperation` adds the operation/company,
exact intent digest and admission pins so the kernel can bind its receipt.

Each input envelope and the complete effect plan is limited to 256 KiB canonical
UTF-8, 8,192 visited JSON values, depth 16 and 64 KiB individual strings. Arrays
are dense, at most 256 elements even inside business bodies; objects have at most
128 keys. Undefined, floating JSON numbers, symbols, getters, custom prototypes,
prototype pollution keys and malformed Unicode are rejected without field
stripping. Decimals remain strings; profiles choose precision/rounding rules.

## Kernel integration required

Before committing, the existing kernel must recheck current identity, represented
company authority, module intersection, exact required operation/data grants,
mandates and approvals. It owns scope policy, record/profile admission, all
resource CAS checks, immutable business-ID/intent receipts, ancestry budget
charges, uniqueness, rollback and outbox events in one transaction. This helper
never authorizes budget charges, grants, identities, handler installation,
arbitrary tables, external payments or network effects. It does not retry/apply
plans. A handler cannot opt out of kernel-derived budget consumption.

Mark operation-managed record kinds/resources and reject attempts to fabricate
the same authoritative effect using generic `record.append`. Validate foreign
keys, record ancestry and exact output versions centrally. Do not let the
handler create its own trusted receipt/provenance fields; derive them from the
evaluated intent and admission pins. Replays disclose only currently authorized
receipt fields. Host migration must preflight the exact admitted handlers and
carry operation receipts, budgets, pending work and outbox state before freezing.

The integration contract additionally requires approvals to bind both the intent
digest and an evaluated-plan digest including expected resource revisions. Fresh
mutable snapshots require reevaluation and reapproval. This wrapper does not
create or validate those approval bindings; it must not be described as doing so.

Tests exercise valid deterministic update/append plans, changed pins, unsupported
profiles, missing inputs, snapshot omissions, cross-company effects, stale CAS,
duplicate effects, excessive aggregate size, invalid schema outputs, malformed
objects, async handlers and frozen-input mutation. These tests are not approval
by their author; an independent architecture reviewer owns the disposition.
