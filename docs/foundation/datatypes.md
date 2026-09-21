# Foundation datatype helpers

Internal foundation draft, September 12, 2026. Import directly from
`sdk/src/foundation/datatypes.ts`. These pure helpers are not yet wired into
command admission, generated schemas, persistence or public SDK exports. Existing
signed bytes, ID derivations and experimental v0.4 formats are unchanged.

## Contract

- `EntityReference`: `{kind, id, organization_id}`. `kind` is `person`,
  `organization`, `service`, `resource` or `record`; IDs are lowercase UUIDs.
  Person/organization references require null company scope. Service/resource/
  record references require a company UUID. A product or facility is a resource
  with a profile, not a new mandatory core identity class. Service authority is
  company-local; people are not employer-owned.
- `RevisionReference`: `{entity, revision_id, digest}` pins a lowercase UUID
  revision and SHA-256 hex digest. The digest's hashed preimage/signing domain
  must be specified by the consuming contract. Parsing does not verify it.
- `ExternalIdentifier`: `{issuer, type, value}`. Issuer is a person, company or
  company-local service reference. Type is a bounded namespace token, value is
  exact bounded text. `externalIdentifierKey` and `entityReferenceKey` produce
  canonical JSON tuple keys, not separator-concatenated or normalized aliases.
  Identical SKU values from different issuers or types are distinct claims.
- `Knowledge<T>`: `{state:'known',value:T}` or exactly
  `{state:'absent'|'unknown'|'withheld'|'not_applicable'}`. A known zero is retained.
  No missing state implies zero, truth, creditworthiness or a clean balance sheet.
  `parseKnowledge` takes a locally supplied trusted value parser. It does not
  load or interpret validator code from a submitted record. Only the knowledge
  envelope is copied by this generic helper; the trusted value parser owns the
  payload's bounds, validation, copying and error redaction. Its exceptions are
  propagated, not rewritten as safe datatype errors.
- Local dates are valid proleptic Gregorian `YYYY-MM-DD`, years 0001-9999.
  Instants use the explicit UTC millisecond subset `YYYY-MM-DDTHH:mm:ss.sssZ`;
  offsets, leap seconds and precision loss are rejected rather than normalized.
  Date/instant intervals have `{start,end}` with inclusive start, exclusive end,
  and strictly increasing endpoints. No conversion between date and instant is
  implicit. `TemporalValues` has separate nullable `observed_at`, `effective_at`
  and `accepted_at`; null means unprovided, not inferred unknown or withheld.
  Acceptance timestamps are claims until authenticated by a host receipt.
- `parseTimeZone(value, supportedZones=['UTC'])` requires an exact supported name
  in an explicit, bounded local allowlist. Non-UTC names have IANA-style syntax;
  callers must pin the actual timezone database and supply supported names.
  Syntax alone is not evidence of timezone support. This helper performs no
  network lookup, DST conversion, ICU-dependent alias normalization or registry
  fetch. Unsupported names are rejected, never silently treated as UTC.
- `Provenance`: `{kind,issuer,inputs,completeness,missing_inputs,times,causation,
  correlation_id}`. Kind distinguishes command, observation, commitment,
  attestation and assessment. Inputs pin at most 64 exact revisions, with no
  duplicate identity or conflicting digest. Missing inputs are at most 64
  `Knowledge<RevisionReference>` entries: known identifies an unavailable input;
  unknown/withheld hides its identity. Complete provenance has no missing inputs;
  partial requires at least one; unknown completeness does not infer coverage.
  Causation is a nullable exact revision; correlation is a nullable UUID.

All `parse*` functions take unknown input, reject undeclared fields, malformed
arrays, accessors, prototype-bearing objects, symbols and unsupported values,
and return new data objects. They do not silently drop fields. Error objects expose
`code` and `path`; errors do not include input values. Strings reject controls,
edge whitespace and malformed Unicode. Object and array bounds are checked
before child validation. No money arithmetic, currency conversion, geocoding,
identity resolution, signatures, ownership, temporal truth or commercial authority
is established by these helpers. Quantity/money, locations, attachments and
record-kind-specific correction/reversal rules are separate work, not silently
claimed as completed F3 integration.

## Tests and review boundary

Unit tests cover valid contrasting goods/finance claims, issuer/type collisions,
exact revisions, non-values versus known zero, invalid dates, unsupported zones,
interval ordering, completeness and duplicate/conflicting provenance inputs,
bounded arrays, prototype keys and getters. Run with the pinned Node runtime:

```text
node --test tests/foundation/datatypes.test.ts
```

Tests are implementation evidence, not self-approval. An independent architecture
agent owns review and any acceptance disposition. Runtime integration and its
authorization/privacy tests remain required before advertising these fields as
enforced protocol capabilities.
