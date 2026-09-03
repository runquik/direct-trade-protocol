# Direct Trade Protocol (DTP)

**A platform-agnostic protocol for direct, agent-native trade of physical goods — with on-chain settlement, regulatory compliance, and portable business identity.**

> **🛒 Live MVP — use DTP from Claude Code today:**
>
> ```
> /plugin marketplace add runquik/direct-trade-protocol
> /plugin install dtp@dtp
> ```
>
> The MVP marketplace covers listing goods for sale, posting buy intents, price shopping,
> matching, and account-level trust. See [`marketplace/`](marketplace/README.md) for the
> architecture and [`plugins/dtp/`](plugins/dtp/README.md) for usage. The full protocol
> below (escrow, settlement, traceability) is the roadmap the MVP grows into.

> **🗂️ Protocol v0.2 (Sept 2026): DTP is now a *company record protocol*.** The core is a company's
> portable, signed, append-only record store that any small module can read and write with the
> company's permission; trade is the first namespace, finance the second. See [`SPEC.md`](SPEC.md),
> the builder quickstart [`docs/PROTOCOL_STORE.md`](docs/PROTOCOL_STORE.md), the schemas in
> [`spec/`](spec/), and the reference store + SDK in [`supabase/`](supabase/functions/dtp-store) and
> [`sdk/`](sdk/). The prior-art research that drove the re-rooting is in [`research/`](research/).

---

## What DTP Is

DTP is coordination infrastructure — a set of rules, schemas, state machines, and on-chain identity primitives that define how two businesses can negotiate, contract, settle, and trace a trade of physical goods without a broker in the middle.

Think of it like HTTP for commerce: HTTP defines how computers exchange information on the web, and any server or browser can implement it. DTP defines how trade parties exchange intentions, offers, contracts, and traceability records, and any platform, agent, or application can implement it.

DTP is **not** an app, a marketplace, or a company. It is infrastructure.

**Current v1 scope:** wholesale B2B trade of physical goods, with a focus on the U.S. food and agriculture supply chain.

---

## Why It Exists

Trade in physical goods still runs on faxes, emails, spreadsheets, paper checks, and 30–90 day payment terms — and on the fact that nobody's records are portable. Every system a business uses is a silo, so counterparties coordinate by re-keying, phoning, and waiting. The honest accounting (see [`research/SYNTHESIS.md`](research/SYNTHESIS.md)) is that most of a distributor's margin pays for real services — credit, cold chain, aggregation, recourse — and only a few points are pure coordination friction. What the status quo genuinely does *not* provide is: fast seller liquidity against a delivered order, trust between businesses that have never traded, machine-readable trade state that survives a change of software, and a cheap way to attach regulatory traceability to trades that already happened.

DTP targets exactly those gaps: signed, portable records; delivery attestation that a financer can price against in one step; and FSMA 204 traceability that falls out of settled trades instead of being separate homework.

**The regulatory context.** FDA's FSMA Rule 204 (Food Traceability Final Rule) is final law, but enforcement is statutorily barred until July 20, 2028. The near-term forcing function is retailer supplier-traceability programs (Walmart's has run with chargebacks since August 2025). DTP builds to the rule's data model and sells against the mandates that exist today.

---

## How It Works

DTP is a **two-sided protocol**. Both buyers and sellers post proactively. The matching engine watches both sides and surfaces smart matches to both parties.

```
Buyer posts TradeIntent          Seller posts SupplyListing
        ↓         ↘            ↙         ↓
        ↓      Matching Engine           ↓
        ↓      (continuous, both sides)  ↓
        ↓         ↙            ↘         ↓
   Seller receives match     Buyer receives match
        ↓                              ↓
        └──────── Contract formed ─────┘
                       ↓
                 Escrow locked
                       ↓
             Delivery + Attestation
                       ↓
             Settlement → Escrow released
                       ↓
             FSMA 204 CTEs recorded on-chain
```

1. **TradeIntent** — A buyer broadcasts what they want: product, quantity, quality specs, required certifications, delivery window, price ceiling.
2. **SupplyListing** — A seller broadcasts what they have available: product, quantity, quality, certifications, pricing, and delivery terms — without waiting for a buyer to post first.
3. **Matching** — The matching engine continuously evaluates both sides. When a TradeIntent aligns with a SupplyListing, both parties are notified. Either party can initiate contract formation.
4. **Contract + Escrow** — A smart contract locks buyer funds and encodes the agreed delivery conditions.
5. **Fulfillment** — Seller delivers. Both parties attest to delivery on-chain.
6. **Settlement** — Escrow releases to the seller. Reputation scores update. Audit trail is permanent.
7. **Traceability** — Receiving, Shipping, and Transforming CTEs are recorded on-chain, satisfying FSMA 204 one-up/one-down traceability requirements.

---

## Identity Model

Every DTP participant is a **DTP Account** — a NEAR account with a registered Party profile on the DTP contract. The NEAR account is the canonical identity: it owns keys, signs transactions, holds USDC for escrow, and carries on-chain reputation, trade history, and regulatory credentials.

**Accounts are role-neutral.** A farmer buys seeds and sells produce. A distributor buys from producers and sells to retailers. No account is permanently stamped as "buyer" or "seller" — role is declared per-trade and per-agreement.

**Authentication is cryptographic.** The NEAR account keypair is the login. There is no email/password at the protocol level.

**Portability is structural.** Because a party's reputation, certifications, GLN, and trade history live in the NEAR contract — not in any platform's database — they are readable and usable by any DTP-compatible implementation. Accounts are never locked to a platform.

**Portable business identity fields on-chain:**
- `kyb` — legal entity attestation (KYB) linking the NEAR account to a real-world business
- `gs1_gln` — GS1 Global Location Number (required by major food retailers and FSMA 204)
- `duns_number` — D-U-N-S Number (used by banks, insurers, and enterprise procurement)
- `fsma_pcqi_on_file` — Preventive Controls Qualified Individual flag (21 CFR Part 117)
- `facility_allergens` — allergens present in the facility (FALCPA + FASTER Act sesame)
- `certifications` — USDA Organic, GAP, SQF, BRC, and others with issuer + expiry
- `data_vault_uri` — URI of the party's secure off-chain data vault (Phase 3; see roadmap)

**Agent delegation via sub-accounts.** NEAR accounts are hierarchical. `agent.acme-foods.near` is cryptographically subordinate to `acme-foods.near`. This is the recommended pattern for AI agent participation: the business controls the parent account; agents operate from sub-accounts with scoped permissions.

---

## FSMA Rule 204 Compliance

DTP is purpose-built for FSMA Rule 204 compliance. The five Critical Tracking Events are first-class protocol objects:

| CTE | What it records |
|---|---|
| **Growing** | Farm/grower harvest of an FTL commodity |
| **Creating** | First packer assigns the Traceability Lot Code (TLC) |
| **Receiving** | Receiver records arrival and originating TLC source |
| **Transforming** | Processor creates a new TLC from one or more input TLCs |
| **Shipping** | Shipper records departure and destination |

Every CTE is indexed by lot ID for instant one-up / one-down recall lookups. GS1 GLNs on party records populate CTE location fields automatically. COA document hashes (SHA-256 or IPFS CIDv1) are anchored on-chain for tamper-evident lot certification.

---

## Finance Layer (v1)

DTP v1 includes a simple finance layer for wholesale payment terms.

- **Escrow-only mode** — settlement follows normal escrow release at delivery attestation.
- **LP pool mode** — a registered DeFi liquidity pool advances seller payment; buyer repays at maturity.
- PACA-covered produce enforced at ≤ 30 net days. All other trades capped at 60 net days in v1.
- Landed-cost guardrail on intent path: (goods total + net freight) must stay within buyer ceiling.
- Future-compatible fields for buyer-selected lender routing (v2).

---

## Design Principles

- **Platform-agnostic** — Any system that can speak JSON can implement DTP. No vendor lock-in.
- **Agent-native** — Designed from the start for AI agents to operate as buyers, sellers, and matching solvers. Human interfaces are a thin layer on top.
- **No speculative token** — Settlement in stablecoins (USDC). DTP has no native token and creates no speculative instrument.
- **Non-extractive** — The protocol charges no rent. Any fees are set by governance, minimal by design, and flow to infrastructure — not a middleman.
- **Verifiable claims** — Certifications, grades, and credentials carry issuer + expiry + verification source. Nothing is self-reported without attestation.
- **Transparent audit trail** — Every state transition is an on-chain event. The full history of any trade or lot is permanently readable.
- **Regulatory-ready** — FSMA 204, PACA, 21 CFR Part 117 compliance built into the core protocol, not bolted on.

---

## Roadmap

### Phase 1 — Trade & Compliance Protocol (now)
The core settlement layer: intents, listings, offers, contracts, fulfillment, dispute resolution, escrow. FSMA 204 CTE recording. Inventory ledger with lot-level traceability. COA anchoring. Portable business identity fields on-chain.

### Phase 2 — Network & Adoption
Real businesses transacting. Finance pool integration. Standing agreements. Relationship tiers. Matching engine improvements. SDK and developer tooling.

### Phase 3 — Data Vault
Encrypted, portable off-chain storage accessible via NEAR signature challenge — the business equivalent of Sign-in with Google, but for your ERP, CRM, and financial data. Apps request permission-scoped access. Data is encrypted at rest; only the party's NEAR key can authorize decryption. The `data_vault_uri` field on `Party` is the on-chain anchor for this layer. See [docs/PORTABLE_IDENTITY.md](docs/PORTABLE_IDENTITY.md) for the full vision.

### Phase 4 — W3C Verifiable Credentials
Full W3C VC 2.0 credential issuance and verification. KYB providers, certifying bodies, and government agencies write attestations directly to party records. NEAR accounts become portable W3C DIDs.

---

## Repository Structure

```
direct-trade-protocol/
  README.md                       ← this file
  SPEC.md                         ← protocol specification v0.2 (company record model)
  spec/                           ← NORMATIVE: JSON Schemas, type registry, fixed test vectors, generated types
  sdk/                            ← @dtp/sdk: canonicalization, keys, signing, store client, seed/keygen/sign CLIs,
                                     conformance tests, and a no-Docker dev store (embedded Postgres)
  supabase/                       ← reference store: migrations/ (schema `protocol`) + functions/dtp-store (edge function)
  docs/
    PROTOCOL_STORE.md             ← builder quickstart for the store (read this first)
    SPRINT_01_PROTOCOL_INTEROP.md ← the interop sprint brief; SPRINT_01_GAP_LOG.md collects findings
    PORTABLE_IDENTITY.md          ← portable business identity + data vault vision
    FINANCE_LAYER.md, FREIGHT_LAYER.md
    archive/SPEC_v0.1.md          ← the superseded marketplace-pipeline spec
  research/                       ← prior art, 1930–2026: 8 dossiers + SYNTHESIS.md + TIMELINE.md
  contracts/                      ← v0.1 NEAR smart contract (Rust): v0.1 objects, not v0.2-conformant; future on-chain profile
  marketplace/                    ← the live MVP (Supabase edge function + plugin backend); pre-v0.2 data model
  plugins/dtp/                    ← the Claude Code plugin for the MVP
  mcp-server/, remote-mcp-server/ ← v0.1 clients, frozen
```

---

## Status

**v0.2 reference store built (Sept 2026):** signed records, per-module grants, visibility, state machines, and an event feed, with a 32-test conformance suite green on embedded Postgres. Next: deploy to the shared Supabase project and run Sprint 01 with an outside builder.

**MVP marketplace:** live as a Claude Code plugin (listings, intents, matching, trust) on a pre-v0.2 data model.

**On-chain (v0.1 contract):** feature-complete for the v0.1 marketplace scope; not deployed to mainnet; escrow/release are placeholders. Becomes the on-chain store profile of v0.2 in a later phase.

Reference chain: [NEAR Protocol](https://near.org) — key and signature encodings in v0.2 are NEAR-compatible by design.

---

## Built By

[George Milton](https://github.com/runquik).
