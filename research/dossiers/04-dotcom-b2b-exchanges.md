# Dot-Com B2B Exchanges (Independent Marketplaces & Industry Consortia)

**Era:** ~1998–2002 (boom); shakeout complete by ~2003; a handful of survivors persist as software/network businesses
**Status:** dead (as a category); survivors exist only as pivoted SaaS/procurement-network businesses
**One-line:** ~1,500 venture- and consortium-funded online exchanges that promised to disintermediate B2B middlemen with neutral matching engines and transaction fees — and were almost entirely extinct within four years.

## 1. Origin Story

Three things converged in 1998–2000:

1. **A genuinely large inefficiency.** B2B procurement ran on phone, fax, catalogs, EDI over expensive VANs, and salespeople. Search costs were real: a lab manager ordering reagents flipped through paper catalogs from hundreds of suppliers; a steel buyer called brokers; a purchasing agent for MRO supplies re-keyed faxes. Distributor/broker margins of 5–30% depending on vertical looked, to founders and VCs, like pure coordination waste waiting to be arbitraged away by a website.
2. **The B2C marketplace template.** eBay and Amazon had just demonstrated internet matching at scale. The syllogism was: B2B commerce is ~10x the size of B2C, therefore B2B marketplaces will be 10x eBay. [Gartner forecast $7.3 trillion in B2B e-commerce by 2004](https://computerworld.com/article/2594794/gartner--b-to-b-e-sales-will-exceed-b-to-c-by-tenfold-next-year.html) (~7% of the global economy); Goldman Sachs said $4.3 trillion by 2005 ([retrospective](https://www.the-future-of-commerce.com/2014/08/13/b2b-e-commerce-a-trillion-dollar-reality-check/)).
3. **Capital that priced the story, not the business.** [Chemdex](https://en.wikipedia.org/wiki/Chemdex) IPO'd in July 1999 with **$165K of quarterly sales (82% from one customer, Genentech)** and closed its first day worth $758M. By February 2000, renamed Ventro, it traded at $243/share — a market cap variously reported at $7–11B. The name change alone moved the stock 30% in a day.

The canonical archetypes:

- **Independent/neutral verticals:** Chemdex (life-science supplies), e-STEEL, MetalSite, PaperExchange, Altra (energy), efdex/FoodTrader/GoFish/GlobalFoodExchange (food & ag), plus horizontal players like VerticalNet (which ran ~59 shallow vertical "communities").
- **Auction specialists:** FreeMarkets (reverse auctions for industrial inputs — notably a *services* business wrapped around software).
- **Incumbent consortia**, formed largely in *reaction* to the startups threatening to tax their supply chains: [Covisint](https://en.wikipedia.org/wiki/Covisint) (GM + Ford + DaimlerChrysler, Feb 2000, $500M committed), [Transora](https://progressivegrocer.com/history-making) (~50 CPG/food manufacturers incl. Coca-Cola, P&G, Unilever, ~$250M), [GlobalNetXchange](https://www.sdcexec.com/sourcing-procurement/news/10356780/gnx-wwre-complete-merger-to-form-agentrics) (Sears, Carrefour, Kroger + Oracle) vs. WorldWide Retail Exchange (Ahold, Kmart, Target, Tesco et al.), Rooster.com (Cargill + DuPont + Cenex, farm inputs), Exostar (aerospace), Elemica (chemicals), Trade-Ranger (energy).

Before these exchanges existed, trade coordination worked — expensively — through distributors, brokers, and direct sales relationships that bundled discovery, credit, logistics, and quality assurance into the product margin. That bundling is the key fact the era's founders missed.

### Cast of characters (summary table)

| Exchange | Vertical | Model | Peak | Fate |
|---|---|---|---|---|
| Chemdex / Ventro | Life-science supplies | Neutral catalog aggregator, transaction fees | ~$10–11B market cap, Feb 2000 | Marketplaces shut Dec 2000; shell pivoted to software; assets eventually bankrupt (2011) |
| Covisint | Automotive | Big Three consortium | $500M invested; target: $0.5T annual flow | 40/30,000 suppliers in 5 months; sold to Compuware 2004 as identity software; later OpenText |
| Transora | CPG / food manufacturing | ~50-manufacturer consortium (~$250M) | Never achieved trading liquidity | Retreated to data sync; merged with UCCnet → 1SYNC (GS1), 2005 |
| GNX / WWRE | Retail (grocery incl.) | Rival retailer consortia | 50+ global retailers as members | Merged into Agentrics 2005; sold to NeoGrid 2008 |
| e-STEEL | Steel | Neutral bid/ask exchange | Well-funded, prominent | Renamed NewView Technologies Nov 2001; exited exchange business |
| MetalSite | Steel/metals | Producer-backed marketplace | ~$200M total orders facilitated | Shut June 2001, 62 of 72 staff fired |
| FreeMarkets | Industrial inputs | Reverse-auction events + services | ~$7B market cap post-IPO | Survived operationally; sold to Ariba 2004 for ~$493M |
| VerticalNet | 59 horizontal "communities" | Media/community → exchange software | $10.8B valuation on ~$100M revenue | Media assets sold for $2.35M cash; software remnant → JAGGAER lineage |
| efdex | Food & beverage | Neutral exchange (UK/US) | $69M VC raised | Collapsed 2000 with "nothing but a website" |
| FoodTrader.com | Food, multi-category | Neutral exchange | 8,000 registrants, 170 countries | Folded; brand later revived by unrelated owners |
| GoFish.com | Seafood | Exchange + payment guarantee (80% in 48h) | Niche traction | Gone by ~2002 |
| Rooster.com | Farm inputs | Cargill/DuPont/Cenex consortium | — | Folded 2001 |
| Ariba | Horizontal procurement | Software → network | ~$40B market cap 2000 | Survived; SAP acquired for $4.3B (2012); network carried $319B/yr |
| Alibaba.com | Export trade (China) | Supplier directory, storefront fees | — | Survived; escrow (Trade Assurance) added only 2014–15 |
| Grainger | MRO distribution | Incumbent distributor, online catalog | — | Never disintermediated; now a top US B2B e-commerce operation |

## 2. Mechanics

The designs varied, but the modal independent exchange looked like:

- **Identity:** company accounts with credentialed buyers; membership agreements; no cryptographic identity, no portable reputation. Consortia layered on heavier onboarding (Covisint's post-FTC security model became its actual product: federated single sign-on into hundreds of supplier networks).
- **Discovery/intent:** aggregated multi-supplier catalogs (Chemdex unified ~hundreds of life-science catalogs), posted offers/RFQs, or auction events. This maps to DTP's SupplyListing/TradeIntent layer — and it was the *only* layer most exchanges actually built.
- **Matching:** search + RFQ routing; bid/ask boards for commodities (e-STEEL, MetalSite); scheduled reverse auctions (FreeMarkets ran staffed, consultant-prepared auction events, with claimed ~20% average savings per project — [InformationWeek](https://www.informationweek.com/software-services/ariba-s-buyout-of-freemarkets-bears-first-fruit)).
- **Contract:** formation happened *off-exchange* in most cases — the exchange produced a PO or an auction result; master agreements, specs, and terms were negotiated bilaterally through existing legal channels.
- **Settlement:** almost none. Payment ran on invoices and corporate credit exactly as before. Chemdex took orders and passed them to suppliers, booking transaction fees on gross flow. A rare exception: GoFish.com (seafood) guaranteed sellers 80% payment within 48 hours — i.e., the one food exchange that touched settlement risk did so by *becoming a counterparty*, not by staying neutral ([Forbes, July 2000](https://www.forbes.com/global/2000/0724/0314111a.html)).
- **Escrow/attestation/traceability:** absent. No exchange verified delivery, held funds, or attested quality. Disputes fell back to bilateral relationships and courts.
- **Revenue/governance:** transaction fees of ~0.5–3% of GMV, plus membership dues; independents governed by VCs, consortia governed by committees of competitors (Covisint burned through 6 CEOs in ~2 years and could not get its owner-automakers to agree on priorities — [Computerworld](https://www.computerworld.com/article/1355549/covisint-the-road-traveled.html)).

Compared to DTP's pipeline, the 1999 exchange implemented roughly the first 1.5 stages and charged as if it had built all seven:

| DTP stage | 1999 exchange coverage | Who actually did it in 1999 |
|---|---|---|
| Intent (TradeIntent) | Partial — RFQs, auction lot postings | Buyer's purchasing dept, by phone/fax |
| Listing (SupplyListing) | Yes — aggregated catalogs, bid/ask boards | Supplier catalogs, sales reps |
| Matching | Yes — search, RFQ routing, auctions | Brokers, distributors, trade shows |
| Contract | No — PO generated, terms negotiated offline | Bilateral master agreements, lawyers |
| Escrow / payment security | No (GoFish's 48h/80% guarantee the lone partial exception) | Trade credit, letters of credit, factoring |
| Delivery attestation | No | Bills of lading, receiving docks, trust |
| Settlement | No — invoice + net-30/60/90 as before | Corporate AR/AP, banks |
| Traceability / compliance | No | Paper trails, later GS1 data sync (the one layer that survived) |

## 3. Adoption Trajectory

### Timeline

- **1995–1997:** First movers (FreeMarkets 1995, Chemdex 1997) launch quietly; EDI over VANs remains the incumbent "electronic" channel.
- **1998:** Chemdex live (Oct); e-STEEL, MetalSite, PaperExchange launch; VerticalNet IPO (Feb 1999 filing period begins).
- **1999:** IPO wave — Chemdex (Jul), FreeMarkets (Dec, stock up ~483% day one), VerticalNet. Hundreds of copycats funded; Alibaba.com founded in Hangzhou.
- **Feb–Apr 2000:** Peak mania. Ventro at $243/share; Covisint announced (Feb); Transora announced (Mar); GNX vs. WWRE formed within weeks of each other; Gartner's $7.3T forecast lands (Apr) — three weeks after the NASDAQ peak.
- **Apr 2000–Dec 2000:** Funding window slams shut. Ventro shuts Chemdex/Promedix (Dec).
- **2001:** Mass extinction — MetalSite shut (Jun), efdex gone, food exchanges fold, e-STEEL exits exchange business (Nov); consortia quietly refocus on auctions/data sync.
- **2002–2005:** Long tail of consolidation: ~1,520 exchanges (2001) → ~180 (2003); Covisint sold (2004); FreeMarkets absorbed by Ariba (2004); Transora+UCCnet → 1SYNC (2005); GNX+WWRE → Agentrics (2005).

### Numbers

- **Peak:** ~1,500 exchanges. [Day, Fein & Ruppersberger (California Management Review, 2003)](https://journals.sagepub.com/doi/10.2307/41166169) count **1,520 B2B exchanges in 2001, collapsing to a projected ~180 by 2003** — a ~88% extinction rate in under six years ([Wharton summary](https://knowledge.wharton.upenn.edu/article/surviving-the-shakeout-where-b2b-exchanges-went-wrong/)).
- **Chemdex/Ventro:** 1998 sales $29K → market cap approaching $10–11B in Feb 2000 → [both marketplaces shut December 2000](https://www.thestreet.com/technology/ventro-shutters-its-flagship-chemdex-exchange-1202509), 235 layoffs, $400M charge; stock at $2 (~1% of peak), $0.39 by mid-2001. Transaction-fee revenue never came close to covering the cost of acquiring and serving flow ([Pharmaceutical Online](https://www.pharmaceuticalonline.com/doc/ventro-pulls-the-plug-on-chemdex-promedix-onl-0003)).
- **Covisint:** designed to carry up to **half a trillion dollars** of annual purchasing from 8,000 suppliers; in its first five months it signed **40 of 30,000** target suppliers. An FTC antitrust probe consumed 7 months and ~$35M ([Forbes](https://www.forbes.com/sites/joannmuller/2012/06/27/covisint-detroits-failed-internet-venture-is-alive-and-well-and-about-to-go-public/), [Encyclopedia.com](https://www.encyclopedia.com/economics/encyclopedias-almanacs-transcripts-and-maps/covisint)). Sold to Compuware in Feb 2004 for ~$293M — versus ~$500M invested — as an identity/messaging software asset, not an exchange.
- **Steel:** MetalSite facilitated only ~$200M of orders before [shuttering in June 2001](https://www.informationweek.com/it-leadership/metalsite-headed-for-scrap-heap-) and firing 62 of 72 staff; e-STEEL abandoned the exchange model, [renamed itself NewView Technologies](https://www.crainsdetroit.com/article/20020429/SUB/204290887/online-trade-exchanges-what-went-wrong) (Nov 2001) and became a collaboration-software vendor.
- **Food & ag:** efdex burned **$69M of VC with "nothing but a website to show for it"**; FoodTrader.com signed up 8,000+ registrants across 170 countries but registration never became liquidity; GoFish, GlobalFoodExchange, BevAccess, FoodUSA and Rooster.com all folded or were absorbed within ~2 years ([Forbes survey, July 2000](https://www.forbes.com/global/2000/0724/0314111a.html)). Transora launched with ~$250M from CPG manufacturers, found no takers for its trading functions, retreated to data synchronization, and [merged with UCCnet in 2005 to form 1SYNC](https://www.digitalcommerce360.com/2005/08/26/uccnet-and-transora-complete-merger-to-form-1sync/) under GS1 — i.e., the food-industry "exchange" survived only as a *product-data registry standard body*.
- **Retail consortia:** GNX and WWRE limped along on auctions and CPFR pilots, then [merged into Agentrics (Nov 2005)](https://www.sdcexec.com/sourcing-procurement/news/10356780/gnx-wwre-complete-merger-to-form-agentrics), which was sold to Brazil's NeoGrid in 2008 — again as supply-chain *software*, not a marketplace.
- **VerticalNet:** IPO'd at a **$10.8B valuation on ~$100M of revenue**; its media/community assets were eventually [sold for $2.35M cash plus earn-out](https://www.jaggaer.com/blog/story-of-verticalnet) — a >99.9% value destruction — while the software remnant passed through several owners into what is now part of JAGGAER.
- **Survivors:** Ariba nearly died with the bubble (peak market cap ~$40B, then ~95%+ drawdown), pivoted from marketplace software to a *fee-charging procurement network* riding buyers' existing supplier relationships; it [bought FreeMarkets for ~$493M in 2004](https://www.mhlnews.com/technology-automation/article/22046856/ariba-acquires-freemarkets) and was [acquired by SAP for $4.3B in 2012](https://techcrunch.com/2012/05/22/sap-to-acquire-ariba-for-4-3-billion/), by then carrying $319B/year across 730,000 companies. Grainger — the incumbent MRO *distributor* the exchanges were supposed to kill — simply put its catalog online and is now one of the largest B2B e-commerce operations in the US. Alibaba.com survived 2001 as a cheap *listings/directory* business for Chinese exporters (charging suppliers for storefronts and verification, not taxing transactions); its escrow-style settlement layer, [Trade Assurance, only arrived in 2014–15](https://www.prnewswire.com/news-releases/alibabacom-celebrates-eight-years-of-its-trade-assurance-protections-providing-security-and-confidence-to-growing-businesses-301886316.html) — fifteen years after founding, once liquidity already existed.

## 4. Incentive Autopsy

- **Who paid for it?** VCs and public-market investors (independents — sector estimated ~100x over-capitalized relative to realized demand, per [InsightReports' retrospective](https://www.insightreports.org/reports/why-b2b-marketplaces-keep-failing-despite-massive-funding/)); incumbent members (consortia — Covisint $500M, Transora ~$250M, largely as defensive insurance and equity-upside speculation).
- **Who captured the value?** Almost nobody. Buyers captured auction savings where auctions ran (FreeMarkets' ~20%/event), which is precisely why *suppliers* refused to fund the mechanism that extracted their margin. Consultants, enterprise-software vendors (Oracle, Commerce One, Ariba licenses), and investment banks captured the spend. Sellers of exchanges to acquirers captured salvage value.
- **Who bore the integration cost?** Suppliers, overwhelmingly — catalog digitization, content normalization, process change — for exchanges whose explicit purpose was to compress supplier margins and commoditize their differentiation. Suppliers were asked to pay a 1–3% tax on flow they already owned via existing relationships. They rationally declined; many joined defensively and routed no volume ("registration ≠ liquidity").
- **The middleman problem:** exchanges claimed distributors/brokers were a deadweight coordination tax. But the incumbent middleman's margin was a bundle ([Distribution Strategy Group](https://distributionstrategy.com/the-importance-of-value-added-services-in-distribution-today/); Rust & Hall, ["Middlemen versus Market Makers"](https://people.brandeis.edu/~ghall/papers/rust_hall_jpe.pdf), JPE 2003 — written with e-STEEL/MetalSite as the live experiment, and predicting middlemen's resilience correctly):
  - **Trade credit** — net-30/60/90 terms and absorption of buyer default risk (the manufacturer wants this centralized somewhere that isn't its own balance sheet);
  - **Aggregation and break-bulk** — one PO/one invoice/one truck across many small suppliers, serving buyers too small for producers to serve directly;
  - **Inventory buffering** — carrying stock so demand volatility lands on the middleman's working capital, not the buyer's shelf or the seller's plant;
  - **Quality assurance and returns** — inspection, grading (crucial and subjective in food), a throat to choke when the lot is bad;
  - **Spec and market knowledge** — knowing which supplier's "US #1" actually grades out, seasonal sourcing, substitutions;
  - **Relationship-mediated dispute resolution** — repeat business as the enforcement mechanism nobody had to write down.

  The exchanges unbundled discovery alone, priced it at 1–3% of GMV, and left the expensive 90% of the middleman's job with... the middleman — who then had every incentive and every ability to kill the exchange. And a **new middleman did appear**: the consortium operator/network itself — Covisint, Transora, GNX/WWRE, later the Ariba Network, which today charges suppliers network fees at scale. The coordination tax was not eliminated; it was re-platformed — and only where it rode existing relationships rather than trying to replace them.

## 5. What's Right

- **The inefficiency was real.** Procurement digitization did happen — B2B e-commerce today is measured in trillions ([Forrester](https://www.forrester.com/press-newsroom/forrester-us-b2b-e-commerce-will-reach-an-estimated-3-trillion-by-2027)). The forecasts were wrong on timing and *capture*, not on direction.
- **Vertical focus and domain depth** (Kaplan & Sawhney's ["E-Hubs" taxonomy](https://hbr.org/2000/05/e-hubs-the-new-b2b-marketplaces): what is bought × how it is bought — spot vs. systematic — remains the best one-page map of B2B market structure; DTP should locate itself on it deliberately).
- **Reverse auctions worked where the product was truly spec-able** — FreeMarkets delivered real, measured savings on custom industrial parts, because it invested heavy *human* effort in RFQ preparation, spec normalization, and supplier vetting before any bid ran. The lesson: matching quality is downstream of data/spec quality, which someone must pay to produce.
- **Standardized product data outlasted everything.** The only piece of the food-industry consortium stack that survived (Transora → 1SYNC → GS1 GDSN) was the boring layer: synchronized item data and identifiers. Standards outlived marketplaces by decades.
- **Federated identity as a by-product** — Covisint's durable asset was letting one credential reach hundreds of supplier systems. Portable B2B identity was valuable even when the marketplace wasn't.
- **The U-turn pivots that worked point in one direction: serve existing relationships.** [Neoforma](https://knowledge.wharton.upenn.edu/article/surviving-the-shakeout-where-b2b-exchanges-went-wrong/) (hospital supplies) abandoned its open exchange and became software running the *existing* Novation GPO relationships; SciQuest abandoned neutral exchange for building private marketplaces for established pharma buyers. Day & Fein's advice to survivors — "play the right game… be prepared to take U-turns" — in practice always meant: stop trying to re-match parties, start servicing the matches that already exist.
- **The survivors' shape:** ride existing relationships and take fees on flow that already wants to happen (Ariba Network), or *be* the merchant with real inventory and service (Grainger, Amazon Business), or start as near-free discovery and add settlement/trust only after liquidity exists (Alibaba → Trade Assurance in 2014–15).

## 6. What's Wrong / Failure Modes

Be precise about cause of death; the press-release version was "the dot-com downturn." The actual mechanisms:

1. **Liquidity chicken-and-egg, unsubsidized.** Neutral exchanges needed both sides simultaneously; neither side would commit volume to an empty venue, and no exchange could afford to subsidize liquidity to the break-even point. Most died *before* network effects could activate ([InsightReports](https://www.insightreports.org/reports/why-b2b-marketplaces-keep-failing-despite-massive-funding/)). 8,000 registered FoodTrader members produced negligible trades.
2. **B2B trade is relationship-based repeat business, not spot matching.** The overwhelming majority of B2B volume moves under negotiated annual contracts, qualified-vendor lists, and multi-year relationships. Day/Fein/Ruppersberger's core finding: exchanges treated a **"re-formed" market as a "breakthrough" market** — the incumbents held the customers, the trust, and the data, and "the odds favor the leading incumbents in markets being re-formed by the Internet" ([Wharton](https://knowledge.wharton.upenn.edu/article/surviving-the-shakeout-where-b2b-exchanges-went-wrong/)). Spot matching addressed a thin sliver of real demand (distressed lots, overflow, commodity graded goods) and priced itself as if it addressed everything.
3. **No incentive for the party with pricing power to show up.** Sellers with negotiated pricing saw exchanges as price-discovery weapons pointed at their own margins. Buyers valued reliability and continuity over the last 3%. So the side each exchange needed most was the side structurally motivated to boycott it.
4. **Transaction-fee resistance.** A 0.5–3% ad valorem tax on thin-margin physical goods (food distribution nets low single digits) is enormous relative to value delivered when the exchange only does discovery. Participants either resisted the fee, negotiated it away, or — worst case — used the exchange for discovery and closed the deal offline (disintermediating the disintermediator).
5. **The middleman's bundle was load-bearing** (see §4). No exchange replaced credit, aggregation, QA, logistics, or dispute absorption; food exchanges in particular collided with spoilage, grading subjectivity, cold-chain logistics, and licensing/regulatory burdens ([Forbes](https://www.forbes.com/global/2000/0724/0314111a.html) — "How does shrimp get out of a pond in Thailand and end up on your plate? You don't want to know").
6. **Consortium governance poison.** Competitor-owned exchanges couldn't decide, couldn't move fast, triggered antitrust scrutiny (Covisint's FTC probe), and repelled the very non-member participants they needed — who refused to route data and fees to a venue owned by their competitors ([OpenText retrospective](https://blogs.opentext.com/b2b-e-marketplaces-a-look-back-ten-years-later/)).
7. **Cost structure vs. take rate.** Chemdex booked gross flow but its economics were a thin fee minus heavy catalog-integration, sales, and support costs. Revenue model "based primarily on transaction fees" was simply not viable at achievable volume ([TheStreet](https://www.thestreet.com/technology/ventro-shutters-its-flagship-chemdex-exchange-1202509)).
8. **Crowding.** ~1,500 exchanges chasing the same story meant several near-identical venues per vertical, splitting already-insufficient liquidity ([Day/Fein/Ruppersberger](https://journals.sagepub.com/doi/10.2307/41166169)).
9. **Gross-flow accounting masked the absence of a business.** Booking GMV (or gross order value) as "revenue" let Chemdex-style exchanges show hockey-stick charts while net economics were a rounding error; when markets started demanding net numbers in mid-2000, the category's P&Ls were revealed as fee slivers under enormous fixed costs. Any successor should assume its true unit economics will eventually be read net.
10. **No stickiness after the match.** Because the exchanges held no funds, carried no risk, and kept no state the parties valued (no escrow, no attestation record, no compliance artifact), a counterparty pair matched once had zero reason to return. Discovery is a one-shot value; settlement, trust, and records are recurring values. The era built only the one-shot layer.

## 7. Kill Conditions

What was true when the category died — each is a standing kill condition for any successor, including DTP:

- Liquidity subsidy runs out before matched volume covers operating cost.
- The venue's economics require participation from a party whose margins the venue exists to compress.
- Take rate > verifiable value added per transaction (fee resistance → offline leakage → death spiral).
- Incumbent intermediaries can replicate the venue's only feature (online ordering) while retaining their bundle — Grainger.com beat the MRO exchanges by existing.
- Governance owned by competitors of prospective users.
- Capital-market regime change removes the subsidy all at once (April 2000): every exchange hit its kill conditions simultaneously.

What keeps the survivors alive: Ariba/SAP rides *existing* buyer–supplier relationships and network lock-in on invoice/PO flow; Grainger owns inventory, credit, and fulfillment (it is the middleman); Alibaba built discovery cheaply for an export market with no incumbent relationship structure, then monetized trust (verification, then escrow via Trade Assurance) once liquidity was captive; GS1/1SYNC survives as a neutral standards utility funded by dues, not transaction taxes.

## 8. Null Hypothesis Check

Would the trade have happened without the exchanges? **Almost all of it did — and does.** The steel still moved through brokers and mills' sales desks; the reagents still moved through VWR and Fisher; the produce still moved through terminal-market wholesalers. The exchanges' incremental contribution over phone/fax/catalog was: (a) faster multi-supplier search, (b) occasional auction savings on spec-able spot buys, (c) cleaner product data. Of these, only (c) proved worth institutionalizing at industry scale (GDSN), and (b) survived as a procurement-consulting/software feature inside buyers' own processes — not as a neutral venue. The honest accounting: for relationship-based repeat B2B trade, a neutral matching venue added nearly nothing the incumbent bundle didn't already provide, at a fee the trade couldn't bear. The 20–30% "coordination tax" turned out to be maybe 3–5 points of true search/matching friction plus 15–25 points of *paid-for services* (credit, aggregation, buffering, QA, risk). The exchanges priced themselves against the whole tax while replacing only the sliver.

## 9. Lessons for DTP

**Avoid this:**

1. **Do not assume the 20–30% middleman margin is coordination waste.** Decompose it per category (credit/terms, aggregation/break-bulk, cold-chain logistics, QA/rejection risk, demand smoothing, relationship insurance). DTP's protocol must replace or explicitly out-source *each* function it disintermediates, or the middleman stays and DTP becomes a lead-gen tool for offline deals. This is the single strongest lesson of 1998–2002.
2. **Spot matching is a niche, not the market.** Most food/ag wholesale volume is programmed, repeat, relationship-priced. If TradeIntent → matching only serves spot/overflow/distressed flow, size the opportunity honestly (single-digit % of volume) — or design first-class support for *standing relationships*: recurring intents, preferred-counterparty matching, contract renewal on-protocol. The exchanges died treating a re-formed market as a breakthrough market.
3. **Ad valorem transaction fees on thin-margin physical goods triggered boycott and leakage every time.** DTP's advantage: as a protocol it can charge ~zero take rate, monetizing (if at all) at the service layer. Guard obsessively against any design where value capture requires taxing flow that can settle offline. Assume counterparties who meet via DTP will try to complete off-protocol; make on-protocol settlement (escrow safety, attestation history, FSMA 204 compliance for free) the thing they *want*, not the toll they must pay.
4. **Don't require the disadvantaged party to fund its own commoditization.** Sellers won't do integration work for a venue whose function is price compression. Sequence: deliver seller-side value first (faster payment via escrow release, compliance automation, reputation portability) before asking sellers to expose price/inventory.
5. **Beware consortium capture and its mirror image.** Neutral-and-empty failed; competitor-owned-and-distrusted also failed. A protocol with open governance (closest analog: GS1, the era's only true survivor as a neutral layer) is the one governance shape that lived. DTP being a protocol rather than a platform is the right response — but only if governance is credibly not capturable by any trading side.
6. **Registration is not liquidity.** 8,000 FoodTrader members, 40 of 30,000 Covisint suppliers. Measure matched, settled volume from day one; treat signups as vanity. Launch in one narrow corridor (one region × one product family) and get to repeated settled trades before widening — 1,500 exchanges split liquidity and all starved.

**Steal this:**

7. **Settlement and trust were the missing layers — and they're DTP's core.** No 1999 exchange held funds, verified delivery, or absorbed counterparty risk; the one that touched payment risk (GoFish's 48-hour 80% guarantee) at least understood the problem. Alibaba's eventual moat was exactly escrow + verification (Trade Assurance). DTP building escrow + delivery attestation *into the protocol* addresses the era's biggest gap. But note the sequencing: Alibaba added escrow to existing liquidity; DTP must not assume escrow alone *creates* liquidity.
8. **Data/spec quality is the real matching engine.** FreeMarkets' auctions worked because humans normalized specs first; GDSN survived because clean item data compounds. For food & ag, machine-readable specs, grades, and lot data (which DTP's FSMA 204 layer requires anyway) are a prerequisite for agent-native matching — invest there before matching cleverness.
9. **Ride existing relationships; don't fight them.** Ariba won by digitizing PO/invoice flow between parties who already traded. DTP's agent-native framing should let a buyer's agent and its *incumbent* suppliers' agents transact on-protocol (getting escrow + traceability) — capturing existing flow — rather than only brokering strangers.
10. **The by-products may outvalue the venue.** Covisint's salvage value was federated identity; Transora's was data sync. DTP's portable identity, attestation history, and on-chain traceability records are assets with standalone value even where matching is thin — design them to be independently useful.

**Tripwires (measurable, from the era's autopsies):**

- *Registration-to-settlement ratio.* FoodTrader: 8,000 registrants, ~0 liquidity. If DTP's ratio of onboarded orgs to orgs with ≥1 settled trade in 90 days looks like a funnel with no bottom, it is 1999 again.
- *Repeat-trade share.* If <50% of settled volume is between counterparties who have traded on-protocol before within 2 quarters, DTP is serving only spot flow — the sliver that starved every neutral exchange.
- *Off-protocol leakage.* Track matches that go silent before contract. The exchanges never instrumented this; it was how they died. If discovery happens on DTP but settlement happens by wire-and-invoice, the escrow layer is priced or designed wrong.
- *Who is doing integration work, and what do they get this quarter?* Covisint's suppliers were asked to integrate so their margins could be auctioned down; 40 of 30,000 showed up. Every DTP integration ask must be paired with a same-quarter benefit to the integrating party (faster cash via escrow release, automated FSMA 204 filings, portable reputation).
- *Effective take rate vs. delivered value.* The era's ceiling on tolerated ad valorem fees for discovery-only value was effectively ~0%. Whatever DTP or its service layer charges must be defensible against the specific service rendered (escrow, compliance, attestation), never against gross flow.
- *Concentration.* Chemdex Q1-1999: 82% of revenue from one relationship (Genentech). A protocol whose settled volume is one anchor pair is a demo, not a network.

## Sources

- [Chemdex — Wikipedia](https://en.wikipedia.org/wiki/Chemdex)
- [Ventro Shutters Its Flagship Chemdex Exchange — TheStreet](https://www.thestreet.com/technology/ventro-shutters-its-flagship-chemdex-exchange-1202509)
- [Ventro pulls the plug on Chemdex, Promedix — Pharmaceutical Online](https://www.pharmaceuticalonline.com/doc/ventro-pulls-the-plug-on-chemdex-promedix-onl-0003)
- [B2B: Chemdex and Promedix going out of business — Chemeurope](https://www.chemeurope.com/en/news/497/b2b-chemdex-and-promedix-going-out-of-business.html)
- [B2B exchanges dying off fast — SFGate](https://www.sfgate.com/business/article/B2B-exchanges-dying-off-fast-Inherent-problems-2918497.php)
- [Day, Fein & Ruppersberger, "Shakeouts in Digital Markets: Lessons from B2B Exchanges," California Management Review 45(2), 2003](https://journals.sagepub.com/doi/10.2307/41166169)
- [Surviving the Shakeout: Where B2B Exchanges Went Wrong — Knowledge at Wharton](https://knowledge.wharton.upenn.edu/article/surviving-the-shakeout-where-b2b-exchanges-went-wrong/)
- [Kaplan & Sawhney, "E-Hubs: The New B2B Marketplaces," HBR May–June 2000](https://hbr.org/2000/05/e-hubs-the-new-b2b-marketplaces)
- [Rust & Hall, "Middlemen versus Market Makers: A Theory of Competitive Exchange," Journal of Political Economy 111(2), 2003](https://people.brandeis.edu/~ghall/papers/rust_hall_jpe.pdf)
- [Covisint — Wikipedia](https://en.wikipedia.org/wiki/Covisint)
- [Covisint: The Road Traveled — Computerworld](https://www.computerworld.com/article/1355549/covisint-the-road-traveled.html)
- [Covisint Didn't Die; It Just Went to the Cloud — Forbes](https://www.forbes.com/sites/joannmuller/2012/06/27/covisint-detroits-failed-internet-venture-is-alive-and-well-and-about-to-go-public/)
- [Covisint — Encyclopedia.com](https://www.encyclopedia.com/economics/encyclopedias-almanacs-transcripts-and-maps/covisint)
- [Harder than the Hype — Forbes Global, April 2001](https://www.forbes.com/global/2001/0416/082.html)
- [Online trade exchanges: What went wrong? — Crain's Detroit Business](https://www.crainsdetroit.com/article/20020429/SUB/204290887/online-trade-exchanges-what-went-wrong)
- [MetalSite Headed for Scrap Heap? — InformationWeek](https://www.informationweek.com/it-leadership/metalsite-headed-for-scrap-heap-)
- [Food & Beverage exchanges survey — Forbes Global, July 2000](https://www.forbes.com/global/2000/0724/0314111a.html)
- [UCCnet and Transora complete merger to form 1SYNC — Digital Commerce 360](https://www.digitalcommerce360.com/2005/08/26/uccnet-and-transora-complete-merger-to-form-1sync/)
- [History in the Making (Transora/UCCnet) — Progressive Grocer](https://progressivegrocer.com/history-making)
- [GNX, WWRE Complete Merger to Form Agentrics — Supply & Demand Chain Executive](https://www.sdcexec.com/sourcing-procurement/news/10356780/gnx-wwre-complete-merger-to-form-agentrics)
- [Agentrics NeoGrid acquisition — FreightWaves](https://www.freightwaves.com/news/agentrics-neogrid-starts-supply-chain-portal)
- [The Story of VerticalNet — JAGGAER](https://www.jaggaer.com/blog/story-of-verticalnet)
- [Ariba acquires FreeMarkets — Material Handling & Logistics](https://www.mhlnews.com/technology-automation/article/22046856/ariba-acquires-freemarkets)
- [Ariba's Buyout of FreeMarkets Bears First Fruit — InformationWeek](https://www.informationweek.com/software-services/ariba-s-buyout-of-freemarkets-bears-first-fruit)
- [SAP to Acquire Ariba for $4.3 Billion — TechCrunch](https://techcrunch.com/2012/05/22/sap-to-acquire-ariba-for-4-3-billion/)
- [Alibaba.com Trade Assurance eighth anniversary — PR Newswire](https://www.prnewswire.com/news-releases/alibabacom-celebrates-eight-years-of-its-trade-assurance-protections-providing-security-and-confidence-to-growing-businesses-301886316.html)
- [Gartner: B-to-B e-sales will exceed B-to-C tenfold — Computerworld, 2000](https://computerworld.com/article/2594794/gartner--b-to-b-e-sales-will-exceed-b-to-c-by-tenfold-next-year.html)
- [B2B e-commerce: A trillion-dollar reality check — Future of Commerce](https://www.the-future-of-commerce.com/2014/08/13/b2b-e-commerce-a-trillion-dollar-reality-check/)
- [B2B e-Marketplaces – A Look Back Ten Years Later — OpenText](https://blogs.opentext.com/b2b-e-marketplaces-a-look-back-ten-years-later/)
- [Ten Reasons the B2B e-Marketplaces Failed — OpenText](https://blogs.opentext.com/ten-reasons-the-b2b-e-marketplaces-failed/)
- [The Graveyard Is Full: Why B2B Marketplaces Keep Failing — InsightReports](https://www.insightreports.org/reports/why-b2b-marketplaces-keep-failing-despite-massive-funding/)
- [The Importance of Value-Added Services in Distribution — Distribution Strategy Group](https://distributionstrategy.com/the-importance-of-value-added-services-in-distribution-today/)
- [Forrester: US B2B e-commerce to reach $3T by 2027](https://www.forrester.com/press-newsroom/forrester-us-b2b-e-commerce-will-reach-an-estimated-3-trillion-by-2027)
