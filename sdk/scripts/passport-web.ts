// Local demonstration harness. All signers are disposable fictional personas held
// in this process, never sent to the browser. This is NOT production sign-in.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createPbpStore } from "./pbp-dev-server.ts";
import { Passport, type PassportIdentity } from "../../modules/passport/src/index.ts";
import { generateKeyPair, type KeyPair } from "../src/keys.ts";
import { draftCommand, signCommand, PbpError } from "../src/v03/wire.ts";
import { createEarlyPayDemo, EARLY_RIGHTS } from "../../modules/early-pay/src/demo.ts";
import { createFinancialProfileDemo } from "../../modules/financial-profile/src/demo.ts";

const expires = () => new Date(Date.now() + 7 * 86400000).toISOString();
const usd = (amount: string) => ({ amount, currency: "USD" });
export async function createPassportWeb(port = 8789, hooks:{beforeReconcile?:()=>void;beforeAppendSend?:(step:string)=>void;afterAppendSend?:(step:string)=>void}={}) {
  const store = await createPbpStore();
  const passport = new Passport(store.audience);
  const people: Record<string, PassportIdentity> = {};
  for (const id of ["alex", "jamie", "sam", "riley", "taylor", "buyer"]) people[id] = await passport.createIdentity();
  const profiles = [
    { id: "alex", name: "Alex Morgan", initials: "AM", title: "Fractional CFO", description: "One identity. Three independent memberships." },
    { id: "jamie", name: "Jamie Chen", initials: "JC", title: "Company controller", description: "Manage company membership and module access." },
    { id: "sam", name: "Sam Rivera", initials: "SR", title: "Operations lead", description: "Acme trade records, without finance access." },
    { id: "riley", name: "Riley Park", initials: "RP", title: "Harbor Finance controller", description: "Review disclosed evidence and approve simulated financing." },
    { id: "taylor", name: "Taylor Brooks", initials: "TB", title: "Cedar Capital controller", description: "A second independent lender. Sees only applications sent to Cedar." },
  ];
  const companyInfo = [
    { name: "Acme Sauce", initials: "AS", sector: "Food & beverage", color: "green" },
    { name: "Bluestem Foods", initials: "BF", sector: "Distribution", color: "blue" },
    { name: "Northstar Manufacturing", initials: "NM", sector: "Manufacturing", color: "purple" },
  ];
  const companies = await Promise.all(companyInfo.map(async c => ({ ...c, id: await passport.createCompany(people.jamie, c.name) })));
  const pending = new Map<string, { id: string; org: string; person: string }>();
  const grants = (org: string, person: string) => person === "sam" ? ["records.read:trade.contract"] :
    org === companies[1].id ? ["records.read:trade.contract"] : org === companies[0].id ? [...new Set([...EARLY_RIGHTS.filter(r=>r!=='finance.fund'&&r!=='records.write:finance.advance'),"records.share","records.read:trade.contract"])] : ["records.read:finance.invoice", "records.read:trade.contract"];
  async function invite(org: string, person: string, by: PassportIdentity) {
    const id = await passport.invite(by, org, people[person].id, grants(org, person), expires());
    pending.set(`${org}:${person}`, { id, org, person }); return id;
  }
  for (const org of companies) {
    const id = await invite(org.id, "alex", people.jamie);
    if (org.id !== companies[2].id) { await passport.accept(people.alex, org.id, id); pending.delete(`${org.id}:alex`); }
  }
  await passport.accept(people.sam, companies[0].id, await invite(companies[0].id, "sam", people.jamie));
  pending.delete(`${companies[0].id}:sam`);
  const contracts = new Map<string, string>();
  for (const [i, org] of companies.entries()) {
    const counterparty = companies[(i + 1) % companies.length].id;
    const contractId = crypto.randomUUID(), now = new Date().toISOString();
    contracts.set(org.id, contractId);
    await passport.client.act(people.jamie, "record.append", org.id, {
      record_id: contractId, root_id: contractId, supersedes: null, type: "trade.contract", subject_company_id: org.id, counterparty_ids: [counterparty], visibility: "granted",
      body: { buyer_company_id: org.id, seller_company_id: counterparty, intent_id: null, listing_id: null, offer_id: null, standing_agreement_id: null, lot_id: null, buyer_po_number: `PO-${1042 + i}`,
        goods: { category: "condiments.hot_sauce", product_name: "Habanero sauce · 12-pack", description: "Fictional demo order", product_type: "branded", commodity_details: null,
          branded_details: { brand_name: "Acme", sku: "HAB-5", gtin: null, upc: null, manufacturer: "Acme Sauce" }, value_added_details: null,
          quantity: { amount: String(240 + i * 120), unit: "case" }, quality: null, required_certifications: [], packaging: "12x5oz glass", shelf_life_days: 365 },
        delivery: { destination: { line1: "400 Demo Dock", line2: null, city: "Austin", region: "TX", postal_code: "78701", country: "US" }, destination_gln: null,
          window: { earliest: now, latest: expires() }, method: "delivered", temperature_requirements: "ambient", notes: "Synthetic scenario" },
        finance: { payment_timing: "delivery_attestation", net_days: 30, paca_covered: false, financing_mode: "open_account", liquidity_pool_id: null, financer_company_id: null, finance_fee_bps: 0 },
        freight: null, price_per_unit: usd("42.00"), total_value: usd(String((240 + i * 120) * 42)), escrow_ref: null, dispute_window_hours: 48, arbitrator_company_id: null, status: "active" } });
  }
  for (const [i, org] of companies.entries()) {
    const counterparty = companies[(i + companies.length - 1) % companies.length].id;
    const contractId = contracts.get(counterparty)!;
    for (let n = 0; n < 3; n++) {
      const buyerIndex = (i + companies.length - 1) % companies.length;
      const id = crypto.randomUUID(), amount = ((240 + buyerIndex * 120) * 42 * [0.5, 0.3, 0.2][n]).toFixed(2);
      await passport.client.act(people.jamie, "record.append", org.id, {
        record_id: id, root_id: id, supersedes: null, type: "finance.invoice", subject_company_id: org.id, counterparty_ids: [counterparty], visibility: "granted",
        body: { invoice_number: `INV-${i + 1}0${21 + n}`, seller_company_id: org.id, buyer_company_id: counterparty, contract_id: contractId,
          line_items: [{ description: "Demo product shipment", quantity: { amount: "1", unit: "unit" }, unit_price: usd(amount), amount: usd(amount) }], subtotal: usd(amount), deductions: [], total: usd(amount),
          issued_at: new Date(Date.now() + (n * 5 - 28) * 86400000).toISOString(), due_at: new Date(Date.now() + (n * 5 + 2) * 86400000).toISOString(), payment_terms: { net_days: 30, paca_covered: false }, status: "issued", paid_amount: usd("0"), settlement_event_ids: [], assigned_to_company_id: null } });
    }
  }
  const modules: Record<string, { id: string; name: string; permission: string }> = {};
  const installations = new Map<string, { id: string; key: KeyPair; active: boolean }>();
  const scopesFor = (slug:string, permission:string) => slug === "books" ? [permission,"records.read:finance.advance_offer","records.read:finance.advance","records.read:finance.settlement_event"] : [permission];
  for (const [slug, name, permission] of [["ledger", "Trade Ledger", "records.read:trade.contract"], ["books", "Books", "records.read:finance.invoice"]]) {
    const id = crypto.randomUUID(); modules[slug] = { id, name, permission };
    await passport.client.act(people.jamie, "module.publish", companies[0].id, { module_id: id, manifest: { version: "1.0.0", name, permissions: scopesFor(slug,permission) } });
  }
  async function connect(org: string, slug: string, person: PassportIdentity) {
    if (installations.get(`${org}:${slug}`)?.active) throw new PbpError("already_connected", "This module is already connected", 409);
    const key = await generateKeyPair(), id = crypto.randomUUID(), mod = modules[slug];
    await passport.client.act(person, "installation.create", org, { installation_id: id, module_id: mod.id, manifest_version: "1.0.0", key_id: key.keyId,
      permissions: scopesFor(slug,mod.permission), mode: "interactive", expires_at: expires() }, [key]);
    installations.set(`${org}:${slug}`, { id, key, active: true });
  }
  for (const org of companies) await connect(org.id, "ledger", people.jamie);
  const harbor = { name: "Harbor Finance", initials: "HF", sector: "Fictional lender", color: "blue", id: await passport.createCompany(people.riley, "Harbor Finance") };
  companies.push(harbor);
  const cedar = { name: "Cedar Capital", initials: "CC", sector: "Fictional lender", color: "purple", id: await passport.createCompany(people.taylor, "Cedar Capital") };
  companies.push(cedar);
  const financialProfile = await createFinancialProfileDemo(passport, people.jamie, companies.map(c=>({id:c.id,name:c.name,person:c.id===harbor.id?people.riley:c.id===cedar.id?people.taylor:people.jamie})), companies[0].id);
  const earlyPay = await createEarlyPayDemo(passport, companies[0].id, harbor.id, people.jamie, people.riley, people.buyer, financialProfile, [{id:cedar.id,name:cedar.name,person:people.taylor}], hooks);

  type Session = { persona: string | null; csrf: string };
  const sessions = new Map<string, Session>();
  let origin = "", queue = Promise.resolve();
  async function home(session: Session) {
    const persona = session.persona;
    if (!persona) return { profiles, persona: null, companies: [], invitations: [] };
    const organizations = await passport.organizations(people[persona]);
    return { profiles, persona, person_id: people[persona].id,
      companies: organizations.map((o: any) => ({ ...o, ...companies.find(c => c.id === o.id) })),
      invitations: [...pending.values()].filter(p => p.person === persona).map(p => ({ ...companies.find(c => c.id === p.org), invitation_id: p.id })) };
  }
  async function action(session: Session, path: string, p: any): Promise<any> {
    if (path === "/api/login") {
      if (!profiles.some(x => x.id === p.persona)) throw new PbpError("invalid", "Choose a demo persona", 400);
      session.persona = p.persona; return home(session);
    }
    if (path === "/api/logout") { session.persona = null; return home(session); }
    if (!session.persona) throw new PbpError("sign_in_required", "Choose a demo persona first", 401);
    if (p.demo_persona !== session.persona) throw new PbpError("persona_changed", "The demo persona changed in another tab. Refresh before continuing.", 409);
    const person = people[session.persona], org = p.organization_id;
    if (path.startsWith("/api/early/")) return earlyPay.action(person, org, path.slice("/api/early/".length), p);
    if (path.startsWith("/api/profile/")) return financialProfile.action(person, org, path.slice("/api/profile/".length));
    if (path === "/api/accept") {
      const invitation = pending.get(`${org}:${session.persona}`);
      if (!invitation) throw new PbpError("not_found", "Invitation not found", 404);
      await passport.accept(person, org, invitation.id); pending.delete(`${org}:${session.persona}`); return home(session);
    }
    if (path === "/api/workspace") {
      const view = await passport.enter(person, org);
      let notifications:any[]=[];
      if(earlyPay.installation(org)){try{notifications=await earlyPay.notifications(person,org);}catch(e){if(!(e instanceof PbpError)||![403,404,409].includes(e.status))throw e;}}
      return { ...view, notifications, financial_profile:await financialProfile.active(person,org), early_pay: view.installations.some((i:any)=>i.id===earlyPay.installation(org)?.id&&i.active), company: companies.find(c => c.id === org), modules: Object.entries(modules).map(([slug, m]) => ({ slug, name: m.name, permission: m.permission,
        installed: installations.has(`${org}:${slug}`), active: installations.get(`${org}:${slug}`)?.active ?? false })),
        alex: session.persona === "jamie" ? { pending: pending.has(`${org}:alex`), active: (await passport.organizations(people.alex)).some((o: any) => o.id === org) } : null };
    }
    if (path === "/api/member/revoke") {
      await passport.revoke(person, org, people.alex.id); pending.delete(`${org}:alex`); return { message: "Alex's access was revoked by the protocol. Other companies are unaffected." };
    }
    if (path === "/api/member/invite") { await invite(org, "alex", person); return { message: "Invitation issued. Switch to Alex to accept it." }; }
    if (!["books", "ledger"].includes(p.module)) throw new PbpError("invalid", "Unknown demo action", 400);
    const installed = installations.get(`${org}:${p.module}`);
    if (path === "/api/module/connect") { await connect(org, p.module, person); return { message: "Module connected with a new company-specific credential." }; }
    if (!installed) throw new PbpError("not_found", "Connect this module first", 404);
    if (path === "/api/module/revoke") {
      await passport.client.act(person, "installation.revoke", org, { installation_id: installed.id }); installed.active = false;
      return { message: "Module access revoked. The company's records remain." };
    }
    if (path === "/api/module/read") {
      const command = draftCommand(store.audience, person, "records.list", org, { after: 0, limit: 100 });
      command.actor = { kind: "installation", id: installed.id, key_id: installed.key.keyId };
      return passport.client.send(await signCommand(command, [installed.key, person.key]));
    }
    throw new PbpError("not_found", "Action not found", 404);
  }
  const files: Record<string, [string, string]> = { "/": ["index.html", "text/html"], "/app.js": ["app.js", "text/javascript"], "/style.css": ["style.css", "text/css"], "/early-pay": ["early-pay.html", "text/html"], "/early-pay.js": ["early-pay.js", "text/javascript"], "/early-pay.css": ["early-pay.css", "text/css"], "/financial-profile":["financial-profile.html","text/html"], "/financial-profile.js":["financial-profile.js","text/javascript"] };
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");
    res.setHeader("Referrer-Policy", "no-referrer");
    const reply = (code: number, data: unknown) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
    try {
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin) || req.headers["sec-fetch-site"] === "cross-site") return reply(403, { error: "Local same-origin requests only" });
      const path = new URL(req.url ?? "/", origin).pathname;
      if (req.method === "GET" && files[path]) { const [file, type] = files[path]; res.writeHead(200, { "Content-Type": type }); res.end(readFileSync(new URL(`../../modules/passport/demo/${file}`, import.meta.url))); return; }
      const cookie = /(?:^|;\s*)passport_demo=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
      let session = cookie ? sessions.get(cookie) : undefined;
      if (path === "/api/session" && req.method === "GET") {
        if (!session) {
          if (sessions.size >= 100) return reply(429, { error: "Restart the local demo to clear old sessions" });
          const id = crypto.randomUUID(); session = { persona: null, csrf: crypto.randomUUID() }; sessions.set(id, session);
          res.setHeader("Set-Cookie", `passport_demo=${id}; HttpOnly; SameSite=Strict; Path=/`);
        }
        return reply(200, { ...await home(session), csrf: session.csrf });
      }
      if (req.method !== "POST" || !path.startsWith("/api/")) return reply(404, { error: "Not found" });
      if (!session || req.headers["x-demo-csrf"] !== session.csrf || !req.headers["content-type"]?.startsWith("application/json")) return reply(403, { error: "Refresh the demo before continuing" });
      let raw = "";
      for await (const chunk of req) { raw += chunk.toString(); if (Buffer.byteLength(raw) > 4096) return reply(413, { error: "Request too large" }); }
      let payload; try { payload = JSON.parse(raw); } catch { return reply(400, { error: "Invalid JSON" }); }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return reply(400, { error: "Expected an object" });
      const selected = session;
      const result = queue.then(() => action(selected, path, payload)); queue = result.then(() => {}, () => {});
      reply(200, await result);
    } catch (e) { reply(e instanceof PbpError ? e.status : 500, { error: e instanceof PbpError ? e.message : "Demo request failed", code: e instanceof PbpError ? e.code : "internal" }); }
  });
  server.requestTimeout = 15000;
  try { await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); }); }
  catch (e) { await store.close(); throw e; }
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No local address");
  origin = `http://127.0.0.1:${address.port}`;
  return { origin, close: async () => { await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); } };
}
if (process.argv[1]?.endsWith("passport-web.ts")) {
  const demo = await createPassportWeb();
  console.log(`Passport browser demo: ${demo.origin}`);
  console.log("Local fictional personas only. No cloud credentials. Restart to reset demo data.");
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void demo.close().then(() => process.exit(0)); });
}
