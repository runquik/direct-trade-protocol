# Company workspace and module marketplace: proposed foundations

2026-09-06. Design recommendation, **not a new normative protocol or an implemented workspace**.

## Product boundary

DTP remains the open company identity, permissions and signed business-record layer. A company workspace and module marketplace can be products on top of it; neither should be required to use the protocol. Chat, dashboards and manual controls invoke the same capabilities and inspect the same durable work. The company-facing home is orders, inventory, money and attention needed, not a disconnected collection of app screens.

| Layer | Owns | Must not own exclusively |
|---|---|---|
| DTP | Identity, record meaning, evidence references, authorization, synchronization | A particular UI, model provider, billing operator or discovery channel |
| Workspace / execution service | Module installation, job execution, approvals, operational projections, credential custody | The only usable company identity or only copy of essential workflow state |
| Marketplace | Discovery, publisher verification, pricing presentation, billing reconciliation and payouts | Developers' distribution rights, mandatory exclusivity or the only compatible module registry |
| Modules | Implementations, specialist behavior, optional custom UI | Undocumented essential state that prevents another implementation taking over |

An MVP may combine workspace and marketplace in one service. Keep their contracts separable. Registration is not endorsement, publication is not installation, and installation is not consent to every requested scope.

## Build next, in this order

### 1. Evidence and read models for the existing sprint

Keep an explicit distinction between imported observation, company assertion, counterparty attestation, and verified payment evidence. A source email or extracted PO is not automatically a signature from the buyer. Preserve source provenance and confidence; keep original documents and personal data private with explicit sharing controls, rather than permanently publishing email contents. Content and module descriptions are untrusted data, never execution instructions.

Business entity references use `root_id`. Approval, attestation and financing-decision evidence references use the exact `record_id` (optionally also its payload hash). Consumer code must validate the evidence version, issuer authority, chain membership, relevant terms and later disputes. Store acceptance is not underwriting or physical-world verification. `x_` extensions cannot be the only place essential shared state lives.

Deliver a shared evidence-verification library plus independent language-neutral vectors, not an SDK-only definition. The immutable-field fixes are necessary but do not supply the complete consumer verifier.

### 2. Module capability manifest and conformance kit

A proposed manifest describes stable operation IDs and versions, input/output schemas, record types read/written, required scopes, side effects, approval class, idempotency behavior, progress/error outcomes and optional UI entry points. Pricing and metering references should be versioned and separate from technical permissions. Pin a manifest version at installation; a publisher update must not silently expand access or spending.

Expose the same implementation through ordinary application APIs and an MCP adapter. Do not make MCP tool descriptions the normative business contract. A dashboard button and chat instruction must reach the same checked operation. Module upgrades must declare compatible protocol/operation versions; conformance tests should test behavior, not merely manifest shape.

Start with Passport/Early Pay/Books operations, not an exhaustive universal manifest. Agree the contract with an independent builder before registering new protocol types. A module homepage is not an execution endpoint the store should fetch automatically.

### 3. Portable installation and narrow execution authority

Distinguish publisher/module identity, a company's installed instance, the human or agent requesting an action, and the key executing it. Current module keys can exercise grants from many companies; current company delegate keys have broad non-core authority. Neither is a safe unrestricted workspace-agent credential.

Add tenant/installation-bound credentials and operation-level authorization before exposing a general agent harness to real company data. Keep root keys outside model context and module runtimes. Permission to read/write a type is not permission to share it with every model provider, accept financing, spend money, or invoke every module automatically.

Make uninstall/revocation behavior explicit: stop queued unauthorized work; report already-committed effects; don't pretend revocation reverses external transfers. Reconcile installed state with actual grants. Support replacing a module without transferring its vendor key to the replacement.

### 4. Durable actions, approvals and job execution

Use one stable action ID across chat, dashboard and automation. Record who requested it, the exact inputs/record versions, selected module/operation version, authorization, approval and budget snapshot, progress, result/error and billable outcome. Conversation history is not the authoritative job state.

An approval binds exact effects and a maximum price, not an open-ended natural-language instruction. Recheck permissions and relevant record versions before execution. Separate quote/request/accept/fund into different actions. Failures and retries must not duplicate business effects or charges; an action ID is distinct from each resulting record ID. Multi-module or external-rail workflows need explicit compensation/reconciliation, not an assumption of one distributed database transaction.

Choose one installed provider for each requested capability, with a visible override. Multiple modules may read the same state; avoid accidentally invoking every installed module on the same event. Cash balances and availability projections need declared formulas and provenance when multiple modules derive different answers.

### 5. A thin shared workspace

Build an attention queue, activity history, company record views and approval cards first. Modules may contribute custom controls; critical approval and spending displays should use trusted workspace components. Every number/action should link to the records and module responsible. Authorization applies to derived dashboards, cached search and the agent's retrieved context too, not just raw API reads.

Prove that one action can start in chat, be inspected in a table, approved manually, and resumed from a different client. Keep the UI replaceable, and preserve audit history when a module is uninstalled.

### 6. Usage receipts and marketplace billing, after the above

Separate module usage, agreed pricing, a bill, and actual settlement. A publisher-signed immutable usage claim is not independently verified measurement. Define meters, failure/retry charging, caps, reconciliation, dispute and correction flows before putting billing into the protocol. Require customer spending authorization independently of data grants. Avoid a universal token meter; operations may be priced in understandable units.

Discovery rankings, commissions, subscriptions/allowances and payout-provider plumbing are marketplace concerns. Promote only shared receipt semantics to DTP after an independent producer and billing consumer need them. The marketplace should earn repeat use through convenience and reliability, not exclusive control of data or module distribution.

## Sprint acceptance test, adjusted without expanding the sprint

Proposed module split is Passport + Early Pay versus brand-side Trade Ledger + Books, subject to confirmation after the existing-product demo. Preserve independent signing from the published vectors. Existing extraction can supply realistic **sanitized** shapes; financing, counterparties and transfers remain simulated (`rail: mock`), with no live lender required.

1. One company identity/grant flow works across the independently built modules.
2. Imported records retain their provenance; buyer-side confirmation is supplied explicitly by a separate simulated buyer identity.
3. Early Pay reads the published trade/evidence records, records why it made a test offer, and writes mock finance records.
4. Independently built Books consumes those finance records back through DTP. This must be bidirectional operational integration, not merely an export into the store.
5. Revocation removes access; narrow permissions do not truncate sync. After new grants, readers backfill history.
6. Retry after a lost acknowledgment produces no duplicate record/event. Settlement corrections preserve the original movement.
7. As a stretch test, replace a read-only module and reconstruct the same accounting picture from permitted records, then test an unfinished workflow when durable actions exist.
8. Missing meanings and out-of-band explanations go in the gap log; no requirement that the independent builder read another module's code.

## Not in this repair batch

No workspace UI, module runner, marketplace, real financing, new billing namespace, agent custody system, external document ingestion or deployment. Do not mistake an architecture note for supported APIs. Revisit scaling of the reference store's coarse write lock, tenant isolation, evidence trust, cross-store identity and migration, module supply-chain review, metering economics and multi-party amendment/assignment release as the system grows.
