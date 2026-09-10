# Inventory-v1 consumer conformance fixtures

These synthetic fixtures exercise the declared `dtp.inventory/1` /
`inventory-v1` semantics. The closed bounded schema is pinned by SHA-256 of
canonical JSON. Conditional event rules, exact three-place quantities, immutable
packaging versions and revision/reservation invariants are additionally required;
passing the structural schema alone is insufficient.

The flow starts with an **explicitly known empty pool**, receives ten 12-unit
cases, reserves eight, fulfills three, releases two, records a negative cycle-count
correction, introduces a new 24-unit case revision, receives one new case, appends
a late one-unit observation, and fulfills the old reservation using its old pack
pin. An exact duplicate observation must not add stock. Expected final on-hand is
61 units, reserved zero, ten unique observations and one duplicate.

`sdk/tests/interop/inventory-reader.ts` reconstructs this independently of the SDK
inventory reducer, decimal helpers and canonicalizer. The test compares both
implementations to explicit expected results and to each accepted prefix. It also
checks profile/schema incompatibility, mutation, conflicting retries, stale
allocation, overselling, packing pins and unknown-versus-zero behavior.

Test envelopes use generated Ed25519 keys and a separate, explicitly named
`DTP-INVENTORY-INTEROP-FIXTURE-1` detached-signature domain. These signatures bind
the fixture's company, resource, schema and body. They are **not v0.4 command wire
conformance vectors**. An authorized caller supplies trusted keys and scope; this
reader does not discover authority, grant access or assess physical truth. Stream
completeness is a caller-established precondition. Partial/unknown history remains
unknown, never a default zero balance.

This establishes separately coded consumer agreement by the same author, not
independent authorship, certification or a cold implementation by Boris. A second
builder should implement these public fixtures without seeing either consumer.

Run from `sdk` with the pinned runtime:

```text
node --test tests/interop/inventory-conformance.test.ts
```
