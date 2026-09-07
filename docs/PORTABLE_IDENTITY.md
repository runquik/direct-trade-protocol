# Portable Business Identity

> Historical March 2026 DTP vision. The project is now Portable Business Protocol (PBP). For current identity/authority behavior use the [v0.3 preview specification](../spec/v0.3/SPEC.md) and [current scope](PBP_DIRECTION.md), not this document's earlier NEAR-account assumptions.

> DTP Phase 3 Design Document
> Status: Vision / Pre-design | Updated: 2026-03-10

---

## The Problem

Every business software platform today — ERPs, CRMs, financial systems, project management tools, ecommerce platforms — is a silo. Your data lives inside each vendor's database, accessible only through their API, formatted in their schema, governed by their terms of service. When you switch platforms (or when a platform raises prices, shuts down, or gets acquired), you export CSVs and spend months re-entering data into the new system.

This is not a technical limitation. It's a business model. Data lock-in is the moat.

The result is enormous friction in the supply chain. Two companies doing business together each have systems that can't talk to each other, so they communicate by email and fax. The coordination overhead is a tax on every transaction.

**DTP's thesis is that this doesn't have to be true.**

---

## The Vision: Your NEAR Account IS Your Business Identity

A DTP account is already the canonical identity for a business's commercial activity. On-chain today:

- Legal entity attestation (KYB)
- GS1 Global Location Number
- D-U-N-S Number
- FSMA PCQI flag and food safety credentials
- Organic, GAP, SQF, BRC, and other certifications with issuer and expiry
- Facility allergen declarations
- Complete trade history: every contract, fulfillment, and settlement
- Reputation record: computed from on-chain trade outcomes, not self-reported
- Relationship records: bilateral trade history with every counterparty
- Full FSMA 204 CTE traceability: every lot's movement from farm to fork

This data is portable by construction. It lives in the NEAR contract, not in any platform's database. Any DTP-compatible app can read it with a single view call. No API keys. No data exports. No migrations.

The question is: **what about the data that can't go on-chain?**

---

## What Can't Go On-Chain (and Why)

The blockchain is the wrong place for:

- **Mutable operational records** — invoices, POs, emails, CRM notes, project tasks. These change constantly; on-chain writes cost gas and are immutable.
- **PII and sensitive financial data** — GDPR's right to erasure is incompatible with an immutable ledger. You can't delete on-chain data.
- **Large documents** — legal contracts, spec sheets, lab reports. Storing blobs on-chain is prohibitively expensive.
- **High-frequency data** — inventory counts, real-time pricing, shipment tracking. The chain isn't a database.

But the **hash** of a document, the **reference** to a record, and the **permission grant** to access it? Those belong on-chain.

---

## The DTP Data Vault

A **DTP Data Vault** is an encrypted, structured storage service tied to a NEAR account. The architecture:

```
NEAR Account (acme-foods.near)
├── On-chain (DTP Contract)
│   ├── Party profile, certifications, GLN, reputation
│   ├── Trade history, lot inventory, FSMA CTEs
│   ├── data_vault_uri: "https://vault.dtp.ag/acme-foods.near"  ← on-chain anchor
│   └── Permission grants: which apps can access which data categories
│
└── Off-chain (DTP Vault Service)
    ├── Encrypted at rest; decryption key derived from NEAR keypair
    ├── CRM data (contacts, accounts, interactions)
    ├── Financial records (invoices, POs, payment history)
    ├── ERP data (inventory counts, production orders, BOMs)
    ├── Documents (contracts, COAs, lab reports — content-addressed by hash)
    └── [Future data types added via community schema registry]
```

The key insight: **the NEAR account is the key**. Data is encrypted such that only a holder of the private key can authorize decryption. Even DTP's storage servers see ciphertext only.

---

## "Login with DTP" — The Permission Flow

When a third-party app (an ERP, a CRM, a marketplace) wants access to a business's data:

1. App displays "Login with DTP" button.
2. User signs a challenge message with their NEAR key (same flow as any NEAR transaction).
3. App presents a permission request: *"Acme ERP wants access to your: financial records, inventory data, contacts. This app is DTP-certified."*
4. User approves. A signed permission grant is recorded on-chain.
5. App can now read (and write, if permitted) the specified data categories from the vault.
6. User can revoke access at any time by revoking the on-chain permission grant.

This is OAuth2 backed by cryptographic identity instead of a username/password. No DTP server is in the auth path — the NEAR key pair IS the credential.

```
App                  NEAR Wallet            DTP Contract         Vault
 |                       |                       |                  |
 |─── sign challenge ───>|                       |                  |
 |<── signed message ────|                       |                  |
 |──── verify + request permission grant ──────>|                  |
 |                       |<── user approves ─────|                  |
 |                       |─── sign grant tx ────>|                  |
 |<──────────────────────────── grant recorded ──|                  |
 |──── present grant + signed request ──────────────────────────>  |
 |<──── encrypted data (decryptable by app with user's auth) ─────  |
```

---

## Data Categories and Schema Registry

The vault organizes data into typed categories. Phase 3 launches with canonical schemas for the most common business data types:

| Category | Examples |
|---|---|
| `financial` | Invoices, purchase orders, payment history, AR/AP balances |
| `crm` | Contacts, accounts, interaction history, deals |
| `inventory` | SKUs, stock levels, reorder points, warehouse locations |
| `production` | BOMs, production orders, batch records, yield data |
| `documents` | Contracts, COAs, lab reports, compliance certificates |
| `logistics` | Shipments, carrier bookings, delivery confirmations |

**Schema extensibility** — New data types can be registered via the DTP Schema Registry (an on-chain contract). App developers submit a JSON Schema definition. The DTP community (initially a steering committee, eventually token-weighted governance) votes to add it to the canonical schema list. Apps that implement the schema get access to a shared data type all DTP-compatible apps can read.

This is the difference between proprietary APIs (each app speaks its own language) and a protocol (all apps agree on a shared vocabulary).

---

## Why This Is Phase 3, Not Now

The vault is the right long-term play. Here's why it's Phase 3:

**Phase 1 (now) is the hard constraint.** Food businesses face an FSMA 204 compliance deadline in 2026. That creates urgency and a clear value proposition for the trade protocol and traceability layer. We build that first, because it's the reason someone adopts DTP in the first place.

**Phase 2 is network effects.** The vault is only valuable when there are enough DTP-connected businesses that "Login with DTP" means something. You need the network before you need the vault.

**Phase 3 is the lever.** Once businesses trust DTP with their trade records and certifications, the ask to "also bring your CRM data" is much smaller. Trust is earned sequentially.

Building the vault today would:
- Split focus during the period when focused execution matters most
- Require a different infrastructure team (storage, encryption, key management)
- Need an app ecosystem that doesn't exist yet
- Ask for enterprise data trust before it's been earned

**The architecture we're building now is already the right foundation.** The NEAR account as the root of identity, the `Party` struct as the canonical on-chain record, the `data_vault_uri` field as the on-chain anchor — none of this needs to change. The vault plugs into the identity layer we're building today.

---

## Prior Art and Adjacent Projects

DTP is not the first to attempt decentralized data portability. Understanding what's been tried informs what we build:

| Project | Approach | Current Status |
|---|---|---|
| **Ceramic Network / ComposeDB** | Mutable data streams tied to DIDs; any app can read/write schemas | Active, developer-focused, limited mainstream adoption |
| **Solid (Tim Berners-Lee)** | Personal Online Data Stores; apps request access to your pod | Active, academic traction, limited enterprise adoption |
| **Lit Protocol** | Programmable access control for encrypted off-chain content | Active, good crypto-native adoption |
| **NEAR Social** | On-chain social graph; already does a version of this for social data | Live on NEAR mainnet |
| **Spruce / Sign-In with Ethereum** | DID-based auth + verifiable credentials | Standardized (EIP-4361), moderate adoption |

The pattern works. None have cracked mainstream enterprise adoption because they started with the data layer before earning trust with a core use case. DTP starts with the use case (food trade + FSMA compliance) and builds the data layer on top of earned trust.

---

## Key Design Decisions for Later

When Phase 3 design begins in earnest, these are the decisions that matter most:

1. **Key recovery story** — What happens when a business loses their NEAR private key? Hardware security modules (HSMs) for enterprise key custody. Multi-sig key recovery for smaller businesses. This is the hardest consumer UX problem in crypto and needs a designed solution, not an afterthought.

2. **Storage business model** — Who pays for the servers? Options: subscription per account, per-GB pricing, protocol-level fees on vault-connected transactions. Needs to be sustainable without creating extraction incentives.

3. **Self-hosted vs DTP-hosted** — Larger enterprises may want to run their own vault infrastructure. The `data_vault_uri` field is deliberately a URI, not a DTP-controlled endpoint. Any conforming implementation can host a vault.

4. **Schema governance velocity** — The governance process for new schema types needs to be fast enough to support rapid ecosystem growth. A slow committee process kills developer momentum.

5. **GDPR / right to erasure** — Deleting encryption keys renders data computationally inaccessible (the standard GDPR compliance pattern for encrypted data). The on-chain permission grants themselves are minimal metadata, not PII. This is solvable.

---

## The Moat

The apps built on DTP will have UX as their competitive differentiation. The data portability layer means you can't lock users in at the data layer — so you have to win on product.

This is actually better for the ecosystem. It creates a race to build the best tools for food businesses, not a race to capture data. The protocol benefits from more good apps. Good apps benefit from more DTP-connected businesses. Businesses benefit from competition and portability.

That's the flywheel.
