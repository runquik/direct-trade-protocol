# DTP foundation update: plan for the first public release

September 12, 2026. **Proposed implementation plan, not implementation authorization or a release certificate.**

## 1. Outcome and scope

DTP should let independently operated businesses and independently built applications reuse business records with **shared meaning, explicit authority, and reliable change propagation**. Physical distribution, retail/wholesale discovery, company-built apps, partnerships, professional services, and financial services are uses of this foundation, not competing definitions of the product.

The protocol is not a marketplace, ERP, routing optimizer, general workflow runtime, or guarantee that a physical assertion is true. It should let those products interoperate without making one product the owner of the network.

The first public release target is **DTP 0.1.0**, as requested. Until then, call the work the **DTP foundation update**, with identifiable internal draft revisions. Do not manufacture a new public product version for every development pass.

This plan proposes a reviewed, release-ready implementation as the next execution outcome. Publishing packages, merging, deploying, onboarding real companies, handling personal/financial records, and spending on infrastructure require their own applicable authorization. This planning pass changes only this document. No test suite was rerun; stored release evidence is historical evidence for its recorded scope, not fresh qualification of this plan.

### Finish-line demonstrations

1. A company-built app publishes a private extension without editing the core. Another builder consumes it from the public contract, and a replacement app continues its unfinished work.
2. A retailer's demand can discover published goods, handling and transport offers, obtain a delivered quote, and produce linked provider commitments. A failed provider triggers explicit recovery rather than a falsely confirmed order.
3. An agency or broker can act for a client under bounded, revocable authority without becoming the client, seeing unrelated records, or acquiring administrative control.
4. A finance module receives precisely authorized evidence from the same records, distinguishes unknown from verified information, and does not require a bespoke inventory integration.
5. Consumers recover after missed updates, corrections, permission changes, module replacement, and a cooperative host move without silently losing meaning or widening access.

These are synthetic protocol fixtures and minimal reference clients, not full production applications.

## 2. Evidence baseline: keep, extend, replace

Inspected local source: `5045e52`, the reviewed experimental v0.4 candidate. The checkout is not itself checked out on main. No remote/deployed-state refresh was performed. Existing changes in `progress.md`, `.codex/`, private collaboration notes, the nested vision site, and `output/` are outside this plan and remain untouched.

| Area | Verified current surface | Planned response |
|---|---|---|
| Identity | Signed people and organizations; key rotation; organization controllers and accepted memberships | Preserve separation; design version-independent identity continuity, service principals, resolution and recovery |
| Authority | Controller administration separate from policy stewardship; resource-scoped read/write/export; human/module intersection | Add bounded business-operation delegation, approvals, partnership mandates and dependency-aware revocation |
| Record integrity | Signed commands, exact retries, immutable revisions, current-head conflicts, minimal write receipts | Keep; formalize stable references, typed relationships, corrections, business effects and external identifiers |
| Extensions | Publisher-owned immutable definitions, pinned dependencies, closed bounded schemas | Keep fail-closed admission; add reusable datatype vocabulary, operation contracts and independent semantic conformance |
| Business semantics | Built-in inventory/packaging and invoice rules; custom profiles can validate structure | Decouple host semantic support from a hard-coded pair of business families without accepting arbitrary uploaded code |
| Synchronization | Authorized paginated record reads; host-local sequence; explicit evidence exchange | Add gap-detectable changes, snapshot/catch-up, resumable consumption, freshness and revocation behavior |
| Discovery | Host health information and explicit pinned remote-company authority | Add permissioned offer/demand publication and a replaceable discovery interface, not a global public company database |
| Cross-company work | Owner-bound records, counterparty references and recipient-bound historical evidence | Add mutual relationships, agency mandates, quotes and separately authorized linked commitments |
| Portability | Bounded staged cooperative host migration; original records/policies/profiles preserved | Extend to new operational state, discovery relocation, outstanding commitments and tested backup recovery |
| Module admission | Exact artifacts, assessments, declarations, installations and revocation | Keep; clarify that app hosting, scanners and sandboxing are separate prerequisites for running untrusted apps |
| Storage | One JSON state row and one global transaction lock; even signed read requests traverse the state transaction | Retain as executable reference baseline, not network-scale architecture; implement indexed transactional persistence |
| Evidence | Stored candidate report marks its gates passed; separate consumers and adversarial tests exist | Preserve regressions; do not inherit green status for new requirements or claim external-builder independence |

Source anchors: [model](../sdk/src/v04/model.ts), [engine](../sdk/src/v04/engine.ts), [permissions](../sdk/src/v04/permissions.ts), [profiles](../sdk/src/v04/profiles.ts), [router](../sdk/src/v04/router.ts), [wire](../sdk/src/v04/wire.ts), [federation](../sdk/src/v04/federation.ts), [storage](../spec/v0.4/store.sql), [acceptance scope](release/v04-acceptance.md), [CI](../.github/workflows/protocol.yml).

The [business-domain map](DTP_BUSINESS_DOMAIN_MAP.md) remains a useful design inventory, but its historical “Now” column is not today's implementation status. The [earlier stress results](DTP_STRESS_TEST_RESULTS_2026-09-10.md) describe a pre-fix baseline, not current unresolved bugs.

## 3. Architecture and boundary rules

```text
Company apps / workspaces / marketplaces / finance / distribution coordinators
                 | authorized common interfaces
Shared optional profiles: goods, offers, demand, service capacity,
relationships, commitments, fulfillment, invoices, evidence
                 | versioned definitions and supported operations
Core: identity + authority + references + revisions + command admission
      + change exchange + profile negotiation + provenance
                 | documented storage and transport contracts
Replaceable hosts, discovery indexes, credential providers and adapters
```

This is one protocol family, not one mandatory all-business schema. A payroll consumer need not implement pallet handling. A discovery index is not the authority that can promise somebody else's stock. A matching algorithm can be proprietary while its offers and commitments remain interoperable.

### What becomes first-class, and where

- **Core primitives:** person/organization/service identity, controller authority, delegation, resource reference, record revision, profile identity, action receipt, change checkpoint and evidence provenance.
- **Profile objects with independent identity:** product, lot, packaging specification, facility, handling unit, offer, demand request, service-capacity pool, agreement, commitment, fulfillment and assessment. These can be first-class without all being built into the core.
- **Typed relationships:** owns, operates, employs, represents, supplies, holds custody, fulfills, finances. None of these relationships automatically grants access. A facility is not a company; custody is not title; a corporate parent is not automatically an administrator of its subsidiary.
- **Module decisions:** matching, route optimization, underwriting, forecasting, reputation scoring, pricing strategies, dashboards and the user's preferred automation experience.

Admission rule for a new core concept: demonstrate a cross-domain need, explicit invariants, privacy consequences and at least two contrasting fixtures. Otherwise put it in an optional profile. Do not build a universal business ontology or execute every workflow in the core.

## 4. Priority work packages

All packages below are proposed, not currently running. Owners are responsibilities for a later implementation team, not assignments to Boris or existing agents.

### F0. One release story and a frozen compatibility baseline

**Priority:** prerequisite. **Owner:** integration/release lead.

- Inventory historical specs, signing domains, ID derivation, routes, package names/versions, generated artifacts, demos and deployment references. Confirm which packages or interfaces were ever externally published before changing their naming.
- Explain that v0.2/v0.3/v0.4 are experimental wire generations. Target public DTP 0.1.0; use `0.1.0-dev.N` for new unpublished development artifacts where appropriate. Do not republish a used package version or silently downgrade an existing package release line.
- Separate public release version, exact wire-contract identity, profile version and software package version. Published signed bytes and definition digests never change in place.
- Preserve historical verification fixtures and label legacy entry points clearly. Select one default development entry point; do not add another parallel product stack by reflex.
- Decide which synthetic demos are explicitly reseeded and which records need an opt-in provenance-preserving adapter. No destructive database reset, history rewriting or implied continuity from a text rename.

**Exit:** one documented release/version policy; old signature vectors still verify under their original verifier; wrong-format replays fail; one unambiguous getting-started path.

### F1. Identity, identifiers and relationship foundations

**Priority:** core must-have. **Owner:** identity/authority lead.

- Give stable identity a lifecycle independent of email, employer, any vendor's domain, current host and draft protocol numbering. Define exact revision references separately from stable entity references.
- Specify current-controller resolution, key rotation, compromise response and recovery. Resolve how multiple company hosts learn the same person's new controller state instead of holding independently stale person copies.
- Keep an identity-control registry adapter separate from the core. Evaluate NEAR as one implementation, not a mandatory wallet, public personal directory, or assumption that a genesis signature resolves later forks. Freeze one implemented trust model for the pilot.
- Define organization-authorized service principals for scanners, company services and long-lived automation. Human accountability and organization sponsorship must be explicit; do not force enduring business automation to impersonate a departed employee.
- Distinguish a protocol identity from a legally verified person/company. Model verification as issuer-bound evidence with status, not a boolean that registration magically establishes.
- Namespace external IDs by issuer and type. Product aliases, company names, SKU mappings and record-number matches are claims requiring provenance, not proof that entities are identical.
- Preserve organization-local employee/customer/contact references, including people without Passport. Avoid publishing a universal cross-company personal graph.

**Exit:** device/key replacement, multi-company membership, service-sponsor transfer and protocol-upgrade continuity tests; no cross-company profile disclosure; loss of ordinary credentials recoverable through the explicitly chosen recovery policy. Recovery without any surviving recovery authority is not promised.

### F2. Authority to act, delegate and approve

**Priority:** core must-have. **Owner:** identity/authority lead, reviewed independently.

- Keep data access distinct from business actions: observing stock, adjusting stock, quoting, reserving, approving an order, confirming receipt, sharing evidence and authorizing a payment are not one generic write permission.
- Bind each operation to represented organization, action, resource scope, expiry and bounded constraints. For the first implementation support a finite explicit constraint vocabulary, not arbitrary policy code.
- Add spending/quantity limits, exact-input approvals, approval expiry, multi-person thresholds and separation-of-duties where declared. Changing amount, parties, quote revision or terms invalidates the affected approval.
- Model delegation chains with parent grants, bounded depth and no broader scope, duration or power than the parent. Delegation permission must itself be explicit. Parent revocation disables descendants at execution, not only outstanding invitations.
- Add mutual company relationship records and bilateral service/agency mandates. An agency's person acts through their own organization and a client's mandate; client access is the intersection, not an invented client employee account.
- State which governance changes require quorum. Steward policy changes may confer access; log and review self-grants rather than implying stewardship eliminates escalation risk.
- Recheck live authority at irreversible execution. A previously approved document is historical evidence, not a forever-valid execution credential. Removing access does not erase an already valid commercial obligation.

**Exit:** synthetic broker authorized to quote but not accept; buyer cannot confirm seller action; no self-approval where prohibited; amount splitting addressed by scoped cumulative limits where supported; expired/modified/revoked mandates block queued execution.

### F3. Shared records, datatypes and provenance

**Priority:** core/profile must-have. **Owner:** protocol/data-model lead.

- Publish reusable datatypes for decimal quantity, currency/monetary asset, unit, local date, instant, timezone, interval, location, external identifier and evidence status. Declare rounding and conversion rules per profile.
- Represent absent, unknown, withheld, not applicable and zero distinctly. A missing available-stock calculation is not zero; missing debt evidence is not a clean balance sheet.
- Separate observation time, effective business time and acceptance time; command, observation, commitment, attestation and derived assessment must remain distinguishable.
- Define append, revision, correction, cancellation and reversal by record kind. Do not turn inventory-event supersession into retroactive changes to accepted reservations.
- Add explicit input revision references, causation/correlation, provenance and completeness to derived outputs. A financing assessment or delivered-cost estimate identifies what it used and what it could not see.
- Define attachment manifests and authorized external payload access with integrity, size/type bounds, retention and import behavior. Do not inline unlimited images, BOLs or sensor streams into immutable history.
- Keep disputed assertions side by side with issuer identity and resolution links. Counterparty confirmation is a distinct statement, not an owner-editable `confirmed` field.

**Exit:** corrections cannot silently rewrite accepted agreements; two independently coded consumers agree on fixture outputs; unsupported units, ambiguous IDs and unknown references produce explicit results.

### F4. Extensible profiles with honest semantic support

**Priority:** core must-have. **Owner:** profile/contracts lead.

- Retain exact immutable schema/definition/dependency identity and publisher authority. Add a documented profile contract covering meaning, operations, lifecycle, authority, validation level, examples and negative vectors.
- Publish a bounded operation-descriptor format: inputs, effects, preconditions, required grants, approval bindings, concurrency scope and retry behavior. The descriptor is not executable permission by itself.
- Refactor the hard-coded semantic-family switch behind a declared host capability boundary. Recommended first approach: operator-admitted, pinned deterministic handlers implementing published contracts; no runtime code downloads from a submitted record.
- Publish handlers as separately reviewable implementations of optional profiles, not universal core business logic. A host advertising a profile's operations must pass its conformance suite. Supporting a record's shape does not authorize or certify its state transitions.
- Let a company app introduce a purely structural profile without host code changes. A new authoritative business operation needs an admitted conforming handler or a separately identified provider authority. Do not conceal this distinction in the builder experience.
- Define explicit incompatible-version errors and revision-to-revision mappings. No silent field dropping, automatic lossy conversion or implicit dependency-schema inheritance.
- Evolve the bounded schema dialect only where fixtures prove a need. Preserve complexity limits and prohibit arbitrary network references, dynamic evaluation and unbounded validators.
- Define open profile governance, namespace recovery, deprecation, publication licensing and conformance claims. Private schemas remain private; public records do not accidentally disclose private dependencies.

**Exit:** a new service/inspection profile works without core edits; two independent implementations either agree on behavior or explicitly reject unsupported semantics. A malicious profile cannot fetch URLs, execute code, redefine existing meaning or claim support through its name alone.

### F5. Reliable change propagation and state reconstruction

**Priority:** core must-have. **Owner:** synchronization/storage lead.

- Define an authorized change-feed interface with stable event identity, authority epoch, scoped checkpoints, additions/revisions/tombstones and explicit gap responses. A filtered feed must not leak unauthorized record IDs or bodies.
- Provide snapshot plus catch-up with a consistent boundary; define retention, checkpoint expiry and resnapshot behavior. Consumers persist progress without gaps between the initial snapshot and later changes.
- Make at-least-once delivery and idempotent processing explicit. A durable outbox couples accepted effects to emitted changes. A lost response must not duplicate a commitment or external payment instruction.
- Establish one declared authority per mutable resource/capacity pool. An offline observation can be recorded later; an offline client cannot promise globally available stock without an explicitly allocated authority budget.
- Separate eventually refreshed views from authoritative command execution. Include as-of/checkpoint/completeness metadata; booking rechecks current availability at its authority.
- Define revocation and withdrawal behavior for feeds, indexes, dashboards, caches and exports. Erasure of received copies is not guaranteed. Use non-disclosing invalidation/resync behavior when revealing a removed resource would leak information.
- Start with replayable pull synchronization; implement optional signed webhook notifications using that same durable feed, with delivery authentication, endpoint validation, SSRF defenses, retries, backoff and bounded fan-out. Webhooks are notifications, not a second source of truth.

**Exit:** duplicate, reordered and missing deliveries; consumer restarts; permission changes mid-page; retained-history gaps; corrections; authority relocation; and replacement consumers all produce documented outcomes without silent omission.

### F6. Publishable supply, demand and service discovery

**Priority:** shared-profile and interface must-have. **Owner:** commerce/profile lead.

- Define minimal product, goods-availability, demand-request and service-offer profiles. Common fields include provider, subject, location/service area, time window/timezone, unit/capacity, minimum/maximum, conditions, pricing basis, freshness/expiry and authoritative quote/booking endpoint reference.
- Keep internal stock, internal costs and customer-specific contracts separate from intentionally advertised availability and prices. Published availability can be coarse or request-for-quote only.
- Distinguish asking price, estimate, time-limited quote and firm accepted terms. Identify currency, taxes/fees included or excluded, minimums, handling requirements and accessorial conditions. Do not imply a universally computable landed price.
- Define discovery publication, update, withdrawal, provenance and pagination interfaces. Implement two disposable index instances to prove that indexes are replaceable and can recover from change feeds.
- Search and ranking remain implementations. Exact filters, profile compatibility, result provenance, declared coverage and revalidation are contractual. No index promises universal completeness or authority over somebody else's capacity.
- Registry/endpoint discovery must authenticate provenance; discovering an endpoint does not make its host trusted. Limit outbound fetches and authenticate enrolled peers instead of following arbitrary advertised URLs.

**Exit:** unrelated wholesale and distribution clients can find the same authorized offer; private terms stay private; stale/withdrawn offers cannot become firm bookings without authority revalidation; company migration updates the locator without changing the offer identity.

### F7. Quotes, capacity holds and linked commitments

**Priority:** shared-profile must-have. **Owner:** commerce/coordination lead.

- Define a bounded commitment lifecycle: proposed, quoted, held, accepted, fulfilling, completed, cancelled, expired and disputed where applicable. Pin quote revisions, parties, resources, time windows, price components, dependencies and change/cancellation conditions.
- Separate goods reservations, time-windowed warehouse capacity, transport service capacity and staffing availability. Reuse commitment principles without pretending every resource is measured or allocated like inventory.
- Each provider remains authoritative for its own capacity and signature. Define hold expiry, confirmation, retries and observable status, including an uncertain result after a network timeout.
- Build a minimal reference coordinator that obtains provider holds, requests any required approvals, confirms commitments and records its durable progress. It is replaceable application code, not a global DTP transaction service.
- Do not promise atomic commitment across unrelated hosts. Partial success triggers declared compensation: release reversible holds, cancel only under agreed conditions, or enter a visible exception requiring resolution. Never report a rollback when a provider's commitment remains in force.
- Allocate price/risk responsibility explicitly: who issues the combined quote, who is the buyer's counterparty, who bears changed freight cost, and which substitutions require consent. No default financial guarantee by DTP or by any workspace or marketplace operator.
- Add fulfillment evidence, partial quantities, short/damaged deliveries and linked invoice/credit adjustments. Preserve disagreement and separate completion from payment settlement.

**Exit:** the same order succeeds normally and survives carrier refusal, expired quote, coordinator crash, duplicate retry, partial confirmation, delivery shortage and provider substitution without hidden commitments or duplicate stock allocation.

### F8. Partnerships, services and finance as contrasting consumers

**Priority:** bounded shared profiles must-have; specialist breadth later. **Owner:** relationship/finance-profile lead.

- Broker/agency engagement: scope, principal, agent organization, delegated activities, effective period, compensation basis, approvals, termination and surviving obligations. A relationship alone never discloses the client's data.
- Service engagement: deliverables, milestones, acceptance, time/capacity and work evidence. Prove this with a merchandising team or agency rather than another inventory-shaped example.
- Finance evidence request/grant: exact sources/revisions, permitted recipient and purpose, expiry, observed time and completeness. Request additional evidence without obtaining blanket company access.
- Reuse trade records for a synthetic financing assessment. Keep underwriting, pricing and scoring in the finance module; unknown data remains unknown, and an attestation does not prove absence of undisclosed obligations.
- Provide extensible references for obligations, collateral, assignment/release and external settlement status, but do not claim global financing exclusivity, legal perfection, money movement or real underwriting readiness.
- Preserve future restricted workforce/achievement profiles, but do not add a universal reputation score or real payroll workflow to this release.

**Exit:** an agency's independent staff member works within a client's mandate; termination blocks new actions; a second finance consumer interprets permitted evidence without privileged database access; company switching and all derived views remain isolated.

### F9. Persistence, privacy, portability and operational readiness

**Priority:** core-host must-have before real use. **Owner:** storage/operations lead with security review.

- Replace the all-host singleton write path with indexed records, revisions, resource authority, command receipts and transactional outbox storage. Use resource/organization-scoped locking and concurrency constraints. Keep the current reference engine as a differential oracle while changing storage.
- Preserve atomicity of authorization checks and effects. Partitioning cannot allow revocation races, oversubscribed shared capacity, partial state commits or outbox loss.
- Add quotas, rate limits, request/schema/attachment bounds, retry limits, feed backpressure and observable rejection reasons. Prevent one tenant from exhausting the whole host through large histories or broad subscriptions.
- Specify trusted-host versus encrypted-payload boundaries. Before real sensitive records, choose and test key custody, retention/deletion, backups, support access and derived-data policies; API permissions are not secrecy from database administrators.
- Extend migration manifests to authority/delegation chains, private definitions, attachments, feeds, pending quotes/commitments, operation receipts and coordinator state. Destination capability checks precede source freeze. Outstanding counterparties must be able to resolve the new authority.
- Add independently stored backups and restore rehearsal. Cooperative migration and original-host failure recovery are distinct gates. Do not resume two writable authorities after a partition.
- Audit supported Node/Deno/PostgreSQL and dependency versions against current primary advisories at execution kickoff. Prefer supported, reproducible versions, not blind major upgrades. Pin CI dependencies/actions and record lockfile provenance.

**Exit:** real PostgreSQL contention/rollback tests and differential state checks pass; no global serialization for unrelated tenant reads/writes; measured load and restore results meet an explicit pilot envelope.

Provisional benchmark, to ratify before implementation: 10 organizations, 100,000 representative records, 50 concurrent clients, including a hot reservation pool and mixed unauthorized reads; target p95 reads below 500 ms and accepted writes below 1 second on documented hardware. These are planning targets, not measured capacity or a production SLA. Correctness and isolation must hold even when latency targets fail. Define separate feed-lag, backup recovery-point and recovery-time targets in the operations decision record before testing.

### F10. Builder experience and independent conformance

**Priority:** must-have. **Owner:** developer-experience/conformance lead.

- Provide one local sandbox, synthetic fixtures, generated typed contracts, examples in at least two client environments and an explicit supported-profile capability response.
- Ship a profile starter, a private-app starter and actionable error examples. AI-generated starter code must still use the same SDK/contracts and pass the same server-side checks; it gets no special trust.
- Provide a minimal record/authority inspector showing readable business meaning, provenance, status, freshness, missing evidence and why an action failed. This is developer tooling, not a workspace product.
- Distinguish connecting a privately operated app from uploading executable code for us to host. The former requires admission and authorization; the latter additionally requires a reviewed runtime/sandbox/secrets/egress operating model and is deferred.
- Require a cold integration by an external builder using published docs, without private database access or undocumented instructions. Obtain participation explicitly; do not assume Boris's availability. Every clarification needed becomes a contract/doc/test change.
- Maintain separate badges/results for structural validation, semantic conformance, host trust, credential evidence and artifact assessment. No generic green badge meaning “all safe.”

**Exit:** independent producer/consumer integration and app replacement succeed; a deliberate incompatible extension fails understandably; minimal human review can explain each fixture's state and authority from public documentation.

## 5. Execution order and dependency graph

```text
F0 baseline + version/release decisions
  -> F1 identity/relationships + F3 records/datatypes
      -> F2 operation authority + F4 profile contracts
          -> F5 synchronization + F9 transactional persistence
              -> F6 offers/demand/discovery
                  -> F7 linked commitments
                      -> F8 service/agency/finance consumers
F10 conformance harness starts at F0 and grows with every package
All packages -> independent review -> fixes/retests -> release candidate
```

F9 privacy and recovery design starts alongside F1/F2, not at the end. F6 profile drafting can proceed in parallel once F3/F4 contracts are frozen. No parallel implementation should independently invent incompatible common IDs, money types or grant structures.

| Milestone | Deliverable | Stop/go condition |
|---|---|---|
| M0: agree boundaries | Architecture decisions, requirement graph, legacy inventory, fixture scripts | No unresolved identity/trust/semantic-execution decision hidden in implementation |
| M1: reusable foundation | Identity continuity, operation authority, typed records/profiles, persistence contract | Permission, signature, compatibility and state-invariant negatives pass |
| M2: living records | Reliable feed, checkpoints, indexed persistence, private app and replacement reader | Missed updates, revocation, crash/restart and replacement preserve meaning |
| M3: discoverable commerce | Goods/demand/service publication and two indexes | Freshness, privacy, endpoint trust and index replacement proven |
| M4: coordinated trade | Linked quotes/holds/commitments and simple reference coordinator | All specified partial-failure and compensation cases pass |
| M5: cross-domain proof | Agency mandate, service engagement, finance evidence, host relocation | No private glue or widened authority; unsupported semantics explicit |
| M6: qualification | Independent integration, adversarial review, operational evidence and release docs | All mandatory graph gates fresh; no unexplained skips or unresolved blockers |

Do not attach a fixed calendar promise to these milestones before M0 decomposes them into executable tasks. Identity continuity, semantic-handler admission, distributed failure recovery and persistence are the highest-uncertainty work. If scope exceeds capacity, narrow the supported profiles, not core authority or correctness. Any change to a mandatory fixture requires explicit scope review rather than silently redefining success.

## 6. Acceptance scenarios and adversarial review

| Case | Required observable result |
|---|---|
| Private custom inspection app | Introduces definition without core source edits; second app recognizes exact supported contract |
| Shared product, changed packaging | New pack revision cannot change historical order quantity or fulfillment conversion |
| Last case / last truck slot race | One authoritative allocation; other contenders receive a conflict, not duplicate success |
| Fifteen-store demand | Separate needs can be combined by a module; resulting commitments retain store-level provenance and limits |
| Partial provider confirmation | Coordinator records actual accepted commitments; compensates where permitted; unresolved remainder visible |
| Quote changes after approval | Old approval cannot authorize new price, date, provider or quantity |
| Broker at multiple clients | Client mandates and agency employment both enforced; no cross-client leakage |
| Departed employee / revoked parent grant | New automation/delegated execution blocked; accepted obligations retained; authorized sponsor change explicit |
| Unreadable finance evidence | Unknown rather than zero, clean bill of health or existence leak |
| Missed/reordered events | Consumer catches up or receives explicit gap; no silent corrupt projection |
| App/host replacement mid-order | Replacement reconstructs records and pending work, without reexecuting completed effects |
| Host crash / restore / partition | Acknowledged effects recovered within declared policy; no competing writable authorities |
| Malicious extension/endpoint | No remote code execution, arbitrary schema fetching, SSRF or permission escape |
| Product discovery privacy | Publication opt-in; internal cost, private stock and personnel data absent from indexes/logs/notifications |
| Unknown semantic handler | Stored structural record never masquerades as an enforced reservation or approved payment |
| Correctly signed false statement | UI/consumer reports who asserted it and supporting evidence; does not claim verified physical truth |

Expand the existing 28-case matrix with these acceptance assertions, retaining dispositions for out-of-scope cases. A test that proves a known gap exists is not a passing implementation gate.

### Evidence and review loop

For each requirement record: ID, user outcome, owning contract, files, dependencies, owner, positive/negative tests, evidence digest and reviewer disposition.

Loop: **freeze a small contract -> write failing acceptance cases -> implement -> run -> adversarial review -> fix -> rerun affected dependencies -> independently re-review**. Changes to core inputs invalidate downstream evidence. Tests require the intended runtime; missing infrastructure is blocked, not skipped green. Maintain deterministic/property-style tests, actual PostgreSQL races, Node/Deno boundaries, schema/signature parity, migration and independent client tests.

Proposed later team roles: protocol/integration lead; identity/privacy reviewer; profile/commerce implementer; storage/synchronization implementer; independent security/conformance reviewer; builder-experience reviewer. No one solely approves their own work. This plan does not spawn or authorize that team now. External security/privacy review and an external cold builder are distinct from agent review.

## 7. Release boundaries and explicit exclusions

**Required for the planned protocol candidate:** core contracts and their reference implementation; bounded goods/service/agency/finance fixtures; reliable synchronization; private app integration; independent interpretation; operational-state portability; source-bound review evidence.

**Required before real company use:** deployment-specific security/privacy assessment; identity custody/recovery; quotas/abuse protection; measured capacity; backups/restore; incident and key-compromise procedures; disclosed supported profiles and trust assumptions. Publishing an experimental specification is not approval to handle real employee records or funds.

**Not in this update:** any workspace's login or dashboard UI, hosted executable marketplace, automatic malware certification, full ERP replacement, generalized route optimization, real payment rails, lender underwriting, lockboxes, universal credit/reputation scores, payroll/tax calculation, global cross-host exactly-once or atomic transactions, mandatory blockchain/token, and elimination of every intermediary. Necessary physical services remain independent participants.

## 8. Decisions to close in M0, with recommended defaults

| Decision | Recommended default | Revisit trigger |
|---|---|---|
| Versioning | First public release 0.1.0; internal drafts identifiable; historical signed formats preserved | Discovery of an already published package/interface with conflicting numbering |
| Identity authority | Host-independent identity contract; select and test one explicit resolver/custody/recovery model | Multiple independent hosts or changed custody promises |
| NEAR | Optional registry adapter evaluated against the identity contract, not assumed core dependency | Demonstrated benefit and acceptable cost/privacy/recovery evidence |
| Semantic execution | Pinned operator-admitted deterministic handlers with conformance tests | Need for independently supplied handlers beyond reviewed deployment model |
| Consistency | One authority per resource, replayable eventual views, fresh checks for commitments | Explicit offline allocation or shared-resource federation requirement |
| Discovery | Replaceable opt-in indexes over signed publisher data | Scale/access patterns requiring different indexing infrastructure |
| Cross-provider orchestration | Replaceable coordinator with durable status and compensation | Parties explicitly support stronger coordinated transaction guarantees |
| Initial network trust | Explicitly enrolled host peers; discoverability is not trust | Open federation pilot with an approved abuse/admission model |
| Initial data | Synthetic, then minimally sensitive pilot only after readiness review | Real workforce, bank, medical or settlement use |

These defaults are enough to write the implementation backlog. The identity custody/recovery choice and any change of financial or operational authority require an explicit decision before implementation of that boundary, not assumptions buried in code.

## 9. Standards reuse, not reinvention

Primary sources checked for this plan. These are proposed reuse points, not claims of implemented conformance. Pin exact adopted versions and inspect normative artifacts and licensing during M0.

- [W3C DID Core](https://www.w3.org/TR/did-core/) provides an identity/controller/service-reference model to evaluate. A DID label alone does not solve resolution, recovery, trust or privacy.
- [GS1 EPCIS/CBV artifacts](https://ref.gs1.org/standards/epcis/artefacts) provide established physical visibility-event vocabulary and artifacts; the page currently lists 2.0.1. Map selected product/lot/custody/aggregation concepts rather than invent incompatible meanings or claim full conformance prematurely.
- [OASIS UBL 2.4](https://docs.oasis-open.org/ubl/UBL-2.4.html) supplies business-document models for procurement and transportation. Evaluate mappings for offers/catalogues, orders, invoices and transport; preserve explicit mapping losses and avoid importing the whole schema library into the core.
- [CloudEvents](https://cloudevents.io/) provides common event metadata; its [primer](https://github.com/cloudevents/spec/blob/main/cloudevents/primer.md) distinguishes the format from security and routing concerns. DTP still needs business meaning, authorization, ordering, retries and recovery.
- [Semantic Versioning](https://semver.org/) allows an initial-development release line and prerelease labels. Published artifacts must remain immutable; user-facing release milestones do not justify rewriting cryptographic identities or old bytes.

## 10. Recommended next authorization

Approve this plan's architecture and bounded finish line, then execute M0 and M1 first with an inspectable requirement/evidence graph. Review the frozen identity, operation-authority and extension contracts before the longer implementation loop proceeds through commerce and independent integration.

The outcome is not “a bigger pile of schemas.” It is a reusable protocol where a record's meaning, authority, changes and unfinished commitments survive the applications and infrastructure that created them.
