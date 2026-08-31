# EDI (ANSI X12 / UN/EDIFACT)

**Era:** 1968–present (standards formalized 1975–1987; still dominant)
**Status:** dominant
**One-line:** Machine-readable standard business documents (PO, ship notice, invoice) exchanged computer-to-computer between trading partners, originally over Value-Added Networks, now mostly over the internet — the coordination backbone of physical-goods B2B trade for 50 years.

## 1. Origin Story

EDI is a military-logistics idea that escaped into commerce. During the 1948 Berlin Airlift, U.S. Army logistics officer Edward A. Guilbert and colleagues built a system of standardized shipping manifests transmitted by radio-teletype and telephone so that inbound cargo to West Berlin could be processed before the plane landed. Guilbert carried the idea into civilian freight: in 1965 the Holland-America steamship line was sending trans-Atlantic shipping manifests by telex (a full page in ~2 minutes, converted to tape and loaded onto computers), and in 1968 the Transportation Data Coordinating Committee (TDCC) was formed — rail, motor, ocean, and air carriers — to standardize inter-company electronic messages. Guilbert led TDCC for 19 years and is remembered as the "Father of EDI." TDCC published the first true EDI standards in 1975.

What trade coordination looked like *before*: every document (purchase order, bill of lading, invoice) was typed, mailed or couriered, re-keyed on receipt, reconciled by hand, and errored constantly. A freight movement could generate dozens of paper documents, each re-keyed multiple times. The pain that drove EDI was not "no communication" — phone and paper worked — it was **re-keying cost, error rates, and latency** at industrial scale.

Two parallel formalizations followed:

- **ANSI X12 (1979):** ANSI chartered Accredited Standards Committee X12 to generalize TDCC's transportation work into cross-industry standards for North America. X12 has since sponsored 300+ transaction sets spanning supply chain, transportation, finance, insurance, and healthcare, maintained by ~3,000 experts from 600+ member companies.
- **UN/EDIFACT (1987):** Europe had its own lineages (UNTDI/GTDI under UNECE). In 1987, following convergence of the UN and US/ANSI *syntax* proposals, the UN/EDIFACT syntax rules were approved as ISO 9735. EDIFACT became the international/European standard, governed today by UN/CEFACT under the UN Economic Commission for Europe. The two never merged at the message level: X12 rules North America; EDIFACT rules Europe and most global trade. A late-1990s X12/EDIFACT Alignment Plan aimed to coalesce them into one global standard; it never happened — installed base won.

Industry subsets appeared where verticals wanted tighter conventions: for grocery, the **Uniform Communication Standard (UCS)** — design work started 1976, introduced ~1980, first live use ~1982, administered from 1983 by the Uniform Product Code Council (the barcode people, now GS1 US). The grocery industry thus standardized *identity* (UPC) and *messaging* (UCS) under the same roof — a pairing DTP replicates with GLN + protocol messages.

## 2. Mechanics

**Message format.** EDI documents are delimited, positional text records designed for 1970s bandwidth. An X12 interchange nests: ISA/IEA envelope → GS/GE functional group → ST/SE transaction set → segments → elements. EDIFACT is analogous (UNB interchange, UNH message, segments, composites, elements drawn from the UN Trade Data Element Directory). Terse by design: `N1*ST*WALMART DC 6094*UL*0078742000992` is a ship-to party with a GS1 GLN.

**Key transaction sets (X12) — the de facto state machine of a trade:**

| Set | Name | Role in the flow |
|---|---|---|
| 850 | Purchase Order | Buyer's committed order (≈ DTP contract formation, *not* intent) |
| 855 | PO Acknowledgment | Seller accepts / rejects / modifies line items |
| 856 | Advance Ship Notice (ASN) | Hierarchical shipment/order/pack/item manifest, sent before truck arrives |
| 810 | Invoice | Seller's request for payment |
| 812 | Credit/Debit Adjustment | Deductions, chargebacks, price adjustments |
| 997 | Functional Acknowledgment | "I received and could parse your file" — receipt, not agreement |

Note what this state machine is: **order → acknowledgment → shipment manifest → invoice → adjustment.** There is no discovery layer (no "intent" or "listing" — partners are pre-established by contract), no matching, no settlement (payment runs separately through ACH/checks, reconciled painfully via the 812/820), and no native identity (partners are identified by ISA qualifier/ID pairs — DUNS numbers, GS1 identifiers, or phone numbers — assigned bilaterally).

**Identity model.** Bilateral and out-of-band. Every partner pair exchanges a "trading partner agreement" (a legal document) plus implementation guides specifying exactly which segments/qualifiers the hub requires. The same 850 differs between Walmart, Kroger, and Target — the standard is a *grammar*, and each hub speaks its own *dialect*. This is the single largest ongoing cost of EDI.

**Transport.**
- **VAN era (1970s–2000s):** Value-Added Networks (GEIS, Sterling, IBM, later GXS/OpenText) operated store-and-forward mailboxes. You dialed in, dropped files, and the VAN routed them to your partner's mailbox — including across VAN interconnects. VANs billed per **kilocharacter** (per 1,000 characters transmitted, historically $0.05–$0.30+/KC), plus mailbox fees, setup fees, per-partner fees, and interconnect charges. Both sender and receiver paid — you paid to send and your counterparty paid to receive the same bytes.
- **AS2 era (2002–):** AS2 (Applicability Statement 2) wraps EDI payloads in signed, encrypted HTTP with signed receipts (MDNs) — non-repudiable delivery over the open internet, no per-character toll. On September 9, 2002, Walmart announced it was moving supplier connectivity to AS2 (using software from the small vendor iSoft) and required its entire supplier base to follow. Meijer, Kohl's, Home Depot, and Lowe's followed quickly. Today Walmart requires *direct AS2 — no VAN intermediaries accepted*. This was catastrophic for VAN economics and is the canonical example of a hub unilaterally re-platforming an ecosystem's transport layer while keeping the message layer intact.

**Governance.** X12: an ANSI-accredited committee, subcommittees per domain, dues-paying corporate members, ~annual version releases (still versioned like 004010, 008010) — with the crucial property that *hubs choose when to upgrade*, so 1997-era version 4010 remains the most-used release decades later. EDIFACT: UN/CEFACT working groups, directories published twice a year. Both are open standards with paid access to full specs — genuinely neutral, glacially slow, and nobody is forced to use any particular version.

## 3. Adoption Trajectory

- **1965–1975:** carrier experiments (telex manifests); TDCC standards 1975.
- **1979–1990:** X12 chartered; verticals build subsets (UCS grocery ~1982, ORDERNET pharma, ODETTE autos in Europe). Adoption is hub-driven from the start: automakers, railroads, then big retail. In the UK, major retailers held mandatory supplier seminars where "EDI was now a condition of trade."
- **1990s:** "Quick Response" retail and JIT manufacturing make EDI a prerequisite for shelf space. Kmart, Sears, JCPenney, Walmart all mandate. Academic adoption research from this era consistently finds *coercive pressure from customers* — not internal ROI — is the main determinant of small-supplier adoption.
- **2002–2010:** Walmart's AS2 mandate moves transport to the internet; VAN industry consolidates (GXS absorbs IBM's and others' networks, later bought by OpenText). Meanwhile ebXML (2001) and industry XML efforts predicted EDI's death; they failed — installed base, sunk mapping investments, and "it works" inertia won.
- **Today:** EDI is the *majority* of B2B digital commerce: 78.4% of all U.S. B2B electronic sales ($7.0 trillion) in 2019, still >75% in 2021 though growing slowest of all digital channels (8.3%). Estimates put 160,000+ businesses on EDI globally processing 23+ billion transactions/year; the EDI market is valued around $34–40B (2024). SPS Commerce — the largest pure-play retail EDI network — reports ~$751M revenue (96% recurring) and 115,000+ connected businesses. In food specifically, GS1 US has published guidance mapping the X12 856 ASN onto FSMA 204 shipping Critical Tracking Events, and networks like iTradeNetwork sell FSMA 204 compliance modules on top of their EDI/order-management rails — food traceability is being retrofitted onto the 856 rather than replacing it.

Plateau shape: essentially 100% of large-retailer volume, but adoption *stops at the first tier*. Retailers forced EDI onto their direct suppliers; those suppliers rarely extended EDI upstream to *their* suppliers, so second-tier trade (very much including farm-level food & ag) still runs on phone/email/spreadsheet.

## 4. Incentive Autopsy

- **Who paid for it?** Overwhelmingly the spokes. Hubs (retailers, automakers) paid once for their own EDI infrastructure and amortized it over thousands of partners; every spoke paid setup ($1,000–$5,000 per partner with legacy providers), per-partner mapping ($200–$2,000, plus $500–$2,000 per mapping *change* when the hub revises its spec), VAN/network fees, and often $30K–$100K first-year total for a modest multi-partner setup. In the VAN era both sides also paid per kilocharacter for the same message. The hub then charged the spoke *again* for imperfect compliance: ASN (856) errors generate more penalties than any other document — roughly $50/PO at CVS up to $1,000/shipment at Home Depot; Amazon deducts 2–6% of product cost on a tiered ASN-accuracy schedule. EDI compliance is a profit center for hubs.
- **Who captured the value?** Hubs captured nearly all operational value (automated receiving, JIT inventory, deduction revenue). VANs captured rent on the pipe for ~25 years. The consultant/provider ecosystem (SPS, TrueCommerce, and hundreds of smaller shops) captures a permanent service annuity created by dialect fragmentation — SPS's 96%-recurring revenue *is* the monetized gap between "standard" and "what each hub actually requires."
- **Who bore the integration cost?** Spokes, per-hub, forever. Because every hub publishes its own implementation guide, the N-partner integration problem never collapsed to "integrate once." A small food supplier selling to five retailers does five map sets, five certification/testing cycles (legacy onboarding: 4–8 weeks per partner), and five ongoing change streams.
- **Middleman problem?** EDI's pitch was disintermediating *paper and re-keying*, not middlemen. But it minted new ones twice: first VANs (tollbooth on every character, interconnect fees between networks), then — after AS2 killed the per-character toll — managed-service networks that sell the *complexity* as a service. The middleman moved up the stack from transport to translation/onboarding. Each generation of "EDI simplifiers" (VANs → web-EDI portals → SPS/TrueCommerce → Stedi/Orderful APIs) is a new intermediary monetizing the same unfixed root cause: no canonical machine-verifiable semantics and no shared identity/discovery layer.

## 5. What's Right

- **Standardize the document, not the software.** X12/EDIFACT are pure wire formats — platform-, vendor-, and transport-agnostic. That neutrality is why they outlived every proprietary network, every "EDI killer," and several generations of transport. A 1980s 850 concept still parses in 2026 systems.
- **The transaction-set decomposition is correct.** Order / acknowledgment / ship-notice / invoice / adjustment is a genuinely accurate model of physical-goods trade. The 856 ASN in particular — a hierarchical shipment→order→pallet→case→item manifest sent *before* arrival, keyed by GS1 identifiers — is so right that the FDA-era food traceability regime (FSMA 204 CTEs) is being mapped onto it. DTP's delivery-attestation and CTE layers should treat 856 semantics as the incumbent ontology to interoperate with, not reinvent.
- **Functional acknowledgments (997).** Separating "I received and parsed it" from "I agree to it" (855) is a protocol-hygiene decision every trade protocol should copy.
- **Neutral, open governance survived.** An ANSI committee and a UN body outlasted every for-profit network that carried their messages. No token, no rent at the standards layer.
- **Riding external identity (DUNS, GS1 UPC/GLN)** rather than minting its own party registry — and grocery co-locating identity (UPC) and messaging (UCS) governance under one body — reduced fragmentation where it was tried.
- **AS2's receipt model:** signed MDNs give cryptographic non-repudiation of delivery over untrusted transport — a 2002-era precursor of what on-chain attestation does better.

## 6. What's Wrong / Failure Modes

- **Standard-as-grammar, not standard-as-semantics.** X12 defines *how* to say things, not *what must be said*; every hub's implementation guide is a proprietary dialect. Result: the integration cost is O(partners), not O(1), and a permanent service industry monetizes the gap. This is EDI's original sin.
- **No discovery, no matching, no price formation.** EDI only automates trade between parties who already found each other and signed paper agreements. It digitized the *execution* of relationships, never their *formation* — which is exactly the layer DTP's intent/listing/matching primitives target.
- **No settlement.** Money moves out-of-band; the 810/812/820 reconciliation loop is where deduction disputes fester for months. The absence of coupled settlement is why chargebacks became a hub profit center.
- **Asymmetric economics froze adoption at tier one.** Spokes adopt at gunpoint, get little internal value (many run "rip and re-key" — printing EDI orders and typing them into their own systems, destroying the whole point), and therefore never push EDI upstream. Whole tiers of the supply chain — including most of farm-level food & ag — remain manual.
- **Batch, asynchronous, eventually-consistent.** Mailbox/file semantics mean no shared state: both sides hold divergent copies of "the order," and a huge reconciliation industry exists because the protocol has no single source of truth.
- **Version fossilization.** Because hubs control upgrade timing, the ecosystem froze on decades-old versions; the standard evolves but the network doesn't.
- **Human-hostile tooling** kept per-seat costs high and made EDI expertise a priesthood — the opposite of agent-native.

## 7. Kill Conditions

EDI has survived every predicted death (proprietary portals, ebXML/XML 2001, RosettaNet, "APIs will kill EDI" 2015–present). What keeps it alive:

1. **Two-sided switching costs:** replacing EDI requires every hub *and* every spoke to move; hubs have no incentive (it works, and compliance fees are revenue).
2. **Sunk mapping capital:** decades of encoded business rules, amortized to near-zero marginal cost for incumbents.
3. **The standard is transport-independent,** so each infrastructure revolution (internet, cloud, APIs) gets absorbed as a new carrier for the same payloads rather than a replacement — Stedi and Orderful ultimately emit X12 because that's what the hub accepts.

What would actually kill it: a critical mass of *hubs* mandating a successor (the only mechanism that has ever moved this ecosystem — see Walmart/AS2), most plausibly triggered by regulation (e.g., e-invoicing mandates in Europe are forcing structured-XML rails today) or by hubs concluding that agent-mediated commerce needs richer semantics than a 4010 850 can carry. A protocol that only recruits spokes will never kill EDI.

## 8. Null Hypothesis Check

Would trade have happened fine without EDI? Yes — and for most of the world's small-business trade, it still does, on phone/fax/email/spreadsheet. What EDI actually added over those channels: elimination of re-keying (error rates and clerical headcount), latency compression (order-to-ship cycles measured in hours, enabling JIT and Quick Response retail), and pre-arrival shipment data (the ASN) that makes cross-docking and automated receiving physically possible. For *hubs at volume*, that paid for itself many times over — Walmart's logistics model is not operable by fax. For a *low-volume spoke*, the null hypothesis frequently wins: EDI costs more than the manual process it replaced, which is precisely why adoption required coercion and why "rip and re-key" persists. The honest summary: EDI's value is real but scales with volume and concentration; below a volume threshold it is a compliance tax, not a tool. Any successor protocol must be cheaper than email *at one order per week*, or it will need mandates too.

## 9. Lessons for DTP

**Steal:**

1. **Be a wire standard, not a platform.** EDI's 50-year survival comes from platform-agnosticism and transport-independence. DTP's "platform-agnostic, no native token" stance is the proven posture; guard it from anything that makes DTP itself the rent-collecting network.
2. **Adopt the 856/CTE ontology, don't fight it.** GS1 US already maps 856 ASN fields to FSMA 204 shipping CTEs. DTP's delivery attestation should be losslessly translatable to/from an 856 (and its CTEs to GS1 EPCIS), so incumbent-connected buyers can bridge — interoperability with the installed base is how new rails actually onboard hubs.
3. **Separate receipt from agreement** (997 vs 855): DTP messages need distinct "received/parseable," "accepted," and "fulfilled" acknowledgment semantics.
4. **Ride external identity** — EDI's use of DUNS/GS1 IDs was right; DTP's NEAR account carrying GLN/DUNS/KYB is the same move with verifiability added.
5. **Close EDI's two open flanks — formation and settlement.** EDI never did discovery/matching/price formation and never coupled money to messages; those absences created the reconciliation and chargeback industries. DTP's intent→match→contract→escrow→settlement loop is exactly the layer EDI proved is missing. Coupled escrow settlement is DTP's strongest differentiator: it makes the deduction/dispute economy structurally impossible rather than incrementally better.

**Avoid:**

6. **Never allow dialects.** The fatal flaw was hub-specific implementation guides. DTP must make conformance machine-verifiable (schema + semantic validation at the protocol level) and forbid per-hub required-field variants; extensions must be additive and namespaced, never redefinitions. If integrating with partner N+1 costs more than ~zero, DTP has recreated EDI's service-industry tax.
7. **Don't price like a VAN.** Per-message/per-character/per-partner tolls, both-sides-pay, and paid spec access all suppressed spoke adoption and invited disintermediation the moment a cheaper transport appeared. Non-extractive, hub-weighted (or free-for-spokes) economics is not generosity — it's the adoption strategy EDI's history demands.
8. **Design for the spoke's ROI at low volume.** EDI adoption was coerced because spokes got negative value. A small produce supplier must get standalone value from DTP (faster payment via escrow, portable reputation, one-time onboarding) *before* any buyer mandates it — otherwise DTP inherits the tier-one plateau and never reaches the farm.
9. **Plan for hub-led ignition anyway.** Every transition this ecosystem has ever made (UCS, X12, AS2) was driven by hubs/mandates, and regulation (FSMA 204 — original Jan 2026 compliance date, though enforcement is now statutorily barred until July 20, 2028; see dossier 03) remains a forcing function, with retailer mandates (e.g. Walmart's chargeback-backed traceability program) doing the near-term forcing. DTP's wedge: be the cheapest possible way for a mid-size food buyer to get FSMA 204 CTE compliance *and* settlement in one integration.
10. **Version with network upgrade in mind.** X12 froze on version 4010 for 25 years because upgrades were bilateral. DTP needs protocol-level version negotiation and backwards-compatible evolution, or it will fossilize the same way.

## Sources

- [EDI History (Logicbroker)](https://blog.logicbroker.com/blog/2013/08/19/edi-history) — Berlin Airlift, 1965 Holland-America telex, TDCC 1968, first standards 1975
- [EDI's Connection to the 1948 Berlin Airlift (BOLD VAN)](https://www.boldvan.com/blog/electronic-data-interchanges-connection-to-the-1948-berlin-airlift-a-history-lesson) — Guilbert's radio-teletype manifest system
- [Father of EDI: Edward A. Guilbert (EDI Library)](https://edilibrary.wordpress.com/2016/08/29/father-of-edi-army-master-sargent-edward-a-guilbert/) — Guilbert's 19 years leading TDCC
- [A Brief History of Electronic Data Interchange (Information Builders)](https://iwayinfocenter.informationbuilders.com/TLs/TL_soa_ebiz_edix12/source/intro_edix9.htm) — ANSI recognition 1975, X12 accreditation 1979
- [ASC X12 (Wikipedia)](https://en.wikipedia.org/wiki/ASC_X12) — chartered 1979, 300+ transaction sets, 600+ member companies, TDCC predecessor
- [EDIFACT (Wikipedia)](https://en.wikipedia.org/wiki/EDIFACT) — 1987 syntax convergence, ISO 9735, UN/CEFACT governance, message structure
- [UN/EDIFACT (Encyclopedia.com)](https://www.encyclopedia.com/economics/encyclopedias-almanacs-transcripts-and-maps/unedifact) — X12/EDIFACT Alignment Plan and failed harmonization
- [Uniform Communication Standard (Wikipedia)](https://en.wikipedia.org/wiki/Uniform_Communication_Standard) — UCS as grocery subset of X12, design start 1976, first use ~1982
- [Making EDI Come Across (Supermarket News)](https://www.supermarketnews.com/grocery-operations/making-edi-come-across) — UCS introduced 1980, grocery expectations
- [ANSI X12 Message Standard (SEEBURGER)](https://www.seeburger.com/resources/good-to-know/what-is-ansi-x12) — 810/850/856/997 transaction sets, 275+ sets
- [Common EDI VAN Fees Explained (NexusVAN)](https://www.nexusvan.com/post/common-edi-van-fees-explained-whats-legitimate-whats-not-and-how-to-read-your-bill-like-a-pro) — KC rates $0.10–$0.30, mailbox $50–$200/mo, setup $500–$5,000, per-partner fees
- [What is an EDI Kilo-Character? (Crisp)](https://www.gocrisp.com/learning-center/operations-supply-chain/what-is-an-edi-kilo-character) — kilocharacter pricing model and origins
- [EDI Cost Comparison: KC vs Trading Partner Pricing (BOLD VAN)](https://www.boldvan.com/blog/edi-cost-comparison-kilocharacter-pricing-vs-trading-partner-pricing-explained) — VAN pricing economics
- [AS2 and Internet EDI – Nine Years Later (OpenText)](https://blogs.opentext.com/as2-and-internet-edi-nine-years-later/) — Walmart Sept 9 2002 announcement, iSoft, VAN impact, Meijer/Kohl's/Home Depot/Lowe's followers
- [Why Walmart Prefers AS2 (Aayu Technologies)](https://aayutechnologies.com/blog/why-walmart-prefers-as2-for-edi-transactions/) — AS2 mandate mechanics
- [Walmart EDI Requirements 2026 (BOLD VAN)](https://www.boldvan.com/blog/walmart-and-edi-what-you-need-to-know-to-become-a-supplier) — direct AS2 required today, no VANs accepted
- [The Forgotten Message (AdvanceFirst)](https://advancefirst.com/the-forgotten-message-that-costs-industry-millions-or-is-it-billions/) — UK retailers making EDI "a condition of trade"; upstream adoption never happened
- [Determinants of EDI Adoption and Integration (Kobe University RIEB)](https://www.rieb.kobe-u.ac.jp/academic/ra/dp/English/dp129.PDF) — customer/coercive pressure as primary adoption driver
- [8 EDI Compliance Errors That Trigger Chargebacks (Orderful)](https://www.orderful.com/blog/edi-compliance-errors-retailer-chargebacks) — ASN as highest-penalty document, error taxonomy
- [How to Avoid EDI Chargebacks (Crstl)](https://www.crstl.ai/blog/how-to-avoid-edi-chargebacks) — CVS ~$50/PO to Home Depot $1,000/shipment; Amazon 2–6% tiered ASN accuracy deductions
- [EDI Pricing Guide (Orderful)](https://www.orderful.com/blog/edi-pricing-guide) — legacy setup $1,000–$5,000/partner, first-year $30K–$100K, mapping change fees, 4–8 week onboarding vs 9 days
- [How Much Does EDI Cost? (iHateEDI)](https://ihateedi.com/how-much-does-edi-cost/) — integrated setup $8K–$12K, translator and mapping cost ranges
- [EDI Still Accounts for the Lion's Share of B2B Digital Sales (Digital Commerce 360)](https://www.digitalcommerce360.com/2022/02/15/edi-still-accounts-for-the-lions-share-of-b2b-digital-sales/) — 78.4% / $7.0T of B2B electronic sales (2019); >75% in 2021, slowest growth at 8.3%
- [Electronic Data Interchange Market (IMARC Group)](https://www.imarcgroup.com/electronic-data-interchange-market) — global EDI market ~$40B (2024), growth projections
- [EDI Market Size (Insight Partners via Yahoo Finance)](https://finance.yahoo.com/news/electronic-data-interchange-market-size-153000783.html) — $34B (2024), 160,000+ businesses, 23B+ transactions/year
- [Best EDI Software Providers (Cleo)](https://www.cleo.com/blog/best-edi-software-providers) — SPS Commerce ~$751M revenue, 96% recurring, full-service model, 115,000+ business network
- [Orderful's Series C (FreightWaves)](https://www.freightwaves.com/news/orderful-35m-series-c-edi) — Orderful cloud/JSON model targeting the EDI service model
- [Stedi Raises $50M Series C (Ventureburn)](https://ventureburn.com/stedi-raises-50m-series-c-to-modernize-healthcare-edi/) — Stedi's API-first / usage-priced model and healthcare-clearinghouse pivot
- [X12 EDI for Startups: Vendor Comparison (IntuitionLabs)](https://intuitionlabs.ai/articles/x12-edi-vendors-startups) — Stedi/Orderful funding and pricing vs legacy VANs
- [FSMA 204 Food Traceability Rule (TrueCommerce)](https://www.truecommerce.com/blog/fsma-food-traceability-rule/) — GS1 US guidance mapping X12 856 ASN to FSMA 204 shipping CTEs; cites the original Jan 20, 2026 compliance date (enforcement since delayed to 2028 — see dossier 03)
- [FSMA 204 Traceability: Do You Need EDI? (BOLD VAN)](https://www.boldvan.com/fsma) — EDI's role in FSMA 204 data exchange
- [FSMA 204 Compliance (iTradeNetwork)](https://www.itradenetwork.com/resources/fsma-204-compliance-made-simple) — FSMA ASNs via EDI on produce industry's dominant order-management network
- [What is ebXML (TechTarget)](https://www.techtarget.com/searchcio/definition/ebXML) — the XML-based would-be EDI successor
- [Is EDI Dead? (TranzAct)](https://blog.tranzact.com/is-edi-dead) — the perennial death prediction and why it fails
