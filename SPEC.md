# DTP Specification v0.1

**Direct Trade Protocol — Protocol Specification**

> Status: Draft | Version: 0.1 | Date: 2026-03-06

---

## 1. Overview

The Direct Trade Protocol (DTP) defines a standard set of message schemas, state machines, and settlement rules for coordinating the trade of physical goods between two parties without a broker or intermediary.

**Scope (v0/v1):** wholesale buyer ↔ wholesale seller trade flows only.

A DTP implementation consists of:
- **Messages** — structured data objects passed between parties
- **State machines** — valid states and transitions for intents, offers, contracts, and fulfillments
- **Settlement rules** — conditions under which escrowed funds are released or returned
- **Identity/credential references** — how party credentials are attached and verified

Any platform, agent, or application that conforms to this specification can interoperate with any other conforming implementation.

---

## 2. Core Concepts

### 2.1 Parties

A **Party** is any entity that participates in a DTP trade. Parties may be human-operated businesses or autonomous AI agents.

```json
{
  "party_id": "string",
  "account": "string",
  "business_name": "string",
  "business_type": "producer | distributor | retailer | cooperative | agent",
  "jurisdiction": "string",
  "certifications": ["CertificationRef"],
  "reputation": "ReputationRecord",
  "created_at": "ISO8601"
}
```

**Fields:**
- `party_id` — unique identifier (NEAR account name or DID)
- `account` — on-chain account address for settlement
- `business_type` — role in the supply chain
- `certifications` — array of `CertificationRef` objects (see 2.2)
- `reputation` — on-chain reputation record derived from completed trades (see 2.3)

### 2.2 CertificationRef

A certification claim is never self-asserted. Every certification must carry a reference to the issuing authority and be independently verifiable.

```json
{
  "cert_id": "string",
  "type": "string",
  "issuer": "string",
  "issuer_url": "string",
  "issued_at": "ISO8601",
  "expires_at": "ISO8601",
  "verification_url": "string",
  "status": "active | expired | revoked"
}
```

**Common certification types (food domain):**
- `USDA_ORGANIC` — USDA organic certification
- `FSMA_COMPLIANT` — FDA Food Safety Modernization Act compliance
- `GAP` — Good Agricultural Practices
- `FAIR_TRADE` — Fair Trade certified
- `HACCP` — Hazard Analysis Critical Control Points
- `NON_GMO` — Non-GMO Project verified

### 2.3 ReputationRecord

Reputation is built on-chain from completed trades. It cannot be manually set or imported.

```json
{
  "party_id": "string",
  "trades_completed": "integer",
  "trades_disputed": "integer",
  "trades_settled_on_time": "integer",
  "average_delivery_accuracy": "float",
  "score": "float",
  "last_updated": "ISO8601"
}
```

`score` is computed as: `(trades_completed - trades_disputed) / trades_completed * delivery_accuracy_factor`. Formula is on-chain and immutable per version.

---

### 2.4 RelationshipRecord

A **RelationshipRecord** captures the bilateral trade history between two specific parties. Unlike Reputation (which reflects a party's general track record across all counterparties), a RelationshipRecord reflects the specific history between Party A and Party B.

RelationshipRecords are computed automatically from completed trades. They cannot be manually created or edited. Either party can view their shared RelationshipRecord. Third parties can see aggregate relationship strength (tier, trade count, relationship age) but not individual trade values or terms.

```json
{
  "relationship_id": "string",
  "party_a": "string",
  "party_b": "string",
  "first_trade_at": "ISO8601",
  "last_trade_at": "ISO8601",
  "trades_completed": "integer",
  "total_volume_usd": "decimal",
  "dispute_rate": "float",
  "on_time_delivery_rate": "float",
  "tier": "RelationshipTier",
  "standing_agreements": ["StandingAgreementRef"],
  "updated_at": "ISO8601"
}
```

**RelationshipTier** is derived automatically from trade history:

| Tier | Criteria |
|---|---|
| `NEW` | First trade, or fewer than 3 completed trades |
| `ESTABLISHED` | 3+ completed trades or 6+ months of history |
| `PREFERRED` | 10+ trades, or $50k+ lifetime volume, or active StandingAgreement |
| `STRATEGIC` | Multi-year history, $250k+ lifetime volume, or multi-year StandingAgreement |

Tier thresholds are protocol-defined and version-controlled. Tier is visible to both parties and to the matching engine.

**How RelationshipTier affects the protocol:**
- Matching engine weights counterparty relationship tier in scoring — an established supplier ranks higher than an unknown one for the same goods at the same price.
- Agents can be configured to auto-accept offers from `PREFERRED` or `STRATEGIC` counterparties within wider price bounds than they would for new counterparties.
- Sellers may attach relationship-conditional pricing tiers (see PricingStructure) — pricing that is only unlocked for parties at a certain tier.

---

### 2.5 StandingAgreement

A **StandingAgreement** is a long-term or recurring trading relationship formally acknowledged on-chain by both parties. It is not a single trade — it is a framework that governs a series of trades over a defined period.

```json
{
  "agreement_id": "string",
  "version": "string",
  "buyer": "PartyRef",
  "seller": "PartyRef",
  "goods": "GoodsSpec",
  "terms": {
    "period_start": "ISO8601",
    "period_end": "ISO8601",
    "volume_commitment": {
      "min_quantity_per_period": {"amount": "decimal", "unit": "string"},
      "period": "monthly | quarterly | annual",
      "committed_total": {"amount": "decimal", "unit": "string"}
    },
    "pricing": "PricingStructure",
    "delivery_cadence": "string | null",
    "renewal": "auto | manual | none"
  },
  "status": "AgreementStatus",
  "buyer_signed_at": "ISO8601 | null",
  "seller_signed_at": "ISO8601 | null",
  "created_at": "ISO8601"
}
```

**AgreementStatus:**
```
PROPOSED → COUNTERED → ACTIVE → COMPLETED
                     ↘ TERMINATED
```

Both parties must sign (on-chain attestation) for the agreement to become `ACTIVE`. Once active, individual trades that fulfil the agreement reference it via `standing_agreement_id` and inherit its pricing and terms automatically.

**Effect on agent autonomy:** An agent operating under an active StandingAgreement can place orders that conform to the agreement terms autonomously — no per-trade human approval required. The agreement itself was the human approval decision.

---

## 3. Message Types

### 3.1 TradeIntent

A **TradeIntent** is a public declaration by a buyer of what they want to purchase. It is the entry point to a DTP trade.

```json
{
  "intent_id": "string",
  "version": "string",
  "buyer": "PartyRef",
  "goods": "GoodsSpec",
  "delivery": "DeliverySpec",
  "payment": "PaymentSpec",
  "expires_at": "ISO8601",
  "status": "IntentStatus",
  "created_at": "ISO8601",
  "updated_at": "ISO8601"
}
```

**IntentStatus state machine:**
```
DRAFT → POSTED → MATCHED → CONTRACTED → FULFILLED → SETTLED
                         ↘ EXPIRED
                         ↘ CANCELLED
```

### 3.2 GoodsSpec

Describes the goods being requested or offered. Used in TradeIntent, SupplyListing, and Offer.

```json
{
  "category": "string",
  "product_name": "string",
  "description": "string",
  "product_type": "commodity | branded | value_added",
  "commodity_details": {
    "country_of_origin": "string",
    "farming_practices": ["string"],
    "grade": "string",
    "harvest_date": "ISO8601 | null"
  },
  "branded_details": {
    "brand_name": "string",
    "sku": "string",
    "gtin": "string",
    "upc": "string | null",
    "manufacturer": "string"
  },
  "value_added_details": {
    "process_type": "string",
    "base_ingredients": ["string"],
    "processing_facility": "string | null"
  },
  "quantity": {
    "amount": "decimal",
    "unit": "string"
  },
  "quality": {
    "grade": "string",
    "specifications": ["string"]
  },
  "required_certifications": ["string"],
  "packaging": "string",
  "shelf_life_days": "integer | null"
}
```

**Product types:**
- `commodity` — undifferentiated bulk goods defined by grade, origin, and certifications (e.g., bulk whole black peppercorns, raw cacao). `commodity_details` required.
- `branded` — goods sold under a specific brand with individual unit identifiers (e.g., Yellowbird Habanero Sauce). `branded_details` required, including GTIN/SKU per unit.
- `value_added` — goods transformed from a raw commodity through processing (e.g., IQF organic blueberries, cold-pressed olive oil). `value_added_details` required.

Only the `*_details` block matching `product_type` is required. Others may be omitted.

**Quantity units:** `lb`, `kg`, `oz`, `ton`, `case`, `pallet`, `unit`

**Required certifications** are cert type strings (see 2.2). A listing or offer that does not carry all required certifications is ineligible for matching.

### 3.3 DeliverySpec

```json
{
  "destination": {
    "address": "string",
    "city": "string",
    "state": "string",
    "zip": "string",
    "country": "string"
  },
  "window": {
    "earliest": "ISO8601",
    "latest": "ISO8601"
  },
  "method": "delivered | FOB_origin | third_party_logistics",
  "temperature_requirements": "ambient | refrigerated | frozen | null",
  "notes": "string | null"
}
```

### 3.4 PackStructure

Describes the physical packaging hierarchy of goods. Used in SupplyListings to define how goods are packaged and shipped. The protocol uses pack structure to derive suggested pricing tier breakpoints automatically.

```json
{
  "unit_size": {
    "amount": "decimal",
    "unit": "string"
  },
  "units_per_case": "integer",
  "cases_per_pallet": "integer",
  "pallets_per_truckload": "integer | null",
  "moq": {
    "amount": "decimal",
    "unit": "string",
    "label": "string"
  }
}
```

**Example:** A seller listing 25 lb bags of organic black pepper, 4 bags/case, 40 cases/pallet:
```json
{
  "unit_size": {"amount": 25, "unit": "lb"},
  "units_per_case": 4,
  "cases_per_pallet": 40,
  "moq": {"amount": 100, "unit": "lb", "label": "1 case"}
}
```

The protocol derives natural tier breakpoints: 1 case (100 lb), 10 cases (1,000 lb), 1 pallet (4,000 lb), etc., and presents these as suggested tiers. The seller confirms or adjusts.

---

### 3.5 PricingStructure

Used in both SupplyListings (seller side) and TradeIntents (buyer side). Replaces simple `price_per_unit`.

**Seller PricingStructure:**
```json
{
  "model": "tiered | flat | negotiable",
  "currency": "USDC",
  "asking_price_per_unit": "decimal",
  "tiers": [
    {
      "min_quantity": {"amount": "decimal", "unit": "string"},
      "max_quantity": {"amount": "decimal", "unit": "string"} ,
      "price_per_unit": "decimal",
      "label": "string | null"
    }
  ]
}
```

`asking_price_per_unit` is the published starting price — the price at the lowest tier. Higher-volume tiers offer lower unit prices.

**Floor price is not published.** It is private to the seller and held in the seller's agent context (see Section 10). Buyers never see the seller's floor or cost basis.

**Buyer PricingStructure:**
```json
{
  "currency": "USDC",
  "ceiling_price_per_unit": "decimal",
  "desired_quantity": {
    "amount": "decimal",
    "unit": "string"
  }
}
```

`ceiling_price_per_unit` is the maximum the buyer will pay. The matching engine surfaces matches at or below this ceiling.

**Quantity flexibility is a protocol recommendation, not a buyer-set parameter.** When a buyer posts a TradeIntent at 400 lbs, the matching engine surfaces the exact-quantity price AND adjacent tier comparisons — e.g., "at 500 lbs (half pallet) you save 9% per unit." The buyer (or buyer's agent) decides whether to adjust quantity. No hard flex range is required upfront.

---

### 3.6 PaymentSpec

```json
{
  "pricing": "PricingStructure",
  "escrow_required": true,
  "payment_on": "delivery_attestation | inspection_period_end",
  "finance": "FinanceTerms | null"
}
```

`escrow_required` is always `true` in v0/v1.

### 3.6.1 FinanceTerms (v1)

```json
{
  "payment_timing": "delivery_attestation | inspection_period_end",
  "net_days": 0,
  "financing_mode": "escrow_only | lp_pool",
  "liquidity_pool_id": "string | null",
  "financer_id": "PartyRef | null",
  "finance_fee_bps": 0
}
```

**v1 constraints:**
- `net_days` must be `<= 60` for standard financed wholesale trades
- PACA-covered produce obligations cap effective due date at `30` calendar days
- `financing_mode=escrow_only` must not set `liquidity_pool_id` or `financer_id`
- `financing_mode=lp_pool` defaults to protocol LP if no pool is specified

This is intentionally minimal in v1: one default LP lane and on-chain recording of financing terms per trade, with prepay-anytime and deterministic max due dates. Open lender/funder selection is deferred to v2.

### 3.6.2 v1 LP Finance Policy

For financed wholesale trades using `financing_mode=lp_pool`, the protocol applies the following defaults:

- Interest accrues at a fixed **30% effective APR**.
- Accrual compounds **daily**.
- Buyer may prepay at any time without penalty.
- Balance is due in full (principal + accrued interest + protocol finance fees) no later than the **60th calendar day** from financing start.
- For produce suppliers covered by **PACA** protections, full payoff is due no later than the **30th calendar day**.

These rules are protocol policy defaults for v1 and are intended to be deterministic in contract execution.

---

### 3.5 SupplyListing

A **SupplyListing** is a seller's proactive broadcast of available inventory. It is the supply-side equivalent of a TradeIntent — sellers do not need to wait for a buyer to post first.

```json
{
  "listing_id": "string",
  "version": "string",
  "seller": "PartyRef",
  "goods": "GoodsSpec",
  "delivery": "DeliverySpec",
  "payment": {
    "currency": "USDC",
    "price_per_unit": "decimal",
    "minimum_order_quantity": {
      "amount": "decimal",
      "unit": "string"
    }
  },
  "certifications": ["CertificationRef"],
  "available_from": "ISO8601",
  "expires_at": "ISO8601",
  "status": "ListingStatus",
  "created_at": "ISO8601"
}
```

**ListingStatus state machine:**
```
DRAFT → ACTIVE → MATCHED → CONTRACTED
               ↘ EXPIRED
               ↘ WITHDRAWN
```

When a SupplyListing matches a TradeIntent, both the seller (via the listing) and the buyer (via the intent) are notified. Either party may initiate contract formation from the match.

---

### 3.6 Offer

An **Offer** is a seller's direct response to a posted TradeIntent, or a buyer's direct response to a posted SupplyListing. Offers are targeted (referencing a specific intent or listing), whereas TradeIntents and SupplyListings are broadcast.

```json
{
  "offer_id": "string",
  "version": "string",
  "intent_id": "string",
  "seller": "PartyRef",
  "goods": "GoodsSpec",
  "delivery": "DeliverySpec",
  "payment": {
    "currency": "USDC",
    "price_per_unit": "decimal",
    "total_price": "decimal"
  },
  "certifications": ["CertificationRef"],
  "expires_at": "ISO8601",
  "status": "OfferStatus",
  "created_at": "ISO8601"
}
```

**OfferStatus state machine:**
```
SUBMITTED → SHORTLISTED → ACCEPTED
          ↘ REJECTED
          ↘ EXPIRED
```

An offer must be for the same or greater quantity and must carry all certifications required by the TradeIntent to be eligible for matching.

---

### 3.6 Contract

A **Contract** is formed when a buyer accepts an offer. It is the binding record of the agreed trade terms and triggers escrow.

```json
{
  "contract_id": "string",
  "version": "string",
  "intent_id": "string",
  "offer_id": "string",
  "buyer": "PartyRef",
  "seller": "PartyRef",
  "goods": "GoodsSpec",
  "delivery": "DeliverySpec",
  "payment": {
    "currency": "USDC",
    "price_per_unit": "decimal",
    "total_value": "decimal",
    "escrow_ref": "string"
  },
  "dispute_window_hours": "integer",
  "arbitrator": "PartyRef | null",
  "status": "ContractStatus",
  "created_at": "ISO8601",
  "updated_at": "ISO8601"
}
```

**ContractStatus state machine:**
```
ACTIVE → IN_FULFILLMENT → DELIVERED → SETTLED
                        ↘ DISPUTED → RESOLVED_BUYER
                                   → RESOLVED_SELLER
       ↘ CANCELLED
```

`escrow_ref` is the on-chain transaction ID where buyer funds are locked.

`dispute_window_hours` — the period after delivery attestation during which a buyer may raise a dispute before automatic settlement. Default: 48 hours.

---

### 3.7 Fulfillment

A **Fulfillment** record is created when a seller initiates delivery confirmation.

```json
{
  "fulfillment_id": "string",
  "contract_id": "string",
  "delivered_at": "ISO8601",
  "quantity_delivered": {
    "amount": "decimal",
    "unit": "string"
  },
  "seller_attestation": "Attestation",
  "buyer_attestation": "Attestation | null",
  "status": "FulfillmentStatus"
}
```

**Attestation:**
```json
{
  "party_id": "string",
  "signed_at": "ISO8601",
  "signature": "string",
  "notes": "string | null"
}
```

**FulfillmentStatus:**
```
SELLER_ATTESTED → BUYER_ATTESTED → COMPLETE
               ↘ DISPUTED
```

Settlement does not trigger until `COMPLETE` or dispute resolution.

---

### 3.8 Settlement

```json
{
  "settlement_id": "string",
  "contract_id": "string",
  "fulfillment_id": "string",
  "gross_amount": "decimal",
  "deductions": [
    {
      "reason": "string",
      "amount": "decimal"
    }
  ],
  "net_amount": "decimal",
  "currency": "USDC",
  "escrow_release_tx": "string",
  "settled_at": "ISO8601"
}
```

`escrow_release_tx` is the on-chain transaction ID for payment release to seller.

Deductions (quantity shortfalls, quality disputes resolved in buyer's favor) reduce `net_amount` from `gross_amount`.

---

## 4. Matching

DTP matching is **bidirectional and continuous**. The matching engine watches both TradeIntents (buyer demand) and SupplyListings (seller supply) and surfaces smart matches to both parties when alignment is detected.

Matching is **off-chain** — a solver scores and ranks candidates, and the accepted match is committed on-chain. This keeps gas costs low and allows matching logic to evolve without contract upgrades.

### 4.1 Match Types

| Trigger | Candidates evaluated | Notified |
|---|---|---|
| New TradeIntent posted | All active SupplyListings | Buyer (top matches) + matching Sellers |
| New SupplyListing posted | All active TradeIntents | Seller (top matches) + matching Buyers |
| Direct Offer submitted | The specific intent or listing | The receiving party |

### 4.2 Eligibility Rules

A SupplyListing or Offer is eligible to match a TradeIntent if and only if:
1. Quantity available ≥ intent required quantity (or minimum order quantity ≤ intent quantity)
2. All certifications in `intent.goods.required_certifications` are present in the listing/offer
3. Listing price per unit ≤ intent payment ceiling
4. Delivery windows overlap
5. The listing/offer has not expired and is in an active status

Symmetrically, a TradeIntent is eligible to match a SupplyListing if and only if:
1. Intent quantity ≥ listing minimum order quantity
2. Intent does not require certifications the listing cannot provide
3. Intent payment ceiling ≥ listing price
4. Delivery windows overlap
5. The intent has not expired and has status `POSTED`

### 4.3 Scoring

Eligible candidates are scored on four dimensions (equal weight in v0):

| Dimension | Higher is better |
|---|---|
| Price alignment | Closer to ceiling (buyer) / asking price (seller) → higher score |
| Delivery timing | Delivery window fit → higher score |
| Party reputation | Higher `reputation.score` of counterparty → higher score |
| Certification depth | More certs than required → higher score |

The top 3 candidates are surfaced to each party as recommended matches.

### 4.4 Tier Comparison Surfacing

When the matching engine surfaces a match to a buyer, it also computes and surfaces adjacent tier comparisons — even if the buyer did not request them. This allows buyers and buyer agents to evaluate quantity flexibility without having to recalculate manually.

**Example output for a buyer who posted 400 lbs at a $4.50/lb ceiling:**
```
Match: Organic basil — Green Valley Farm
  Your quantity (400 lb):     $4.20/lb  =  $1,680 total
  Next tier   (500 lb, ½ pallet): $3.80/lb  =  $1,900 total  [-10% per unit, +13% total]
  Pallet tier (1,000 lb):     $3.50/lb  =  $3,500 total  [-17% per unit, +108% total]
```

The buyer or buyer's agent decides whether to adjust quantity. No quantity commitment is made until contract formation.

### 4.5 Solver Role

In v0, the solver is a human operator or a simple scoring script. The protocol does not mandate solver implementation — any conforming matching algorithm may be used. Future versions will define a decentralized solver network.

---

## 5. Settlement Rules

1. Settlement is triggered when a Fulfillment reaches `COMPLETE` status (both party attestations received).
2. If the buyer does not attest within `dispute_window_hours` of seller attestation, settlement is triggered automatically (presumed acceptance).
3. If the buyer raises a dispute during the dispute window, the contract enters `DISPUTED` state. The arbitrator (defined in the contract, or a default DTP arbitrator in v0) resolves the dispute.
4. Escrow is held until settlement or dispute resolution. It cannot be unilaterally withdrawn by either party.
5. All deductions must be agreed by both parties or ordered by the arbitrator.

---

## 6. Audit Trail

Every state transition in DTP emits an on-chain event. The event log is append-only and cannot be modified or deleted.

**Event schema:**
```json
{
  "event_id": "string",
  "event_type": "string",
  "entity_type": "intent | offer | contract | fulfillment | settlement",
  "entity_id": "string",
  "actor": "string",
  "timestamp": "ISO8601",
  "payload_hash": "string"
}
```

`payload_hash` is a SHA-256 hash of the full event payload, enabling independent verification.

---

## 7. Versioning

DTP is versioned. Every message carries a `version` field. Breaking changes increment the major version. Implementations must reject messages with incompatible versions.

Current version: `0.1`

---

## 8. Reference Implementation

The canonical reference implementation consists of:

- **`contracts/`** — NEAR smart contracts (Rust) implementing the settlement layer
- **`sdk/`** — TypeScript SDK providing typed clients for all DTP message types and state transitions

Implementors are not required to use the reference contracts or SDK. Any conforming implementation is valid.

---

## 9. Agent Autonomy Context

DTP is designed for both human-operated and agent-operated parties. To enable autonomous agent behavior, each party may maintain a private **Agent Autonomy Context** — a set of parameters that governs how their agent acts on their behalf.

**Agent Autonomy Context is not a protocol message.** It is never transmitted, never stored on-chain, and never visible to the counterparty. It is private configuration held by the party's agent.

### 9.1 Seller Agent Context

```json
{
  "party_id": "string",
  "cogs_per_unit": "decimal",
  "target_margin_pct": "decimal",
  "minimum_margin_pct": "decimal",
  "pricing_guidelines": {
    "auto_accept_above_floor": true,
    "auto_counter_below_floor": true,
    "escalate_to_human_below_margin_pct": "decimal"
  }
}
```

The seller's agent derives its floor price from `cogs_per_unit` and `minimum_margin_pct`. It publishes asking prices and tiers based on `target_margin_pct`. It can autonomously accept any offer above the derived floor, counter-offer below it, or escalate to a human if an offer falls below the escalation threshold.

**Buyers never see COGS, floor price, or margin guidelines.** They see only the published asking price and tiers.

### 9.2 Buyer Agent Context

The buyer's agent operates like an internal procurement officer: it knows the company's economics, inventory position, supplier history, and spending authority — and negotiates on behalf of the company without exposing any of that to the seller.

```json
{
  "party_id": "string",
  "input_cost_targets": [
    {
      "product_category": "string",
      "target_cost_per_unit": "decimal",
      "max_cost_per_unit": "decimal",
      "notes": "string | null"
    }
  ],
  "budget": {
    "category_budgets": [
      {
        "category": "string",
        "period": "string",
        "total": "decimal",
        "remaining": "decimal",
        "currency": "USDC"
      }
    ],
    "per_order_authority": "decimal"
  },
  "inventory": {
    "items": [
      {
        "product_category": "string",
        "on_hand": {"amount": "decimal", "unit": "string"},
        "reorder_point": {"amount": "decimal", "unit": "string"},
        "storage_constraints": ["ambient_only | refrigerated | frozen | limited_space"]
      }
    ]
  },
  "supplier_preferences": {
    "preferred_party_ids": ["string"],
    "excluded_party_ids": ["string"],
    "sourcing_priorities": ["local | minority_owned | cooperative | certified_organic | fair_trade"]
  },
  "negotiation_guidelines": {
    "auto_accept_at_or_below_target_cost": true,
    "auto_counter_above_target_up_to_max": true,
    "escalate_to_human_above_spend": "decimal",
    "auto_accept_tier_upgrade_if_savings_pct_gte": "decimal"
  }
}
```

**`input_cost_targets`** — the buyer's internal cost economics. Not an arbitrary ceiling but a derived target based on their own product margins or operational budget. The agent negotiates toward `target_cost_per_unit` and treats `max_cost_per_unit` as a hard ceiling. Sellers never see these values.

**`budget`** — category-level spending authority for the period and per-order autonomous spending limit. The agent escalates to a human for any order exceeding `per_order_authority`.

**`inventory`** — current stock and reorder state. The agent factors this into urgency and quantity decisions. Storage constraints limit which offers are physically viable (e.g., a buyer with no cold storage cannot accept a refrigerated listing).

**`supplier_preferences`** — preferred and excluded suppliers inform matching ranking. Sourcing priorities (local, cooperative, etc.) can be weighted in the scoring algorithm without being exposed as mandatory filters.

**`negotiation_guidelines`** — defines the boundary of autonomous action. Within these bounds the agent acts without human input. Outside them it escalates.

### 9.3 TEE Integration

In deployments using NEAR AI Cloud's Trusted Execution Environment (TEE), Agent Autonomy Context runs inside hardware-secured infrastructure where the context is encrypted and isolated — even the infrastructure operator cannot read it. This is the recommended deployment model for production agent autonomy.

---

## 10. Out of Scope (v0)

The following are explicitly out of scope for DTP v0 and may be addressed in future versions:

- Automated IoT/sensor-based delivery verification
- Decentralized solver/matching network
- Cross-chain settlement (v0 settles on NEAR only)
- Regulatory compliance automation (FSMA, etc.) — DTP carries certification references but does not validate them
- Native DTP token or governance mechanism

---

*DTP is open protocol infrastructure. It is not a product, a marketplace, or a company.*
