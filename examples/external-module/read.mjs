// Step 3: the module. It reads what company A admitted it to read, derives an exception and replenishment assessment,
// and shows the refusals a correct host must give it. Its report goes to stdout as one JSON document.
//
// What the assessment is: a derived statement from the producers' recorded facts, with every identifier and every
// source observation preserved. What it is not: physical truth, completeness, or authority to do anything about it.
import { keys } from "@dtp/sdk/preview/foundation";
import { KINDS, attempt, audience, connect, draftAsInstallation, loadCredentials, sign } from "./common.mjs";

const { client, health } = await connect();
const credentials = loadCredentials();
if (!credentials.installation) throw new Error("run seed.mjs first");
const installation = { id: credentials.installation.id, key: await keys.keyPairFromSecret(credentials.installation.secret_key) };
const a = credentials.company_a, b = credentials.company_b;
const call = async (action, organization, payload) => {
  const command = await sign(draftAsInstallation(installation, action, organization, payload), [installation.key]);
  return { command, result: await client.send(command) };
};

// 1. Consume company A's records of the kinds this module understands, page by page, keeping the greatest sequence seen.
const records = []; let after = 0, firstPage = null, accepted = null;
for (;;) {
  const { command, result: page } = await call("records.list", a.id, { after, limit: 100, profile_digests: [], kinds: Object.keys(KINDS) });
  firstPage ??= command; accepted = page.profile_digests; records.push(...page.records);
  if (page.next_cursor === null) break;
  after = page.next_cursor;
}
const greatestSeq = records.reduce((m, r) => Math.max(m, r.seq), 0);
const products = records.filter(r => r.profile_digest === KINDS["dtp/product@1"] && r.is_head);
const facts = records.filter(r => r.profile_digest === KINDS["dtp/inventory@2"]);

// 2. The host's derived ledger for the product, which the module cross-checks against the facts it read.
const { result: ledger } = await call("inventory.ledger", a.id, { policy_id: a.policy_id, product_id: a.product_id });

// 3. Derive the assessment in exact thousandths of the base unit; no floating point anywhere near a quantity.
const thousandths = text => { const [whole, fraction = ""] = text.split("."); return BigInt(whole) * 1000n + BigInt((fraction + "000").slice(0, 3)); };
const decimal = n => { const sign = n < 0n ? "-" : "", v = n < 0n ? -n : n, whole = v / 1000n, fraction = (v % 1000n).toString().padStart(3, "0").replace(/0+$/, ""); return `${sign}${whole}${fraction ? "." + fraction : ""}`; };
const MINIMUM_UNRESERVED = "60"; // the module's own policy, in base units; a parameter, not a protocol fact
const samePosition = (x, y) => x.lot_id === y.lot_id && x.location_id === y.location_id && x.status === y.status;
const product = products.find(p => p.id === a.product_id || p.root_id === a.product_id);
const exceptions = [], positions = [];
for (const [key, state] of Object.entries(ledger.positions)) {
  const reserved = Object.values(ledger.reservations).filter(r => r.position === key).reduce((sum, r) => sum + thousandths(r.quantity), 0n);
  const onHand = thousandths(state.quantity), unreserved = onHand - reserved;
  const touching = facts.filter(f => f.body.moves.some(l => samePosition(l.from, state.position) || samePosition(l.to, state.position)) || f.body.reservations.some(o => samePosition(o.position, state.position)));
  const view = { position: state.position, on_hand: decimal(onHand), reserved: decimal(reserved), unreserved: decimal(unreserved), unit: ledger.base_unit,
    provenance: { ledger_revision: ledger.revision, facts: touching.map(f => ({ record_id: f.id, seq: f.seq, accepted_at: f.accepted_at, source_id: f.body.observation.source_id, sequence: f.body.observation.sequence, occurred_at: f.body.occurred_at })) } };
  positions.push(view);
  if (state.position.status === "available" && unreserved < thousandths(MINIMUM_UNRESERVED)) exceptions.push({
    condition: "unreserved_below_minimum", minimum: MINIMUM_UNRESERVED, replenish: decimal(thousandths(MINIMUM_UNRESERVED) - unreserved),
    product: { root_id: product?.root_id ?? null, revision_id: product?.id ?? null, names: product?.body.names ?? [], base_unit: product?.body.base_unit ?? null },
    identifiers: product?.body.identifiers ?? [], ...view,
  });
}

// 4. What a correct host refuses this module. Each is data in the report, not an exception.
const tampered = structuredClone(firstPage); tampered.payload.limit = 50; // bytes changed after signing
const expired = await sign(draftAsInstallation(installation, "records.list", a.id, firstPage.payload, Date.now() - 10 * 60 * 1000), [installation.key]);
const writeId = crypto.randomUUID(); // a read-only installation asking to write: refused on authority, whatever the body
const writeAttempt = await sign(draftAsInstallation(installation, "record.append", a.id, { id: writeId, root_id: writeId, supersedes: null, organization_id: a.id, policy_id: a.policy_id, resource_id: a.product_id, profile_digest: KINDS["dtp/inventory@2"], counterparty_ids: [], body: facts[0]?.body ?? {} }), [installation.key]);
const otherCompany = await sign(draftAsInstallation(installation, "records.list", b.id, { after: 0, limit: 100, profile_digests: [], kinds: Object.keys(KINDS) }), [installation.key]);
const replay = await attempt(client, firstPage);

console.log(JSON.stringify({
  baseline: { audience, host_key: health.store_key_id ?? null, capabilities: health.capabilities, kinds: KINDS, installation: installation.id, mode: credentials.installation.mode, actions: credentials.installation.actions },
  company_a: { id: a.id, policy_id: a.policy_id, product_id: a.product_id, accepted_profile_digests: accepted, records: records.length, products: products.length, facts: facts.length, greatest_seq: greatestSeq, ledger_revision: ledger.revision },
  assessment: { as_of_seq: greatestSeq, minimum_unreserved: MINIMUM_UNRESERVED, positions, exceptions,
    meaning: "derived from the producers' recorded facts as accepted by the host; not physical truth, not completeness, not authority to act" },
  replay: { ok: replay.ok, same: replay.ok && replay.result.records.length === (records.length > 100 ? 100 : records.length) },
  company_b_refusal: await attempt(client, otherCompany),
  tampered: await attempt(client, tampered),
  expired: await attempt(client, expired),
  write_refused: await attempt(client, writeAttempt),
}, null, 2));
