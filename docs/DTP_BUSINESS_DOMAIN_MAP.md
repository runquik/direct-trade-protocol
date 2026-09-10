# DTP: the language of business modularity

September 10, 2026. **Architecture proposal, not a released specification or implemented capability list.** Read with the [code-grounded review](DTP_ARCHITECTURE_REVIEW_2026-09-10.md) and [proposed stress test](DTP_PROTOCOL_STRESS_TEST.md).

## 1. Direction and requirements

Direct Trade Protocol is an open foundation for businesses to discover capabilities, make agreements, coordinate work, and exchange evidence and value without depending on a single intermediary to control the relationship or its records.

The objective is to make software and service providers replaceable while preserving business meaning, authorized relationships, and usable records. This is wider than exchanging documents, but does not require one database containing everything or one program that runs every business.

Confirmed by George on September 10:

- Stress-test the protocol before building the private workspace/module experiment with Boris.
- The eventual workspace uses Passport for entry and connects company-built and independently built modules. A marketplace may host and distribute them; community publication is optional.
- Hosting **must be replaceable**, including third-party hosting or self-hosting compatible with our workspace.
- HR/payroll must support **both restricted employee-level records and company-level summaries**, with strict privacy boundaries.
- Module security screening and publication controls need architectural support now; their implementation is later work.

These are user requirements, not evidence of a collaborator's acceptance of a particular implementation, deadline, or collaboration structure. Private correspondence is maintained separately from the public protocol artifacts.

## 2. A small grammar, a growing vocabulary

Do not try to design every business field in advance. Design the rules by which new fields, meanings, and behaviors can be introduced safely.

```text
Workspace / marketplace / company-built app / specialist provider
                  | same authorized interfaces
        Modules and independent implementations
                  | declare the profiles they understand
 Shared business profiles + explicit publisher-owned extensions
                  | build on
       DTP core: identity, authority, records, evidence,
       versioning, synchronization and portable references
                  | implemented by
   Replaceable stores, hosts and transport/storage adapters
```

The profiles are part of DTP's published language, not separate hidden databases. Supporting DTP core should not mean implementing every profile. A payroll module and a freight module share authority, provenance, time, and references; neither needs to understand the other's confidential domain in full.

### What belongs in the common foundation

| Foundation | Shared meaning to establish |
|---|---|
| Identity and relationships | People, organizations, publisher identities, installations, authorized services; roles within a relationship rather than permanent company labels |
| Stable references | Distinguish an entity from an exact revision; namespace external IDs by issuer; distinguish an identifier from the current hosting address |
| Authority | Actor, represented organization, delegated operation, resource scope, applicable constraints, approval, expiry and revocation; consistent enforcement across every interface |
| Record and action lifecycle | Signed attribution, immutable version identity, correction/reversal links, current-head conflicts, idempotent requests, causation and correlation |
| Evidence and provenance | Assertion vs observation vs approval vs assessment; issuer, source versions, method, observation time, validity and completeness/coverage |
| Schema/profile negotiation | Exact schema identity and digest, version and dependencies, supported profiles, compatibility rules, critical extensions and safe rejection |
| Synchronization | Scoped changes, pagination, replay/backfill, recovery after lost responses, current authorization, migration checkpoints and error semantics |
| Privacy-aware portability | Authorized export of records, documents and required workflow state; verifiable manifests; retention/deletion semantics; host relocation and trust limitations |

Common datatype vocabulary should include decimal quantities, units, money/currency or identified monetary assets, date-only values, instants, local time zones, intervals, locations, and external identifiers. A common representation does not impose one domain's precision, rounding or disclosure policy on all domains.

An opaque blob is not interoperability. Conversely, requiring DTP maintainers to approve every company's custom field is not an open ecosystem.

## 3. Whole-business coverage map

**Now** refers to this working checkout, not a production service. **Partial** means a limited related structure exists, not complete workflow support. Proposed record families below are concepts, not reserved wire names.

| Business area | Shared records/relationships DTP should be able to express | Modules/services decide or execute | Now |
|---|---|---|---|
| Organization and governance | Legal entities, establishments, subsidiaries, memberships, delegated authority, effective dates, ownership/control evidence | Legal formation, corporate decisions, identity verification and recovery operations | Partial: person/org authority preview; no full organizational model |
| Product and material master | Product identities, SKU/GTIN mappings, revisions, variants, raw materials, ingredients, units and classifications | Catalog authoring, merchandising, product strategy | Partial: embedded goods descriptions; no independent product/material master |
| Packaging and artwork | Each/inner/case/pallet hierarchy, dimensions, tare/net/gross weight, pack versions, artwork approvals, returnable assets | Packaging design, labeling decisions, optimization | Partial: simple pack structure and free text |
| R&D, recipes and specifications | Versioned formulas/BOMs, substitutions, tolerances, specification approvals and effective lots | Formulation, recipe optimization, intellectual-property decisions | Absent; recipes must be restricted separately from public product facts |
| Procurement and supplier management | Supplier qualification claims, RFQs, quotes, purchase orders, confirmations, amendments, receipts, supplier score evidence | Vendor selection, negotiation and procurement policy | Partial: intent/offer/contract; not complete procure-to-pay |
| Sales and B2B relationships | Customers/accounts, quotes, sales orders, standing agreements, contract changes, commercial commitments | CRM workflows, pricing and sales recommendations | Partial: trade schemas; limited amendments/disputes |
| Retail and ecommerce | Assortments, channel listings, offers, baskets/orders, sales/refunds, availability, promotions, reseller relationships | Storefront, search/ranking, checkout UX, promotion optimization | Partial: listings/intent; no retail channel model |
| Inventory and warehousing | Item-lot-location positions, movements, reservations, ownership vs custody, counts/adjustments, consignments, holds, expiry | WMS, replenishment, slotting, allocation strategies | Absent as a strict operational profile |
| Manufacturing and co-packing | Work orders, input/output transformations, consumed packaging, output lots, yield, scrap, rework, release and subcontract relationships | Scheduling/optimization, equipment control, costing policy | Partial: loose traceability transformation fields |
| Demand and production planning | Forecast scenarios with method/as-of time, demand signals, capacity calendars, material requirements, committed plans | Forecast models, scheduling algorithms and business assumptions | Absent; forecasts must not look like actual orders |
| Logistics and physical distribution | Freight offers/bookings, legs/stops, handling units, custody transfers, BOL/POD references, receiving exceptions, temperature summaries | Routing, dispatch, actual transport, warehousing labor | Partial: delivery/freight terms and fulfillment |
| Traceability, quality and recall | Lot genealogy, aggregation/disaggregation, inspections, tests, samples, certificates, quarantine, release, recall scope and disposal | Laboratory work, inspection, certification and recall execution | Partial: loose CTE and COA anchor; not EPCIS conformance |
| Returns, deductions and disputes | Return authorization, reason/evidence, short shipment, damage, allowance, credit/debit memo, disputed claim, resolution and reversal | Case handling, negotiation, arbitration and legal remedies | Partial: deduction fields/statuses; no full dispute or return profile |
| Invoicing, AP/AR and accounting | Invoice lines, taxes/charges, credits, remittance/allocation, journal entries, account mappings, periods, reconciliations and close evidence | Accounting treatment, reconciliation logic, reporting policy and filings | Partial: invoice/settlement types; no general ledger |
| Treasury, payments and financing | Payment intent/authorization/attempt/settlement/reversal, accounts by safe reference, balances with provenance, obligations, assignment/release, collateral and lien evidence | Money movement, underwriting, risk models, collections, bank custody | Partial: advance/settlement schemas and simulated Early Pay; no real rails |
| Workforce, HR and payroll | Organization-local employee/contractor references, engagements, teams, schedules, approved time, compensation components, payroll runs, benefits and restricted personnel records | Hiring decisions, payroll calculations, benefits administration, tax filing | Absent; requires the privacy profile first |
| Assets, facilities and maintenance | Facilities, equipment, warranties, leases, service history, inspections, work orders, downtime and capacity | Maintenance scheduling, facility operation and machine control | Partial locations only |
| Service businesses and projects | Service capabilities, statements of work, milestones, assigned work, timesheets, deliverables, acceptance and expenses | Project management, staffing, professional judgment | Absent; needed for fractional operators and service nodes |
| Customer support and field service | Permissioned cases, product/lot links, complaints, warranty claims, service appointments and resolutions | Support workflows, escalation and communication | Absent; customer data must not become network-public |
| Marketing and commercial programs | Campaign/offer identity, approved claims, trade promotions, rebates, spend commitments, attributed outcome summaries | Creative work, ad targeting, attribution methodology and recommendations | Absent; raw tracking exhaust is not core data |
| Legal, compliance, tax and cross-border | Agreement/evidence references, licensed credentials, insurance, obligations, jurisdiction/profile versions, customs declarations and filing receipts | Legal interpretation, certification, customs clearance, tax engines | Partial credentials/references; not regulatory certification |
| Sustainability, waste and circular flows | Material origin, waste/donation/recycling events, reusable packaging, emissions/resource assessments with method/boundary/evidence | Measurement, certification and impact models | Absent as shared profiles; do not confuse estimates with measurements |
| Data, software and operational services | Module descriptors, authorized installations, supported operations, durable business-action status, portable usage/assessment receipts | Hosting, scanners, runtimes, discovery, billing, dashboards and AI inference | Partial manifests/permissions; no hosted module supply chain |

A warehouse, lender, co-packer and fractional CFO are all participants offering capabilities. A capability advertisement is a claim; a reservation is a commitment; a performance event is an assertion; an independent attestation is separate evidence. This is how the software-modularity idea connects to the original physical network vision.

## 4. Distinctions every domain must preserve

1. **Product vs lot vs serial item vs handling unit.** A SKU is not a batch; a pallet is not a quantity conversion without its contents; repacking is not necessarily transformation.
2. **Ownership vs custody vs possession vs rights to disclose.** The warehouse can possess goods without owning them. A record custodian is not entitled to publish all personal data in it.
3. **Plan vs commitment vs actual vs estimate.** Forecast, purchase order, goods receipt and predicted arrival are different assertions.
4. **Entity vs revision vs external identifier.** An approval binds a specific version; a PO number is meaningful within its issuer's namespace. Mapping two IDs is an attributable claim, not automatic proof they are identical.
5. **Business time vs observation time vs acceptance time.** Offline scans and backdated corrections require all three when relevant. Payroll and schedules also need dates/time zones, not only UTC timestamps.
6. **Absent vs unknown vs withheld vs not applicable vs zero.** Missing data must never silently become zero inventory, a clean lien search, or a bad employee/risk rating.
7. **Authorized statement vs verified truth.** Correct signatures do not prove physical delivery, lawful title, actual payment or completeness of an export.
8. **Technical authority vs business approval.** Ability to append a purchase order is not unlimited permission to commit company spending.
9. **Source record vs derived view.** Available inventory, cash forecasts and reputation need declared inputs, method/version, coverage and as-of time. Multiple assessments can disagree without rewriting their evidence.
10. **Shared facts vs private implementation state.** An algorithm cache need not be portable; an open commitment, reservation, approval, or uncompleted customer request cannot exist only in a vendor's cache if replacement is promised.

## 5. Extension and governance proposal

Three tracks, sharing the same core envelope and security rules:

- **Common core:** deliberately small; breaking changes require a new protocol version and migration design.
- **Shared domain profiles:** stable, published vocabularies and semantic tests for defined workflows; independently versioned and optional to implement.
- **Publisher-owned extensions:** company/private or community-visible definitions with collision-resistant namespace ownership, signed publication, fixed schema digest, version, dependency lock and explicit compatibility. Publication visibility is distinct from permission to read records using it.

For an extension, declare fields, meaning, units, temporal rules, invariants, operations, permissions, examples, unsupported behavior and how it maps to existing profiles. A private extension may remain private; an authorized host/consumer still needs enough of its contract to process it. A public listing must not accidentally publish a private schema, source code, sample data or business secret.

Unknown optional data can be retained opaquely by a declared capable host; this must not be advertised as semantic validation. Unknown required semantics or unsupported authorization policy must block the affected operation. A consumer must not calculate or sign an agreement using fields it does not understand. Do not fetch arbitrary remote schemas or execute supplied validators on receipt of a record. Pin and admit bounded declarative schemas/dependencies out of band; defend against malicious references, cycles and validation resource exhaustion.

Promotion to a shared profile should require a concrete business case, threat/privacy model, at least two independent implementations, positive and negative vectors, compatibility behavior and an accountable maintainer. No company-specific extension may override a standard field's meaning. Document when a mapping loses meaning; do not promise universal lossless conversion.

Governance can start with named maintainers and public proposals. GitHub is a collaboration host, not the exclusive authority for runtime discovery. Versioned definitions and conformance materials must be mirrorable. Review source/spec licenses and contribution rights deliberately; this audit does not select or apply a license.

## 6. Privacy and authority before HR

Keep Passport's person identity distinct from an employee record. One person may have several company-local engagements; another company's managers must not correlate or retrieve those engagements by default. Some workers or external contacts will not yet have Passport accounts. Model them as appropriately scoped subjects, not fabricated registered identities.

The authorization decision needs explicit actor + organization + operation + resource scope + constraints, checked at execution time. Resource scope may mean specific records, facilities, projects, teams or the person's own employee record. Sensitive attributes should be separated into protected record/payload compartments; arbitrary JSON field masking alone is not a sufficient architecture. Approvals bind exact inputs and limits; spending and mass export need their own authority.

**Organizational control must not automatically mean plaintext access to every sensitive record.** The current controller wildcard cannot be carried unchanged into HR. Separate company governance from payroll/personnel data stewardship and tightly audited exceptional access. Domain-specific employee access, correction, retention and lawful disclosure rules require specialist review before real records are used.

All derived paths count: notifications, dashboard totals, search indexes, exports, logs, embeddings, AI prompts, caches and support tooling. A payroll module's data permission is not consent to send salaries to an external model. Aggregate disclosures need minimum-group/anti-inference policy where appropriate; an aggregate is not automatically anonymous.

Do not put raw personnel data, medical/benefit documents, bank details or full email contents in a permanently replicated public ledger. Propose removable, access-controlled payload storage and minimal signed provenance, with policy-aware deletion/correction and legal-hold handling. Minimize even the immutable metadata: hashes of predictable personal values can leak information. A deleted payload or destroyed encryption key does not prove recipients erased previous copies. User rights and retention vary by jurisdiction; this proposal is not a compliance conclusion.

## 7. Replaceable hosts and distributed business

Separate four promises and test them independently:

1. **Export:** obtain authorized data and a manifest explaining completeness and omissions.
2. **Migration:** restore usable company state, documents and in-flight work at another host without silently widening access.
3. **Federation:** companies on different hosts can transact while maintaining independent authority and disclosure boundaries.
4. **Provider failure recovery:** recover from backups if the original host is unavailable or refuses to cooperate.

The existing preview demonstrates only a bounded, cooperative, trusted-source migration. It does not establish the other promises. A production design needs signed locator/authority-generation changes, authenticated discovery, key rotation, compatibility negotiation, destination readiness before source freeze, resumable chunked export, snapshot plus delta catch-up, cutover/reconciliation, stale-host detection and explicit failure recovery. Avoid indefinite dual writers. No universal cross-host transaction or global exactly-once guarantee is assumed.

An agreement involving two companies must remain intelligible when only one moves. Preserve authorized counterparty-owned evidence and distinguish owned records from retained evidence copies. A host must not impersonate a counterparty to make import succeed. Validate active references and unresolved dependencies explicitly rather than requiring every business partner to relocate together.

Hosting independence does not require blockchain. A later notarization/consensus profile may help particular trust assumptions; it must justify its cost and privacy impact and cannot substitute for real-world verification.

## 8. Boundaries for workspace, marketplace and incoming modules

### Bringing an existing company-built app

An existing app does not become interoperable simply because we host it. The onboarding path must identify its useful data/operations, map them to supported profiles (or an explicit extension), preserve external/source IDs and history, validate the mapping with fixtures, and place all shared reads/writes behind company-scoped authorization. An adapter may be sufficient; a rewrite is not inherently required. AI can propose mappings, but unit conversions, sensitive fields, authority and lossy transformations need deterministic checks and appropriate human approval. Measure this onboarding effort in the experiment instead of promising zero integration work.

Protocol compatibility also does not mean our host can execute every language, runtime, hardware integration or arbitrary application bundle. The future hosting product must publish its supported runtime/interface contract separately. A self-hosted app can still speak DTP without being deployable in our marketplace runtime.

| Concern | DTP/shared contract | Product or host implementation |
|---|---|---|
| Login | Person identity, accepted membership and allowed actions | Passport UX, passkeys/SSO integration, sessions and custody |
| Module registration | Publisher and module identity; immutable versioned descriptor | Catalog forms and developer onboarding |
| Executable release | Artifact digest, runtime/interface requirements, declared operations and permissions | Build pipelines, registries and deployment |
| Security assessment | Signed assessment naming exact artifact, scope, scanner/reviewer, time, expiry/revocation and limitations | Scanning, review policy, admission decisions and monitoring |
| Installation | Company-specific consent, pinned version/digest, bounded capabilities and revocation | Sandboxing, secrets injection, resource budgets and network isolation |
| Community publication | Optional interoperable release/assessment references | Owner's private/community choice, moderation and marketplace listing |
| Attention and action status | Durable, permission-scoped business-action/event semantics | Notification delivery, unread state, dashboard layout and custom controls |
| Usage | Optional auditable usage/price-agreement/correction receipts with explicit meaning | Pricing model, billing, payment processing, ranking and commissions |

Proposed lifecycle: private draft -> built artifact -> checks/review -> approval for a defined host policy -> optional community listing -> separately authorized installation. New artifact or permission expansion requires fresh assessment/consent as appropriate. Delisting, revoking an assessment, stopping a compromised runtime, and revoking a company installation are different actions. Do not delete business history when an application is removed.

Private applications still require runtime security controls. Community visibility must never imply permission to access company data. An approved release is not permanently safe, and a compatible module is not necessarily secure. Our marketplace may reject a module without defining it as universally invalid DTP. Other hosts can apply their own disclosed admission policies.

Code need not be public to publish a compatible module. Publisher ownership, licensing and source visibility are separate from business-data ownership. Do not tie protocol access to paid marketplace membership. For external SaaS modules, require explicit egress/disclosure agreements rather than pretending our sandbox controls their server.

Agent tool descriptions, retrieved documents and module-produced UI are untrusted inputs. Use the same checked operation contract for chat and manual controls; neither MCP nor an LLM response grants authority. Prefer trusted workspace rendering for high-impact approvals rather than module HTML that can misdescribe an action.

## 9. What explicitly does not belong in the core

- A fixed universal credit or reputation score, preferred lender, lockbox requirement, loan pricing or underwriting policy.
- Tax/payroll calculation engines, legal conclusions, hiring decisions or medical eligibility decisions.
- Demand forecasting, allocation/routing optimization, proprietary business algorithms or a mandatory AI model.
- Dashboard/widget layout, unread counters, search ranking or marketplace recommendations.
- Mandatory public company/employee data, global customer directories or public pricing/margin disclosure.
- A required token, chain, payment provider, cloud host, module marketplace or exclusive registry.
- A general-purpose code runner, antivirus engine, container scheduler, secret manager or arbitrary workflow interpreter.
- Raw high-volume sensor/video/clickstream data as mandatory ledger content. Use authorized external datasets and summaries where appropriate.
- Guarantees of authenticity of physical goods, universal finality of payments, absence of liens, or legal enforceability merely because a record is signed.

These exclusions do not exclude relevant **records**. DTP may describe a payroll result without calculating payroll, carry a route plan without choosing the route, and exchange a security assessment without being the scanner.

## 10. Reuse existing work without inheriting it wholesale

Primary sources checked September 10, 2026. These are candidate mappings/reuse boundaries, not claims of implemented compatibility or a comprehensive standards survey. Pin exact adopted versions later.

| Source | Proposed use | Boundary |
|---|---|---|
| [OASIS UBL 2.4](https://docs.oasis-open.org/ubl/os-UBL-2.4/UBL-2.4.html) | Business-document semantics: orders, invoices, credit notes, transport and catalog structures | Select bounded mappings and code lists; do not copy the entire vocabulary into the core |
| [GS1 EPCIS 2.0](https://ref.gs1.org/standards/epcis/) and [implementation guideline](https://ref.gs1.org/guidelines/epcis-cbv/2.0.0/) | Visibility events, lot/handling-unit relationships, aggregation and transformation | Physical observations and standard identifiers do not establish ownership, honesty or universal compliance |
| [UCUM](https://ucum.org/ucum) | Unambiguous physical-unit representation | Product-specific pack conversions and variable weights still need explicit records |
| [HR Open Standards](https://www.hropenstandards.org/) | HR exchange vocabulary and specialist profile work | Evaluate actual artifacts and applicable rights before adopting; privacy is a separate requirement |
| [CloudEvents](https://github.com/cloudevents/spec/blob/main/cloudevents/primer.md) | Transport-neutral event metadata and bindings | Does not define DTP's business meaning, authorization, processing guarantees or consumer recovery |
| [W3C Verifiable Credentials 2.0](https://www.w3.org/TR/vc-data-model-2.0/) | Issuer/subject/credential vocabulary and presentation concepts | Credential verification does not imply issuer trust or factual truth; avoid mandatory public personal identifiers |
| [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) | Preserve deterministic signing behavior and fixed cross-language vectors | Existing DTP integer-only restrictions and signing domains remain versioned, not silently changed |
| [SLSA 1.2](https://slsa.dev/spec/v1.2/) and [Sigstore verification](https://docs.sigstore.dev/cosign/verifying/verify/) | Artifact provenance and verification inputs for module admission | Provenance is not proof of benign runtime behavior; policy, sandboxing and monitoring remain necessary |
| [MCP security guidance](https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices) | Agent-interface threat model and authorization boundaries | MCP is an optional adapter, not the normative DTP business language |

The [2024 essay](https://medium.com/@George_43822/a-modest-proposal-for-the-grocery-industry-in-america-blockchain-d47457d88827) supplies the mission and network motivation, not current numerical market claims or required DAO/token architecture. Historical research in this repo remains useful background, but its settlement-first and blockchain-era product prescriptions are not current protocol requirements.
