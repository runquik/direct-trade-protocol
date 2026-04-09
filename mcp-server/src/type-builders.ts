/**
 * Conversion functions between human-friendly MCP tool params
 * and the NEAR contract's internal representations.
 *
 * Key conversions:
 *   - Dollars → microdollars (×1,000,000)
 *   - Human amounts → milliamounts (×1,000)
 *   - ISO date strings → Unix milliseconds
 *   - Flat params → nested contract structs
 *
 * Reverse conversions for formatting view results back to human-readable.
 */

// ── Forward conversions (human → contract) ──────────────────────────────

export function dollarsToMicrodollars(dollars: number): string {
  return Math.round(dollars * 1_000_000).toString();
}

export function amountToMilliamount(amount: number): number {
  return Math.round(amount * 1000);
}

export function isoToUnixMs(iso: string): number {
  const ms = new Date(iso).getTime();
  if (isNaN(ms)) throw new Error(`Invalid date: ${iso}`);
  return ms;
}

// ── Reverse conversions (contract → human) ──────────────────────────────

export function microdollarsToDollars(micro: string | number): number {
  const n = typeof micro === "string" ? Number(micro) : micro;
  return n / 1_000_000;
}

export function milliamountToAmount(milli: number): number {
  return milli / 1000;
}

export function unixMsToIso(ms: number): string {
  if (ms === 0) return "N/A";
  return new Date(ms).toISOString().split("T")[0]!;
}

export function unixMsToIsoFull(ms: number): string {
  if (ms === 0) return "N/A";
  return new Date(ms).toISOString();
}

// ── Struct builders ─────────────────────────────────────────────────────

export function buildGoodsSpec(p: {
  category: string;
  product_name: string;
  description: string;
  product_type: string;
  quantity_amount: number;
  quantity_unit: string;
  grade: string;
  packaging: string;
  quality_specs?: string[];
  required_certifications?: string[];
  shelf_life_days?: number;
}) {
  return {
    category: p.category,
    product_name: p.product_name,
    description: p.description,
    product_type: p.product_type,
    commodity_details: null,
    branded_details: null,
    value_added_details: null,
    quantity: {
      milliamount: amountToMilliamount(p.quantity_amount),
      unit: p.quantity_unit,
    },
    grade: p.grade,
    quality_specs: p.quality_specs ?? [],
    required_certifications: p.required_certifications ?? [],
    packaging: p.packaging,
    shelf_life_days: p.shelf_life_days ?? null,
  };
}

export function buildDeliverySpec(p: {
  destination_city: string;
  destination_state: string;
  destination_zip: string;
  destination_country: string;
  delivery_earliest: string;
  delivery_latest: string;
  delivery_method: string;
  temperature?: string;
  notes?: string;
}) {
  return {
    destination_city: p.destination_city,
    destination_state: p.destination_state,
    destination_zip: p.destination_zip,
    destination_country: p.destination_country,
    window_earliest: isoToUnixMs(p.delivery_earliest),
    window_latest: isoToUnixMs(p.delivery_latest),
    method: p.delivery_method,
    temperature: p.temperature ?? null,
    notes: p.notes ?? null,
  };
}

export function buildPackStructure(p: {
  unit_size_amount: number;
  unit_size_unit: string;
  units_per_case: number;
  cases_per_pallet: number;
  moq_amount: number;
  moq_unit: string;
  moq_label: string;
  pallets_per_truckload?: number;
}) {
  return {
    unit_size: {
      milliamount: amountToMilliamount(p.unit_size_amount),
      unit: p.unit_size_unit,
    },
    units_per_case: p.units_per_case,
    cases_per_pallet: p.cases_per_pallet,
    pallets_per_truckload: p.pallets_per_truckload ?? null,
    moq: {
      milliamount: amountToMilliamount(p.moq_amount),
      unit: p.moq_unit,
    },
    moq_label: p.moq_label,
  };
}

export function buildSellerPricing(p: {
  pricing_model: string;
  asking_price_per_unit: number;
}) {
  return {
    model: p.pricing_model,
    asking_price_per_unit: dollarsToMicrodollars(p.asking_price_per_unit),
    tiers: [],
  };
}

export function buildBuyerPricing(p: { ceiling_price_per_unit: number }) {
  return {
    ceiling_price_per_unit: dollarsToMicrodollars(p.ceiling_price_per_unit),
  };
}

// ── Formatters (contract data → human-readable strings) ─────────────────

export function formatDollars(micro: string | number): string {
  return `$${microdollarsToDollars(micro).toFixed(2)}`;
}

export function formatQuantity(q: { milliamount: number; unit: string }): string {
  return `${milliamountToAmount(q.milliamount)} ${q.unit}`;
}

export function formatParty(p: any): string {
  const lines = [
    `Party: ${p.party_id}`,
    `  Name: ${p.business_name}`,
    `  Type: ${p.business_type}`,
    `  Jurisdiction: ${p.jurisdiction}`,
    `  Reputation: ${p.reputation.score / 100}% (${p.reputation.trades_completed} trades)`,
  ];
  if (p.gs1_gln) lines.push(`  GLN: ${p.gs1_gln}`);
  if (p.duns_number) lines.push(`  D-U-N-S: ${p.duns_number}`);
  if (p.certifications?.length) {
    lines.push(`  Certifications: ${p.certifications.map((c: any) => c.cert_type).join(", ")}`);
  }
  return lines.join("\n");
}

export function formatListing(l: any): string {
  return [
    `Listing ${l.listing_id}: ${l.goods.product_name}`,
    `  Seller: ${l.seller}`,
    `  Quantity: ${formatQuantity(l.goods.quantity)} at ${formatDollars(l.pricing.asking_price_per_unit)}/unit`,
    `  Delivery: ${l.delivery.destination_city}, ${l.delivery.destination_state} by ${unixMsToIso(l.delivery.window_latest)}`,
    `  Method: ${l.delivery.method}`,
    `  Status: ${l.status}`,
    l.lot_id ? `  Lot: ${l.lot_id}` : null,
  ].filter(Boolean).join("\n");
}

export function formatIntent(i: any): string {
  return [
    `Intent ${i.intent_id}: ${i.goods.product_name}`,
    `  Buyer: ${i.buyer}`,
    `  Quantity: ${formatQuantity(i.goods.quantity)} at ceiling ${formatDollars(i.pricing.ceiling_price_per_unit)}/unit`,
    `  Delivery: ${i.delivery.destination_city}, ${i.delivery.destination_state} by ${unixMsToIso(i.delivery.window_latest)}`,
    `  Status: ${i.status}`,
    `  Expires: ${unixMsToIso(i.expires_at)}`,
  ].join("\n");
}

export function formatOffer(o: any): string {
  return [
    `Offer ${o.offer_id}`,
    `  Target: ${o.target_type} ${o.target_id}`,
    `  Offerer: ${o.offerer}`,
    `  Price: ${formatDollars(o.price_per_unit)}/unit, Total: ${formatDollars(o.total_price)}`,
    `  Quantity: ${formatQuantity(o.goods.quantity)}`,
    `  Status: ${o.status}`,
  ].join("\n");
}

export function formatContract(c: any): string {
  return [
    `Contract ${c.contract_id}`,
    `  Buyer: ${c.buyer}`,
    `  Seller: ${c.seller}`,
    `  Goods: ${c.goods.product_name} — ${formatQuantity(c.goods.quantity)}`,
    `  Price: ${formatDollars(c.price_per_unit)}/unit, Total: ${formatDollars(c.total_value)}`,
    `  Delivery by: ${unixMsToIso(c.delivery.window_latest)}`,
    `  Dispute window: ${c.dispute_window_hours}h`,
    `  Status: ${c.status}`,
  ].join("\n");
}

export function formatFulfillment(f: any): string {
  return [
    `Fulfillment ${f.fulfillment_id}`,
    `  Contract: ${f.contract_id}`,
    `  Delivered: ${unixMsToIsoFull(f.delivered_at)}`,
    `  Quantity: ${formatQuantity(f.quantity_delivered)}`,
    `  Seller attested: ${unixMsToIsoFull(f.seller_attestation.signed_at)}`,
    f.buyer_attestation ? `  Buyer attested: ${unixMsToIsoFull(f.buyer_attestation.signed_at)}` : `  Buyer: not yet attested`,
    `  Status: ${f.status}`,
  ].join("\n");
}

export function formatSettlement(s: any): string {
  return [
    `Settlement ${s.settlement_id}`,
    `  Contract: ${s.contract_id}`,
    `  Gross: ${formatDollars(s.gross_amount)}`,
    s.deductions?.length ? `  Deductions: ${s.deductions.map((d: any) => `${d.reason}: ${formatDollars(d.amount)}`).join(", ")}` : null,
    `  Net: ${formatDollars(s.net_amount)}`,
    `  Settled: ${unixMsToIsoFull(s.settled_at)}`,
  ].filter(Boolean).join("\n");
}

export function formatMatchResult(m: any): string {
  if (m.eligible) {
    return `Match: ELIGIBLE (score ${m.score}/10000)`;
  }
  return `Match: NOT ELIGIBLE\n  Reasons:\n${m.reasons.map((r: string) => `  - ${r}`).join("\n")}`;
}

export function formatRankedMatches(matches: any[]): string {
  if (matches.length === 0) return "No eligible matches found.";
  return matches.map((m: any, i: number) =>
    `${i + 1}. Intent: ${m.intent_id}, Listing: ${m.listing_id}, Score: ${m.score}/10000`
  ).join("\n");
}
