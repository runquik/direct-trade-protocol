# DTP stress test: first executable business-boundary pass

**Historical baseline, not current candidate qualification.** The v0.4 [release plan](DTP_V04_RELEASE_PLAN.md) tracks the follow-up implementation and mandatory acceptance gates. The original JSON evidence below is preserved. Rerunning the legacy suite writes `docs/stress-results/business-boundaries-current.json`; the oversized-cutover and invoice-arithmetic probes now require rejection, while legacy-only gaps remain explicitly labeled. A green observation of an old gap never qualifies v0.4.

September 10, 2026. **The identity and signing foundations held in these probes. The expanded modular-business contract is not ready yet.** The most consequential demonstrated failure is a host move that freezes the source even though the destination cannot accept its transfer.

This executes the recommended first slice of [the stress-test plan](DTP_PROTOCOL_STRESS_TEST.md), not its entire 28-case acceptance matrix. Inventory, employee privacy and company-owned extensions expose missing contracts before a real independent implementation trial is possible. No production-readiness or third-party-conformance claim is made.

## What ran

- **22 new signed-HTTP probes: 12 control observations and 10 reproduced gap observations.** All matched their assertions. Node reports 23 tests including the parent test. A green `[GAP]` test means the deficiency was reproduced, not that DTP met the desired business requirement.
- Disposable localhost PGlite source and destination stores, plus a third store for wrong-destination rejection. All run the existing v0.3 reference engine. There is no direct test access to store databases.
- A separate client using native Node Ed25519, independently written canonical JSON/base58, the published signing vector, and ordinary HTTP. It does not import SDK client, signing, wire or permission helpers. This tests client implementation diversity, **not independent authorship or independently implemented hosts**.
- Synthetic companies, scanner data and employee canaries only. No real employee information, external inventory commitments, funds, hosting changes or module uploads.
- Existing default suite: **103 passed**. Existing auxiliary canonicalization/encoding/signing/concurrency suite: **37 passed**. TypeScript passed. Node **22.23.2**.

Tested the current dirty working tree based on Git HEAD `e5deb7fcecc07bf6cd2486d36c9d5b3ed24d69c9`, not a fresh main checkout or a deployed release. The [machine-readable evidence](stress-results/business-boundaries.json) records runtime, timestamps, input SHA-256 hashes, observations and an HTTP journal without private keys or business bodies. The journal uses status `0` for a transport failure, not an HTTP response code.

## Findings and recommended order

### 1. P1: refuse an impossible migration before freezing the source

**S21 / T18, T20.** Eighteen individually valid records, each with roughly 34 KB of synthetic notes, generated an import request around **2 MB**. Records appear in signed commands, records and audit history, so migration size grows faster than just the original business bodies.

The source accepted `migration.commit`. The destination rejected the oversized transfer; this local run observed a connection reset while the development server closed its oversized request. A subsequent destination company lookup returned **404**, and a new source write returned **409**. The durable transfer receipt remained retrievable, but that alone did not complete or recover the move.

The shared router's limit is **1,048,576 bytes**. Depending on socket timing, the local caller can observe HTTP 413 or a reset. The probe accepts only these specific oversized-request outcomes, then independently checks destination absence and source freeze. It does not disguise an arbitrary network failure as success.

Relevant code: [source commit](../sdk/src/v03/engine.ts), `migration.commit`; [HTTP bound](../supabase/functions/pbp-store/router.ts), `MAX_BYTES`; [development request termination](../sdk/scripts/pbp-dev-server.ts).

**Immediate fix recommendation:** destination capability/size preflight and a source-side reject before irreversible cutover. **Then:** bounded, integrity-checked staging, resumable transfer and an explicit destination-ready/cutover/recovery contract. Do not fix this by merely increasing the request limit or unconditionally reactivating the source; neither solves safe recovery or split-brain.

This limit was already documented in the preview specification. The new evidence is the concrete write-freeze failure path, not a claim that large migration had been promised by v0.3.

### 2. P1: define employee compartments before admitting HR data

**S02, S09, S10 / T12, T13.** There is no native employee record type. A member with `records.read:traceability.cte` could read every same-company private CTE, including a synthetic salary canary deliberately placed in an extra field. It appeared both in `body` and in `command.payload.body`, as well as the workspace response. A controller could also read it. Employee-scoped permissions and conditional membership fields were rejected with **400**.

This is **not an unauthorized breach of today's type-level permission contract**. It demonstrates why that contract cannot safely stand in for employee/team/medical/compensation access. We deliberately used an obviously labeled fallback, not real HR data or a claimed HR implementation.

Relevant code: [type-only permission vocabulary and controller wildcard](../sdk/src/v03/permissions.ts); [visibility and full record projection](../sdk/src/v03/engine.ts), `readVisible` and `recordView`.

**Recommendation:** distinguish company administration from sensitive-data access; define employee/resource/purpose boundaries, export authority and aggregate disclosure rules. Authorization must cover signed evidence as well as displayed fields. UI redaction alone cannot work when the original salary remains inside the returned signed payload. Sensitive compartments need a deliberate signing/storage/retention design before employee-level records are enabled.

### 3. P1: host replacement must preserve relationships, not just owned records

**S17–S20 / T19.** A small company moved successfully, retaining 12 signed records whose signatures were verified by the independent client. However, continuing a shared record at the destination returned **403: `all parties must have active local company authority`** when its buyer stayed on the source. The buyer could still read the old shared record there.

Relevant code: [local-party requirement](../sdk/src/v03/engine.ts), `record.append`, and subject-owned filtering in `snapshot`.

**Recommendation:** define identity/authority resolution, issuer and host trust, cross-host authorized evidence retrieval, record continuity and migration-location updates. Preserve explicit authority instead of fabricating local buyer accounts. A successful file transfer is not evidence of uninterrupted trading after a host change.

### 4. P1: create a governed extension/profile contract before connecting arbitrary company apps

**S02, S14 / T01, T22, T23.** Signed attempts to publish permissions or append records for inventory, HR and company-owned types were rejected. This includes `jerky.scan`, which fits the current type-name grammar but is absent from the registry. Published module versions resisted silent mutation (**409**), but adding artifact-digest and publication-visibility metadata was rejected (**400**).

Relevant code: [permission registry admission](../sdk/src/v03/permissions.ts), [module publication and record admission](../sdk/src/v03/engine.ts).

**Recommendation:** specify namespace authority, immutable schema/profile references, required versus optional extensions, compatibility negotiation and bounded validation. Separately specify executable artifact identity, security assessments, installation consent and private/community publication. Storing a module manifest is not hosting or screening its code.

**Release gate:** a company-owned type must work without editing the central DTP source, and two independent consumers must either produce the same declared business interpretation or explicitly report incompatibility. That gate was **not achieved** here. Building two apps around the same private `x_` agreement would hide the gap.

### 5. P2: define inventory effects, identities and pack revisions in a shared profile

**S03–S07 / T05–T07.** Exact signed retries returned the same result without adding a record, and two concurrent corrections to one head produced one acceptance and one conflict. Those are useful core controls.

But a fresh record ID with the same physical scan identifier was accepted, yielding two ten-case observations. Two separate eight-case reservations against a stated ten-case balance were accepted. Conflicting 12-unit and 24-unit case conversions labeled with the same experimental pack version were also accepted. Late events retained their timestamps but arrived in the opposite order from their physical occurrence.

These probes used `x_inventory` in the deliberately loose CTE schema. **They prove opaque storage is not inventory interoperability, not that the protocol violates an existing stock-reservation contract.** Arrival sequence is correctly not a promise of physical chronology.

**Recommendation:** a versioned inventory/packaging profile needs scanner/observation identities, deduplication scope, authoritative reservation conflicts, correction/late-event rules and pinned packaging relationships. The core needs extensibility and reusable concurrency primitives; it should not become an inventory-planning application.

### 6. P2: distinguish shape-valid records from reconciled business records

**S08 / T09.** A signed invoice was accepted with quantity 2, unit price $100, line amount $999, subtotal $1 and total $700, referring to a contract that did not exist in the test store.

Relevant code: [record validation](../sdk/src/v03/engine.ts), `record.append`; [existing integrity checks](../supabase/functions/dtp-store/integrity.ts).

**Recommendation:** publish invoice arithmetic, rounding, reference and evidence validation rules with explicit result classes. A missing external reference need not always prohibit ingestion, but it must not silently become “verified.” Separate what a schema establishes, what arithmetic establishes, what a party attested, and what remains inaccessible or unknown.

## Controls that held

- Independent signing matched the fixed vector; altered signatures and wrong audiences were rejected.
- Three parallel fractional-CFO reads stayed company-scoped. Small-page listing matched the full authorized list without omissions or duplicates.
- Membership revocation blocked prepared reads and exact read replays. Installation revocation blocked prepared module reads while owner-accessible records remained.
- Human and installation permissions intersected. A read-only module could not write, operate in a different company, or omit the required human signature. It could not read private records.
- Stale migration previews were rejected. Small imports preserved signed payloads, rejected tampering/wrong destinations and duplicate imports, and disabled imported installations.

These are bounded observations, not proof against every attack or every runtime. The tests do not show that downloaded copies can be erased by revocation.

## Every planned case has an explicit disposition

“Partial” names a narrow executed check; it does not mark the full target as passed. “Blocked” means an absent protocol capability prevents the intended conformance experiment. “Deferred” was not exercised in this new suite.

| Plan case | Disposition | Evidence and remaining gate |
|---|---|---|
| T01 | Blocked | S02: native/private custom type admission absent; no independent extension published |
| T02 | Partial | S14: manifest version immutability only; standard-field redefinition/required-extension semantics deferred |
| T03 | Partial | S21/S22: HTTP bounds only; remote schema references, recursive validators and schema-digest mutation deferred |
| T04 | Blocked | S01 verifies independent signing, **not** two compatible profile consumers; profile negotiation absent |
| T05 | Partial, gap | S03–S07: retry, duplicate scan, concurrent correction and arrival order; offline two-lot reconciliation deferred |
| T06 | Gap | S05/S06: one-head CAS holds, but proposed independent reservations have no inventory invariant |
| T07 | Partial, gap | S06: contradictory experimental conversion accepted; mid-PO revision, pallet split and repack lifecycle deferred |
| T08 | Deferred | Full co-packer/partial shipment/dispute/credit fixture is the subsequent B slice |
| T09 | Partial, gap | S08: bad arithmetic and missing contract accepted; inaccessible third-party evidence classification deferred |
| T10 | Deferred | New multi-domain stale approval scenario not run; existing financing regression results are separate |
| T11 | Partial, control | S11/S16: parallel HTTP company reads and filtered pagination; browser switches/notifications/in-flight actions deferred |
| T12 | Blocked/gap | S02/S09/S10: native HR and employee/team scope absent; fallback exposes why type-only access is insufficient |
| T13 | Partial, gap | S09/S11: raw record/signed payload/workspace response canary tests; rendered UI/search/AI/aggregate inference deferred |
| T14 | Partial, control | S12/S13/S15: prepared and replayed reads, membership/module revocation; queued external effects deferred |
| T15 | Deferred | No extraction/forecast-to-counterparty-attestation attack in this suite |
| T16 | Partial, control | S15: records outlive installation revocation; unfinished workflow reconstruction by replacement module deferred |
| T17 | Deferred | No independent Financial Profile consumer implementation in this suite |
| T18 | Gap plus controls | S17–S19/S21: small transfer/tampering checks; large transfer fails; chunk reorder/resumption unavailable |
| T19 | Gap | S19/S20: owned records survive, but partner-left-behind continuation fails |
| T20 | Partial, gap | S17/S21: receipt recovery/source freeze and failed large cutover; source-loss disaster recovery and partition races deferred |
| T21 | Partial | S19: controller export includes synthetic private payload; employee-specific export/retention/deletion rules deferred |
| T22 | Blocked/partial | S14: immutable permission manifest, no artifact assessment contract; no executable module screening attempted |
| T23 | Blocked | S14: publication policy fields unavailable; no public release attempted |
| T24 | Deferred | S22 is HTTP tampering, **not an agent prompt-injection exercise** |
| T25 | Partial | Raw independently signed HTTP and module authority exercised; MCP/manual UI parity deferred |
| T26 | Deferred | Metering, price agreements and charge authorization require a later contract |
| T27 | Deferred | External identifier collision/resolution fixtures not executed |
| T28 | Partial | S07/S22: arrival/event-time distinction and unsupported unit rejection; payroll DST, FX, rounding and missing/withheld semantics deferred |

## Reproduce and interpret

From `sdk`, with the repository's pinned Node 22.23.2 runtime and existing dependencies:

```powershell
npm run test:stress-business
npm run typecheck
npm test
npm run test:fuzz
```

The dedicated stress test always creates ephemeral local stores and ignores external `STORE_URL`/database settings. Before the broader default or fuzz suites, verify `STORE_URL` and `DTP_TEST_DATABASE_URL` are unset unless you intentionally configured a disposable target. Both were unset for this run. No new dependencies were needed.

Sources: [test scenarios](../sdk/tests/stress/business-boundaries.test.ts), [independent test client](../sdk/tests/stress/independent-client.ts). Each run overwrites the generated evidence JSON with fresh synthetic IDs, keypairs, ports, timestamps and source hashes; do not compare those random values across runs. Compare classifications, assertions and semantic outcomes. A changed assertion outcome makes the suite fail; if a real fix closes a gap, replace that gap's assertion with the new desired invariant and update this report.

The first fixture-authoring run used `counterparties` visibility without parties and correctly failed validation; the fixture now uses `granted` for same-company module-readable records. Those authoring failures were not counted as product defects. The observed oversized-request reset is retained explicitly rather than mislabeled HTTP 413.

## Next decision

Keep the existing signing and company-authority foundation. Before building the private workspace, agree the minimum next protocol contract for **governed extensions, sensitive-data authority and safe host exit**, then implement narrow conformance fixtures for those contracts. Treat migration preflight as the first safety fix. Add the inventory/packaging shared profile and invoice validation contract alongside those foundations, not as another demo-only convention.

No fixes, wire changes, commits, deployments or public-site changes were made in this pass. New work is the test harness, evidence and review documentation. Real PostgreSQL/Deno execution, production load/recovery, two independent builders, full A/C workflows and the B fixture remain explicit gates.
