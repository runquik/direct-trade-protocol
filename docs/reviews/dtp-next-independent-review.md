# DTP candidate: independent implementation review

September 10, 2026. This is a bounded agent review, not external certification,
production approval or an assertion that every future business profile is ready.

## Review method

The profile implementation agent subsequently reviewed the kernel and migration
implementation written by the other agents. Review probes use independently
written transaction harnesses: signed commands enter the kernel, state changes
commit only on success, and fixtures establish real person/company/policy/profile
authority through commands. No actual personnel data, credentials, financing,
production changes or external messages are involved.

Tests assert the intended safe outcome. They do not mark exploit reproduction as
protocol success. Some code-review fixes landed before the first regression run;
the derived inventory module-scope defect was also reproduced as a failing test
before the implementation owner fixed it.

## Regression coverage

| Suite | Tests | What it establishes |
|---|---:|---|
| `sdk/tests/profiles/business-profiles.test.ts` | 14 | Exact bounded decimal arithmetic; invoice/reference classifications; immutable packaging; observation deduplication; reservation, release, fulfillment and correction invariants; 1,000 mixed inventory attempts |
| `sdk/tests/interop/inventory-conformance.test.ts` | 8 | Separately coded consumer agreement with pinned public fixtures, accepted prefixes, incompatible profiles, signed fixture binding and unknown-versus-zero handling |
| `sdk/tests/v04/review-probes.test.ts` | 10 | Company metadata isolation, module profile intersections, inventory policy binding, non-disclosing mutation receipts, prototype-name rejection, independent assessment trust and installed-module expiry/revocation |
| `sdk/tests/v04/snapshot-review.test.ts` | 6 | Valid signed snapshots; rejection of never-associated signers/grantees; cancellation of losing migration attempts after another destination wins; destination installation-ID collision rejection |
| `sdk/tests/v04/evidence-review.test.ts` | 15 | Exact recipient/compartment/host binding, source read-and-export authority, module authority, expiry/signature checks, malformed payloads, dependency-complete evidence, signed profile display-identity binding, deterministic recipient validation, and permission-scoped live invoice reference checks |
| `sdk/tests/release/independent-release-review.test.ts` | 2 | Failed runtime preflight supersedes prior success; executable observations require pinned runtime and explicit zero skipped tests |

The owned aggregate is **55 tests**, in addition to the separately maintained kernel,
HTTP, migration, PostgreSQL and existing compatibility suites. These counts are
test-runner cases, not an estimate of all possible attack paths.

## Findings addressed during the review loop

- Closed inherited prototype lookups in profile admission and discovery.
- Prevented outsiders obtaining private organization metadata through empty pages.
- Intersected module release declarations on record reads, listing and derived
  inventory access, not just writes.
- Bound stock-pool events to the pool's actual policy.
- Changed write/retry responses to minimal receipts so revoked read access is not
  bypassed by a previously successful write command.
- Separated artifact assessment trust from ordinary federation/migration host
  pins. Installed modules stop on assessment expiration or explicit revocation;
  company-owned business records remain accessible to authorized people.
- Removed the unnecessary all-stewards-active requirement where a valid active
  quorum remains, while retaining quorum requirements.
- Prevented never-associated personal signers/grantees and colliding installation
  identities from acquiring authority through imported projections.
- Permitted safe cancellation of an uncommitted losing migration after another
  destination has won. A committed migration still cannot be cancelled.
- Carried required profile dependencies with evidence and protected private
  third-party profile redistribution.
- Separated source-host projections from recipient-computed validation. Original
  record signatures and disclosed schemas are checked; structurally or
  arithmetically invalid evidence is not legitimized by an outer host signature.
- Required exact operator-understood reference-profile pins for live invoice
  checks. A publisher choosing the name `trade.contract` does not establish a
  standardized contract type. Missing, inaccessible and undeclared-module
  references remain unknown rather than becoming an existence oracle.
- Bound the displayed profile identity to its signed publisher/name/version;
  a trusted transport issuer cannot relabel an unchanged publication.

## Release automation and migration capacity closure

Independently read the complete release-graph runner, exact G00-G10 graph,
fingerprint/evidence evaluator, migration finalization and router transaction
capacity admission. Identified a runtime-preflight stale-success path: a missing
or incorrect runtime previously threw before recording the failed attempt.
The implementation owner now persists a pending attempt before launching the
runtime and a blocked result on failed preflight. Interrupted execution therefore
does not leave the previous successful observation as the latest result. Passed
executable observations also require the exact pinned runtime and an explicit
zero skipped-test count. Desired-invariant regressions pass; these changes landed
before their first execution, so this is not claimed as a captured red-to-green run.

Migration finalization applies the validated snapshot and discards its staged
snapshot/chunk copies in the same transaction. Every router write preserves
64 KiB of capacity per ready, unactivated migration. Independently reran the
implementation owner's actual-HTTP capacity test: insufficient ready capacity
does not freeze the source; after readiness, intervening writes fill ordinary
capacity to HTTP 507, but commit, finalization, read and retry still succeed.
No additional capacity defect was identified in this bounded review. This does
not cover an operator reducing the configured capacity after readiness, loss of
storage, or a malicious pinned host.

The combined rerun passed **71 tests with zero skipped/cancelled/todo cases**:
55 owned tests, 15 existing release-graph tests and one actual-HTTP migration
capacity test. The release graph now explicitly includes the independent runner
regressions. Evidence files and reviewer labels remain trusted repository/CI
inputs, not cryptographically authenticated attestations of reviewer identity.
The runner cannot prevent an authorized repository editor from forging evidence
or weakening test contents; protected review and CI are separate controls.

## Boundaries that remain important

The two inventory consumers have different implementations but the same author.
Fixture signatures deliberately use a test domain; they are not v0.4 wire
conformance vectors. A cold implementation by an external builder remains a
separate interoperability exercise.

Snapshot checks verify signed content, identity continuity, impossible association
claims, projections and deterministic inventory/invoice rules. Historical
acceptance order, completeness and delegated authorization still rely on the
explicitly trusted source host. Client-supplied `issued_at` is not an authoritative
acceptance clock. This review does not claim hostile-host-proof reconstruction.

The updated relocation path was independently read: it verifies a cached prior
locator, source commitment, destination readiness, company/generation/digest/host
bindings and a fresh destination authority token. Historical receipts do not
replace fresh authority. The verified-previous-digest bypass parameter is private
and computed after the chain checks. This reading supplements the implementation
owner's relocation tests; it is not a separate network/disaster-recovery test.

Evidence inspection verifies the supplied historical versions. It does not turn
them into live records, prove physical events, establish payment, or erase copies
already disclosed. A selected inventory evidence bundle cannot establish the
entire stock state; its issuer projection remains separate from recipient replay.

Ready migration reservations must survive ordinary token expiration so delayed
committed cutovers can finish without split-brain. Abandoned pre-ready staging
needs a documented cleanup policy. Host failure, operational key custody,
retention/compliance, runtime module sandboxing and external security certification
are not established by these unit and integration checks.

## Reproduction

From `sdk`, using the repository's pinned runtime:

```text
node --test tests/profiles/business-profiles.test.ts tests/interop/inventory-conformance.test.ts tests/v04/review-probes.test.ts tests/v04/snapshot-review.test.ts tests/v04/evidence-review.test.ts tests/release/independent-release-review.test.ts tests/release/release-gates.test.ts tests/v04/migration-capacity.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

The root release report should retain the results of the full default, candidate,
database and runtime gates separately. A local passing review is not authorization
to merge or deploy.
