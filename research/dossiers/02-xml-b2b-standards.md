# XML-Era B2B Integration Standards (RosettaNet, ebXML, cXML/PunchOut, OBI, UBL, OAGIS)

**Era:** ~1997–2010 (design/hype window); survivors still active in 2026
**Status:** mixed — cXML: dominant in procurement niche | UBL/Peppol: active and growing (mandate-driven) | RosettaNet: niche/zombie (high-tech verticals, folded into GS1 US) | ebXML: mostly dead, with one surviving organ (ebMS3/AS4 messaging) | OBI: dead | OAGIS: niche (app-to-app integration)
**One-line:** The first-generation attempt to replace EDI-over-VAN with open, XML-based, internet-native protocols for inter-company trade — a wave of consortium "grand designs" of which only the pragmatic vendor format and the government-mandated format achieved mass adoption.

## 1. Origin Story

**The pain.** By the mid-1990s, large-company B2B ran on EDI (ANSI X12 in the US, EDIFACT in Europe) transmitted over expensive Value-Added Networks (VANs) charging per-kilocharacter fees. EDI worked but: (a) setup cost thousands of dollars per trading-partner connection, so only ~high-volume relationships justified it; (b) 80%+ of most companies' suppliers — the SME long tail — stayed on phone/fax; (c) EDI encoded *documents*, not *processes* — no shared state machine, no standard for "what happens after the PO is rejected." The internet + XML (W3C recommendation, Feb 1998) promised cheap transport and self-describing messages, and everyone raced to define the trade layer on top.

**The wave, in order of appearance:**

- **OAGIS (1995):** Open Applications Group, a consortium of ERP vendors, defined Business Object Documents (BODs) — canonical noun+verb messages ("ProcessPurchaseOrder", "SyncItemMaster") originally for application-to-application integration inside and between enterprises ([Cover Pages](https://xml.coverpages.org/oag.html)).
- **OBI (1996–97):** The Internet Purchasing Roundtable — Fortune 500 buyers (American Express, Ford, GE, Home Depot, United Technologies) and their suppliers — published Open Buying on the Internet v1.0 in May 1997 for high-volume, low-dollar MRO purchasing ([FreeLibrary](https://www.thefreelibrary.com/Business-to-Business+Purchasing+On+the+Internet:+The+OBI+Standard.-a063609721), [spec PDF](https://sep.turbifycdn.com/ty/cdn/vw/OBIv210.pdf)).
- **RosettaNet (1998):** Founded by ~40 IT-industry heavyweights (Intel, HP, IBM, Microsoft, Cisco, Toshiba…) under founding CEO Fadi Chehadé, to standardize entire inter-company *processes* (not just documents) for the electronics/semiconductor supply chain ([Wikipedia](https://en.wikipedia.org/wiki/RosettaNet), [Computerworld](https://www.computerworld.com/article/1725842/rosettanet.html)).
- **cXML (1999):** Ariba, a procurement-software vendor, published commerce XML as a lightweight DTD-based protocol so suppliers could plug catalogs and order flows into Ariba's buyer-side software — deliberately cheaper and simpler than EDI ([cxml.org](https://cxml.org/), [TradeCentric](https://tradecentric.com/blog/what-cxml/)).
- **ebXML (1999–2001):** UN/CEFACT (the UN body behind EDIFACT) + OASIS launched an 18-month program to design a *complete* global e-business infrastructure: messaging, registries, partner agreements, process schemas, core components — "a global electronic marketplace where enterprises of any size... can find each other and conduct business" ([Wikipedia](https://en.wikipedia.org/wiki/EbXML), [ebXML Requirements](https://xml.coverpages.org/ebXML-Reqspc06.html)).
- **UBL (2001–2004):** After ebXML shipped no standard document library, OASIS chartered Universal Business Language to build one (invoice, order, despatch advice…) using ebXML Core Components methodology; UBL 1.0 ratified Nov 2004, 2.0 in 2006, 2.1 in 2013 ([OASIS UBL TC](https://www.oasis-open.org/committees/tc_home.php?wg_abbrev=ubl)).

**Before:** phone, fax, mailed POs, and bilateral EDI for the biggest relationships. The whole wave was an attempt to make the *mid- and long-tail* of trade relationships machine-readable.

## 2. Mechanics

Mapped against DTP's pipeline (intent → match → contract → escrow → attestation → settlement → traceability):

### RosettaNet — the process state-machine approach
- **PIPs (Partner Interface Processes):** each PIP is a specified two-party mini-state-machine: choreography (who sends what, in what order), message schemas, time-outs, retry counts, non-repudiation requirements, and failure handling. Organized into clusters/segments: Cluster 2 (product info), Cluster 3 (order management — e.g., PIP 3A4 "Request Purchase Order", 3B2 "Advance Shipment Notification"), Cluster 4 (inventory/forecast collaboration), etc. First PIPs published 1999; the library grew toward ~100+ processes ([CData](https://arc.cdata.com/resources/mft/rosettanet.rst), [Commport](https://www.commport.com/rosettanet-edi-standard/)).
- **RNIF (RosettaNet Implementation Framework):** the transport envelope — packaging, signing, sync/async transfer over HTTPS. Later, RosettaNet also profiled ebMS and Web Services as carriers.
- **Dictionaries:** RosettaNet Technical Dictionary + Business Dictionary — controlled vocabulary for products and business properties, aligned to GS1 identifiers (DUNS for parties, GTIN for products) — an early "portable identity + product ontology" layer.
- **Coverage of DTP pipeline:** contract-execution and fulfillment messaging plus some forecast/"intent" collaboration (Cluster 4). **No discovery/matching, no settlement, no escrow** — payment stayed in the banking system; RosettaNet only carried the documents around it.

### ebXML — the grand full-stack vision
Five layers, later ISO 15000 parts ([Wikipedia](https://en.wikipedia.org/wiki/EbXML)):
1. **ebMS** (Messaging Service): SOAP-with-attachments-based reliable, signed messaging — the plumbing.
2. **Registry/Repository (ebRIM/ebRS):** a global registry where any company publishes its capabilities and artifacts; partners *discover* each other there.
3. **CPP/CPA:** Collaboration Protocol Profile (machine-readable declaration of what processes/transports/certs a company supports) and Collaboration Protocol Agreement (the intersection of two CPPs = a machine-negotiated trading agreement) ([OASIS CPPA](https://www.oasis-open.org/standard/ebxmlcppa/)).
4. **BPSS:** Business Process Specification Schema — declarative definition of binary collaborations (state machines, like PIPs but generic).
5. **Core Components (CCS):** semantic building blocks from which document schemas are assembled.
- **Coverage of DTP pipeline:** on paper, everything pre-settlement: discovery (registry), agreement formation (CPP→CPA), contract execution (BPSS + ebMS). In practice only ebMS shipped widely. This is the closest 1999-era analog to DTP's "intent → match → contract" — including the idea of machine-negotiated agreements between strangers.

### cXML / PunchOut — the pragmatic vendor format
- Simple DTD-defined request/response documents over HTTP POST: `PunchOutSetupRequest` (buyer's procurement app launches an authenticated shopping session on the supplier's web store; the cart is returned as a `PunchOutOrderMessage`), `OrderRequest`/`ConfirmationRequest`, `ShipNoticeRequest`, `InvoiceDetailRequest`. Shared-secret or credential-based auth via DUNS/NetworkID ([cXML User's Guide](https://xml.cxml.org/current/cXMLUsersGuide.pdf), [Anglera](https://www.anglera.com/glossary/cxml-commerce-xml)).
- **Coverage:** catalog/discovery (PunchOut is effectively "browse the supplier's live offer"), order, fulfillment, invoice. No escrow, no settlement, no registry — identity and routing were provided by the **Ariba Network**, a hub operated by the vendor.

### OBI — the minimal bridge
- Architecture: buyer's system holds requisitioner profiles; the *supplier* hosts the catalog; the order itself was an **EDI 850 wrapped in an OBI envelope over HTTPS**, with X.509 certificates for identity and SSL for transport ([OBI spec](https://sep.turbifycdn.com/ty/cdn/vw/OBIv210.pdf), [uni-kl PDF](http://wwwlgis.informatik.uni-kl.de/cms/fileadmin/courses/ss2007/Informationssysteme/addons/OpenBuyingOnTheInternet.pdf)). Payment via P-cards. OBI basically invented the PunchOut pattern (supplier-hosted catalog) but froze the payload as EDI.

### UBL — the document library that found a delivery network
- A complete XML vocabulary (65+ document types by 2.1: Order, Invoice, DespatchAdvice, ReceiptAdvice…) with a reusable common library, free to implement ([OASIS UBL](https://www.oasis-open.org/committees/tc_home.php?wg_abbrev=ubl)).
- **Peppol** (Pan-European Public Procurement On-Line, 2008-) supplied what UBL lacked: a *network* — a four-corner model (sender → Access Point → Access Point → receiver), a directory (SMP/SML for participant discovery), AS2-then-AS4 transport, and a governance body (OpenPeppol). UBL 2.1 is the canonical syntax of EN 16931, the EU e-invoice semantic norm ([VATupdate](https://www.vatupdate.com/2026/05/25/understanding-eu-e-invoicing-en-16931-ubl-cii-and-national-syntaxes/), [Peppol AS4 profile](https://docs.peppol.eu/edelivery/as4/specification/)).

### OAGIS — the integration vocabulary
- BODs = ApplicationArea (routing/metadata) + DataArea (verb + noun). Hundreds of them (434 in release 9.0; 494 in 9.2, including ISA-95 manufacturing BODs) ([Control Engineering](https://www.controleng.com/494-bods-business-object-documents-in-oagis-release-9-2/)). Adopted *inside* products (IBM WebSphere/HCL Commerce, Oracle, Infor) as their canonical message model rather than *between* strangers ([HCL](https://help.hcl-software.com/commerce/9.1.0/webservices/concepts/cwvoagis.html), [Oracle](https://docs.oracle.com/en/cloud/paas/application-integration/integration-b2b/open-applications-group-support.html)).

**Identity models across the wave:** all of them leaned on pre-existing identifier registries — DUNS numbers, GS1 GLN/GTIN — plus X.509 certs for authentication. None created a *portable, self-sovereign* business identity; identity always resolved to a paid registry (D&B) or a hub account (Ariba NetworkID).

## 3. Adoption Trajectory

- **RosettaNet:** grew to ~500 member companies; strong in semiconductor/electronics and in Asia (Taiwan, Malaysia, Singapore, Japan ran government-backed adoption programs). Intel is the flagship datapoint: ~10% of customer/supplier transactions ≈ **$5B through RosettaNet in 2002**, later **>$18B in standards-based transactions** and $44M in measured B2B value ([Computerworld](https://computerworld.com/article/2580296/intel-does--5b-in-transactions-through-rosettanet.html)). Malaysia paid **50–70% matching grants** for RosettaNet implementations and gave tax deductions to MNCs helping SMEs onboard ([ProQuest](https://www.proquest.com/docview/228292882), [UCI/Malakooty case study](https://escholarship.org/content/qt7wd45496/qt7wd45496_noSplash_e4b82e683545a06ef33fb1e2b1543784.pdf)). It became a subsidiary of the Uniform Code Council/GS1 US in 2002ff and its standalone standards site was wound down by end of 2013 ([Wikipedia](https://en.wikipedia.org/wiki/RosettaNet)). Never escaped its home vertical; Europe stayed on EDIFACT.
- **ebXML:** 18 months of work (1999–2001), five ISO 15000 parts — then fragmentation. The registry saw almost no public deployment (the parallel UDDI public Business Registry, run by IBM/Microsoft/SAP, was shut down in Jan 2006 after accumulating unmoderated junk — the definitive verdict on public B2B registries of that era: [InfoWorld](https://www.infoworld.com/article/2215182/microsoft-ibm-sap-discontinue-uddi-registry-effort.html), [Lemire](https://lemire.me/blog/2005/12/19/ibm-uddi-shut-down/)). CPA machine-negotiation essentially never happened in the wild; academic literature by 2002 already noted adoption "slow or limited contrary to expectations," confined to large firms ([IEEE](https://ieeexplore.ieee.org/document/995093/)). **Exception:** ebMS messaging survived — ebMS3/AS4 became ISO 15000-1/-2 and is today the transport of EU eDelivery and the Peppol network ([EC eDelivery AS4](https://ec.europa.eu/digital-building-blocks/sites/spaces/DIGITAL/pages/845480153/eDelivery+AS4+-+2.0), [Peppol AS4](https://docs.peppol.eu/edelivery/as4/specification/)).
- **cXML:** won procurement de facto. Rode the Ariba Network's growth (Ariba acquired by SAP in 2012 for $4.3B; the network — now SAP Business Network — connects millions of suppliers and transacts trillions of dollars annually). cXML remains the default PunchOut/PO/invoice protocol across e-procurement platforms (Coupa, Jaggaer, Oracle all speak it) ([cxml.org](https://cxml.org/), [TradeCentric](https://tradecentric.com/blog/what-cxml/)).
- **OBI:** adopted by its own founders (AmEx, Ford, GE…), then quietly died around 2001 as cXML/OCI-style PunchOut plus native XML orders did the same job without dragging EDI 850 syntax along ([FreeLibrary](https://www.thefreelibrary.com/Business-to-Business+Purchasing+On+the+Internet:+The+OBI+Standard.-a063609721)).
- **UBL/Peppol:** slow burn, then hockey stick driven by law: Denmark mandated UBL (OIOUBL) for all public-sector invoices in **2005**; EU Directive 2014/55/EU forced all public bodies to receive e-invoices (EN 16931, UBL syntax); country mandates followed (Italy, Norway, Belgium mandatory B2B from Jan 2026, France 2026-27…). Peppol: ~110K participants in 2019 → **1.4M+ organizations, 300+ certified Access Points, ~100 countries** by 2025, and millions of participants by 2026, expanding to Singapore, Japan (JP PINT), Australia/NZ, Malaysia, UAE ([Qvalia](https://qvalia.com/peppol-global-reach-2026-the-complete-country-guide/), [peppol.nu statistics](https://www.peppol.nu/knowledge-base/peppol-statistics/), [Wikipedia](https://en.wikipedia.org/wiki/PEPPOL)).
- **OAGIS:** steady niche as embedded canonical model in enterprise software; never a network standard between strangers.

## 4. Incentive Autopsy

- **Who paid for it?** RosettaNet: membership dues from big vendors (board seats cost real money) + Asian government subsidy programs. ebXML: standards-body budgets and member volunteer labor — i.e., nobody with P&L accountability. cXML: Ariba, as customer-acquisition infrastructure for its network business. OBI: Fortune 500 purchasing departments. UBL: OASIS volunteers for a decade, then **taxpayers** — EU/state mandates converted it into funded infrastructure. OAGIS: ERP vendors solving their own integration costs.
- **Who captured the value?** RosettaNet: hub firms (Intel, HP) that pushed connection costs onto partners captured most measured savings. cXML: **Ariba/SAP captured it structurally** — an open format wrapped around a proprietary tollbooth. UBL/Peppol: value split between governments (VAT enforcement, procurement efficiency) and a competitive market of Access Point providers; OpenPeppol's governance keeps any single AP from becoming a chokepoint. ebXML: no one — there was no operator with an incentive to drive adoption.
- **Who bore the integration cost?** Always the smaller counterparty. A RosettaNet PIP implementation was a five-to-six-figure IT project per partner class; only subsidy (Malaysia) or hub coercion (Intel telling suppliers "connect or lose the business") moved SMEs. cXML shifted cost cleverly: suppliers already had web stores; PunchOut reused them.
- **Middleman problem:** every one of these promised to kill the VAN. Outcome: **the VAN was reincarnated, not killed.** Ariba Network became a VAN with a web UI — and its supplier-side fee schedule (subscription tiers + ~0.1–0.2% transaction fees once a supplier crosses ~$50K/5 documents with a buyer) is the canonical example of the extraction DTP calls out; network fees can reach 40–60% of a large buyer's total Ariba cost, seven figures annually ([Redress Compliance](https://redresscompliance.com/sap-ariba-negotiations-managing-transaction-fees-volume-tiers-and-network-costs/), [SAP fee schedule via DC.gov](https://ocp.dc.gov/sites/default/files/dc/sites/ocp/page_content/attachments/Ariba%20Network%20Fulfillment%20Orders%20and%20Invoices%20Supplier%20Fee%20Schedule_0.pdf)). Peppol's four-corner model is the deliberate counter-design: many interchangeable Access Points, no bilateral fee negotiations, no roaming charges.

## 5. What's Right

- **Processes, not documents (RosettaNet).** PIPs understood that a trade is a *choreographed state machine with timeouts, retries, and failure states* — not a pile of documents. This is exactly the right abstraction and directly prefigures DTP's intent→match→contract→attestation pipeline.
- **Machine-readable capability profiles (ebXML CPP/CPA).** "Publish what you can do; the protocol computes the intersection as an agreement" is a genuinely great idea that was ~20 years early — it presumed autonomous negotiation without agents capable of it. LLM-era agents are the missing runtime.
- **Semantic core components (ebXML CCS → UBL).** Building documents from a shared semantic library (Party, Item, Amount, Period) is why UBL could later become a legal norm. Slow, boring, and it won.
- **Four-corner network + directory (Peppol).** Register once, reach everyone; competitive service providers on both edges; central *thin* governance (identifiers, service metadata, compliance) rather than a central operator. The best-surviving architecture of the whole era.
- **Reuse of existing identity rails.** DUNS + GS1 GLN/GTIN grounding (RosettaNet dictionaries, cXML credentials) meant no new identity bootstrap problem. DTP's NEAR-account-carrying-GLN/DUNS is the same move with a portable wrapper.
- **PunchOut's insight (OBI→cXML):** don't force suppliers to syndicate static catalogs into every buyer system; let the *supplier's own live system* be the catalog, and standardize only the session handshake and the cart. Minimal standardization surface = fast adoption.
- **ebMS/AS4 reliable messaging:** signed, non-repudiable, exactly-once delivery outlived everything else in ebXML because plumbing with narrow scope survives fashion cycles.

## 6. What's Wrong / Failure Modes

- **The grand-design trap (ebXML).** Specifying discovery + agreements + process + semantics + messaging *simultaneously*, by committee, in 18 months, before any running code had users. Each layer depended on the others, so partial adoption delivered near-zero value — the opposite of incremental adoptability. When SOAP/WSDL Web Services (backed by Microsoft/IBM marketing) arrived, developers took the simpler thing, even though it solved less.
- **Public registries die without a curator (ebXML RegRep, UDDI).** The UDDI Business Registry filled with stale junk because no one was paid to garbage-collect or verify entries; IBM/MS/SAP pulled the plug in Jan 2006 ([Lemire](https://lemire.me/blog/2005/12/19/ibm-uddi-shut-down/)). "Global yellow pages of business capabilities" fails without funded governance of data quality — discovery is a *service with an operator*, not a schema.
- **Per-partner-process cost (RosettaNet).** Each PIP with each partner was an integration project. Costs scaled O(partners × processes); only firms with enormous relationship volume (semiconductor supply chains) cleared the bar. That's *why* it stayed vertical: the standard encoded its founders' industry semantics, and re-deriving PIPs for another vertical meant redoing the whole consortium effort.
- **Consortium governance = slow + politicized.** Multi-vendor committees converge on unions of requirements (bloat: 494 OAGIS BODs, 100+ PIPs, 65+ UBL doc types) and move at veto speed. Meanwhile a single vendor (Ariba) shipped, iterated, and let the market ratify.
- **No settlement, no teeth.** None of these touched money movement — payment stayed out of band (P-cards in OBI, bank rails elsewhere). So the standard never controlled the moment of value transfer, which is where fees, leverage, and lock-in actually live. The network operator (Ariba) monetized adjacency to that moment instead.
- **"Open format, closed network" (cXML).** The spec is free; the routing/identity/onboarding layer that makes it useful is a proprietary hub with supplier fees. Openness at the syntax layer did not prevent extraction at the network layer — it *enabled* it, by making supplier onboarding cheap for the hub.
- **OBI's fatal compromise:** wrapping legacy EDI 850 syntax inside a new envelope satisfied incumbents' sunk costs but gave adopters the worst of both worlds; it was cleanly outcompeted by a native design within ~3 years.
- **Press-release causes of death vs real ones:** ebXML "transitioned to maintenance" (really: developer mindshare lost to WS-* then REST; no adoption engine); RosettaNet "merged with GS1 US to gain scale" (really: growth had stopped outside high-tech; the consortium could not fund itself as a universal protocol); UDDI's shutdown was declared a proof of success.

## 7. Kill Conditions

- **What killed the dead ones:** absence of a *forcing function*. OBI died when its buyer-side sponsors adopted better tools — no regulator, no dominant network, no revenue-motivated vendor defended it. ebXML's registry/CPA layers died because they required simultaneous multi-party adoption with no first-mover payoff (empty-registry cold start) and no funded operator.
- **What kept the survivors alive:**
  - *cXML:* a revenue-motivated operator (Ariba→SAP) whose business depends on the format, plus deep installed-base network effects in procurement. It survives *despite* extractive fees because switching a Global-2000 P2P stack is a multi-year project.
  - *UBL/Peppol:* legal mandates. Governments as anchor buyers ("receive e-invoices or don't sell to the state") plus VAT-fraud enforcement give every finance department a compliance deadline. The forcing function is statutory and ratchets one country at a time.
  - *RosettaNet (residually):* semiconductor supply chains still run PIPs because hub firms baked them into operations decades ago — pure installed-base inertia under GS1 stewardship.
  - *ebMS/AS4:* got adopted as *someone else's* plumbing (EU eDelivery, Peppol) — survival by being infrastructure for a mandated network.
- **Generalization:** a neutral B2B trade standard survives only while at least one of these holds: (1) a profit-motivated operator whose revenue depends on it, (2) a regulatory mandate, (3) a hub gorilla coercing its supply base, (4) government subsidy of integration costs (Malaysia bought RosettaNet adoption for a while — and it faded when subsidies stopped being the binding constraint). Pure voluntary-consortium goodwill has a demonstrated half-life of roughly one hype cycle.

## 8. Null Hypothesis Check

Would the trades have happened anyway? **Yes — every one of them.** Semiconductors shipped before PIP 3A4; offices got their pens before PunchOut; invoices moved by PDF-over-email (and still do in the US mid-market). These standards competed not with "no trade" but with fax, email, portals, and bilateral EDI.

What they actually added, where they added it:

- **RosettaNet at Intel:** measured — $44M in value against $18B+ of flow ≈ ~25bp of transaction value, concentrated in error reduction, headcount, and cycle time ([Computerworld](https://computerworld.com/article/2580296/intel-does--5b-in-transactions-through-rosettanet.html)). Real, but thin enough that it only paid at hub scale — which is precisely why voluntary SME adoption never happened without subsidy or coercion.
- **cXML/PunchOut:** eliminated catalog maintenance and rekeying for MRO purchasing; paid for itself quickly for suppliers facing many Ariba-side buyers. The null hypothesis (supplier webstore + manual PO entry) was genuinely worse at volume.
- **UBL/Peppol:** for a single SME, emailing a PDF invoice was fine — which is why *voluntary* e-invoicing adoption sat under 20% for a decade and why mandates were needed. The aggregate value (VAT-gap closure, straight-through AP processing) accrues mostly to governments and large payers, not to the marginal adopter. Classic externality structure → mandate was the economically correct instrument.
- **ebXML registry/CPA:** added nothing anyone would pay for in 2001, because there were no autonomous counterparties to consume machine-readable capability profiles. Humans found trading partners at trade shows and negotiated by phone; the registry solved a problem nobody yet had.

**Verdict:** the honest ROI of pure *data-format* standardization in B2B trade is small per transaction and back-loaded behind integration capex. It clears the hurdle only with scale (hub), law (mandate), or bundling with something that moves money or wins business.

## 9. Lessons for DTP

**Steal:**

1. **PIPs as the shape of the contract layer.** Specify DTP trade flows the way PIPs were specified: explicit two-party state machines with timeouts, retries, and failure/exception states (late delivery, partial acceptance, quality rejection) — not just message schemas. RosettaNet proved this abstraction correct for physical goods; DTP adds what PIPs lacked: on-chain state so both parties *share* the machine instead of mirroring it.
2. **CPP/CPA reborn as agent capability profiles.** ebXML's machine-negotiated agreements failed for lack of machine negotiators. DTP's agent-native premise is exactly the missing piece — a SupplyListing/TradeIntent pair *is* a CPP pair, and the matching engine *is* the CPA computation. Say this in the docs: DTP is ebXML's discovery-and-agreement layer, 25 years later, with the runtime that finally exists.
3. **Peppol's four-corner + thin-governance model.** If DTP ever needs intermediaries (onboarding services, attestation oracles, node operators), make them interchangeable and certified against the protocol, with governance owning only identifiers/compliance — never a single operator owning routing. Peppol is the only architecture in this dossier that scaled without becoming extractive.
4. **Ride existing identity registries; add portability.** RosettaNet's DUNS/GS1 grounding was right. DTP's NEAR account carrying GLN/DUNS/KYB/certs is the correct upgrade — keep the authoritative registries as *attestation sources*, don't try to replace them.
5. **Minimize the mandatory surface (cXML's lesson).** cXML won partly because a supplier could implement PunchOut in days against systems they already ran. DTP's v1 should have a similarly small "hello world": a seller should be able to post a valid SupplyListing and receive a matched contract with near-zero integration.
6. **Find the forcing function before writing more spec.** The single loudest finding: neutral protocols without a forcing function die regardless of technical quality. DTP's candidates: (a) **FSMA 204 is DTP's Peppol-mandate analog** — the Jan 2026/2027 traceability compliance deadline gives US food companies a statutory reason to adopt structured CTE records; lead with compliance, let trading follow; (b) escrow itself — unlike every protocol here, DTP sits *in* the money flow, so early adopters get a concrete financial primitive (payment assurance for buyers, working-capital certainty for sellers), not just cheaper paperwork; (c) anchor buyers — one regional grocery chain or food-service distributor mandating DTP for its suppliers is worth more than any consortium.

**Avoid:**

7. **Don't build the global registry first.** Empty registries rot (UDDI died of junk data in six years). Bootstrap discovery from live TradeIntents/SupplyListings — a market with flow is self-curating in a way a directory of capabilities never is. Any DTP directory should be an *index of active market state*, not a self-reported yellow pages.
8. **Don't spec all layers before one layer has users.** ebXML's simultaneous five-layer design is the anti-pattern. DTP should get one full trade loop (intent→settlement) live in one narrow vertical (it has chosen food/ag — correct) before generalizing schemas, exactly the opposite of "design the universal ontology, then onboard."
9. **Beware the reincarnated middleman.** Every "kill the VAN" protocol here produced a new tollbooth (Ariba Network, Access Point markets, consortium dues). DTP's non-extractive-fee stance must be *structural*, not promissory: fee logic in open contract code, forkability as the enforcement mechanism, no privileged position for the matching engine's operator. Otherwise DTP's matching engine is just the next Ariba.
10. **Don't let the founding vertical's semantics ossify into the core.** RosettaNet could never leave electronics because industry semantics were welded into the PIPs. Keep DTP's core primitives (intent, match, escrow, attestation, settlement) vertical-neutral and push food/ag specifics (FSMA CTEs, USDA grades, cold-chain terms) into a versioned extension layer from day one.
11. **Expect the per-transaction value to be thin — design for it.** Intel's ~25bp realized value is a sobering benchmark for pure coordination gains. DTP's economics must not depend on coordination savings alone; escrow (risk reduction), compliance (FSMA), and disintermediation of distributor margins are the value pools big enough to fund adoption.
12. **Subsidized adoption evaporates (Malaysia).** Grants buy pilots, not ecosystems. If DTP subsidizes onboarding, tie it to relationships that generate recurring flow, not to integration checkboxes.

## Sources

- [Wikipedia — RosettaNet](https://en.wikipedia.org/wiki/RosettaNet)
- [Computerworld — RosettaNet QuickStudy](https://www.computerworld.com/article/1725842/rosettanet.html)
- [Computerworld — Intel does $5B in transactions through RosettaNet](https://computerworld.com/article/2580296/intel-does--5b-in-transactions-through-rosettanet.html)
- [Malakooty (UCI PCIC) — RosettaNet: The Organization and the System (PDF)](https://escholarship.org/content/qt7wd45496/qt7wd45496_noSplash_e4b82e683545a06ef33fb1e2b1543784.pdf)
- [ProQuest — RosettaNet Gets Some Help in Asia (government subsidies)](https://www.proquest.com/docview/228292882)
- [CData Arc — What is RosettaNet](https://arc.cdata.com/resources/mft/rosettanet.rst)
- [Commport — RosettaNet EDI Standard](https://www.commport.com/rosettanet-edi-standard/)
- [ResearchGate — B2B integration over the Internet with XML: RosettaNet successes and challenges](https://www.researchgate.net/publication/221022531_B2B_integration_over_the_Internet_with_XML_-_RosettaNet_successes_and_challenges)
- [Wikipedia — ebXML](https://en.wikipedia.org/wiki/EbXML)
- [OASIS — ebXML CPPA v2 standard](https://www.oasis-open.org/standard/ebxmlcppa/)
- [OASIS — ebXML Registry TC](https://www.oasis-open.org/committees/tc_home.php?wg_abbrev=regrep)
- [IEEE — ebXML: status, research issues, and obstacles (2002)](https://ieeexplore.ieee.org/document/995093/)
- [Cover Pages — ebXML Requirements Specification](https://xml.coverpages.org/ebXML-Reqspc06.html)
- [InfoWorld — Microsoft, IBM, SAP discontinue UDDI registry effort](https://www.infoworld.com/article/2215182/microsoft-ibm-sap-discontinue-uddi-registry-effort.html)
- [Daniel Lemire — IBM UDDI Shut Down](https://lemire.me/blog/2005/12/19/ibm-uddi-shut-down/)
- [Microsoft — Shutdown of UDDI Public Registry](https://learn.microsoft.com/en-us/archive/blogs/dotnetinterop/shutdown-of-uddi-public-registry)
- [EC — eDelivery AS4 2.0 profile](https://ec.europa.eu/digital-building-blocks/sites/spaces/DIGITAL/pages/845480153/eDelivery+AS4+-+2.0)
- [OpenPeppol — Peppol AS4 Profile](https://docs.peppol.eu/edelivery/as4/specification/)
- [cxml.org — cXML resources and schemas](https://cxml.org/)
- [cXML User's Guide (PDF)](https://xml.cxml.org/current/cXMLUsersGuide.pdf)
- [TradeCentric — What is cXML?](https://tradecentric.com/blog/what-cxml/)
- [Anglera — cXML: The Protocol Behind PunchOut Catalogs](https://www.anglera.com/glossary/cxml-commerce-xml)
- [Wikipedia — cXML](https://en.wikipedia.org/wiki/CXML)
- [Redress Compliance — SAP Ariba: Managing Transaction Fees, Volume Tiers, and Network Costs](https://redresscompliance.com/sap-ariba-negotiations-managing-transaction-fees-volume-tiers-and-network-costs/)
- [DC.gov — Ariba Network Supplier Fee Schedule (PDF)](https://ocp.dc.gov/sites/default/files/dc/sites/ocp/page_content/attachments/Ariba%20Network%20Fulfillment%20Orders%20and%20Invoices%20Supplier%20Fee%20Schedule_0.pdf)
- [OBI Technical Specification v2.1 (PDF)](https://sep.turbifycdn.com/ty/cdn/vw/OBIv210.pdf)
- [FreeLibrary — Business-to-Business Purchasing on the Internet: The OBI Standard](https://www.thefreelibrary.com/Business-to-Business+Purchasing+On+the+Internet:+The+OBI+Standard.-a063609721)
- [Uni-KL — Open Buying on the Internet overview (PDF)](http://wwwlgis.informatik.uni-kl.de/cms/fileadmin/courses/ss2007/Informationssysteme/addons/OpenBuyingOnTheInternet.pdf)
- [OASIS — UBL Technical Committee](https://www.oasis-open.org/committees/tc_home.php?wg_abbrev=ubl)
- [VATupdate — Understanding EU E-Invoicing: EN 16931, UBL, CII](https://www.vatupdate.com/2026/05/25/understanding-eu-e-invoicing-en-16931-ubl-cii-and-national-syntaxes/)
- [Microsoft Learn — OIOUBL / European e-invoicing standards](https://learn.microsoft.com/en-us/dynamics365/finance/localizations/europe/emea-oioubl-standards-electronic-invoicing)
- [Qvalia — Peppol global reach 2026: country guide](https://qvalia.com/peppol-global-reach-2026-the-complete-country-guide/)
- [peppol.nu — Peppol Statistics](https://www.peppol.nu/knowledge-base/peppol-statistics/)
- [Wikipedia — PEPPOL](https://en.wikipedia.org/wiki/PEPPOL)
- [Cover Pages — Open Applications Group](https://xml.coverpages.org/oag.html)
- [Control Engineering — 494 BODs in OAGIS Release 9.2](https://www.controleng.com/494-bods-business-object-documents-in-oagis-release-9-2/)
- [HCL Commerce — OAGIS messaging](https://help.hcl-software.com/commerce/9.1.0/webservices/concepts/cwvoagis.html)
- [Oracle — OAGIS support in Integration B2B](https://docs.oracle.com/en/cloud/paas/application-integration/integration-b2b/open-applications-group-support.html)
