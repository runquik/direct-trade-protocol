# Direct Trade Protocol (DTP)

**A platform-agnostic protocol for direct, agent-native trade of physical goods with on-chain settlement.**

---

## What DTP Is

DTP is a coordination protocol — a set of rules, schemas, and state machines that define how two parties (a buyer and a seller) can negotiate, contract, and settle a trade of physical goods without a broker in the middle.

Think of it like HTTP for commerce: HTTP defines how computers exchange information on the web, and any server or browser can implement it. DTP defines how trade parties exchange intentions, offers, and contracts, and any platform, agent, or application can implement it.

DTP is **not** an app, a marketplace, or a company. It is infrastructure.

Current v0 scope is specifically **wholesale buyers and wholesale sellers** (B2B physical goods).

---

## Why It Exists

The U.S. food supply chain alone spends an estimated 20–30% of total value (~$375–750B annually) on middlemen and manual coordination — faxes, spreadsheets, phone calls, paper checks, 30–90 day payment terms. That coordination tax doesn't add value. It just extracts it.

DTP replaces coordination-by-intermediary with coordination-by-protocol: open rules, smart contract escrow, automatic settlement, and on-chain reputation. The value that was flowing to brokers flows back to producers and buyers.

Food is the first target. The protocol is industry-agnostic.

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
```

1. **TradeIntent** — A buyer broadcasts what they want: product, quantity, quality specs, required certifications, delivery window, price ceiling.
2. **SupplyListing** — A seller broadcasts what they have available: product, quantity, quality, certifications, pricing, and delivery terms — without waiting for a buyer to post first.
3. **Matching** — The matching engine continuously evaluates both sides. When a TradeIntent aligns with a SupplyListing, both parties are notified. Either party can initiate contract formation from a match.
4. **Contract + Escrow** — A smart contract locks buyer funds and encodes the agreed delivery conditions.
5. **Fulfillment** — Seller delivers. Both parties attest to delivery on-chain.
6. **Settlement** — Escrow releases to the seller. Reputation scores update. Audit trail is permanent.

---

## Finance Layer (v1)

DTP v1 includes a simple finance layer for wholesale payment terms without turning the protocol into a lender marketplace on day one.

Buyers are not required to pick a term schedule. In escrow-only mode, settlement follows normal escrow release. In LP mode, a single protocol liquidity pool can advance seller payment while buyer balances accrue daily financing and can be repaid at any time up to policy maturity limits.

The first iteration intentionally keeps underwriting and lender routing simple:

- one protocol LP pool (default)
- constrained term options
- on-chain recording of financing terms per trade
- future-compatible fields for buyer-selected funding partner and pool choice

This gives immediate utility for working-capital pressure while preserving a clean path toward deeper DeFi integration in later versions.

---

## Design Principles

- **Platform-agnostic** — Any system that can speak JSON can implement DTP. No vendor lock-in.
- **Agent-native** — Designed from the start for AI agents to operate as buyers, sellers, and matching solvers. Human interfaces are a thin layer on top.
- **No speculative token** — Settlement in stablecoins (USDC). DTP has no native token and creates no speculative instrument.
- **Non-extractive** — The protocol charges no rent. Any fees are set by governance, minimal by design, and flow to infrastructure — not a middleman.
- **Verifiable claims** — Certifications, grades, and credentials are referenced with issuer + expiry + verification source. Nothing is self-reported without verification.
- **Transparent audit trail** — Every state transition is an on-chain event. The full history of any trade is permanently readable.

---

## Repository Structure

```
direct-trade-protocol/
  README.md         ← this file
  SPEC.md           ← the full protocol specification
  contracts/        ← NEAR smart contracts (Rust) — reference settlement implementation
  sdk/              ← TypeScript SDK — reference client implementation
  examples/         ← example integrations (human UI, agent client)
  docs/             ← extended documentation
```

---

## Status

**Pre-alpha.** Active development. Spec and reference contracts are being written now.

Reference chain: [NEAR Protocol](https://near.org) (fast finality, agent-native accounts, USDC support, TEE-secured AI cloud).

---

## Built By

[Ned](https://github.com/ned-for-good) and [@runquik](https://github.com/runquik).
