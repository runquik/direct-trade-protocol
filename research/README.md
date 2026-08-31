# DTP Research: Prior Art in Physical Goods Trade Protocols

A historic log of how the coordination of physical-goods trade has been attempted before — standards, networks, marketplaces, and protocols — with an honest autopsy of what each got right and wrong. The goal is to stand on the shoulders of giants (and learn from the graves) before building further on DTP.

## Methodology

Every dossier follows [TEMPLATE.md](TEMPLATE.md): origin story → mechanics → adoption trajectory → incentive autopsy → what's right → what's wrong → kill conditions → null-hypothesis check → lessons for DTP. Anti-bias guardrails baked in:

- **Survivorship correction** — dead projects get equal or greater coverage than survivors.
- **Incentive autopsy** — who paid, who captured value, who bore integration cost.
- **Kill conditions** — the actual cause of death, not the press-release version.
- **Null hypothesis** — would the trade have happened fine over phone/fax/email anyway?

## Dossiers

Chronological by era:

| # | Dossier | Era | What it covers |
|---|---------|-----|----------------|
| 01 | [EDI: X12 / EDIFACT](dossiers/01-edi-x12-edifact.md) | 1968–present | The 50-year incumbent: transaction sets, VANs, retailer mandates, why it never dies |
| 02 | [XML-era B2B standards](dossiers/02-xml-b2b-standards.md) | 1998–2010 | RosettaNet, ebXML, cXML/PunchOut, UBL/Peppol — the closest prior attempts at a neutral open trade protocol |
| 03 | [GS1, EPCIS & FSMA 204](dossiers/03-gs1-epcis-fsma204.md) | 1973–present | The one standards body that achieved universal adoption; the traceability stack DTP builds on |
| 04 | [Dot-com B2B exchanges](dossiers/04-dotcom-b2b-exchanges.md) | 1998–2002 | ~1,500 marketplaces, near-total extinction — the canonical cautionary tale for neutral matching marketplaces |
| 05 | [Enterprise blockchain trade](dossiers/05-enterprise-blockchain-trade.md) | 2016–2023 | TradeLens, IBM Food Trust, we.trade, Everledger et al. — the consortium-chain graveyard |
| 06 | [Decentralized commerce protocols](dossiers/06-decentralized-commerce-protocols.md) | 2014–present | OpenBazaar, Boson, Beckn/ONDC — protocol-not-platform commerce experiments |
| 07 | [Agent commerce protocols](dossiers/07-agent-commerce-protocols.md) | 2024–present | ACP, AP2, x402, MCP commerce — the wave DTP is entering now |
| 08 | [Food/ag networks & settlement rails](dossiers/08-food-ag-networks-settlement-rails.md) | 1999–present | iTradeNetwork → Silo/ProducePay/Faire; PACA, letters of credit, Trade Assurance — DTP's home turf |

## Synthesis

- [SYNTHESIS.md](SYNTHESIS.md) — cross-cutting patterns, the recurring failure modes, what actually drives adoption, and the design implications for DTP.
- [TIMELINE.md](TIMELINE.md) — one merged timeline of the space, 1968 → 2026.
