# Appendix E — Mapping the v0.1 NEAR contract types to v0.2 records

*Informative. The contract in [`contracts/`](../contracts) implements DTP v0.1 and is not v0.2-conformant. This document lets a future on-chain store profile (or an off-chain adapter) translate between the two without guesswork. Line references are to `contracts/src/types.rs` at commit `dd623af`.*

## 1. Representation conventions

| Concern | v0.1 Rust (`types.rs`) | v0.2 record | Conversion |
|---|---|---|---|
| Timestamps | `u64` Unix milliseconds, set by the contract from `env::block_timestamp()` | RFC 3339 UTC string with `Z` (envelope `created_at`, body `*_at`) | `new Date(ms).toISOString()`; reverse `Date.parse()` |
| Money | `Amount = u128` microdollars (1 USDC = 1 000 000) | `Money {amount: string (≤ 6 decimals), currency}` | `amount = (µ / 1e6).toFixed(6)` trimmed; reverse `BigInt(amount × 1e6)`; currency `USDC` on-chain, `USD` or `USDC` off-chain |
| Quantities | `Quantity {milliamount: u64, unit: String}` | `Quantity {amount: string (≤ 3 decimals), unit}` | `amount = milliamount / 1000`; unit enum unchanged |
| Party references | `near_sdk::AccountId` | `CompanyId` string (NEAR account grammar) | identical text when the company's handle *is* its NEAR account; otherwise via `core.company.identifiers.near_account` |
| Enums | `PascalCase` variants (`Posted`, `InFulfillment`, `ValueAdded`) | `lower_snake` strings (`posted`, `in_fulfillment`, `value_added`) | mechanical case conversion; on the Rust side one `#[serde(rename_all = "snake_case")]` |
| Record identity | `String` ids from one global counter (`int-7`, `ctr-12`) | envelope `record_id`/`root_id` (UUID) | a deterministic UUIDv5 over `(contract account, v0.1 id)` is a reasonable bridge |
| Versioning | `version: String` (protocol version) stamped on each message | envelope `schema_version` per type | drop the body field |
| Mutation | in-place update (`update_catalog_entry` bumps `version: u32`) | new record with `supersedes` | each on-chain update becomes a superseding record |
| Signatures | none stored; "signed" = the NEAR transaction predecessor | envelope `signature` (Ed25519, NEAR encoding) | a NEAR account's access key *is* a valid DTP key; a store profile on NEAR can treat the transaction signature as the record signature |
| Events | `AuditEvent {event_id, event_type, entity_type, entity_id, actor, timestamp, payload_hash}` logged as `DTP_EVENT:` and stored in `audit_log` | `core.event` (one `record_appended` per write) | see §4 |

## 2. Identity and `core.*`

| v0.1 | v0.2 | Notes |
|---|---|---|
| `Party` (`:201`) | `core.company` body | `party_id` → `subject_company_id`; `business_name` → `display_name`; `business_type` (`Producer\|Distributor\|Retailer\|Cooperative\|Agent`) → optional plural `business_types[]` (adds `brand`, `financer`, `service_provider`, `other`; descriptive only, never a role); `jurisdiction` unchanged; `kyb: Option<KybRef>` → `kyb` (statuses lower_snake); `certifications` → `certifications` (`type` field renamed `cert_type` in v0.1 Rust already); `gs1_gln` → `locations[].gln` (a company has many GLNs); `duns_number` → `identifiers.duns`; `fsma_pcqi_on_file`, `facility_allergens` (lower_snake) unchanged; `data_vault_uri` unchanged |
| `Party.authorized_agents: Vec<AccountId>` (`:214`) | `core.company.keys[]` with `role: delegate` and `near_account` set | a sub-account's key becomes a delegate key; scope restrictions come from `core.grant`, not from the key |
| `Party.reputation: ReputationRecord` (`:162`) | **not a record** — derived view (SPEC §6.9) | never stored in a cabinet |
| `RelationshipRecord` (`:1130`) | **not a record** — derived view | two-party aggregate; recompute from `trade.*` chains |
| `KybRef` (`:48`) | `common/kyb_ref` | `status` `Pending\|Verified\|Expired\|Revoked` → `pending\|verified\|expired\|revoked` |
| `CertificationRef` (`:139`) | `common/certification_ref` | `CertStatus` lower_snake |
| — (no equivalent) | `core.module`, `core.grant`, `core.event` | v0.1 had `require_party_or_agent` (`lib.rs:130`) as its only delegation primitive; v0.2 grants generalize it with scopes, expiry, and revocation |
| `FinancePool` (`:681`) + `register_finance_pool` (owner-gated) | — | candidate `finance.pool` in v0.3; the "external contract with one narrow capability" pattern maps to a module with a `finance write` grant |

## 3. Trade namespace

| v0.1 | v0.2 | Field-level notes |
|---|---|---|
| `TradeIntent` (`:879`) | `trade.intent` | `buyer` → `buyer_company_id`; `pricing: BuyerPricing` unchanged shape (money as strings); `goods`, `delivery`, `finance`, `freight`, `expires_at`, `status` (lower_snake) |
| `SupplyListing` (`:916`) | `trade.listing` | `seller` → `seller_company_id`; `pack_structure` (Rust-only in v0.1) now required; `pricing: SellerPricing`; `available_from`, `expires_at`; `Withdrawn` → `withdrawn` |
| `Offer` (`:956`) — Rust shape | `trade.offer` | v0.2 adopts the Rust shape over the v0.1 prose: `target_id`, `target_type` (`Intent\|Listing` → `intent\|listing`), `offerer` → `offerer_company_id`; adds `target_owner_company_id` (the counterparty); `Retracted` → `retracted` |
| `TradeContract` (`:1005`) | `trade.contract` | `buyer`/`seller` → `*_company_id`; `intent_id`, `listing_id`, `offer_id`, `standing_agreement_id`, `lot_id` retained as nullable roots/opaque ids; `escrow_ref: String` → `escrow_ref: string\|null` (null off-chain); `arbitrator` → `arbitrator_company_id`; `dispute_window_hours` unchanged; `ContractStatus` lower_snake |
| `Fulfillment` (`:1060`) | `trade.fulfillment` | adds `seller_company_id`/`buyer_company_id` (v0.1 derived them from the contract); `Attestation {party_id, signed_at, notes}` (`:1051`) → `{company_id, attested_at, record_id, notes}` — `record_id` names the record whose envelope signature proves it; the v0.1 prose `signature` field is dropped; `buyer_attest_delivery` becomes a superseding record issued by the buyer |
| `Deduction` (`:1077`) | inline `deductions[]` on fulfillment/settlement/invoice | `amount` → `Money` |
| `Settlement` (`:1085`) | `trade.settlement` | adds `buyer_company_id`/`seller_company_id`, `settlement_event_ids[]`, `corrects`; `escrow_release_tx: String` → nullable |
| `StandingAgreement` (`:1192`) | `trade.standing_agreement` | `buyer_signed_at`/`seller_signed_at` → `signatures: Attestation[]`; countersignature is a superseding record; `RenewalPolicy` lower_snake; `terms` nested as in the v0.1 prose |
| `GoodsSpec` (`:305`) | `trade/goods_spec` | Rust flattened `grade`/`quality_specs` → nested `quality {grade, specifications}` (v0.1 prose shape wins); `*_details` blocks unchanged; `product_type` lower_snake |
| `DeliverySpec` (`:846`) | `trade/delivery_spec` | Rust flattened `destination_city/state/zip/country` → nested `destination: Address`; `window_earliest/latest` → `window {earliest, latest}`; adds `destination_gln` |
| `FreightTerms` (`:804`), `PackStructure` (`:328`), `SellerPricing`/`BuyerPricing` (`:725`/`:736`), `FinanceTerms` (`:766`) | same-named sub-objects | money/quantity strings; `financer_id` → `financer_company_id`; `FinancingMode` adds `open_account` |
| `GoodsCatalogEntry` (`:572`), `GoodsLot` (`:637`), `LotCertRef`, `ProvenanceEvent`, `InputLotRef`, `PackDefinition`, `MediaRef` | — | **not in v0.2.** Candidates `trade.catalog_entry`, `trade.lot` for v0.3. `MediaRef {kind, hash, uri_hint}` is the precedent for `traceability.coa_anchor` |

## 4. Events

| v0.1 `AuditEvent` | v0.2 `core.event` |
|---|---|
| `event_id` = `evt:<entity>:<type>:<ms>` (can collide within one ms) | `event_id` UUID; `cursor` is the store's monotonic sequence |
| `event_type` (40 variants, e.g. `ContractEscrowLocked`, `FulfillmentBuyerAttested`) | `kind: record_appended` + `type` + `status` — the v0.1 variant is recoverable as `(type, status)`; e.g. `FulfillmentBuyerAttested` ≡ `(trade.fulfillment, buyer_attested)`; `ContractEscrowLocked` has no v0.2 equivalent off-chain (on-chain profile) |
| `entity_type`, `entity_id` | `type`, `root_id` (+ `record_id` of the version) |
| `actor: String` (sometimes `"contract"`) | `issuer {key_id, company_id, module_id}` — always a principal |
| `payload_hash` = SHA-256 of non-canonical serde JSON | `payload_hash` on the record = SHA-256 of the canonical signing input (RFC 8785) |
| stored in `audit_log` + `audit_index` by `entity_id`; read via `get_audit_trail(entity_id, offset, limit)` | `GET /events?after=<cursor>`; visibility-filtered |
| emitted for most transitions, **not** for `register_party`, `add_certification`, `add_kyb_attestation`, `authorize_agent`, `revoke_agent` | emitted for every accepted write, including all `core.*` |

## 5. What the on-chain profile will need to add

To make the NEAR contract a conforming v0.2 store: store envelopes (or their hashes plus an off-chain pointer) rather than typed structs; verify Ed25519 signatures (`env::ed25519_verify`) instead of relying on the predecessor; keep per-company head pointers and a global monotonic event sequence exposed by a paginated view method; implement grants with scopes and expiry; emit NEP-297 `EVENT_JSON:` events; add a `migrate()` path (the current contract is `PanicOnDefault` with no upgrade hook). Escrow (`escrow_ref`, `escrow_release_tx`) is where the on-chain profile adds value the off-chain store cannot.
