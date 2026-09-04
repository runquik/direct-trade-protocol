# DTP Specification v0.2 — Company Record Protocol

**Direct Trade Protocol — Protocol Specification**

> Status: Draft for Sprint 01 | Version: 0.2 | Date: 2026-09-03
> Supersedes v0.1 (archived at [`docs/archive/SPEC_v0.1.md`](docs/archive/SPEC_v0.1.md)).

The key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted as described in RFC 2119.

**How to read this document.** The prose explains; the JSON Schemas in [`spec/schemas/`](spec/schemas) decide. Every record type links to its schema and every conformance claim is checkable against the fixed vectors in [`spec/vectors/`](spec/vectors). Where prose and schema disagree, the schema is normative and the prose is a bug.

**Changes from v0.1.** v0.1 specified a marketplace pipeline (intent → listing → match → contract → escrow → settlement) with a `Party` profile attached. v0.2 re-roots the protocol: the primary object is a **company's record store** — a portable, signed, append-only set of records that any module can read and write with the company's permission. The v0.1 trade objects survive as the `trade` namespace; matching and escrow mechanics are demoted to informative notes; a `finance` namespace is added; identity is generalized from "a NEAR account" to "a company with keys, of which a NEAR account is one". Field-level differences are in Appendix B.

---

## 1. Overview

DTP defines how a business's commercial records — who it is, what it trades, what it is owed, what it has attested — are written, signed, shared, and read by independent software, without any single application owning them.

Three kinds of actor:

| Actor | What it is | Identified by |
|---|---|---|
| **Company** | A business (or cooperative, farm, financer, service provider). The subject of records. | A handle (`acme-sauce.dtp`) and one or more Ed25519 keys |
| **Module** | Software that does a small set of things well and reads/writes a company's records under a grant | A slug (`receivables-financing`), its own keys, and a publisher company |
| **Store** | A service that holds records, validates and authorizes writes, enforces visibility, and emits events | A URL |

Four namespaces in v0.2:

| Namespace | Contents |
|---|---|
| `core` | company spine, module identity, grants, events |
| `trade` | intent, listing, offer, contract, fulfillment, settlement, standing agreement |
| `finance` | invoice, advance offer, advance, settlement event |
| `traceability` | FSMA 204 critical tracking events, document anchors |

**What the protocol guarantees.** A record accepted by a conforming store was (1) well-formed against the envelope and its type's schema, (2) signed by a key that belonged to the issuing principal at write time, (3) written by a party to the record — the subject, a counterparty, or a module holding a live grant from one of them, (4) a legal state transition for the issuer's role, and (5) appended, never mutated: changes are new records that supersede old ones, and the chain is the audit trail.

**What the protocol does not do.** A store performs no business logic: no matching, no pricing, no underwriting, no referential checks inside bodies, no money movement. Those are what modules do. The on-chain settlement profile (escrow in USDC on NEAR) is a separate profile of this specification, not part of the v0.2 core.

**Conformance in one paragraph.** A *Producer* emits envelopes that validate and verify. A *Verifier* can check any envelope against the schemas and the signature. A *Store* implements §5. A *Module* speaks to a store through §5's API and writes only conformant records. The normative artifacts are the schemas and vectors; §9 says what each target must pass.

---

## 2. Core namespace (`core.*`)

### 2.1 Identifier grammars

Defined in [`common/ids.schema.json`](spec/schemas/common/ids.schema.json):

| Name | Grammar | Example |
|---|---|---|
| `CompanyId` | NEAR account-id grammar, 2–64 chars: `^(([a-z0-9]+[-_])*[a-z0-9]+\.)*([a-z0-9]+[-_])*[a-z0-9]+$` | `acme-sauce.dtp`, `acme-sauce.near` |
| `ModuleId` | `^[a-z0-9][a-z0-9-]{1,62}$` | `receivables-financing` |
| `RecordId` | lowercase UUID (v4 or v7) | `018f6d2e-3b1a-7c4e-9a1f-2f6c1a9d0e21` |
| `KeyId` | `ed25519:` + base58(32-byte public key) | `ed25519:8u8LCMQ…` |
| `Signature` | `ed25519:` + base58(64 bytes) | |
| `RecordType` | `^[a-z]+\.[a-z_]+$` | `trade.contract` |
| `DateTime` | RFC 3339 UTC, `Z`, optional fractional seconds; writers SHOULD include milliseconds | `2026-09-08T14:03:22.117Z` |
| `Money` | `{amount: "^-?\d+(\.\d{1,6})?$", currency: USD\|USDC}` — a **string**, six decimals max (microdollar precision) | `{"amount":"5040.00","currency":"USD"}` |
| `Quantity` | `{amount: "^\d+(\.\d{1,3})?$", unit: lb\|kg\|oz\|ton\|case\|pallet\|unit}` — a **string**, three decimals max | `{"amount":"120","unit":"case"}` |

Company handles use NEAR's grammar so that a later on-chain identity mapping is byte-compatible; the handle is *not* itself a NEAR account unless `identifiers.near_account` says so.

### 2.2 `core.company` — the spine

Schema: [`core/company.schema.json`](spec/schemas/core/company.schema.json). Subject: the company itself. Default visibility: `public`.

The spine is deliberately small: names, jurisdiction, **locations** (each with an optional GS1 GLN — GLNs belong to locations, not to the company), external **identifiers** (DUNS, tax id, linked NEAR account), **keys**, and optional attested credentials (`kyb`, `certifications`, FSMA fields). Everything else about a company accretes as records in other namespaces, written by whichever module first needs them.

Rules:

- The **genesis** record MUST be signed by a `root` key listed in its own `body.keys` (self-certifying bootstrap). A store verifies the signature with that embedded public key and issues bearer tokens for the active keys (§5.3).
- Only a `root` key may write a superseding `core.company` record that changes `keys[]`. Adding a key = supersede with the new key appended; rotating = add then revoke; a key removed from the list is treated as revoked.
- A revoked key's signatures on records created before `revoked_at` remain valid.
- **A key belongs to exactly one principal.** A store MUST reject (`forbidden`) any attempt to list, as a company or module key, a key already registered to another company or module.
- `reputation` and `authorized_agents` from v0.1 are gone: reputation is a derived view (§6.9); agents are `delegate` keys (a NEAR sub-account key MAY be listed with `near_account` set).
- **A company has no role.** `business_types` is an optional, plural, purely descriptive list (brand, distributor, financer, …). Stores and modules MUST NOT derive any permission from it. Roles — buyer, seller, financer, arbitrator, payer, payee — are named per record, in that record's body, and the same company is routinely several of them at once across its records.

### 2.3 `Key`

Schema: [`common/key.schema.json`](spec/schemas/common/key.schema.json). `key_id` is the public key. `role` is `root` (may change keys and write grants) or `delegate` (may write everything else the principal may write). `status` is `active` or `revoked`.

### 2.4 `core.module`

Schema: [`core/module.schema.json`](spec/schemas/core/module.schema.json). Subject: the **publisher company**. Default visibility: `public`.

A module is a software identity with its own `keys[]`. Its genesis MAY be signed by a module root key listed in `body.keys` (self-certified key ownership, `issuer.module_id = body.module_id`) or by a publisher root key (`issuer.module_id = null`) — but in both cases the write MUST be authorized by the publisher: a store MUST require a credential for a root key of `publisher_company_id`. Without this, anyone could publish software attributed to a company they do not control. `requested_scopes` is advisory — what a consent screen would show; authority comes only from grants. `module_id` is unique per store.

### 2.5 `core.grant`

Schema: [`core/grant.schema.json`](spec/schemas/core/grant.schema.json). Subject: the **granting company**. Default visibility: `private`.

A grant names a module and a list of scopes, each `{namespace | type, access: read | write}`. `write` implies `read`. `namespace: "*"` covers everything.

Rules:

- A grant MUST be signed by a company `root` key with `issuer.module_id = null`. **Modules never write grants.**
- Revocation is a superseding record with `status: revoked`; narrowing is a superseding record with fewer scopes. Only the **head** of a grant chain counts.
- A grant authorizes module `M` to write a record of type `T` for company `C` iff the head grant (subject `C`, module `M`) is `active`, unexpired, and has a scope covering `T` at `write`; and to read per the visibility rules in §3.7.
- A module can always read the `core.grant` records that name it.

### 2.6 `core.event`

Schema: [`core/event.schema.json`](spec/schemas/core/event.schema.json). See §4.

---

## 3. Record envelope

Schema: [`core/envelope.schema.json`](spec/schemas/core/envelope.schema.json). Every record in every namespace is this envelope around a typed body.

```json
{
  "record_id": "018f6d2e-3b1a-7c4e-9a1f-2f6c1a9d0e22",
  "root_id":   "018f6d2e-3b1a-7c4e-9a1f-2f6c1a9d0e22",
  "type": "trade.contract",
  "namespace": "trade",
  "schema_version": "0.2",
  "subject_company_id": "bluestem-dist.dtp",
  "counterparty_ids": ["acme-sauce.dtp"],
  "issuer": { "key_id": "ed25519:…", "company_id": "acme-sauce.dtp", "module_id": null },
  "visibility": "counterparties",
  "created_at": "2026-09-08T14:03:22.117Z",
  "supersedes": null,
  "body": { },
  "signature": "ed25519:…"
}
```

### 3.1 Fields

| Field | Rule |
|---|---|
| `record_id` | Writer-assigned UUID. Globally unique; a store rejects a second write with the same id and a different payload (`duplicate_record_id`) and answers an identical replay with the stored record. Inside the signature. |
| `root_id` | `record_id` of the first record in this supersession chain; equals `record_id` for a genesis record. **The entity id.** Every cross-reference in any body (`contract_id`, `offer_id`, `invoice_id`, …) is a `root_id`, never a version's `record_id`. |
| `type` | Must exist in the registry ([`index.json`](spec/schemas/index.json)) for `schema_version`. |
| `namespace` | MUST equal the prefix of `type`. Redundant on purpose: grants and indexes key on it without parsing. |
| `schema_version` | `MAJOR.MINOR`; `"0.2"` for every type in this release. Selects the body schema. |
| `subject_company_id` | Whose cabinet the record lives in. Each type's schema names the body field this must match (`x-dtp-subject`). |
| `counterparty_ids` | Other parties. MUST NOT include the subject. MUST be non-empty when visibility is `counterparties`. Stores index it so the record appears in each party's cabinet. |
| `issuer.key_id` | The signing public key. |
| `issuer.company_id` | The principal. MUST be `subject_company_id` or a member of `counterparty_ids` (`issuer_not_party`). |
| `issuer.module_id` | `null` when a company key signs directly. When set, the key MUST be an active key of that module and a live grant from `issuer.company_id` to the module covering `(type, write)` MUST exist (`grant_missing`). |
| `visibility` | `public` · `counterparties` · `granted` · `private`. Required; schemas state a recommended default. |
| `created_at` | Writer clock. The store records its own `received_at` on the event. |
| `supersedes` | `record_id` of the current head this record replaces, or `null` for genesis (then `root_id` MUST equal `record_id`). |
| `body` | Validated by the type's schema. **Integers only** — no JSON number may have a fractional part; decimals are strings. `x_`-prefixed keys are permitted on strict types (the record is "extended"). |
| `signature` | Ed25519 over the signing input (§3.2). |

### 3.2 Canonicalization and signing

**Signing input** = the UTF-8 bytes of the canonical JSON of the envelope minus `signature`, where a missing `supersedes` is `null` and a missing `counterparty_ids` is `[]`.

**Canonical JSON** = [RFC 8785 (JCS)](https://www.rfc-editor.org/rfc/rfc8785) with one restriction: **no non-integer numbers**. With that restriction JCS reduces to: sort object keys recursively by UTF-16 code units (plain string comparison — **not** the numeric-first ordering ECMAScript objects apply to keys like `"10"`); no whitespace; strings escaped exactly as ECMAScript `JSON.stringify`; integers as plain digits (`-0` serializes as `0`); `null`/`true`/`false` literal; undefined-valued keys omitted; strings MUST be well-formed Unicode (lone surrogates are rejected). Serialize straight to text in sorted order — building an intermediate object and calling a JSON library on it reorders numeric-string keys and drops `__proto__` in JavaScript. The vectors include these cases.

**Signature** = Ed25519 over the raw signing-input bytes, no pre-hash. Deterministic. Encoded `ed25519:` + base58(64 bytes), which is NEAR's signature encoding, so a `near-api-js` key pair signs valid DTP records.

**Payload hash** = SHA-256 of the signing input, lowercase hex. Stores return it on every record; it mirrors the v0.1 `AuditEvent.payload_hash` but over canonical bytes.

Fixed vectors: [`spec/vectors/keys.json`](spec/vectors/keys.json), [`canonicalization.json`](spec/vectors/canonicalization.json), [`signatures.json`](spec/vectors/signatures.json). A conforming implementation MUST reproduce them.

### 3.3 Verification algorithm (normative)

A store MUST perform these checks, in this order, and answer with the named error on the first failure:

1. Parse; reject non-objects and bodies over the store's size limit (`bad_request`, `payload_too_large`).
2. Validate against the envelope schema; reject any non-integer JSON number anywhere (`envelope_invalid`, `float_not_allowed`).
3. `namespace` equals the prefix of `type`; subject not among counterparties; genesis has `root_id == record_id` (`envelope_invalid`).
4. `(type, schema_version)` is in the registry (`unknown_type`).
5. `body` validates against the type schema (`schema_invalid`, with issue paths), and the body field named by the schema's `x-dtp-subject` equals `subject_company_id` (`schema_invalid`).
6. Recompute the signing input; verify `signature` with `issuer.key_id` (`signature_invalid`).
7. If `supersedes` is set, resolve the target first: it exists, is the head, and has the same `type`, `subject_company_id`, `root_id`, **`counterparty_ids` (as a set), and `visibility`** (`supersedes_conflict`, with the current head's id in `details`). Parties and visibility are locked for the life of a chain.
8. The caller's credential belongs to `issuer.key_id`, and the key belongs to the principal the envelope names — a company key with `module_id == null` and `company_id` equal to the key's owner, or a module key with `module_id` equal to the key's owner (`issuer_mismatch`); the key is active (`key_inactive`); `core.*` types require a root key and reject module keys (`forbidden`).
9. `issuer.company_id` is the subject or a counterparty **of the record as it exists** — the superseded head's parties for a supersede, the new envelope's for genesis (`issuer_not_party`).
10. For a module key: a live write grant from `issuer.company_id` covers `type` (`grant_missing`).
11. `record_id` is new, or is an exact replay of an existing record, which returns the stored record (this applies to genesis records too).
12. Roles are resolved from the **previous** body for a supersede (§3.5); role fields are continuous; the state transition is permitted for those roles (`transition_forbidden`).
13. Append the record, mark the superseded record no longer head, and append exactly one event — atomically. A concurrent writer that loses the race receives `supersedes_conflict` (or `duplicate_record_id` for a genesis race), never an internal error.

### 3.4 Supersession

Records are never edited or deleted. To change one, write a new record with `supersedes` = the current head's `record_id`, the same `type`, `subject_company_id`, and `root_id`. The old record stays readable (with `include_superseded`) and carries `superseded_by`. Concurrent writers: the second one to land gets `supersedes_conflict` and must re-read and retry — optimistic concurrency, no locks.

A **counterparty** MAY supersede a record it did not create, when the type's state machine allows it for its role. That is how a buyer attests receipt on the seller's `trade.fulfillment`, how a target owner accepts a `trade.offer`, and how a seller accepts a `finance.advance_offer`. The issuer of the superseding record is recorded on that record; the chain therefore shows who did what.

### 3.5 State machines and accountability

Every record-type schema carries three extension keywords, ignored by validators and read by stores and tooling:

- `x-dtp-subject` — the body field that must equal `subject_company_id` (or `self`).
- `x-dtp-roles` — a map from role name to the body field holding that role's company id, e.g. `{"buyer": "buyer_company_id", "seller": "seller_company_id"}`. Two roles are implicit: `subject` and `counterparty`.
- `x-dtp-transitions` — `status_field`, the allowed `initial` statuses and creator roles, and a list of `{from, to, by[], within?, after?}` transitions.

A store MUST enforce:

- **Roles are read from the record being superseded**, never from body fields the writer just supplied. For a genesis record they are read from the new body, which the issuer is bound to by `x-dtp-subject` and the party rule.
- **Role fields are continuous.** A body field named in `x-dtp-roles` MUST NOT change across a supersede, except that a field listed in `x-dtp-third-party-roles` (e.g. a contract's `arbitrator_company_id`) MAY go from `null` to a value once, and that value MUST NOT be the subject or a counterparty.
- Genesis records start in an `initial` status and are created by an `initial.by` role.
- A superseding record whose status matches a listed `from → to` transition is permitted for the roles in that transition's `by`. An unlisted **same-status revision is permitted for the subject only** — a counterparty can change what a record *says* only by making a listed transition. Types with `status_field: null` may be superseded by the subject only.
- `within`/`after` clocks are informative in v0.2 (stores SHOULD expose them; they are not enforced).

*Known gap (v0.2):* a third party named as arbitrator is not a party to the record and therefore cannot write the resolution itself; in Sprint 01 the resolution is recorded by a party. A `trade.dispute` record with the arbitrator as subject is the planned fix.

The rendered matrix of every transition is [`spec/generated/accountability.md`](spec/generated/accountability.md) (Appendix A). It answers the question ONDC never did: for each state of each record, who owes the next move.

### 3.6 Extensions and the "no dialects" rule

- Strict types (`additionalProperties: false`) accept keys prefixed `x_` anywhere the schema allows `patternProperties: {"^x_": {}}`. A record with `x_` keys is conformant and flagged *extended*. Implementations MUST NOT require `x_` keys of their counterparties.
- New fields, types, or namespaces are added by pull request to [`spec/schemas/`](spec/schemas) and the registry, never by per-implementation variation. A store MUST reject a record whose `(type, schema_version)` is not in its registry. There are no implementation guides, hub profiles, or dialects — the lesson of EDI.

### 3.7 Visibility

| `visibility` | Readable by |
|---|---|
| `public` | anyone, unauthenticated |
| `counterparties` | the subject; each counterparty; any module holding a live **read** grant for the type from the subject *or any counterparty* |
| `granted` | the subject; modules holding a read grant from the subject |
| `private` | the subject's own keys only |

A module can always read `core.grant` records that name it as grantee. A store MUST NOT reveal the existence of a record the caller cannot read (`not_found`). The same rule filters the event feed.

### 3.8 Error codes

`{ "error": { "code", "message", "details" } }`. Codes and HTTP statuses: `bad_request` 400 · `auth_required`, `auth_invalid`, `signature_invalid`, `issuer_mismatch` 401 · `key_inactive`, `forbidden`, `grant_missing`, `issuer_not_party` 403 · `not_found` 404 · `duplicate_record_id`, `supersedes_conflict`, `transition_forbidden` 409 · `payload_too_large` 413 · `envelope_invalid`, `schema_invalid`, `float_not_allowed`, `unknown_type` 422 · `internal` 500. `schema_invalid` details carry `issues[]` with JSONPath-style `path` and `keyword`.

---

## 4. Events and synchronization

A store MUST append exactly one `core.event` of kind `record_appended` for every accepted write, and for nothing else. An event carries the envelope's routing fields (`record_id`, `root_id`, `type`, `namespace`, `subject_company_id`, `counterparty_ids`, `issuer`, `visibility`, `supersedes`), the body's `status` when the type has one, the writer's `created_at`, and the store's `recorded_at`. Events are store assertions and are not signed; the record is the proof.

**Cursors** are opaque strings, totally ordered per store (a reference store uses a zero-padded sequence). `GET /events?after=<cursor>` returns events strictly after the cursor in order, visibility-filtered for the caller, with `next_cursor` when more are immediately available and `latest_cursor` so consumers know when they are caught up. Delivery is at-least-once; consumers persist the last cursor they processed. `next_cursor` advances past events the caller could not see, so hidden rows never stall a poller. Push delivery (webhooks, SSE, realtime) is a store extension outside v0.2.

---

## 5. Stores

### 5.1 Obligations

A conforming store MUST: validate per §3.3; store the signed envelope verbatim so records can be re-verified later; keep records append-only; maintain head-of-chain; index by subject, counterparties, type, namespace, and root; enforce §3.7 on every read and on the feed; emit events per §4; serve the schemas it accepts; and run **no business logic** — a store that inspects bodies to enforce cross-record consistency, pricing, or matching is an application, not a store.

### 5.2 Reference HTTP API (informative)

The reference store ([`supabase/functions/dtp-store`](supabase/functions/dtp-store)) exposes:

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /health`, `GET /schemas`, `GET /schemas/{type}` | none | liveness; type registry; one schema |
| `POST /debug/canonicalize` | none | returns the canonical signing input, payload hash, and whether a supplied signature verifies |
| `POST /companies` | none (self-certifying) | genesis `core.company` → `201 {company_id, record, keys:[{key_id, token}]}` |
| `POST /modules` | self-certifying or publisher root token | genesis `core.module` → `201 {module_id, record, keys}` |
| `GET /whoami` | bearer | the principal behind the token |
| `GET /companies/{id}` · `GET /companies/{id}/grants` · `GET /modules/{id}` | optional / bearer | public spine (plus grants if owner); grants (owner sees all, a module sees its own) |
| `POST /records` | bearer | signed envelope → `201` (or `200` on identical replay) |
| `GET /records/{id}` · `GET /records?subject&type&namespace&counterparty&root_id&include_superseded&after&limit` | optional | visibility-filtered reads, ordered by sequence |
| `GET /events?company&after&limit` | bearer | the feed (§4) |

Builder walkthrough: [`docs/PROTOCOL_STORE.md`](docs/PROTOCOL_STORE.md).

### 5.3 Credentials

The reference store identifies callers with a bearer token per key (`dtps_…`, returned once when the key is registered) and proves authorship with the envelope signature. Signed-request authentication for reads is a planned upgrade; a store MAY implement it in addition. Tokens MUST be stored hashed.

### 5.4 Profiles

- **Off-chain store** (this document, reference implementation): Postgres-backed, one operator per store.
- **On-chain store profile** (planned): a NEAR contract holding envelopes or their hashes with USDC escrow. The v0.1 contract in [`contracts/`](contracts) implements v0.1 objects and is not v0.2-conformant; Appendix E maps its types.

---

## 6. Trade namespace (`trade.*`)

The v0.1 trade objects, ported onto the envelope. Global changes: ids, `version`, and timestamps leave the bodies (the envelope carries them); `PartyRef` becomes `*_company_id` strings; dates are RFC 3339; amounts are `Money`/`Quantity` strings; enums are `lower_snake`; state changes are superseding records. Appendix B has the field-by-field map.

### 6.1 Shared sub-objects

[`goods_spec`](spec/schemas/trade/goods_spec.schema.json) (category, product, `product_type` commodity | branded | value_added with the matching `*_details`, `quantity`, quality, required certifications), [`delivery_spec`](spec/schemas/trade/delivery_spec.schema.json) (destination address + optional GLN, window, method, temperature), [`freight_terms`](spec/schemas/trade/freight_terms.schema.json), [`pack_structure`](spec/schemas/trade/pack_structure.schema.json) (unit size, units per case, cases per pallet, MOQ), [`seller_pricing`](spec/schemas/trade/seller_pricing.schema.json) (model, asking price, tiers — floor price is never published), [`buyer_pricing`](spec/schemas/trade/buyer_pricing.schema.json) (ceiling, desired quantity), [`finance_terms`](spec/schemas/trade/finance_terms.schema.json) (payment timing, net days, PACA flag, financing mode). Shared with other namespaces: `Money`, `Quantity`, `Address`, `Attestation`, `CertificationRef`, `KybRef`.

### 6.2 – 6.4 `trade.intent`, `trade.listing`, `trade.offer`

Subjects: buyer / seller / offerer. An intent (`draft → posted → matched → contracted → fulfilled → settled`, or `expired`/`cancelled`) and a listing (`draft → active → matched → contracted`, or `expired`/`withdrawn`) are broadcasts; both are `public` by default. An offer targets one of them (`target_type`, `target_id` = its root, `target_owner_company_id` as counterparty) and the **target owner** moves it to `shortlisted`/`accepted`/`rejected` while the offerer may `retract`. Full field lists and transitions are in the schemas. *These three types are specified and strict in v0.2 but are not exercised by Sprint 01.*

### 6.5 `trade.contract`

Schema: [`trade/contract.schema.json`](spec/schemas/trade/contract.schema.json). Subject: **buyer** (it is the buyer's payable); seller is the counterparty. Default visibility `counterparties`. Created by whichever party accepted (`initial.by: buyer | seller`); may reference `intent_id`, `listing_id`, `offer_id`, `standing_agreement_id`, `lot_id`, and carry `buyer_po_number`. `escrow_ref` is `null` off-chain.

States: `active → in_fulfillment` (seller, when it ships) `→ delivered` (buyer on attestation, or seller after `dispute_window_hours` — presumed acceptance) `→ settled` (buyer, on `trade.settlement`); `in_fulfillment → disputed` (buyer, within the window) `→ resolved_buyer | resolved_seller` (arbitrator, within 7 days) `→ settled`; `active → cancelled` (mutual: the other party countersigns by superseding again).

### 6.6 `trade.fulfillment`

Schema: [`trade/fulfillment.schema.json`](spec/schemas/trade/fulfillment.schema.json). Subject: **seller**; buyer is the counterparty. The seller creates it (`seller_attested`) with `seller_attestation`; the **buyer supersedes it** to add `buyer_attestation` and move to `buyer_attested` (or `disputed`) within the contract's dispute window; either party moves it to `complete`; the seller may move `seller_attested → complete` after the window (presumed acceptance). `Attestation` is `{company_id, attested_at, record_id, notes}` — the proof is the envelope signature of the record named by `record_id`; the v0.1 inner `signature` field is gone. Structured evidence (BOL, temperature logs, inspection) goes under `x_evidence` in v0.2; a first-class evidence type is a v0.3 candidate.

### 6.7 `trade.settlement`

Schema: [`trade/settlement.schema.json`](spec/schemas/trade/settlement.schema.json). Subject: buyer. Terminal, no status: `gross_amount`, `deductions[]`, `net_amount`, optional `escrow_release_tx`, and `settlement_event_ids[]` naming the `finance.settlement_event` records that moved the money. Corrections are a new settlement whose `corrects` names the old one.

### 6.8 `trade.standing_agreement`

Schema: [`trade/standing_agreement.schema.json`](spec/schemas/trade/standing_agreement.schema.json). Subject: proposer; counterparty countersigns by superseding, appending to `signatures[]` and setting `active`. Contracts under it reference `standing_agreement_id`. Relationship-based repeat trade is the majority of B2B volume; this type is first-class for that reason.

### 6.9 Derived views (informative)

**Reputation** and **relationship tier** are computations over a company's `trade.*` chains, not signed records — a company cannot sign its own reputation. v0.1's formula (`(completed − disputed) / completed × delivery_accuracy`) and tier thresholds (`new` < 3 trades; `established` ≥ 3 or 6 months; `preferred` ≥ 10 trades or $50k or an active standing agreement; `strategic` multi-year or $250k) are retained here as the recommended computation a store or module MAY expose.

### 6.10 Accountability

See Appendix A (generated). Every `trade.*` status transition names the role that owes it and, where v0.1 or ONDC practice supplied one, a clock.

### 6.11 Matching (informative)

v0.1 §4 — bidirectional continuous matching, eligibility rules (quantity, certifications, price ceiling, window overlap, expiry), four-dimension scoring, tier-comparison surfacing — is retained as guidance for **matcher modules**. Matching is module logic, never store logic; a `trade.match` record type is a v0.3 candidate.

### 6.12 Settlement and dispute rules

Normative as state rules on `trade.fulfillment` / `trade.contract`: settlement follows `complete`; absent a buyer attestation within `dispute_window_hours` (default 48) the seller may record presumed acceptance; a buyer dispute within the window moves the contract to `disputed`; only the contract's `arbitrator_company_id` may resolve it; deductions are agreed by both parties or ordered by the arbitrator. Escrow mechanics (locking, release, on-chain references) belong to the on-chain profile.

---

## 7. Finance namespace (`finance.*`)

### 7.1 Why a peer namespace

Every surviving food/ag trade platform monetizes payment timing, not matching ([`research/SYNTHESIS.md`](research/SYNTHESIS.md)). Financing is therefore a first-class namespace, designed so that a financer module can price an advance **from protocol records alone** and must say which ones (`pricing_basis`).

### 7.2 `finance.invoice`

Schema: [`finance/invoice.schema.json`](spec/schemas/finance/invoice.schema.json). Subject: **seller** (the receivable); buyer is the counterparty. Issued by the seller or a module with `finance` write from the seller. `contract_id` (and optionally `fulfillment_id`) are roots. States: `draft → issued` (seller) `→ acknowledged | disputed` (buyer, SHOULD within 48h) `→ partially_paid → paid` (seller, citing `settlement_event_ids`); `void` by the seller. `assigned_to_company_id` is set when an advance funds and the receivable is assigned to the financer — the field a factor's lockbox exists to replace.

### 7.3 `finance.advance_offer`

Schema: [`finance/advance_offer.schema.json`](spec/schemas/finance/advance_offer.schema.json). Subject: seller; **financer** is the counterparty and the issuer (via its module, which therefore needs a `finance` write grant from the financer and must be a party). `advance_amount`, `advance_bps`, `fee {fee_bps, apr_bps, fixed_fee}`, `repayment {source, due_at}`, `recourse`, `pricing_basis[] {record_id, type, note}`, `expires_at`. States: `offered` (financer) `→ accepted | declined` (seller) · `→ withdrawn` (financer) · `→ expired` (either, after `expires_at`).

### 7.4 `finance.advance`

Schema: [`finance/advance.schema.json`](spec/schemas/finance/advance.schema.json). Created by the financer only from an `accepted` offer; cites `funding_event_id`. States `funded → partially_repaid → repaid`, `→ defaulted` after maturity, `→ written_off`; every transition is the financer's and SHOULD cite settlement events.

### 7.5 `finance.settlement_event`

Schema: [`finance/settlement_event.schema.json`](spec/schemas/finance/settlement_event.schema.json). The money-movement primitive. Subject: **payer**; payee is the counterparty. `kind` (buyer_payment, advance_funding, advance_repayment, fee, refund, escrow_release, adjustment), `amount`, `occurred_at`, `rail` (`mock` is valid — the sprint moves no real money), `rail_ref`, `references {invoice_id, advance_id, contract_id, trade_settlement_id}`, `reverses`. Immutable: no status; corrections are compensating events.

### 7.6 Accountability

Appendix A. Sprint 01 grant set for a financing module: from the seller — `trade read`, `core.company read`, `finance write`; from the buyer — `trade read`, `finance read`; from the financer's own company — `finance write`.

### 7.7 Policy defaults (informative, from v0.1 §3.6.2)

For `financing_mode: lp_pool` trades: interest at a fixed 30% effective APR compounding daily; prepayment any time; balance due no later than day 60 (day 30 for PACA-covered produce — beyond 30 days the seller forfeits PACA trust protection, so this is a legal cliff, not a preference). These are policy defaults for the on-chain profile and are not schema-enforced.

---

## 8. Traceability namespace (`traceability.*`)

[`traceability/cte.schema.json`](spec/schemas/traceability/cte.schema.json) ports the FSMA 204 Critical Tracking Event (`growing | creating | receiving | transforming | shipping`, keyed by a Traceability Lot Code, with actor/source/destination GLNs and a physical `event_date` distinct from the recording time) and [`coa_anchor.schema.json`](spec/schemas/traceability/coa_anchor.schema.json) anchors an off-chain lot document by SHA-256 or IPFS CID. Both are **loose** in v0.2 (`additionalProperties: true`): this namespace is exercised in a later sprint, and the design intent is that CTEs fall out of settled `trade.*` records rather than being entered separately, with an EPCIS 2.0 JSON-LD export as the interoperability surface. `lot_id` is opaque; `trade.lot` and `trade.catalog_entry` (Rust-only in v0.1) are v0.3 candidates.

---

## 9. Conformance

**Targets.** *Producer*: emits envelopes that pass §3.3 steps 2–6 and reproduces [`spec/vectors/signatures.json`](spec/vectors/signatures.json). *Verifier*: checks any envelope against the schemas and signature; reproduces all vectors. *Store*: implements §5.1 and passes the reference suite ([`sdk/tests`](sdk/tests)) against its URL. *Module*: writes only conformant records, uses `x_` for anything missing, and never requires `x_` of others.

**Normative artifacts.** `spec/schemas/**` (JSON Schema 2020-12), `spec/schemas/index.json` (the registry), `spec/vectors/**`. Generated artifacts ([`spec/generated/`](spec/generated)) are derived and rebuilt by `npm run build` in `sdk/`.

**Extension rules.** New namespaces and types are added to the registry by pull request. Additive optional fields bump a type's minor version; breaking changes bump the major. `x_` fields are the only per-implementation freedom. No dialects.

---

## 10. Versioning and migration

- `schema_version` is per record type and starts at `"0.2"` for all types. Stores list supported versions in `GET /schemas` and MUST reject unknown `(type, version)` pairs.
- **v0.1 → v0.2.** There is no automatic upgrade: a v0.1 object is not a record (no envelope, no signature). Appendix B is the adapter map. The v0.1 `version` field (which carried the *protocol* version on every message) is removed; `schema_version` replaces it.
- **Implementation labels.** `contracts/` — v0.1 on-chain reference (NEAR); not v0.2-conformant; future on-chain store profile. `mcp-server/`, `remote-mcp-server/` — v0.1 clients, frozen. `marketplace/` — the MVP (accounts, listings, intents, endorsements); pre-v0.2 data model; candidate to be re-based on the v0.2 store. `supabase/functions/dtp-store` + `sdk/` — the v0.2 reference store and SDK.

---

## 11. Out of scope and deferred

Not in v0.2: on-chain escrow and USDC settlement (on-chain profile); a decentralized solver network; `trade.match`, `trade.dispute` (Sprint 02 candidate — a short-pay or chargeback as a dispute object with evidence and a clock), `trade.lot`, `trade.catalog_entry`, a first-class delivery-evidence type; push delivery of events (webhooks/SSE/realtime); vault encryption at rest and the "Login with DTP" consent UI ([`docs/PORTABLE_IDENTITY.md`](docs/PORTABLE_IDENTITY.md)); W3C Verifiable Credential wrappers for attestations; NEP-413 wallet signing; signed-request read authentication; body-level referential integrity; any native token.

---

## Appendices

- **A. Accountability matrix** — generated: [`spec/generated/accountability.md`](spec/generated/accountability.md).
- **B. v0.1 → v0.2 field map** — [`docs/RUST_MAPPING.md`](docs/RUST_MAPPING.md) §1–§3 (conventions, `core.*`, `trade.*`, field by field against `contracts/src/types.rs`). Summary: `party_id`/`buyer`/`seller` → `*_company_id`; per-object ids → envelope `root_id`; `version` → `schema_version`; `created_at`/`updated_at` → envelope; microdollars/milliamounts → `Money`/`Quantity` strings; `UPPER_SNAKE`/`PascalCase` → `lower_snake`; `Attestation.signature` dropped; `Party.reputation`/`authorized_agents` → derived view / delegate keys; `Party.gs1_gln` → `locations[].gln`; `Offer` uses the Rust shape.
- **C. Agent Autonomy Context** — v0.1 §11 verbatim, informative: private module configuration (COGS, margins, budgets, negotiation guidelines) that is never a record and never stored in a cabinet. See [`docs/archive/SPEC_v0.1.md`](docs/archive/SPEC_v0.1.md) §11.
- **D. v0.1 EventType map** — [`docs/RUST_MAPPING.md`](docs/RUST_MAPPING.md) §4. Every v0.1 `EventType` is recoverable as `(type, status)` on a `record_appended` event (e.g. `FulfillmentBuyerAttested` ≡ `(trade.fulfillment, buyer_attested)`); escrow events belong to the on-chain profile.
- **E. Rust type mapping** — [`docs/RUST_MAPPING.md`](docs/RUST_MAPPING.md), including §5: what the NEAR contract needs to become a conforming on-chain store profile.
- **F. Vector index** — [`spec/vectors/`](spec/vectors): `keys.json` (fixed key), `canonicalization.json` (4 cases), `signatures.json` (raw message + two signed records).

---

*DTP is open protocol infrastructure. It is not a product, a marketplace, or a company.*
