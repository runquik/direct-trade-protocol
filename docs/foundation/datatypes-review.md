# Independent foundation datatype review

September 12, 2026. Scope: `sdk/src/foundation/datatypes.ts`, its unit suite and
`docs/foundation/datatypes.md`. This reviewer did not implement the helper. New
desired-invariant probes are in `sdk/tests/foundation/datatypes-review.test.ts`.
This is not approval of all F3, wire admission, identity semantics or persistence.

## Findings

### P2: causation can contradict an exact input revision

`parseProvenance` checks duplicate/conflicting exact revisions across `inputs` and
known `missing_inputs`, but initially parsed `causation` separately. An object can
therefore name the same scoped entity and revision ID with digest A as an input
and digest B as its cause, and still pass validation. The same contradiction is
accepted against an explicitly known unavailable input. This weakens the promised
exact-input provenance contract even without signatures or network integration.

Two independent desired-denial tests reproduce these cases. Positive controls
require a cause also used as an input to remain valid when the digest agrees;
knowing the reference of a missing cause does not claim its payload is available.
Correction belongs to the implementation owner: compare exact identity-to-digest
bindings across all three roles while allowing non-conflicting causal overlap.

Initial combined run on pinned Node 22.23.2: **20 tests, 18 passed, 2 failed**.
These are actual failing acceptance assertions, not expected-gap tests counted as
green. Resolution requires rerunning both suites after the implementation changes.

## Positive observations and boundary checks

- Object validators inspect own enumerable data descriptors and reject custom
  prototypes, accessors, symbols and unknown fields. Independent nested getter,
  hostile-prototype and array-element getter probes reject without calling them.
- Dense arrays reject holes, extra hidden/symbol properties and oversized inputs.
  The 64-entry provenance limit is enforced before inspecting child entries.
- Type, issuer and company scope remain in canonical reference keys. Same UUIDs
  across kinds or companies do not collapse. External identifiers preserve exact
  Unicode values instead of silently merging canonically equivalent spellings.
- Gregorian century exceptions and years 0001 through 9999 have explicit bounds.
  Millisecond ordering is exact; rollover, year zero, expanded years, offsets and
  extra precision reject. Independent century and final-millisecond probes pass.
- Non-value knowledge states do not call the local value parser. Withheld payloads
  cannot be smuggled through extra fields. Parsed provenance copies nested arrays
  and reference objects rather than retaining mutable caller references.
- Unsupported timezone names fail instead of becoming UTC. A local allowlist is
  a declaration supplied by the caller, not validation against a bundled timezone
  database. No DST or scheduling behavior is claimed.

## Limits that remain explicit

The helper validates structure and internal consistency, not truth, issuer control,
signature integrity, actual availability, ownership, or accepted execution time.
`complete` is an attributed assertion subject to structural constraints, not a
guarantee that undisclosed inputs do not exist. Separate temporal fields do not
invent a universal chronological relationship; scheduled effective dates and late
observations require profile-specific rules.

`parseKnowledge` delegates payload parsing to trusted local application code.
Its new-object guarantee applies to the knowledge envelope; the callback determines
payload cloning, bounds and error behavior. It is not safe to describe this generic
callback boundary as guaranteeing all payloads are copied or all thrown errors are
redacted `DatatypeError` instances. Callers must use vetted parsers and translate
unexpected exceptions at the API boundary.

Reflection checks apply to normal data objects and parsed JSON, not adversarial
in-process JavaScript proxies capable of executing traps. The parser is not an
execution sandbox. Similarly, object-key enumeration happens before rejecting
extra keys; network byte/node limits must run before arbitrary JSON reaches these
helpers. The bounded fields prevent unbounded recursive datatype traversal, but
are not a complete request-rate, memory-allocation or tenant quota system.

Entity references currently use lowercase UUIDs and kind/company scope. New
host-independent identity namespaces and version-bridge references require the
separate F1 contract; accepting this helper does not decide those wire bindings.
Quantity/money, attachment access, locations, correction/reversal semantics,
generated schemas and runtime integration remain outside this implemented slice.

## Review disposition

The implementation owner added an exact scoped revision identity-to-digest map
covering present and known unavailable references; causation can overlap either
role only when the digest agrees. This reviewer independently read the correction
and reran both suites: **20 passed, zero failed, zero skipped**. The reproduced P2
is resolved and this bounded helper slice has no remaining reproduced blocker.

This is scoped acceptance of the datatype helper and its explicit limitations,
not completion of F3. The foundation release remains governed by its separate
integration, authorization, compatibility and runtime gates. The trusted callback,
hostile in-process object and byte/rate-boundary qualifications above remain part
of the acceptance boundary.
