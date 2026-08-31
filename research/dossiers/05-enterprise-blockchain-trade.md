# Enterprise Blockchain for Supply Chain & Trade Finance (the Consortium Wave)

**Era:** ~2016–2023 (peak hype 2017–2019; mass die-off 2022–2023)
**Status:** dead (as a category; a handful of survivors persist only by abandoning the blockchain premise)
**One-line:** A wave of permissioned-blockchain consortia (Hyperledger Fabric, Corda, Quorum) that tried to put shipping documents, food provenance, and trade-finance instruments on shared ledgers — and almost all of which died between 2022 and 2023 without ever finding a business model.

## 1. Origin Story

The wave was born from three converging pressures around 2015–2016:

1. **Genuinely broken paper processes.** A single ocean shipment could involve ~30 parties and 200 information exchanges; letters of credit were couriered paper; a Maersk study famously found the documentation for a container of avocados cost more than the shipping. Food recalls took days-to-weeks to trace (Walmart's pre-blockchain mango trace took 6 days, 18 hours).
2. **Post-Bitcoin institutional FOMO.** Banks and enterprise IT vendors wanted the "blockchain, not Bitcoin" story: distributed ledgers with no tokens, no public access, and known validators. Hyperledger Fabric (IBM/Linux Foundation, 2015) and R3's Corda (2016) were built precisely to sell this to consortia.
3. **Vendor push.** IBM, Accenture, and the Big 4 had a services business to build. Gartner put blockchain at the peak of the hype cycle in 2016–2017; boards demanded "a blockchain strategy."

Before this wave, trade coordination ran (and still runs) on EDI, SWIFT MT7xx messages for letters of credit, email + PDF, portals, and phone/fax. The consortia pitched a shared single source of truth to replace bilateral reconciliation.

The major specimens:

- **TradeLens** (Maersk + IBM, 2018): shipping-document and container-event platform on Fabric.
- **IBM Food Trust** (IBM + Walmart, 2017/2018): food traceability SaaS on Fabric; Walmart mandated it for leafy-greens suppliers after the 2018 romaine E. coli outbreaks.
- **we.trade** (2017): 12-bank consortium (HSBC, Deutsche, Santander, SocGen, UBS…) for SME open-account trade, on Fabric; IBM took 7% in 2020.
- **Marco Polo Network** (TradeIX + R3, 2017): ~30 banks (Commerzbank, BNY Mellon, BNP Paribas, Mastercard…) for open-account trade finance on Corda.
- **Contour** (2020, ex-Voltron): 8–9 major banks digitizing letters of credit on Corda.
- **komgo** (2018): 15 commodity-trade-finance banks and traders (plus inspector SGS), Geneva, initially on Quorum/Ethereum tech.
- **B3i** (2016/2018): 15+ insurers/reinsurers (Allianz, Munich Re, Swiss Re, Zurich…) for reinsurance placement on Corda.
- **Everledger** (2015): diamond/luxury provenance startup, later ESG traceability; raised $51M+.
- **Provenance** (UK, 2015), **Ripe.io** (2017, Maersk-backed), **Bext360** (coffee), **AgriDigital** (Australian grain): venture-backed traceability/agri startups.
- **VeChain** and **OriginTrail** (2017): the public-chain, token-funded counterparts.

## 2. Mechanics

The consortium-chain design pattern, common across nearly all of them:

- **Ledger:** permissioned blockchain (Fabric channels, Corda point-to-point notarized flows, or Quorum private state). Validators are the consortium members or, more often in practice, the platform operator's cloud.
- **Identity:** membership = legal onboarding by the operator (KYC/contract), then X.509 certs / node identities. No open participation; joining took weeks-to-months and legal review.
- **Message formats:** digitized versions of existing artifacts — bill of lading, packing list, letter of credit, invoice, purchase order; food events typically GS1 EPCIS (commissioning, shipping, receiving, transformation). TradeLens published container "events" (gate-in, load, discharge) plus documents.
- **State machines:** workflow engines mirroring the paper flow. Contour modeled the LC lifecycle (application → issuance → presentation → discrepancy → settlement) as Corda flows. we.trade used smart contracts to auto-trigger "bank payment undertakings" when shipment conditions were met.
- **Settlement:** none on-chain. This is the crucial structural fact: **every consortium platform anchored data about obligations, while money always moved off-platform through correspondent banking**. The ledger recorded that a payment should happen; SWIFT and nostro accounts actually moved it. (AgriDigital's 2016 pilot — a real-time transfer of digital grain title against a settlement token — was the rare exception, and it remained a pilot.)
- **Traceability:** IBM Food Trust / VeChain / Everledger recorded hashes and structured events supplied by participants (or IoT devices/QR codes). The chain proved the record hadn't been altered after submission — nothing more.
- **Governance:** a joint-venture operating company owned by anchor members (Maersk/IBM for TradeLens; banks for we.trade, Contour, komgo, Marco Polo; insurers for B3i). Fees: annual membership plus per-transaction/SaaS charges. Compared to DTP's primitives: these systems implemented *attestation and (partial) contract* layers only — no intent/discovery, no match, no escrow, no settlement.

## 3. Adoption Trajectory

- **TradeLens:** the best-adopted of the entire wave. By late 2020: 175+ organizations, 10 ocean carriers, 600+ ports/terminals, 30M container shipments, 1.5B events, ~13M documents tracked; after CMA CGM, MSC, Hapag-Lloyd and ONE joined, nearly half of global container data was nominally connected ([MSC](https://www.msc.com/en/newsroom/news/2020/october/msc-and-cma-cgm-complete-tradelens-integration-and-join-as-foundation-carriers-working-with-the-ibm)). It still failed: announced discontinuation November 2022, offline by Q1 2023, for lack of "commercial viability" — i.e., participants would connect data feeds but wouldn't *pay*, and key carriers/forwarders never fully committed to a Maersk-controlled network ([Maersk](https://www.maersk.com/news/articles/2022/11/29/maersk-and-ibm-to-discontinue-tradelens), [CIO Dive](https://www.ciodive.com/news/Maersk-IBM-shut-down-TradeLens/637655/)).
- **IBM Food Trust:** Walmart's 2018 mandate forced ~100+ leafy-greens suppliers on; Carrefour, Nestlé, Dole, Albertsons joined; IBM claimed one of the largest non-crypto blockchains. But growth was compliance-driven, not demand-driven. CoinDesk reported in Feb 2021 that IBM's blockchain unit missed revenue targets by ~90% two years running and was gutted ([CoinDesk](https://www.coindesk.com/business/2021/02/01/ibm-blockchain-is-a-shell-of-its-former-self-after-revenue-misses-job-cuts-sources)); IBM Blockchain Platform software hit end-of-support April 2023 ([IBM](https://www.ibm.com/support/pages/ibm-blockchain-platform-software-reaches-end-support-april-30-2023)). As of 2026 Food Trust nominally still exists (login and docs pages remain; big-name customers still listed), but IBM stopped promoting blockchain and repackaged the traceability business as FSMA 204 compliance via a 2023 iFoodDS partnership built on Sterling Supply Chain Intelligence Suite ([IBM/iFoodDS](https://www.ifoodds.com/press-release/ibm-and-ifoodds-launch-new-solution-to-help-organizations-comply-with-fda-fsma-204/)). The FSMA 204 vendor market that actually emerged (iFoodDS, FoodLogiQ/Trustwell, TraceGains) is standards-based (GS1 EPCIS) with blockchain optional-to-absent. Effectively wound down as a blockchain story.
- **we.trade:** live in 2019 across ~12 banks / 15 countries; tiny SME volumes; raised €5.5M in 2021, ran out of cash, insolvency filing June 2022 with PwC as liquidator ([GTR](https://www.gtreview.com/news/fintech/we-trade-calls-it-quits-after-running-out-of-cash/), [Ledger Insights](https://www.ledgerinsights.com/hsbc-socgen-ibm-backed-blockchain-company-we-trade-starts-insolvency-procedure/)).
- **Marco Polo:** 30+ member banks but missed go-live targets in 2019 and 2020; a hoped-for ~$12M Bank of America deal collapsed post-FTX; insolvent February 2023 with €5.2M debts ([TFG](https://www.tradefinanceglobal.com/posts/marco-polo-network-runs-insolvent/), [GTR](https://www.gtreview.com/news/top-stories/marco-polo-brings-in-liquidators-as-funds-run-dry/)).
- **Contour:** the strongest trade-finance product story (LC cycle time cut from ~10 days to under 24h in pilots) — but was processing only ~60–70 transactions per month in 2023; bank shareholders pulled funding, wound down November 2023 ([Ledger Insights](https://www.ledgerinsights.com/contour-blockchain-trade-finance-network-shutter/), [GTR](https://www.gtreview.com/news/top-stories/exclusive-contour-to-shut-down-as-bank-shareholders-pull-funding/)). Assets later recycled through Xalts (2024) then XDC Network (2025) as a stablecoin/tokenization play ([CoinDesk](https://www.coindesk.com/business/2025/10/22/xdc-network-acquires-contour-to-expand-stablecoins-and-tokenization-in-trade-finance)).
- **komgo — the survivor:** went live within 4 months of formation (first LC Dec 2018), ~$1B financing channeled in year one. Survived by (a) serving a tight vertical (Geneva commodity trade finance) where the shareholders were also the daily users, (b) acquiring adjacent software (GlobalTrade Corp., Trakk) and (c) **dropping blockchain** — it discontinued its blockchain-based LC, citing cost and scalability, and describes itself as technology-agnostic ([GTR](https://www.gtreview.com/magazine/volume-17-issue-1/komgo-unwrapped-financing-commodity-trade-blockchain/), [Ledger Insights](https://www.ledgerinsights.com/komgo-commodities-trade-finance-blockchain/)).
- **B3i:** five years, ~€22M+ from 20+ insurer shareholders, one niche product (Cat XL placement); failed a funding round, filed for insolvency in Switzerland July 2022 ([Insurance Journal](https://www.insurancejournal.com/news/international/2022/07/29/677926.htm), [Ledger Insights](https://www.ledgerinsights.com/major-insurers-pull-the-plug-on-b3i-insurance-blockchain-consortium/)).
- **Everledger:** pioneer of diamond provenance (2015), later art/wine/EV batteries/ESG; $51.7M raised (Tencent-led Series A) plus a $3M Australian government grant; an expected funding round fell through, voluntary administration April 2023 ([Ledger Insights](https://www.ledgerinsights.com/everledger-bankruptcy-esg-blockchain-traceability/), [Jewellery Monthly](https://jewellerymonthly.co.uk/everledger-enters-administration/)).
- **The startup graveyard:** Ripe.io ("the blockchain of food," Maersk-backed, $2.4M seed) faded to a 1–10-person shell by 2024 with no exit ([AgFunder](https://agfundernews.com/maersk-leads-blockchain-of-food-startup-ripeio-2-4m-seed-round), [Tracxn](https://tracxn.com/d/companies/ripe.io/__Ka_Rx-TOvXzw_C3915Fg_HbjU68mDaU4G0KO3NaFSJE)). Provenance's celebrated 2016 Indonesian tuna pilot ([Provenance](https://www.provenance.org/tracking_tuna_on_the_blockchain)) never scaled; the company pivoted to sustainability-claims marketing software with blockchain de-emphasized. Bext360 (AI+blockchain coffee kiosks, $3.35M) stayed a boutique pilot vendor ([Forbes](https://www.forbes.com/sites/alexknapp/2018/06/01/agtech-blockchain-startup-bext360-raises-3-35-million-to-provide-traceability-to-commodities/)). AgriDigital ran genuinely novel pilots with CBH Group — including the world's first physical commodity settlement on blockchain (Dec 2016, tokenized grain title vs. digital dollars) — then quietly built its actual business as a conventional cloud grain-management platform ([GTR](https://www.gtreview.com/news/asia/australian-grain-exporter-completes-successful-blockchain-pilots/)).
- **Public-chain counterparts:** VeChain landed the Walmart China Blockchain Traceability Platform (2019, with PwC; 23 product lines at launch, later Sam's Club China) ([VeChain](https://medium.com/vechain-foundation/walmart-china-takes-on-food-safety-with-vechainthor-blockchain-technology-b1443e0e079c)) — a real deployment, but one whose economics ran on VET/VTHO token appreciation rather than enterprise fees; each partnership announcement moved the token far more than it moved supply chains. OriginTrail built the more durable niche — GS1/EPCIS alignment, a BSI partnership, SCAN (US customs audit network), Swiss Federal Railways — then pivoted its Decentralized Knowledge Graph toward "verifiable data for AI" when the supply-chain narrative cooled ([Biyond analysis](https://biyond.co/blog/biyond-alpha-brief/origintrail-trac-protocol-analysis-from-supply-chain-transparency-to-ai-ready-data.html)). Both survive because token treasuries, not customers, fund development.
- **The macro numbers:** Gartner predicted in 2019 that 90% of blockchain supply-chain initiatives would suffer "blockchain fatigue" by 2023 and that 80% would remain stuck at pilot/PoC through 2022 ([Gartner](https://www.gartner.com/en/newsroom/press-releases/2019-05-07-gartner-predicts-90--of-blockchain-based-supply-chain), [Supply Chain Dive](https://www.supplychaindive.com/news/gartner-supply-chain-blockchain-projects-could-suffer-fatigue/554433/)). It was one of the era's few accurate forecasts.

## 4. Incentive Autopsy

- **Who paid for it?** Consortium shareholders (banks, carriers, insurers) funded operating companies out of innovation budgets; IBM and R3 subsidized platforms to sell services; VCs and token buyers funded the startups. Almost no revenue ever came from users paying for delivered value — we.trade, Marco Polo, Contour, and B3i all died the same death: shareholders declined the *next* funding round.
- **Who captured the value?** Consultants and platform vendors captured fees during the build phase. Anchor members (Maersk, Walmart) captured data visibility and PR. Users captured little: an SME on we.trade still needed its bank; a supplier on Food Trust bore data-entry costs so *Walmart* could trace faster.
- **Who bore the integration cost?** The weakest parties. Suppliers, forwarders, and SME exporters had to map ERPs to each platform's schema — for one buyer's mandate, on one non-interoperable island (Food Trust data didn't help you on TradeLens or VeChain). This is the classic EDI hub-and-spoke cost asymmetry, re-run with more expensive technology.
- **The middleman problem:** these platforms claimed to disintermediate paper couriers and reconciliation — but each consortium operating company *was itself a new middleman*, with monopoly pricing power over the network it hoped to own, governed by a subset of the competitors it needed as customers. Competitors correctly perceived TradeLens as Maersk owning the industry's data layer, and stayed lukewarm ([The Register](https://www.theregister.com/2022/11/30/ibm_and_maersk_tradelens_shutdown/)). The "decentralized" technology sat inside a centralized company that could — and did — turn the network off.

## 5. What's Right

- **The pain diagnosis was correct.** Paper LCs, unverifiable provenance claims, week-long recall traces, 30-party document shuffles — all real, all expensive. FSMA 204 (2022, compliance now enforced) proves regulators agreed the traceability gap was real.
- **Standard event vocabularies work.** The lasting artifact of Food Trust et al. is GS1 EPCIS as the lingua franca for supply-chain events — DTP's FSMA 204 events sit directly in this lineage.
- **Contour proved cycle-time compression is real** when a full workflow (LC lifecycle) is digitized end-to-end: ~10 days to <24 hours. The product worked; the business didn't.
- **AgriDigital's 2016 pilot was the correct primitive**, seven years early: atomic delivery-vs-payment for physical commodity title. Everyone else anchored data; AgriDigital settled value. That is the difference between recording a trade and executing one.
- **Neutrality matters and was learned the hard way.** Late-wave designs (Contour's bank-neutral structure, komgo's user-owned model) explicitly tried to fix TradeLens's Maersk problem. komgo's survival shows a utility owned by its actual daily users, in a tight vertical, can work.
- **Walmart's mandate showed adoption follows power, not persuasion.** The only fast supplier onboarding in the whole wave came from a buyer with leverage requiring it.

## 6. What's Wrong / Failure Modes

The precise failure taxonomy:

**(a) Governance/neutrality failure — the competitor-owned consortium.** A network owned by one competitor (TradeLens/Maersk) or a subset of competitors (we.trade's 12 banks vs. every other bank) structurally cannot recruit the rest of the market: joining means feeding data and fees to a rival. TradeLens got carriers to *connect* but not to *commit*; non-shareholder banks had no reason to route volume to we.trade or Contour. Killed: TradeLens, we.trade (partially), B3i, Marco Polo (partially).

**(b) No-business-model failure.** Value created (industry-wide reconciliation savings) was diffuse; costs (integration, membership fees) were concentrated and immediate. Nobody's P&L improved enough to fund the platform once innovation budgets closed — and consortium members treated funding as discretionary CSR, withdrawn at the first macro tightening (2022 rate hikes + FTX chill). Killed: every consortium. Contour is the purest case: a working product, systemically-important shareholders, and only ~60–70 transactions/month of willingness-to-pay.

**(c) Token-speculation-distortion failure.** VeChain, OriginTrail, and dozens of smaller "supply chain coins" funded development via token sales, which decoupled revenue from usage: the customer was the token buyer, and each enterprise pilot's function was narrative, not cash flow. This bought survival (they outlived the consortia — treasuries don't pull funding) at the cost of credibility with exactly the conservative enterprises they courted, and it selected for announcement-maximizing rather than adoption-maximizing behavior.

**(d) Solution-in-search-of-problem failure.** For most use cases, a permissioned blockchain among identified, contracted parties is an expensive shared database with a worse governance problem bolted on. The blockchain added cost (nodes, consensus, novel ops) without adding trust, because trust was already established by contracts and the operator's own centralization. komgo said this out loud when it dropped blockchain: "many of these issues don't require a complicated and expensive technical architecture to solve." Killed or hollowed out: B3i, Ripe.io, most food pilots; forced pivots at komgo, Provenance, AgriDigital.

**(e) The garbage-in problem (cross-cutting).** Academic consensus: blockchain proves a record wasn't altered *after submission*; it cannot prove the record was true. Immutability of false data is arguably worse than a mutable database — "immutable garbage" that becomes a flawed source of truth ([Powell et al., *Garbage in garbage out*, J. Industrial Information Integration 2021](https://www.sciencedirect.com/science/article/abs/pii/S2452414X21000595); [WEF blockchain toolkit on data integrity](https://widgets.weforum.org/blockchain-toolkit/data-integrity/index.html)). The oracle problem — every bridge from physical world to ledger (a worker's data entry, a QR sticker that can be moved to a different crate, an IoT sensor that can be spoofed) is a trusted party — was never solved, only relabeled. Fraudulent organic certificates hashed on-chain are still fraudulent; the chain just notarizes the fraud.

Secondary modes: fragmentation (dozens of non-interoperable islands each demanding its own integration); technology immaturity and over-scoping (Gartner's diagnosis); and supplier cost-shifting without supplier benefit, which capped data quality at the minimum the mandate required.

## 7. Kill Conditions

What was true when they died:

- The next funding round required believers, and by 2022 there were none: rising rates, FTX contagion poisoning the word "blockchain" for bank boards (Marco Polo's BofA deal died with FTX), and five years of pilots with no P&L proof.
- Revenue never crossed opex for a single consortium platform. When platform survival depends on members' *continued charity* rather than users' *fees*, the kill condition is simply the first budget cycle after hype dies.
- For TradeLens specifically: the moment it was clear MSC/CMA CGM/Hapag would integrate but never push commercial volume through a Maersk-governed platform, there was no path to viability.
- komgo's survival condition, inverted, states the rule: it lives because its owners are its heaviest daily users, the vertical is small enough to saturate, and it deleted the technology that was costing money without earning trust.
- VeChain/OriginTrail's survival condition: token treasuries fund development regardless of enterprise revenue — they can't be killed by customers leaving, only by token collapse. That is also why their enterprise traction stays thin.

## 8. Null Hypothesis Check

Would the trade have happened fine without them? **Almost entirely yes — it did.** Container lines kept sailing on EDI and carrier portals after TradeLens went dark; nothing shipped later. LCs kept flowing over SWIFT; Contour's 60–70 monthly transactions were rounding error against the ~$18tn trade it hoped to serve. Food kept moving; when the US finally forced faster traceability, FSMA 204 compliance was met by GS1-EPCIS SaaS vendors with no blockchain required.

What did they actually add over phone/fax/email/EDI?

- Genuine: faster recall tracing where a powerful buyer forced data submission (Walmart: 6 days → 2.2 seconds for a mango trace — but the speedup came from *centralized, standardized data capture*, which a conventional database delivers identically); LC cycle-time compression (Contour — again achievable with any shared workflow SaaS, as essDOCS/Bolero had long shown).
- Not genuine: the "trust" layer. Between KYC'd, contracted counterparties with legal recourse, cryptographic tamper-evidence added nothing anyone would pay for. The one thing a ledger uniquely adds — trustless settlement between parties without a shared intermediary — was precisely the thing every permissioned platform excluded by design (no tokens, no funds on-chain).

The wave's epitaph: they put the *evidence* of trade on-chain and left the *value* off-chain, which meant the chain was never load-bearing — and anything that isn't load-bearing gets cut in a budget crunch.

## 9. Lessons for DTP

**Where DTP's design already dodges the taxonomy:**

- **(a) Governance/neutrality:** DTP is a protocol on a public chain (NEAR), not a competitor-owned operating company. No Maersk problem: a distributor's rival joining DTP doesn't feed the rival's balance sheet. This is the single most important structural difference — but see the exposure note below.
- **(b) Business model:** DTP settles real funds (USDC escrow). The chain is load-bearing: it holds the money. Fees can price against a concrete, per-transaction service (escrow, dispute resolution, settlement finality) rather than diffuse "ecosystem efficiency." Every dead consortium lacked exactly this. AgriDigital's 2016 grain-title-vs-payment pilot is DTP's true ancestor in this wave — steal its framing: *settlement first, traceability as a by-product of settled trades*.
- **(c) Token distortion:** no native token. USDC settlement means no speculation-driven development funding, no announcement-driven roadmap, no enterprise credibility tax. Keep it that way; the moment a token appears, DTP is graded on VeChain's curve.
- **(d) Solution-in-search-of-problem:** DTP's chain does something a database cannot: hold escrowed funds that neither counterparty nor any platform operator controls, between parties who lack an established trust relationship. That is the one use case the null hypothesis doesn't kill.

**Where DTP is still exposed:**

- **Garbage-in (e) is fully inherited.** On-chain FSMA 204 events and reputation attestations are exactly as true as the humans/sensors submitting them. A supplier can settle honestly while lying about lot origins. Mitigations, not solutions: tie attestations to settled trades (skin in the game — a reputation event backed by an escrowed, delivered, paid trade is costlier to fake than a free-floating claim); make dispute outcomes feed reputation; treat third-party inspectors (the SGS role in komgo) as first-class oracle actors; never market "on-chain = true."
- **Integration-cost asymmetry.** The wave died partly because weak parties bore the onboarding cost. DTP's agent-native design is the counter-bet — an AI agent, not an EDI project, does the mapping — but this must actually hold at v1: if onboarding a wholesale produce seller takes more than a session with an agent, DTP re-runs the supplier-fatigue failure.
- **Cold-start without a Walmart.** The only fast adoption in this entire wave was mandated by a channel captain. DTP has no mandate lever. Options the wave suggests: ride an existing mandate (FSMA 204 compliance as the wedge — the deadline is *now*, and DTP can be the only compliance tool that also pays you faster), and saturate one tight vertical the way komgo saturated Geneva commodity finance, rather than boiling global trade.
- **Funding-winter mortality.** Consortia died when patrons got bored. A protocol with no consortium can still die the same death if development funding is venture-shaped and adoption is slower than the runway. Contour had a working product and nine systemically-important backers and still died at 60–70 tx/month; DTP should define, in advance, the transaction volume at which protocol fees sustain development — and treat that number, not partnership announcements, as the metric.
- **Neutrality is behavioral, not just structural.** Even on a public chain, if one anchor buyer's requirements dominate the schema and roadmap, sellers will treat DTP as that buyer's system. Governance of the protocol spec needs visible independence early.
- **Don't oversell traceability.** Traceability-first was the graveyard (Food Trust, Everledger, Ripe.io, Provenance, Bext360). Settlement-first with traceability as exhaust is the inversion this history demands: FSMA 204 events as artifacts of trades that actually settled through escrow are both more credible (economically anchored) and cheaper to collect (they're a side effect, not a data-entry chore).

## Sources

- [Maersk: A.P. Moller-Maersk and IBM to discontinue TradeLens (Nov 2022)](https://www.maersk.com/news/articles/2022/11/29/maersk-and-ibm-to-discontinue-tradelens)
- [CIO Dive: Maersk, IBM to shut down TradeLens](https://www.ciodive.com/news/Maersk-IBM-shut-down-TradeLens/637655/)
- [The Register: IBM, Maersk will shut down TradeLens](https://www.theregister.com/2022/11/30/ibm_and_maersk_tradelens_shutdown/)
- [CoinDesk: IBM and Maersk Abandon Ship on TradeLens](https://www.coindesk.com/business/2022/11/30/ibm-and-maersk-abandon-ship-on-tradelens-logistics-blockchain)
- [Forbes (Cecere): TradeLens Discontinues Operations. Why You Should Care](https://www.forbes.com/sites/loracecere/2022/12/05/tradelens-discontinues-operations-why-you-should-care/)
- [MSC: MSC and CMA CGM Complete TradeLens Integration (Oct 2020, adoption stats)](https://www.msc.com/en/newsroom/news/2020/october/msc-and-cma-cgm-complete-tradelens-integration-and-join-as-foundation-carriers-working-with-the-ibm)
- [Grocery Dive: Walmart mandates blockchain use for leafy greens suppliers](https://www.grocerydive.com/news/walmart-mandates-blockchain-use-for-leafy-greens-suppliers/533645/)
- [Walmart press release: leafy greens on blockchain (PDF)](https://corporate.walmart.com/content/dam/corporate/documents/press-center/in-wake-of-romaine-e-coli-scare-walmart-deploys-blockchain-to-track-leafy-greens/press-release-leafy-greens-on-blockchain.pdf)
- [Hyperledger/LF Decentralized Trust: Walmart case study (mango trace: 6 days → 2.2 seconds)](https://www.lfdecentralizedtrust.org/case-studies/walmart-case-study)
- [CoinDesk: IBM Blockchain Is a Shell of Its Former Self After Revenue Misses, Job Cuts (Feb 2021)](https://www.coindesk.com/business/2021/02/01/ibm-blockchain-is-a-shell-of-its-former-self-after-revenue-misses-job-cuts-sources)
- [IBM: IBM Blockchain Platform software end of support April 30, 2023](https://www.ibm.com/support/pages/ibm-blockchain-platform-software-reaches-end-support-april-30-2023)
- [iFoodDS + IBM FSMA 204 solution launch (Sept 2023)](https://www.ifoodds.com/press-release/ibm-and-ifoodds-launch-new-solution-to-help-organizations-comply-with-fda-fsma-204/)
- [GTR: we.trade calls it quits after running out of cash](https://www.gtreview.com/news/fintech/we-trade-calls-it-quits-after-running-out-of-cash/)
- [Ledger Insights: We.Trade starts insolvency procedure](https://www.ledgerinsights.com/hsbc-socgen-ibm-backed-blockchain-company-we-trade-starts-insolvency-procedure/)
- [Finextra: Bank-backed blockchain consortium we.trade files for insolvency](https://www.finextra.com/newsarticle/40408/bank-backed-blockchain-consortium-wetrade-files-for-insolvency)
- [TFG: Marco Polo Network runs insolvent with €5.2m debts](https://www.tradefinanceglobal.com/posts/marco-polo-network-runs-insolvent/)
- [GTR: Marco Polo brings in liquidators as funds run dry](https://www.gtreview.com/news/top-stories/marco-polo-brings-in-liquidators-as-funds-run-dry/)
- [Ledger Insights: Marco Polo is insolvent](https://www.ledgerinsights.com/marco-polo-blockchain-trade-finance-insolvency/)
- [Ledger Insights: Contour to shutter (60–70 tx/month)](https://www.ledgerinsights.com/contour-blockchain-trade-finance-network-shutter/)
- [GTR: Contour to shut down as bank shareholders pull funding](https://www.gtreview.com/news/top-stories/exclusive-contour-to-shut-down-as-bank-shareholders-pull-funding/)
- [TFG: Contour collapses — what does this mean for digital trade finance?](https://www.tradefinanceglobal.com/posts/contour-collapses-what-does-this-mean-for-digital-trade-finance/)
- [CoinDesk: XDC Network acquires Contour (2025)](https://www.coindesk.com/business/2025/10/22/xdc-network-acquires-contour-to-expand-stablecoins-and-tokenization-in-trade-finance)
- [GTR: komgo unwrapped (dropped blockchain LC, technology-agnostic pivot)](https://www.gtreview.com/magazine/volume-17-issue-1/komgo-unwrapped-financing-commodity-trade-blockchain/)
- [Ledger Insights: komgo goes live](https://www.ledgerinsights.com/komgo-commodities-trade-finance-blockchain/)
- [SGS: co-launch of komgo](https://www.sgs.com/en/news/2018/09/sgs-co-launches-komgo)
- [Insurance Journal: B3i ceases to trade after filing for insolvency](https://www.insurancejournal.com/news/international/2022/07/29/677926.htm)
- [Ledger Insights: Major insurers pull the plug on B3i](https://www.ledgerinsights.com/major-insurers-pull-the-plug-on-b3i-insurance-blockchain-consortium/)
- [Ledger Insights: Everledger goes bust](https://www.ledgerinsights.com/everledger-bankruptcy-esg-blockchain-traceability/)
- [Jewellery Monthly: Everledger enters administration](https://jewellerymonthly.co.uk/everledger-enters-administration/)
- [AgFunder: Maersk leads Ripe.io $2.4m seed](https://agfundernews.com/maersk-leads-blockchain-of-food-startup-ripeio-2-4m-seed-round)
- [Tracxn: Ripe.io profile (1–10 employees, 2024)](https://tracxn.com/d/companies/ripe.io/__Ka_Rx-TOvXzw_C3915Fg_HbjU68mDaU4G0KO3NaFSJE)
- [Provenance: Tracking tuna on the blockchain (2016 pilot)](https://www.provenance.org/tracking_tuna_on_the_blockchain)
- [Forbes: Bext360 raises $3.35M](https://www.forbes.com/sites/alexknapp/2018/06/01/agtech-blockchain-startup-bext360-raises-3-35-million-to-provide-traceability-to-commodities/)
- [GTR: CBH/AgriDigital successful blockchain pilots (world-first commodity settlement)](https://www.gtreview.com/news/asia/australian-grain-exporter-completes-successful-blockchain-pilots/)
- [VeChain: Walmart China Blockchain Traceability Platform](https://medium.com/vechain-foundation/walmart-china-takes-on-food-safety-with-vechainthor-blockchain-technology-b1443e0e079c)
- [Biyond: OriginTrail — from supply chain transparency to AI-ready data](https://biyond.co/blog/biyond-alpha-brief/origintrail-trac-protocol-analysis-from-supply-chain-transparency-to-ai-ready-data.html)
- [Gartner: 90% of blockchain supply chain initiatives will suffer blockchain fatigue by 2023](https://www.gartner.com/en/newsroom/press-releases/2019-05-07-gartner-predicts-90--of-blockchain-based-supply-chain)
- [Supply Chain Dive: Gartner — blockchain pilots stalling](https://www.supplychaindive.com/news/gartner-supply-chain-blockchain-projects-could-suffer-fatigue/554433/)
- [ScienceDirect: Garbage in garbage out — the precarious link between IoT and blockchain in food supply chains](https://www.sciencedirect.com/science/article/abs/pii/S2452414X21000595)
- [WEF Blockchain Toolkit: Data integrity](https://widgets.weforum.org/blockchain-toolkit/data-integrity/index.html)
- [S&P Global: Trade finance industry remains hopeful on blockchain despite failed projects](https://www.spglobal.com/market-intelligence/en/news-insights/articles/2022/10/trade-finance-industry-remains-hopeful-on-blockchain-despite-failed-projects-72557910)
