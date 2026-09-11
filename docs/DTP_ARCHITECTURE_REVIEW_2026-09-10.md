# DTP architecture and repository review

September 10, 2026. **Design/review deliverable, not a release, independent security certification, or production approval.**

## Executive finding

The repository is a useful experimental foundation for signed company records and scoped authority. It is **not yet the general, host-independent language of business modularity** George described. The next work should address the architecture's extension, privacy, semantics and portability boundaries before adding a workspace marketplace or dozens of business schemas.

Keep GitHub. Keep the tested signing, actor attribution, revocation, version identity and isolation concepts. Rework the assumption that every business type must be centrally registered, that company-wide type permissions cover all privacy needs, and that a cooperative company snapshot proves live host replaceability.

Companion deliverables:

- [Whole-business domain map and proposed boundaries](DTP_BUSINESS_DOMAIN_MAP.md)
- [Protocol stress-test proposal and acceptance gates](DTP_PROTOCOL_STRESS_TEST.md)
- [Read-only executable scope probes](../sdk/scripts/audit-business-scope.ts)

## 1. What was actually checked

Read-only GitHub lookup confirmed `main` at `e5deb7fcecc07bf6cd2486d36c9d5b3ed24d69c9`, matching this checkout's HEAD. The checkout is on `codex/passport-browser-demo` and contains substantial existing uncommitted Passport, Early Pay, Financial Profile and v0.3 disclosure work. This review evaluates that working tree, not just GitHub main. No fetch/merge/push/deployment was performed.

| Surface | Review performed | Limits |
|---|---|---|
| Root specification and builder docs | Read relevant normative/compatibility, semantic, extension, visibility, sync and lifecycle sections; compared to v0.3 and implementation | Historical research citations and regulatory assertions were not individually revalidated |
| v0.2 schemas/registry/canonicalization | Inspected registry/common types and business structures; exercised existing tests and read-only parity/boundary probes | Not a complete independent reimplementation of all domain semantics |
| v0.3 authority | Read specification, command schema, model, permissions, wire signing, engine, migration and HTTP persistence/hosting adapters | Not a production identity-provider or cryptographic custody assessment |
| Modules and workspace seam | Read integration contracts, profile signing, request/notification state and coupling; ran current functional tests | No browser UX/accessibility run or hosted-module sandbox test |
| CI/dependencies | Read protocol workflow; local TypeScript/default/fuzz suite; SDK npm advisory query; remote HEAD check | No real PostgreSQL run, fresh Deno Edge qualification, live CI result inspection or production load test |
| Legacy contracts/marketplace/MCP and vision site | Located and classified as separate surfaces from the current protocol; inspected repository entry points | Not rebuilt, dependency-audited, or security-certified in this pass; do not include them in current conformance claims |

This is a broad architecture review with focused executable checks, not a claim that every line or possible failure in the repository has been audited. No independent reviewer participated in this turn. A separate adversarial implementation/review remains a release gate.

### Verification results

Qualified local runtime: Node **22.23.2** from the existing pinned installation. `STORE_URL` and `DTP_TEST_DATABASE_URL` were unset; tests used disposable local stores, not company data or remote writes.

| Check | Result |
|---|---|
| `node --test 'tests/*.test.ts'` in `sdk` | **103 passed**, 0 failed, 0 skipped; 99 top-level entries including nested tests; about 38 seconds |
| `node node_modules/typescript/bin/tsc --noEmit` | Passed |
| Existing canonicalization/encoding/signing/race auxiliary suite | **37 passed**, 0 failed; about 45 seconds; race results are local PGlite, not independent PostgreSQL connections |
| Read-only `scripts/audit-business-scope.ts` | Passed parity assertions: **33 embedded schemas** and the v0.3 generated command schema match sources; emitted the boundary findings below |
| `npm audit --json --ignore-scripts` in `sdk`, against current registry | **0 reported advisories**, 36 total dependencies in audit metadata; only this dependency graph was checked |
| Real PostgreSQL concurrency and hosted runtime | Not run; no disposable PostgreSQL connection configured for this turn |

An advisory-free SDK is not a clean bill of health for the whole repo. Passing tests verifies current expected behavior; several design limitations are intentional and therefore also pass.

## 2. What is worth preserving

- Separate person, organization, module publisher and company installation identities.
- Interactive authority as the intersection of live human and installation permissions, with both signatures.
- Controller quorum for full export/migration and control-policy changes, with explicit new-controller consent.
- Exact signed commands with audience/expiry, replay conflict handling and reauthorization after acquiring the persistence lock.
- Stable record roots versus exact evidence versions; immutable agreed terms and append-only corrections in sensitive flows.
- Private/counterparty visibility checks, including pagination, and tests for company switching and revocation.
- Explicit simulation labels and documentation that signatures are attribution, not physical delivery or real payment proof.
- Generated schema parity and adversarial canonicalization vectors rather than ad hoc serialization.

The recommendation is to evolve these into independent contracts, not discard the foundation.

## 3. Prioritized findings

Priorities here indicate blockers to the **expanded product goal**, not newly discovered exploitable vulnerabilities. P1: architectural contract must be addressed before claiming broad interoperability; P2: qualification/maintenance or scoped next implementation. No P0 production incident was established.

### DTP-A01 / P1: company-built extensions require central source changes

Evidence: [SPEC section 3.6](../SPEC.md) forbids profiles/dialects and requires every new type to enter the central registry; [registry](../sdk/src/registry.ts), [permissions](../sdk/src/v03/permissions.ts:10), and [engine](../sdk/src/v03/engine.ts:343) accept only embedded registered business types. Probes confirm that `inventory.movement`, `product.item`, `hr.employee`, `payroll.run` and `acme.batch_scan` are absent and cannot receive type permissions. There are only 13 registered non-core record types.

Impact: the jerky company's own scanning application cannot publish a native data contract without our involvement. Arbitrary `x_` data neither supplies shared meaning nor grants a safe extension mechanism.

Recommendation: versioned publisher-owned extensions alongside common profiles, with pinned schemas, namespace ownership, bounded admission, explicit required semantics and independent conformance vectors. Keep unsafe/unknown types rejected until this mechanism exists; do not simply permit arbitrary JSON.

### DTP-A02 / P1: authorization and retention cannot safely generalize to HR/payroll

Evidence: [personPermissions](../sdk/src/v03/permissions.ts:18) gives controllers `*`; [readVisible](../sdk/src/v03/engine.ts:34) filters by organization and whole record type, not employee/team/field/attribute scope. [snapshot](../sdk/src/v03/engine.ts:39) exports owned records and private authority state. The v0.3 specification explicitly notes globally correlatable person identifiers. Append-only records and signed command bodies retain content.

Impact: employee-self-service, manager-only team access, restricted compensation, separate personnel custody and privacy-aware deletion are not representable by adding an `hr.*` permission alone. No real HR data should be introduced under the current preview authority model.

Recommendation: subject/resource-scoped permissions, protected payload compartments, governance/data-stewardship separation, privacy-safe projections and export, organization-local subject IDs, minimized audit metadata and explicit retention/correction/deletion contracts. Require specialist privacy review before handling real employee data. Do not retroactively reinterpret existing `private` or controller semantics.

### DTP-A03 / P1: migration is not host independence or federation

Evidence: [record.append](../sdk/src/v03/engine.ts:354) requires all parties to have active authority at the same store. Migration exports only subject-owned records; foreign-owned evidence is omitted. [router](../supabase/functions/pbp-store/router.ts:8) limits requests to 1 MiB. The [v0.3 specification sections 7-8](../spec/v0.3/SPEC.md) explicitly delimit pinned-source trust, large-company export, divergent keys, multi-hop recovery and cross-store writes.

Impact: moving one company does not prove its live relationships survive. Destination import cannot represent seamless operations with counterparties left behind; startup recovery also depends on more than an export button.

Recommendation: separately specify and test export, restore/migration, cross-host interaction, and unavailable-host recovery. Include document/evidence dependencies, fresh installation consent, interrupted cutover, source/destination checkpoints and conflicting authority generations. No production portability claim until a different implementation/host passes.

### DTP-A04 / P1: independent profile/version negotiation is missing

Evidence: [v0.3 record model](../sdk/src/v03/model.ts:14) and [command schema](../sdk/src/v03/schema.ts) carry a record type but no independently selected body-schema version/digest. Bodies are inherited from the static v0.2 registry; the command version is fixed at 0.3. Probes enumerate those exact fields. `PbpClient` primarily offers an untyped `act(action, payload)` surface; the current service has no profile negotiation action.

Impact: independently evolving packaging/payroll applications cannot reliably establish which meaning the other side accepts. A protocol version, profile version, software release and marketplace assessment are different versions.

Recommendation: explicit profile/schema identity, digest and dependencies; discovery of supported semantics; versioned request/response/error contracts and compatibility matrix. Preserve old signing bytes and identifiers; publish a new draft rather than silently changing what 0.3 means.

### DTP-A05 / P1: module identity is not an executable release or security decision

Evidence: [Manifest](../sdk/src/v03/model.ts:5) has only version, name and permissions. [module.publish](../sdk/src/v03/engine.ts:266) accepts exactly those fields. Installation pins the manifest version, not an executable digest; no module release artifact, screening assessment or private/community publication contract is defined.

Impact: current registration cannot bind a review to the exact code that later runs. It must not be called a screened marketplace admission flow.

Recommendation: separate protocol identity/compatibility, immutable software release, signed assessment, marketplace visibility and per-company installation consent. Runtime sandboxing, egress/secret/resource controls and malicious-update response belong to hosts. Private modules need controls too. No scanner is a guarantee of safety.

### DTP-A06 / P1: essential inter-module workflow state is still demo-local

Evidence: [Early Pay](../modules/early-pay/src/demo.ts:16) keeps requests, commitment lookup, seen state and workflow steps in process memory. It calls `profile.snapshot`/`profile.verify` directly and encodes a private contract inside `disclosure.summary`. [Financial Profile](../modules/financial-profile/src/demo.ts:10) uses a locally generated/pinned issuer; its README explicitly labels its snapshot an experimental payload, not a standard protocol type.

Impact: interoperable records do not yet imply that another independent module can reconstruct an unfinished request, verify its profile, discover its inbox or continue the workflow after the original process is lost.

Recommendation: durable shared action/request and evidence contracts with independent discovery and verification; keep cosmetic unread preferences module/workspace state. Rebuild a reader using published artifacts only and kill/restart the producer mid-flow.

### DTP-A07 / P1: the meaning of "conformant" is too easy to overstate

Evidence: [SPEC line 12](../SPEC.md:12) gives schemas precedence, yet contextual authority, arithmetic and cross-record rules are not fully captured by schema validation. Section 3.5 calls transition clocks informative, while section 6.12 describes timing-sensitive outcomes as normative. [integrity.ts](../supabase/functions/dtp-store/integrity.ts) implements local special cases and intentionally leaves references/arithmetic to consumers. The probe accepts an invoice body where `2 x $100` is declared as `$1` and a contract reference is unresolved. This is body-schema acceptance, **not a demonstrated unauthorized signed write**, and matches a documented limitation.

Impact: two modules can both accept the JSON and disagree on what constitutes a valid invoice, payment or confirmed delivery. A generic "DTP valid" badge would conceal that difference.

Recommendation: layered conformance: shape/signature, authority/history, domain invariants, then evidence/trust assessment. Specify where each invariant is enforced. The core need not underwrite loans, but shared invoice arithmetic and action preconditions cannot remain undocumented private logic. Distinguish state transitions from proof of physical-world events. Resolve normative contradictions with a versioned decision.

### DTP-A08 / P1: domain-neutral operations need a clearer boundary

Evidence: [permissions](../sdk/src/v03/permissions.ts:4) and [engine](../sdk/src/v03/engine.ts:356) special-case `finance.accept_offer` and `finance.fund` in the authority core. They correctly strengthen finance approvals but provide no equivalent extensible contract for payroll disbursement, purchase commitments, product release, hiring or irreversible disposal.

Recommendation: define generic operation authority/approval mechanics plus domain-defined actions and invariants. Technical write permission is not business authority to incur obligations. Preserve existing finance checks until an explicitly tested replacement exists; do not remove them in the name of generic design.

### DTP-A09 / P1: common business datatypes are too narrow

Evidence: [money](../spec/schemas/common/money.schema.json) accepts USD/USDC only; [quantity](../spec/schemas/common/quantity.schema.json) accepts seven units and at most three decimals. Probes reject EUR/GBP and liters, milliliters, hours and kWh. [pack structure](../spec/schemas/trade/pack_structure.schema.json) models a simple unit/case/pallet hierarchy. Products/lots/locations are not a complete independently referenceable master-data model.

Impact: service labor, ingredients, utilities, variable-weight goods, packaging revisions, international invoicing and payroll cannot share reliable quantities and valuations through these primitives unchanged.

Recommendation: extensible governed code lists, precise decimal semantics, explicit dimensions/units, product-specific pack conversions, rounding rules, effective versions, tax/charge and currency/asset distinctions. Preserve unsupported-value warnings; never silently convert or net incomparable amounts.

### DTP-A10 / P2: sync and read models are not yet a general workspace contract

Evidence: v0.2 has a documented event feed; v0.3 exposes paginated record reads but no corresponding general authority/action change stream. [workspace.view](../sdk/src/v03/engine.ts:319) returns the last 50 readable heads and installation metadata. Installation actions are allowlisted to record append/list and disclosure read, not generic event subscription. Early Pay separately assembles notifications.

Recommendation: a scoped durable change contract with replay/backfill, permission-change effects and action status. Keep dashboard assembly and unread state outside core. Document staleness, unsupported operations and pagination; do not treat a 50-record view as a complete company picture. Consumer deduplication is not exactly-once execution of external effects.

### DTP-A11 / P2: reference persistence is intentionally a small-scale bottleneck

Evidence: [router](../supabase/functions/pbp-store/router.ts:45) locks one global state row and serializes/replaces it even on reads. Hosted adapter caps state at 16 MiB; serialized writes preserve important authorization order. The spec already labels this a preview.

Recommendation: retain the deterministic behavior tests while moving toward indexed journals/projections and bounded queries. Define numerical load/recovery targets before qualification; test contention, tenant fairness, large exports and backup restore. Do not replace locks without an equivalent linearization model.

### DTP-A12 / P2: public developer promises are ahead of release organization

Evidence: root README/SPEC/quickstart and historical direction docs still lead with PBP, while user direction is DTP. v0.1 artifacts, v0.2 wire rules, v0.3 hosted preview and additional local-only disclosure/modules coexist. Existing research contains settlement/escrow-first prescriptions that no longer define the current direction. The root-file inventory found no root LICENSE, CONTRIBUTING, GOVERNANCE or SECURITY policy document. The SDK is marked private; package-distribution readiness is not established.

Recommendation: one authoritative status/index page, frozen versioned specifications, published compatibility table, explicit supported/experimental/legacy labels, contributor governance, vulnerability reporting and deliberately selected spec/code licenses. This review adds a current entry point but does not grant rights, rewrite history or publish a new version.

### DTP-A13 / P2: deployment/runtime qualification remains a separate gate

Evidence: live GitHub HEAD was checked; live deployed backend revisions were not. The v0.3 hosted adapter requires development access control and uses Supabase-specific configuration. CI defines Deno and PostgreSQL jobs, but a local green test run is not evidence those jobs passed for the dirty working tree. Legacy application graphs were not dependency-audited.

Recommendation: release manifest tying commit, schema hashes, runtime, migration and capability profile to each environment; independent-store tests; real PostgreSQL race tests; host-specific load/abuse/backup qualification. Pin production CI actions and validate dependency update compatibility as part of supply-chain hardening. "Most current" should mean current evidence and supported versions, not untested upgrades to every newest package.

## 4. Review dimension ratings

| Dimension | Assessment |
|---|---|
| Security | Promising tested authorization baseline; not ready for unrestricted apps, sensitive HR or real financial operations |
| Correctness | Current tests pass; broad domain meaning, independent compatibility and evidence validation remain incomplete |
| Performance/reliability | Suitable for bounded synthetic experiments; global-state design and cooperative small transfers are not a scalable host architecture |
| Maintainability | Strong starting vectors and explicit limits; normative rules and product-specific assumptions need disentangling, version/status navigation needs consolidation |

## 5. Recommended next work, in order

1. **Agree the boundary** in the domain map: small core, independently versioned profiles, governed extensions, replaceable hosts, privacy before HR. Do not build all listed domains.
2. **Specify the missing contracts** for profile/schema negotiation, resource-scoped authority and protected payloads, evidence/action semantics, module release identity and migration/federation. Keep existing versions stable.
3. **Run the multi-domain stress test** before selecting a final new version. Use packaging/inventory, procurement/invoicing, HR/payroll privacy, and a private custom app to force different requirements; use Early Pay as an additional consumer, not the core's organizing principle.
4. **Implement the smallest coherent next protocol cut**, with negative tests and an independently built reader/store. Record deferred features and unsupported semantics explicitly.
5. **Only then build the private workspace and hosted-module lifecycle.** Marketplace discovery/pricing, security-runner infrastructure and UX remain separate work with separate acceptance gates.

No final new version number, production schema, license or commercial policy is selected by this review. No application, signed identifier, endpoint, marketplace, or public vision site is changed. Existing uncommitted work remains intact.
