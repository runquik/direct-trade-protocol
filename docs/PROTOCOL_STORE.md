# DTP Protocol Store — Builder Quickstart

*For someone building a module against the DTP v0.2 store with no other context. Everything here is also specified in [`SPEC.md`](../SPEC.md); this is the practical path.*

The store is a small HTTP service. It holds **records**: signed, append-only JSON documents that belong to a **company**. A **module** (your software) reads and writes records on a company's behalf once that company has given it a **grant**. Every write is validated against a JSON Schema and an Ed25519 signature; every accepted write produces one **event** you can poll.

There is no business logic in the store. If you need something it doesn't do, that's a finding for the sprint gap log — work around it with an `x_`-prefixed field and write it down.

---

## 0. What you need

- The store URL (`STORE_URL`), e.g. `https://vsuqtdofphppybkhnijg.supabase.co/functions/v1/dtp-store` or a local `http://127.0.0.1:8787/dtp-store`.
- Any language with Ed25519, SHA-256, base58, and JSON. The reference SDK is TypeScript in [`sdk/`](../sdk) and runs on Node ≥ 23.5 or Deno; you do not have to use it.
- The seed output (`sdk/fixtures/dev-keys.json` after `npm run seed`, or the summary George hands you) with the fixture companies, the demo module, and their tokens.

Check the store is up:

```bash
curl $STORE_URL/health
```

---

## 1. Records in one minute

Every record is an **envelope** around a typed **body**:

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
  "body": { "...": "validated against spec/schemas/trade/contract.schema.json" },
  "signature": "ed25519:…"
}
```

| Field | Meaning |
|---|---|
| `record_id` | UUID you generate. Also the idempotency key: re-posting the identical record returns 200, a different body under the same id returns 409. |
| `root_id` | The entity id. Equals `record_id` for a new thing; for an update it's the `root_id` of the chain. **Bodies cross-reference entities by `root_id`** (`contract_id`, `invoice_id`, …). |
| `type` / `namespace` | `namespace.name`; namespace is repeated on purpose. |
| `subject_company_id` | Whose cabinet the record lives in. Each type says which body field this must match (`GET /schemas`). |
| `counterparty_ids` | The other parties. They can read the record when visibility is `counterparties`, and they may be allowed to change its state. |
| `issuer` | Who signed: the key, the company it acts for, and the module (or `null` when a company signs directly). |
| `visibility` | `public` · `counterparties` · `granted` · `private` — see §6. |
| `supersedes` | Records are never edited. To change one, write a new record with `supersedes` = the current head's `record_id` and the same `root_id`/`type`/`subject`. |
| `body` | Type-specific. **Integers only** — money and quantities are decimal *strings* (`{"amount":"5040.00","currency":"USD"}`). |
| `signature` | Ed25519 over the canonical JSON of everything above. |

Browse the type catalog: `GET $STORE_URL/schemas` (index) and `GET $STORE_URL/schemas/trade.contract` (one schema). Each schema carries `x-dtp-transitions`: which roles may create it and move `body.status` from one value to another.

---

## 2. Make a key

Keys are Ed25519. Encodings match NEAR's, so a `near-api-js` key pair is a valid DTP key.

```
key id     = "ed25519:" + base58(32-byte public key)
secret key = "ed25519:" + base58(32-byte seed || 32-byte public key)
signature  = "ed25519:" + base58(64-byte signature)
```

With the SDK:

```bash
cd sdk && npm install
node scripts/keygen.ts
```

Or any library: generate an Ed25519 seed, derive the public key, encode as above. Fixed vectors to check your encoding: [`spec/vectors/keys.json`](../spec/vectors/keys.json).

---

## 3. Authentication

Two things, deliberately separate:

1. **A bearer token identifies the caller.** Every key gets a token (`dtps_…`) when the key is registered; the store returns it exactly once. Send it on every authenticated request: `Authorization: Bearer dtps_…`.
2. **The signature proves authorship of a record.** Writes must be signed by the key the token belongs to (`issuer.key_id` must equal the token's key), or the store answers `issuer_mismatch`.

Reads only need the token. `GET $STORE_URL/whoami` tells you what the store thinks you are.

---

## 4. Signing — the exact algorithm

1. Build the envelope **without** `signature`. Missing `supersedes` is `null`; missing `counterparty_ids` is `[]`.
2. **Canonicalize**: [RFC 8785 (JCS)](https://www.rfc-editor.org/rfc/rfc8785) with one restriction — no non-integer numbers anywhere (the store rejects them with `float_not_allowed`). With that restriction JCS is simply: recursively sort object keys (plain code-unit order), no whitespace, standard JSON string escaping, integers as digits, `null`/`true`/`false` literal. Drop keys whose value is undefined.
3. **Sign** the UTF-8 bytes of that canonical text with Ed25519. No pre-hash. Deterministic — the same input and key always give the same signature.
4. Put `"signature": "ed25519:" + base58(sig)` on the envelope. Wire key order and whitespace do not matter — the store re-canonicalizes.

`payload_hash` (returned on every stored record) is `sha256(canonical bytes)` as lowercase hex.

**Check yourself before you write:** `POST $STORE_URL/debug/canonicalize` with your envelope (signature optional) returns the exact canonical string, its hash, and whether your signature verifies. No auth needed. Diff its `canonical` against yours and any mismatch is visible in seconds.

Fixed vectors: [`spec/vectors/canonicalization.json`](../spec/vectors/canonicalization.json) and [`spec/vectors/signatures.json`](../spec/vectors/signatures.json) contain a full signed `core.company` and `trade.contract` for the fixed key — reproduce the signature byte-for-byte and you're done.

With the SDK: `node scripts/sign.ts envelope.json --key $SECRET --fill` fills in ids/timestamps and prints the signed envelope.

---

## 5. Identities: companies and modules

### A company (the "spine")

`POST $STORE_URL/companies` with a signed **genesis** `core.company` envelope. No token needed — it is self-certifying: the signing key must be a `root` key listed in `body.keys`, and the store verifies with that embedded public key. Response `201`:

```json
{ "company_id": "acme-sauce.dtp", "record": { "...": "stored record" }, "created": true,
  "keys": [ { "key_id": "ed25519:…", "token": "dtps_…" } ] }
```

Save the token. Company ids use NEAR account grammar (`acme-sauce.dtp`).

Minimal body:

```json
{ "display_name": "Acme Sauce Co.", "business_type": "brand", "jurisdiction": "US",
  "locations": [ { "location_id": "hq", "address": { "city": "Austin", "region": "TX", "country": "US" } } ],
  "keys": [ { "key_id": "ed25519:…", "role": "root", "status": "active", "added_at": "2026-09-08T14:03:22.117Z" } ] }
```

To add or revoke keys later, supersede the company record (root key required). New keys come back with tokens.

### A module (your software)

Modules have their own keys and a **publisher company**. For the sprint:

1. Create a publisher company for yourself (one call, above).
2. `POST $STORE_URL/modules` with a signed genesis `core.module` envelope. Easiest is self-certified: sign with the module's own root key listed in `body.keys` and set `issuer.module_id` to your `module_id`, `issuer.company_id` and `subject_company_id` to the publisher. Response includes the module key's token.

```json
{ "module_id": "receivables-financing", "name": "Receivables Financing", "publisher_company_id": "boris-fin.dtp",
  "keys": [ { "key_id": "ed25519:…", "role": "root", "status": "active", "added_at": "…" } ],
  "requested_scopes": [ { "namespace": "trade", "access": "read" }, { "namespace": "finance", "access": "write" } ] }
```

`requested_scopes` is advisory — it's what a consent screen would show. Authority comes only from grants.

### A grant

A company authorizes a module by writing a `core.grant` record (subject = the company, signed by a company **root** key, module id in the body). In the sprint, George's Passport module does this; the seeded fixtures already grant `demo-financing`. A grant looks like:

```json
{ "module_id": "receivables-financing",
  "scopes": [ { "namespace": "trade", "access": "read" }, { "type": "core.company", "access": "read" }, { "namespace": "finance", "access": "write" } ],
  "status": "active", "expires_at": null, "note": "granted via Passport" }
```

`write` implies `read`. Scopes name a whole namespace or one type. Revoking = superseding the grant with `status: "revoked"`. `GET $STORE_URL/companies/{id}/grants` shows a module the grants it holds from that company.

---

## 6. Reading and writing records

### Write

`POST $STORE_URL/records` with the signed envelope and your bearer token. `201` with the stored record (`seq`, `received_at`, `payload_hash`, `is_head`, `superseded_by` added). The store checks, in order: envelope shape → type & version known → body schema → signature → key belongs to you → you're a party (subject or counterparty) → module grant → duplicate id → supersedes is the head → state transition allowed for your role.

To act **on behalf of a company**, set `issuer.company_id` to that company and `issuer.module_id` to your module; you need a write grant from that company for the type, and that company must be the subject or a counterparty.

### Read

- `GET $STORE_URL/records/{record_id}`
- `GET $STORE_URL/records?subject=…&type=…&namespace=…&counterparty=…&root_id=…&include_superseded=false&after=<seq>&limit=50` — heads only by default, ordered by `seq`.
- `GET $STORE_URL/companies/{id}` — the public spine.

What you can see:

| visibility | readable by |
|---|---|
| `public` | anyone, no token |
| `counterparties` | the subject, the counterparties, and any module granted **read** for the type by any of them |
| `granted` | the subject, and modules granted read by the subject |
| `private` | the subject's own keys only |

A module can always read the `core.grant` records that name it. Records you cannot see are indistinguishable from ones that don't exist (`404`).

### Update = supersede

Write a new record with the same `type`, `subject_company_id`, `root_id`, and `supersedes` = the current head's `record_id`. If someone beat you to it you get `supersedes_conflict` with the new head's id — re-read and retry. Counterparties may supersede too, within the type's state machine: that's how the buyer attests receipt on the seller's `trade.fulfillment`.

---

## 7. Events

`GET $STORE_URL/events?company=<id>&after=<cursor>&limit=100` (token required). One event per accepted write, filtered to what you may read:

```json
{ "events": [ { "cursor": "0000000000000042", "kind": "record_appended", "record_id": "…", "root_id": "…", "type": "trade.fulfillment",
               "subject_company_id": "acme-sauce.dtp", "counterparty_ids": ["bluestem-dist.dtp"], "status": "buyer_attested",
               "supersedes": "…", "issuer": { … }, "created_at": "…", "recorded_at": "…" } ],
  "next_cursor": null, "latest_cursor": "0000000000000042" }
```

Poll every few seconds, persist the last cursor you processed, pass it as `after`. `next_cursor` non-null means there's more right now. Delivery is at-least-once. `status` is copied from the record body so you can react without fetching (`trade.fulfillment` / `buyer_attested` is the "attested receivable" moment M3 waits for).

---

## 8. Type catalog (v0.2)

| Type | Subject | Who typically writes | Notes |
|---|---|---|---|
| `core.company` | self | company root key | the spine; keys live here |
| `core.module` | publisher | module or publisher root key | software identity |
| `core.grant` | granting company | company root key only | scopes → module |
| `trade.contract` | buyer | either party (whoever accepted) | seller is counterparty; `status` machine in schema |
| `trade.fulfillment` | seller | seller creates; buyer supersedes to attest | `buyer_attestation` + `status: buyer_attested` |
| `trade.settlement` | buyer | buyer | terminal accounting for a contract |
| `trade.intent` / `listing` / `offer` / `standing_agreement` | buyer / seller / offerer / proposer | | present and strict; not exercised in Sprint 01 |
| `finance.invoice` | seller | seller or its finance module | `contract_id` = contract root; `assigned_to_company_id` when advanced |
| `finance.advance_offer` | seller | financer module (financer is counterparty) | `pricing_basis` must cite the records the decision came from |
| `finance.advance` | seller | financer module | created from an accepted offer; cites funding event |
| `finance.settlement_event` | payer | payer or its finance module | immutable money movement; `rail: "mock"` is fine |
| `traceability.cte` / `coa_anchor` | actor | | loose stubs in v0.2 |

Full schemas: `spec/schemas/**` or `GET /schemas/{type}`. Generated TypeScript types: `spec/generated/ts/types.d.ts`. Who-may-do-what tables: `spec/generated/accountability.md`.

---

## 9. Error codes

`{ "error": { "code", "message", "details" } }`

| HTTP | code | meaning |
|---|---|---|
| 400 | `bad_request` | not JSON, empty, wrong endpoint for a genesis record |
| 401 | `auth_required` / `auth_invalid` | no token / unknown token |
| 401 | `signature_invalid` | signature doesn't verify over the canonical envelope |
| 401 | `issuer_mismatch` | `issuer.key_id` isn't the token's key, or `issuer.company_id`/`module_id` isn't who the key belongs to |
| 403 | `key_inactive` / `forbidden` / `grant_missing` / `issuer_not_party` | revoked key / rule violation / no live write grant / issuer isn't subject or counterparty |
| 404 | `not_found` | unknown or invisible record, company, module, route |
| 409 | `duplicate_record_id` / `supersedes_conflict` / `transition_forbidden` | id reused with a different body / target isn't head or chain mismatch / state change not allowed for your role |
| 413 | `payload_too_large` | > 256 KB |
| 422 | `envelope_invalid` / `schema_invalid` / `float_not_allowed` / `unknown_type` | shape / body schema (`details.issues[].path`) / a JSON number with a fraction / type or version not in the registry |

---

## 10. Walkthrough with curl (from the seed)

Assume `$STORE_URL`, and from `dev-keys.json`: `$MOD_TOKEN`, `$MOD_SECRET`, `$MOD_ID` (`demo-financing`), `$ACME` (`acme-sauce.dtp`), `$BLUESTEM`, `$FUL_ROOT` (the attested fulfillment's root), `$CONTRACT_ROOT`.

```bash
# who am I
curl -s -H "Authorization: Bearer $MOD_TOKEN" $STORE_URL/whoami

# what has Acme granted me
curl -s -H "Authorization: Bearer $MOD_TOKEN" "$STORE_URL/companies/$ACME/grants"

# find the attested receivable
curl -s -H "Authorization: Bearer $MOD_TOKEN" "$STORE_URL/records?subject=$ACME&type=trade.fulfillment"

# draft an invoice on Acme's behalf (issuer.company_id = acme, issuer.module_id = me)
cat > invoice.json <<EOF
{ "type": "finance.invoice", "subject_company_id": "$ACME", "counterparty_ids": ["$BLUESTEM"],
  "issuer": { "company_id": "$ACME", "module_id": "$MOD_ID" }, "visibility": "counterparties",
  "body": { "invoice_number": "INV-2026-0001", "seller_company_id": "$ACME", "buyer_company_id": "$BLUESTEM",
    "contract_id": "$CONTRACT_ROOT", "fulfillment_id": "$FUL_ROOT",
    "line_items": [ { "description": "Habanero Hot Sauce 5oz, 12/case", "quantity": { "amount": "120", "unit": "case" },
                      "unit_price": { "amount": "42.00", "currency": "USD" }, "amount": { "amount": "5040.00", "currency": "USD" } } ],
    "subtotal": { "amount": "5040.00", "currency": "USD" }, "deductions": [], "total": { "amount": "5040.00", "currency": "USD" },
    "issued_at": "2026-09-09T15:00:00.000Z", "due_at": "2026-10-09T15:00:00.000Z",
    "payment_terms": { "net_days": 30, "paca_covered": false, "early_pay_discount_bps": null },
    "status": "issued", "paid_amount": { "amount": "0", "currency": "USD" }, "settlement_event_ids": [], "assigned_to_company_id": null } }
EOF
node sdk/scripts/sign.ts invoice.json --key "$MOD_SECRET" --fill > invoice.signed.json

# (optional) check the bytes
curl -s -X POST -H "content-type: application/json" --data @invoice.signed.json $STORE_URL/debug/canonicalize

# write it
curl -s -X POST -H "Authorization: Bearer $MOD_TOKEN" -H "content-type: application/json" --data @invoice.signed.json $STORE_URL/records

# watch the feed as Acme or Bluestem would
curl -s -H "Authorization: Bearer $MOD_TOKEN" "$STORE_URL/events?company=$ACME&after=0"
```

From here M3 continues: `finance.advance_offer` (subject Acme, counterparty your financer company, issuer your module *acting for the financer* — so the financer must have granted you `finance write` too, and be a counterparty), Acme accepts by superseding with `status: accepted`, then `finance.advance` + `finance.settlement_event`.

---

## 11. Sprint rules that touch the store

- **The spec is the only coordination channel.** If the docs and schemas don't answer it, log it.
- **`x_` fields** are accepted on every strict type. Use them for anything missing; log each one as a gap (`docs/SPRINT_01_GAP_LOG.md`).
- **No referential integrity inside bodies.** The store does not check that `contract_id` exists. If your module needs that guarantee, that's a finding.
- **Run the store yourself** without Docker: `cd sdk && npm install && node scripts/dev-server.ts` (embedded Postgres, in-memory; `DTP_DEV_DATA=./.pglite` to persist). Then `npm run seed`.
- **Tests as documentation:** `sdk/tests/*.test.ts` exercise every rule above against a live store; `STORE_URL=… npm test` runs them against any deployment.
