// DTP Marketplace MCP server — Supabase Edge Function (Deno).
// Stateless MCP over streamable HTTP: POST JSON-RPC in, JSON out.
// Auth: `Authorization: Bearer dtp_...` API key (hashed at rest). Registration is open.
//
// MVP scope: accounts + trust layer, supply listings (sell), trade intents (buy),
// search, price-check, and intent<->listing matching. No escrow, freight, or CTEs.

import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, {
  prepare: false,
  max: 2,
});

const SERVER_INFO = { name: "dtp-marketplace", version: "0.1.0" };
const PROTOCOL_VERSION = "2025-06-18";

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateApiKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return "dtp_" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function dollars(cents: number | string | null): string | null {
  if (cents === null || cents === undefined) return null;
  return (Number(cents) / 100).toFixed(2);
}

function toCents(dollarAmount: number): number {
  return Math.round(dollarAmount * 100);
}

class ToolError extends Error {}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

interface Account {
  id: string;
  handle: string;
  business_name: string;
  business_type: string;
  jurisdiction: string;
  city: string | null;
  region: string | null;
  country: string;
  contact: string | null;
  bio: string | null;
  website: string | null;
  legal_name: string | null;
  years_in_business: number | null;
  certifications: string[];
  created_at: string;
}

async function authenticate(req: Request): Promise<Account | null> {
  const header = req.headers.get("authorization") ?? "";
  const key = header.replace(/^Bearer\s+/i, "").trim();
  if (!key.startsWith("dtp_")) return null;
  const hash = await sha256Hex(key);
  const rows = await sql`select * from dtp.accounts where api_key_hash = ${hash}`;
  return (rows[0] as unknown as Account) ?? null;
}

function requireAuth(account: Account | null): Account {
  if (!account) {
    throw new ToolError(
      "This tool requires a DTP API key. Register with dtp_register, then set the key " +
        "in the plugin config (Authorization header). Browsing and price-check tools work without a key.",
    );
  }
  return account;
}

// ---------------------------------------------------------------------------
// Trust layer
// ---------------------------------------------------------------------------

interface TrustProfile {
  score: number;
  tier: string;
  components: Record<string, number>;
  endorsement_count: number;
  account_age_days: number;
  active_listings: number;
  open_intents: number;
  completed_sales: number;
}

async function getTrustProfiles(accountIds: string[]): Promise<Map<string, TrustProfile>> {
  const result = new Map<string, TrustProfile>();
  if (accountIds.length === 0) return result;
  const rows = await sql`
    select a.id,
           a.contact, a.city, a.region, a.bio, a.website, a.legal_name,
           a.years_in_business, a.certifications, a.created_at,
           extract(epoch from now() - a.created_at) / 86400 as age_days,
           (select count(*) from dtp.endorsements e where e.to_account = a.id) as endorsements,
           (select count(*) from dtp.listings l where l.account_id = a.id and l.status = 'active') as active_listings,
           (select count(*) from dtp.listings l where l.account_id = a.id and l.status = 'sold') as sold_listings,
           (select count(*) from dtp.intents i where i.account_id = a.id and i.status = 'open') as open_intents,
           (select count(*) from dtp.intents i where i.account_id = a.id and i.status = 'fulfilled') as fulfilled_intents
    from dtp.accounts a
    where a.id in ${sql(accountIds)}`;

  for (const r of rows) {
    // Profile completeness: 0-30
    const fields = [r.contact, r.city, r.region, r.bio, r.website, r.legal_name];
    let completeness = fields.filter((f) => f && String(f).trim().length > 0).length * 4; // 24 max
    if (r.years_in_business !== null) completeness += 3;
    if ((r.certifications ?? []).length > 0) completeness += 3;

    // Longevity: 0-15 (account age up to 180 days -> 10, plus years in business up to 5 -> 5)
    const ageDays = Number(r.age_days);
    const longevity = Math.round((Math.min(ageDays, 180) / 180) * 10) +
      Math.min(Number(r.years_in_business ?? 0), 5);

    // Activity: 0-20 (2 per active post up to 10, plus 2 per completed trade up to 10)
    const completed = Number(r.sold_listings) + Number(r.fulfilled_intents);
    const activity = Math.min((Number(r.active_listings) + Number(r.open_intents)) * 2, 10) +
      Math.min(completed * 2, 10);

    // Peer endorsements: 0-35 (7 each, capped at 5)
    const endorsements = Math.min(Number(r.endorsements), 5) * 7;

    const score = Math.min(completeness + longevity + activity + endorsements, 100);
    const tier = score >= 75 ? "trusted" : score >= 50 ? "established" : score >= 25 ? "emerging" : "unproven";

    result.set(r.id, {
      score,
      tier,
      components: { profile_completeness: completeness, longevity, activity, peer_endorsements: endorsements },
      endorsement_count: Number(r.endorsements),
      account_age_days: Math.floor(ageDays),
      active_listings: Number(r.active_listings),
      open_intents: Number(r.open_intents),
      completed_sales: completed,
    });
  }
  return result;
}

function publicAccountView(a: Account, trust?: TrustProfile) {
  return {
    handle: a.handle,
    business_name: a.business_name,
    business_type: a.business_type,
    location: [a.city, a.region, a.country].filter(Boolean).join(", "),
    contact: a.contact,
    website: a.website,
    bio: a.bio,
    certifications: a.certifications,
    years_in_business: a.years_in_business,
    member_since: a.created_at,
    trust: trust ? { score: trust.score, tier: trust.tier, endorsements: trust.endorsement_count, completed_sales: trust.completed_sales } : undefined,
  };
}

// ---------------------------------------------------------------------------
// Row shaping
// ---------------------------------------------------------------------------

function listingView(l: Record<string, unknown>, seller?: Record<string, unknown>) {
  return {
    listing_id: l.id,
    product_name: l.product_name,
    category: l.category,
    description: l.description,
    quantity: Number(l.quantity),
    unit: l.unit,
    price_per_unit_usd: dollars(l.price_per_unit_cents as string),
    min_order_quantity: l.min_order_quantity === null ? null : Number(l.min_order_quantity),
    grade: l.grade,
    certifications: l.certifications,
    origin: [l.origin_city, l.origin_region, l.origin_country].filter(Boolean).join(", "),
    available_from: l.available_from,
    expires_at: l.expires_at,
    status: l.status,
    created_at: l.created_at,
    seller,
  };
}

function intentView(i: Record<string, unknown>, buyer?: Record<string, unknown>) {
  return {
    intent_id: i.id,
    product_name: i.product_name,
    category: i.category,
    description: i.description,
    quantity: Number(i.quantity),
    unit: i.unit,
    ceiling_price_per_unit_usd: dollars(i.ceiling_price_per_unit_cents as string),
    required_certifications: i.required_certifications,
    deliver_to: [i.deliver_to_city, i.deliver_to_region, i.deliver_to_country].filter(Boolean).join(", "),
    needed_by: i.needed_by,
    expires_at: i.expires_at,
    status: i.status,
    created_at: i.created_at,
    buyer,
  };
}

async function attachAccounts(rows: Record<string, unknown>[], key: "seller" | "buyer") {
  const ids = [...new Set(rows.map((r) => r.account_id as string))];
  if (ids.length === 0) return new Map();
  const accounts = await sql`select * from dtp.accounts where id in ${sql(ids)}`;
  const trust = await getTrustProfiles(ids);
  const map = new Map<string, Record<string, unknown>>();
  for (const a of accounts) map.set(a.id, publicAccountView(a as unknown as Account, trust.get(a.id)));
  return map;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function tokenize(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
}

function scoreMatch(intent: Record<string, unknown>, listing: Record<string, unknown>) {
  let score = 0;
  const reasons: string[] = [];

  // Product relevance: 0-50
  if (String(intent.category).toLowerCase() === String(listing.category).toLowerCase()) {
    score += 25;
    reasons.push("category match");
  }
  const it = tokenize(String(intent.product_name));
  const lt = tokenize(String(listing.product_name) + " " + String(listing.description ?? ""));
  const overlap = [...it].filter((t) => lt.has(t)).length;
  if (it.size > 0) {
    const rel = Math.round((overlap / it.size) * 25);
    score += rel;
    if (rel > 0) reasons.push(`product name overlap ${overlap}/${it.size} terms`);
  }

  // Price fit: 0-20
  const ceiling = intent.ceiling_price_per_unit_cents === null ? null : Number(intent.ceiling_price_per_unit_cents);
  const price = Number(listing.price_per_unit_cents);
  if (ceiling === null) {
    score += 10;
    reasons.push("no price ceiling set");
  } else if (String(intent.unit) !== String(listing.unit)) {
    reasons.push(`unit mismatch (${intent.unit} vs ${listing.unit}) — price not comparable`);
  } else if (price <= ceiling) {
    score += 20;
    reasons.push(`price $${dollars(price)} within ceiling $${dollars(ceiling)}`);
  } else if (price <= ceiling * 1.1) {
    score += 10;
    reasons.push(`price $${dollars(price)} within 10% over ceiling`);
  } else {
    reasons.push(`price $${dollars(price)} exceeds ceiling $${dollars(ceiling)}`);
  }

  // Quantity coverage: 0-15
  if (String(intent.unit) === String(listing.unit)) {
    const coverage = Math.min(Number(listing.quantity) / Number(intent.quantity), 1);
    score += Math.round(coverage * 15);
    reasons.push(`covers ${Math.round(coverage * 100)}% of requested quantity`);
  }

  // Certifications: 0-15
  const required = (intent.required_certifications as string[]) ?? [];
  if (required.length > 0) {
    const have = new Set(((listing.certifications as string[]) ?? []).map((c) => c.toLowerCase()));
    const met = required.filter((c) => have.has(c.toLowerCase())).length;
    score += Math.round((met / required.length) * 15);
    reasons.push(`${met}/${required.length} required certifications present`);
  } else {
    score += 15;
  }

  return { score, reasons };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const strArr = (description: string) => ({ type: "array", items: { type: "string" }, description });

const BUSINESS_TYPES = ["producer", "distributor", "retailer", "cooperative", "broker", "other"];

const TOOLS = [
  {
    name: "dtp_register",
    description:
      "Register a new DTP marketplace account. No API key needed. Returns your account and a one-time API key (dtp_...) — the user must save it and set it in the DTP plugin config to post listings/intents.",
    inputSchema: {
      type: "object",
      properties: {
        handle: str("Unique lowercase handle (3-39 chars, a-z 0-9 hyphen), e.g. 'sunrise-produce'"),
        business_name: str("Display name of the business"),
        business_type: { type: "string", enum: BUSINESS_TYPES, description: "Type of business" },
        city: str("City (optional)"),
        region: str("State/province code, e.g. 'OR' (optional)"),
        country: str("ISO country code, default US (optional)"),
        contact: str("Email or URL where counterparties can reach you (optional but boosts trust)"),
        bio: str("Short description of the business (optional)"),
        website: str("Website URL (optional)"),
      },
      required: ["handle", "business_name", "business_type"],
    },
  },
  {
    name: "dtp_whoami",
    description: "Show the authenticated account, including full trust profile breakdown.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "dtp_update_profile",
    description:
      "Update profile fields on the authenticated account. Filling out contact, location, bio, website, legal_name, years_in_business, and certifications raises your trust score.",
    inputSchema: {
      type: "object",
      properties: {
        business_name: str("Display name"),
        city: str("City"),
        region: str("State/province code"),
        country: str("ISO country code"),
        contact: str("Email or URL for counterparties"),
        bio: str("Short business description"),
        website: str("Website URL"),
        legal_name: str("Registered legal entity name"),
        years_in_business: num("Years in business"),
        certifications: strArr("Certifications held, e.g. ['USDA Organic','GAP']"),
      },
    },
  },
  {
    name: "dtp_get_account",
    description: "View any account's public profile and trust score by handle.",
    inputSchema: { type: "object", properties: { handle: str("Account handle") }, required: ["handle"] },
  },
  {
    name: "dtp_endorse",
    description:
      "Endorse another account (one endorsement per account pair). Endorsements are the strongest trust signal. Only endorse businesses you have actually dealt with.",
    inputSchema: {
      type: "object",
      properties: {
        handle: str("Handle of the account to endorse"),
        note: str("Why you endorse them, e.g. 'Delivered 3 clean orders on time' (optional)"),
      },
      required: ["handle"],
    },
  },
  {
    name: "dtp_post_listing",
    description: "Post goods for sale on the marketplace (requires API key).",
    inputSchema: {
      type: "object",
      properties: {
        product_name: str("Product name, e.g. 'Organic IQF Blueberries'"),
        category: str("Category, e.g. 'produce', 'dairy', 'grain', 'meat', 'packaged'"),
        description: str("Details: variety, pack format, quality specs (optional)"),
        quantity: num("Quantity available"),
        unit: str("Unit: lb, kg, case, pallet, each, ..."),
        price_per_unit_usd: num("Asking price per unit in USD, e.g. 2.80"),
        min_order_quantity: num("Minimum order quantity (optional)"),
        grade: str("Grade, e.g. 'USDA Fancy' (optional)"),
        certifications: strArr("Certifications applying to this lot (optional)"),
        origin_city: str("Origin city (optional)"),
        origin_region: str("Origin state/province (optional)"),
        origin_country: str("Origin country, default US (optional)"),
        available_from: str("Date available, YYYY-MM-DD (optional)"),
        expires_at: str("Listing expiry, YYYY-MM-DD (optional)"),
      },
      required: ["product_name", "category", "quantity", "unit", "price_per_unit_usd"],
    },
  },
  {
    name: "dtp_update_listing",
    description:
      "Update your own listing: change price/quantity, or set status to 'withdrawn' (remove), 'sold' (completed — counts toward trust), or 'active' (relist).",
    inputSchema: {
      type: "object",
      properties: {
        listing_id: str("Listing ID, e.g. L-1A2B3C4D"),
        price_per_unit_usd: num("New asking price per unit in USD (optional)"),
        quantity: num("New available quantity (optional)"),
        status: { type: "string", enum: ["active", "withdrawn", "sold"], description: "New status (optional)" },
        expires_at: str("New expiry YYYY-MM-DD (optional)"),
      },
      required: ["listing_id"],
    },
  },
  {
    name: "dtp_get_listing",
    description: "View a listing with the seller's public profile and trust score.",
    inputSchema: { type: "object", properties: { listing_id: str("Listing ID") }, required: ["listing_id"] },
  },
  {
    name: "dtp_search_listings",
    description:
      "Find goods for sale. Free-text query over product/description/category plus structured filters. Sellers are returned with trust scores. No API key needed.",
    inputSchema: {
      type: "object",
      properties: {
        query: str("Free-text search, e.g. 'organic blueberries' (optional)"),
        category: str("Exact category filter (optional)"),
        region: str("Origin state/province filter (optional)"),
        country: str("Origin country filter (optional)"),
        max_price_per_unit_usd: num("Maximum price per unit in USD (optional)"),
        unit: str("Only listings priced in this unit (optional)"),
        min_quantity: num("Minimum available quantity, same unit (optional)"),
        certifications: strArr("Required certifications (optional)"),
        min_trust_score: num("Only sellers at or above this trust score 0-100 (optional)"),
        sort: { type: "string", enum: ["price", "trust", "newest"], description: "Sort order, default price" },
        limit: num("Max results, default 20"),
      },
    },
  },
  {
    name: "dtp_post_intent",
    description: "Post a buy intent — what you want to purchase — so sellers can find you (requires API key).",
    inputSchema: {
      type: "object",
      properties: {
        product_name: str("Product wanted, e.g. 'organic blueberries'"),
        category: str("Category, e.g. 'produce'"),
        description: str("Quality specs, pack preferences (optional)"),
        quantity: num("Quantity needed"),
        unit: str("Unit: lb, kg, case, pallet, each, ..."),
        ceiling_price_per_unit_usd: num("Max price per unit in USD you will pay (optional)"),
        required_certifications: strArr("Certifications the goods must carry (optional)"),
        deliver_to_city: str("Delivery city (optional)"),
        deliver_to_region: str("Delivery state/province (optional)"),
        deliver_to_country: str("Delivery country, default US (optional)"),
        needed_by: str("Latest acceptable delivery date YYYY-MM-DD (optional)"),
        expires_at: str("Intent expiry YYYY-MM-DD (optional)"),
      },
      required: ["product_name", "category", "quantity", "unit"],
    },
  },
  {
    name: "dtp_cancel_intent",
    description: "Cancel your own buy intent, or mark it 'fulfilled' if the purchase happened (counts toward trust).",
    inputSchema: {
      type: "object",
      properties: {
        intent_id: str("Intent ID, e.g. I-1A2B3C4D"),
        status: { type: "string", enum: ["cancelled", "fulfilled"], description: "Default cancelled" },
      },
      required: ["intent_id"],
    },
  },
  {
    name: "dtp_get_intent",
    description: "View a buy intent with the buyer's public profile and trust score.",
    inputSchema: { type: "object", properties: { intent_id: str("Intent ID") }, required: ["intent_id"] },
  },
  {
    name: "dtp_search_intents",
    description:
      "Find open buy intents — what buyers are looking for. Useful for sellers scouting demand. No API key needed.",
    inputSchema: {
      type: "object",
      properties: {
        query: str("Free-text search (optional)"),
        category: str("Exact category filter (optional)"),
        region: str("Delivery state/province filter (optional)"),
        min_ceiling_price_usd: num("Only intents willing to pay at least this per unit (optional)"),
        limit: num("Max results, default 20"),
      },
    },
  },
  {
    name: "dtp_price_check",
    description:
      "Shop pricing: aggregate price statistics (min/median/max, per unit) across active listings matching a product query, plus the cheapest listings with seller trust. No API key needed.",
    inputSchema: {
      type: "object",
      properties: {
        query: str("Product to price, e.g. 'blueberries'"),
        category: str("Category filter (optional)"),
        region: str("Origin state/province filter (optional)"),
        unit: str("Restrict to one unit (optional)"),
      },
      required: ["query"],
    },
  },
  {
    name: "dtp_find_matches_for_intent",
    description: "Score all active listings against one of your buy intents. Returns ranked matches with reasons.",
    inputSchema: {
      type: "object",
      properties: { intent_id: str("Your intent ID"), limit: num("Max matches, default 10") },
      required: ["intent_id"],
    },
  },
  {
    name: "dtp_find_matches_for_listing",
    description: "Score all open buy intents against one of your listings. Returns ranked matches with reasons.",
    inputSchema: {
      type: "object",
      properties: { listing_id: str("Your listing ID"), limit: num("Max matches, default 10") },
      required: ["listing_id"],
    },
  },
  {
    name: "dtp_my_activity",
    description: "List the authenticated account's listings and intents, all statuses.",
    inputSchema: { type: "object", properties: {} },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

type Args = Record<string, any>;

const handlers: Record<string, (args: Args, account: Account | null) => Promise<unknown>> = {
  async dtp_register(args) {
    const handle = String(args.handle ?? "").toLowerCase().trim();
    if (!/^[a-z0-9][a-z0-9-]{2,38}$/.test(handle)) {
      throw new ToolError("Handle must be 3-39 chars: lowercase letters, digits, hyphens; starting alphanumeric.");
    }
    if (!BUSINESS_TYPES.includes(args.business_type)) {
      throw new ToolError(`business_type must be one of: ${BUSINESS_TYPES.join(", ")}`);
    }
    const apiKey = generateApiKey();
    const hash = await sha256Hex(apiKey);
    let rows;
    try {
      rows = await sql`
        insert into dtp.accounts (handle, business_name, business_type, city, region, country, contact, bio, website, api_key_hash)
        values (${handle}, ${args.business_name}, ${args.business_type}, ${args.city ?? null}, ${args.region ?? null},
                ${args.country ?? "US"}, ${args.contact ?? null}, ${args.bio ?? null}, ${args.website ?? null}, ${hash})
        returning *`;
    } catch (e) {
      if (String(e).includes("accounts_handle_key")) throw new ToolError(`Handle '${handle}' is taken. Pick another.`);
      throw e;
    }
    const trust = await getTrustProfiles([rows[0].id]);
    return {
      account: publicAccountView(rows[0] as unknown as Account, trust.get(rows[0].id)),
      api_key: apiKey,
      important:
        "SAVE THIS API KEY — it is shown only once and stored hashed. Set it as the 'DTP API Key' in the dtp plugin config (/plugin -> dtp -> configure), then restart Claude Code.",
    };
  },

  async dtp_whoami(_args, account) {
    const me = requireAuth(account);
    const trust = (await getTrustProfiles([me.id])).get(me.id)!;
    return { account: publicAccountView(me, trust), trust_breakdown: trust };
  },

  async dtp_update_profile(args, account) {
    const me = requireAuth(account);
    const allowed = ["business_name", "city", "region", "country", "contact", "bio", "website", "legal_name", "years_in_business", "certifications"];
    const updates: Record<string, unknown> = {};
    for (const k of allowed) if (args[k] !== undefined) updates[k] = args[k];
    if (Object.keys(updates).length === 0) throw new ToolError("No fields to update.");
    updates.updated_at = new Date();
    const rows = await sql`update dtp.accounts set ${sql(updates)} where id = ${me.id} returning *`;
    const trust = (await getTrustProfiles([me.id])).get(me.id)!;
    return { account: publicAccountView(rows[0] as unknown as Account, trust), trust_breakdown: trust };
  },

  async dtp_get_account(args) {
    const rows = await sql`select * from dtp.accounts where handle = ${String(args.handle).toLowerCase()}`;
    if (!rows[0]) throw new ToolError(`No account with handle '${args.handle}'.`);
    const trust = (await getTrustProfiles([rows[0].id])).get(rows[0].id)!;
    const endorsements = await sql`
      select e.note, e.created_at, a.handle as from_handle, a.business_name as from_business
      from dtp.endorsements e join dtp.accounts a on a.id = e.from_account
      where e.to_account = ${rows[0].id} order by e.created_at desc limit 10`;
    return { account: publicAccountView(rows[0] as unknown as Account, trust), trust_breakdown: trust, recent_endorsements: endorsements };
  },

  async dtp_endorse(args, account) {
    const me = requireAuth(account);
    const target = await sql`select id, handle, business_name from dtp.accounts where handle = ${String(args.handle).toLowerCase()}`;
    if (!target[0]) throw new ToolError(`No account with handle '${args.handle}'.`);
    if (target[0].id === me.id) throw new ToolError("You cannot endorse yourself.");
    try {
      await sql`insert into dtp.endorsements (from_account, to_account, note)
                values (${me.id}, ${target[0].id}, ${args.note ?? null})`;
    } catch (e) {
      if (String(e).includes("endorsements_from_account_to_account_key")) {
        throw new ToolError(`You have already endorsed ${target[0].handle}.`);
      }
      throw e;
    }
    return { endorsed: target[0].handle, note: args.note ?? null };
  },

  async dtp_post_listing(args, account) {
    const me = requireAuth(account);
    if (!(Number(args.quantity) > 0)) throw new ToolError("quantity must be > 0");
    if (!(Number(args.price_per_unit_usd) >= 0)) throw new ToolError("price_per_unit_usd must be >= 0");
    const rows = await sql`
      insert into dtp.listings (account_id, product_name, category, description, quantity, unit,
                                price_per_unit_cents, min_order_quantity, grade, certifications,
                                origin_city, origin_region, origin_country, available_from, expires_at)
      values (${me.id}, ${args.product_name}, ${String(args.category).toLowerCase()}, ${args.description ?? null},
              ${args.quantity}, ${args.unit}, ${toCents(args.price_per_unit_usd)}, ${args.min_order_quantity ?? null},
              ${args.grade ?? null}, ${args.certifications ?? []}, ${args.origin_city ?? null},
              ${args.origin_region ?? null}, ${args.origin_country ?? "US"}, ${args.available_from ?? null},
              ${args.expires_at ?? null})
      returning *`;
    return { listing: listingView(rows[0]), tip: "Run dtp_find_matches_for_listing to see buyers already looking for this." };
  },

  async dtp_update_listing(args, account) {
    const me = requireAuth(account);
    const existing = await sql`select * from dtp.listings where id = ${args.listing_id}`;
    if (!existing[0]) throw new ToolError(`No listing ${args.listing_id}.`);
    if (existing[0].account_id !== me.id) throw new ToolError("You can only update your own listings.");
    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (args.price_per_unit_usd !== undefined) updates.price_per_unit_cents = toCents(args.price_per_unit_usd);
    if (args.quantity !== undefined) updates.quantity = args.quantity;
    if (args.status !== undefined) updates.status = args.status;
    if (args.expires_at !== undefined) updates.expires_at = args.expires_at;
    const rows = await sql`update dtp.listings set ${sql(updates)} where id = ${args.listing_id} returning *`;
    return { listing: listingView(rows[0]) };
  },

  async dtp_get_listing(args) {
    const rows = await sql`select * from dtp.listings where id = ${args.listing_id}`;
    if (!rows[0]) throw new ToolError(`No listing ${args.listing_id}.`);
    const sellers = await attachAccounts(rows, "seller");
    return { listing: listingView(rows[0], sellers.get(rows[0].account_id)) };
  },

  async dtp_search_listings(args) {
    const limit = Math.min(Number(args.limit ?? 20), 50);
    const q = args.query ? `%${args.query}%` : null;
    const rows = await sql`
      select * from dtp.listings
      where status = 'active'
        and (expires_at is null or expires_at > now())
        ${q ? sql`and (product_name ilike ${q} or coalesce(description,'') ilike ${q} or category ilike ${q})` : sql``}
        ${args.category ? sql`and category = ${String(args.category).toLowerCase()}` : sql``}
        ${args.region ? sql`and origin_region ilike ${args.region}` : sql``}
        ${args.country ? sql`and origin_country ilike ${args.country}` : sql``}
        ${args.unit ? sql`and unit = ${args.unit}` : sql``}
        ${args.max_price_per_unit_usd !== undefined ? sql`and price_per_unit_cents <= ${toCents(args.max_price_per_unit_usd)}` : sql``}
        ${args.min_quantity !== undefined ? sql`and quantity >= ${args.min_quantity}` : sql``}
        ${args.certifications?.length ? sql`and certifications @> ${args.certifications}` : sql``}
      order by ${args.sort === "newest" ? sql`created_at desc` : sql`price_per_unit_cents asc`}
      limit 200`;

    const sellers = await attachAccounts(rows, "seller");
    let results = rows.map((r) => listingView(r, sellers.get(r.account_id)));
    if (args.min_trust_score !== undefined) {
      results = results.filter((r: any) => (r.seller?.trust?.score ?? 0) >= Number(args.min_trust_score));
    }
    if (args.sort === "trust") {
      results.sort((a: any, b: any) => (b.seller?.trust?.score ?? 0) - (a.seller?.trust?.score ?? 0));
    }
    return { count: Math.min(results.length, limit), total_matched: results.length, listings: results.slice(0, limit) };
  },

  async dtp_post_intent(args, account) {
    const me = requireAuth(account);
    if (!(Number(args.quantity) > 0)) throw new ToolError("quantity must be > 0");
    const rows = await sql`
      insert into dtp.intents (account_id, product_name, category, description, quantity, unit,
                               ceiling_price_per_unit_cents, required_certifications,
                               deliver_to_city, deliver_to_region, deliver_to_country, needed_by, expires_at)
      values (${me.id}, ${args.product_name}, ${String(args.category).toLowerCase()}, ${args.description ?? null},
              ${args.quantity}, ${args.unit},
              ${args.ceiling_price_per_unit_usd !== undefined ? toCents(args.ceiling_price_per_unit_usd) : null},
              ${args.required_certifications ?? []}, ${args.deliver_to_city ?? null}, ${args.deliver_to_region ?? null},
              ${args.deliver_to_country ?? "US"}, ${args.needed_by ?? null}, ${args.expires_at ?? null})
      returning *`;
    return { intent: intentView(rows[0]), tip: "Run dtp_find_matches_for_intent to see current supply." };
  },

  async dtp_cancel_intent(args, account) {
    const me = requireAuth(account);
    const existing = await sql`select * from dtp.intents where id = ${args.intent_id}`;
    if (!existing[0]) throw new ToolError(`No intent ${args.intent_id}.`);
    if (existing[0].account_id !== me.id) throw new ToolError("You can only modify your own intents.");
    const status = args.status === "fulfilled" ? "fulfilled" : "cancelled";
    const rows = await sql`update dtp.intents set status = ${status}, updated_at = now() where id = ${args.intent_id} returning *`;
    return { intent: intentView(rows[0]) };
  },

  async dtp_get_intent(args) {
    const rows = await sql`select * from dtp.intents where id = ${args.intent_id}`;
    if (!rows[0]) throw new ToolError(`No intent ${args.intent_id}.`);
    const buyers = await attachAccounts(rows, "buyer");
    return { intent: intentView(rows[0], buyers.get(rows[0].account_id)) };
  },

  async dtp_search_intents(args) {
    const limit = Math.min(Number(args.limit ?? 20), 50);
    const q = args.query ? `%${args.query}%` : null;
    const rows = await sql`
      select * from dtp.intents
      where status = 'open'
        and (expires_at is null or expires_at > now())
        ${q ? sql`and (product_name ilike ${q} or coalesce(description,'') ilike ${q} or category ilike ${q})` : sql``}
        ${args.category ? sql`and category = ${String(args.category).toLowerCase()}` : sql``}
        ${args.region ? sql`and deliver_to_region ilike ${args.region}` : sql``}
        ${args.min_ceiling_price_usd !== undefined ? sql`and ceiling_price_per_unit_cents >= ${toCents(args.min_ceiling_price_usd)}` : sql``}
      order by created_at desc
      limit ${limit}`;
    const buyers = await attachAccounts(rows, "buyer");
    return { count: rows.length, intents: rows.map((r) => intentView(r, buyers.get(r.account_id))) };
  },

  async dtp_price_check(args) {
    const q = `%${args.query}%`;
    const rows = await sql`
      select * from dtp.listings
      where status = 'active'
        and (expires_at is null or expires_at > now())
        and (product_name ilike ${q} or coalesce(description,'') ilike ${q} or category ilike ${q})
        ${args.category ? sql`and category = ${String(args.category).toLowerCase()}` : sql``}
        ${args.region ? sql`and origin_region ilike ${args.region}` : sql``}
        ${args.unit ? sql`and unit = ${args.unit}` : sql``}`;

    if (rows.length === 0) return { query: args.query, message: "No active listings match this query.", stats: [] };

    // Group price stats by unit — units are not converted in the MVP.
    const byUnit = new Map<string, number[]>();
    for (const r of rows) {
      const arr = byUnit.get(r.unit) ?? [];
      arr.push(Number(r.price_per_unit_cents));
      byUnit.set(r.unit, arr);
    }
    const stats = [...byUnit.entries()].map(([unit, prices]) => {
      prices.sort((a, b) => a - b);
      const pct = (p: number) => prices[Math.min(prices.length - 1, Math.floor((p / 100) * prices.length))];
      return {
        unit,
        listing_count: prices.length,
        min_usd: dollars(prices[0]),
        p25_usd: dollars(pct(25)),
        median_usd: dollars(pct(50)),
        p75_usd: dollars(pct(75)),
        max_usd: dollars(prices[prices.length - 1]),
        avg_usd: dollars(Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)),
      };
    });

    const cheapest = rows.sort((a, b) => Number(a.price_per_unit_cents) - Number(b.price_per_unit_cents)).slice(0, 5);
    const sellers = await attachAccounts(cheapest, "seller");
    return {
      query: args.query,
      stats,
      cheapest_listings: cheapest.map((r) => listingView(r, sellers.get(r.account_id))),
    };
  },

  async dtp_find_matches_for_intent(args, account) {
    const me = requireAuth(account);
    const intents = await sql`select * from dtp.intents where id = ${args.intent_id}`;
    if (!intents[0]) throw new ToolError(`No intent ${args.intent_id}.`);
    if (intents[0].account_id !== me.id) throw new ToolError("You can only match your own intents.");
    const listings = await sql`
      select * from dtp.listings where status = 'active' and (expires_at is null or expires_at > now())
      and account_id <> ${me.id} limit 500`;
    const scored = listings
      .map((l) => ({ listing: l, ...scoreMatch(intents[0], l) }))
      .filter((m) => m.score >= 40)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(Number(args.limit ?? 10), 25));
    const sellers = await attachAccounts(scored.map((m) => m.listing), "seller");
    return {
      intent_id: args.intent_id,
      matches: scored.map((m) => ({
        score: m.score,
        reasons: m.reasons,
        listing: listingView(m.listing, sellers.get(m.listing.account_id)),
      })),
    };
  },

  async dtp_find_matches_for_listing(args, account) {
    const me = requireAuth(account);
    const listings = await sql`select * from dtp.listings where id = ${args.listing_id}`;
    if (!listings[0]) throw new ToolError(`No listing ${args.listing_id}.`);
    if (listings[0].account_id !== me.id) throw new ToolError("You can only match your own listings.");
    const intents = await sql`
      select * from dtp.intents where status = 'open' and (expires_at is null or expires_at > now())
      and account_id <> ${me.id} limit 500`;
    const scored = intents
      .map((i) => ({ intent: i, ...scoreMatch(i, listings[0]) }))
      .filter((m) => m.score >= 40)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(Number(args.limit ?? 10), 25));
    const buyers = await attachAccounts(scored.map((m) => m.intent), "buyer");
    return {
      listing_id: args.listing_id,
      matches: scored.map((m) => ({
        score: m.score,
        reasons: m.reasons,
        intent: intentView(m.intent, buyers.get(m.intent.account_id)),
      })),
    };
  },

  async dtp_my_activity(_args, account) {
    const me = requireAuth(account);
    const listings = await sql`select * from dtp.listings where account_id = ${me.id} order by created_at desc limit 50`;
    const intents = await sql`select * from dtp.intents where account_id = ${me.id} order by created_at desc limit 50`;
    return {
      listings: listings.map((l) => listingView(l)),
      intents: intents.map((i) => intentView(i)),
    };
  },
};

// ---------------------------------------------------------------------------
// JSON-RPC / MCP plumbing
// ---------------------------------------------------------------------------

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-session-id, mcp-protocol-version",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE",
};

function rpcResult(id: unknown, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { headers: JSON_HEADERS });
}

function rpcError(id: unknown, code: number, message: string): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), { headers: JSON_HEADERS });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: JSON_HEADERS });
  if (req.method === "GET") {
    // No server-initiated stream in this stateless implementation.
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), { status: 405, headers: JSON_HEADERS });
  }
  if (req.method === "DELETE") return new Response(null, { status: 200, headers: JSON_HEADERS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), { status: 405, headers: JSON_HEADERS });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  // Notifications (no id) get 202 Accepted per streamable HTTP spec.
  if (body?.id === undefined || body?.id === null) {
    return new Response(null, { status: 202, headers: JSON_HEADERS });
  }

  const { id, method, params } = body;

  try {
    switch (method) {
      case "initialize":
        return rpcResult(id, {
          protocolVersion: params?.protocolVersion === "2025-03-26" ? "2025-03-26" : PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions:
            "DTP Marketplace: list goods for sale (dtp_post_listing), find goods and shop pricing " +
            "(dtp_search_listings, dtp_price_check), post buy intents (dtp_post_intent), and build trust " +
            "(dtp_update_profile, dtp_endorse). Browsing needs no key; posting requires dtp_register first.",
        });
      case "ping":
        return rpcResult(id, {});
      case "tools/list":
        return rpcResult(id, { tools: TOOLS });
      case "tools/call": {
        const name = params?.name as string;
        const handler = handlers[name];
        if (!handler) return rpcError(id, -32602, `Unknown tool: ${name}`);
        const account = await authenticate(req);
        try {
          const result = await handler(params?.arguments ?? {}, account);
          return rpcResult(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
        } catch (e) {
          const message = e instanceof ToolError ? e.message : `Internal error: ${String(e)}`;
          return rpcResult(id, { content: [{ type: "text", text: message }], isError: true });
        }
      }
      default:
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    return rpcError(id, -32603, `Internal error: ${String(e)}`);
  }
});
