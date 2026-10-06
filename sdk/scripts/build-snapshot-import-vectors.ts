// Builds spec/vectors/snapshot-import.json (#63): whole, signed v0.4 snapshots a conforming host MUST import or MUST
// refuse at `migration.ready`. One base snapshot carries one company with the five registered business-fact kinds;
// each case is the same company with exactly one host import rule broken and every affected command re-signed, so a
// consumer runs its real import path and never has to sign anything. Keys, instants and IDs are fixed and Ed25519
// signatures are deterministic, so rerunning this must leave the file unchanged; `--check` compares without writing.
// The keys are published on purpose: never use them for anything real. Rule: spec/v0.4/SPEC.md section 8.
import { readFileSync, writeFileSync } from 'node:fs';
import { sha256Sync } from '../src/sha256.ts';
import { encodeKeyId, encodeSecretKey } from '../src/keys.ts';
import type { KeyPair } from '../src/keys.ts';
import { emptyState } from '../src/v04/model.ts';
import type { BusinessRecord, Context, Snapshot, State } from '../src/v04/model.ts';
import { execute } from '../src/v04/engine.ts';
import { digest, draftCommand, organizationId, personId, signCommand } from '../src/v04/wire.ts';
import { applySnapshot, buildSnapshot } from '../src/v04/snapshot.ts';
import { applyInventoryFact } from '../src/profiles/inventory2.ts';
import { inventoryKey } from '../src/profiles/inventory.ts';
import { PRODUCT_PROFILE } from '../src/profiles/product.ts';
import { ORDER_PROFILE } from '../src/profiles/order.ts';
import { FORECAST_PROFILE } from '../src/profiles/forecast.ts';
import { PARTY_PROFILE } from '../src/profiles/party.ts';
import { INVENTORY2_PROFILE } from '../src/profiles/inventory2.ts';
import { loadProtocolProfiles } from './dtp-v04-dev-server.ts';

const PKCS8 = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];
async function fixedKey(label: string): Promise<KeyPair> {
  const seed = sha256Sync(`dtp-snapshot-import-vector:${label}`);
  const key = await crypto.subtle.importKey('pkcs8', new Uint8Array([...PKCS8, ...seed]), { name: 'Ed25519' }, true, ['sign']);
  const publicKey = new Uint8Array(Buffer.from((await crypto.subtle.exportKey('jwk', key)).x!, 'base64url'));
  return { keyId: encodeKeyId(publicKey), secretKey: encodeSecretKey(seed, publicKey), publicKey, seed };
}
const ownerKey = await fixedKey('owner'), storeKey = await fixedKey('source-host');
const owner = { id: await personId(ownerKey.keyId), key: ownerKey };
const AUDIENCE = 'https://source-host.example', T = Date.parse('2026-09-01T08:00:00.000Z');
const NONCE = '5a5a5a5a-0000-4000-8000-000000000001';
const ORG = await organizationId(owner.id, NONCE);
/** Fixed IDs: one namespace per role, so a case that adds a record never renumbers the base. */
const fixedId = (role: number, n: number) => `${role.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const POLICY = fixedId(1, 1), PRODUCT = fixedId(2, 1), PRODUCT_V2 = fixedId(2, 2), PARTY = fixedId(3, 1), ORDER = fixedId(4, 1), ORDER_ACK = fixedId(4, 2);
const FORECAST = fixedId(5, 1), FACT_1 = fixedId(6, 1), FACT_2 = fixedId(6, 2);

const protocol = await loadProtocolProfiles();
const fixtures = (p: string) => JSON.parse(readFileSync(new URL(`../../spec/profiles/${p}/fixtures.json`, import.meta.url), 'utf8'));
const contract = { product: fixtures('product/1').contract_digest, inventory: fixtures('inventory/2').contract_digest, party: fixtures('party/1').contract_digest,
  order: fixtures('order/1').contract_digest, forecast: fixtures('forecast/1').contract_digest } as const;
for (const d of Object.values(contract)) if (!protocol.protocolProfiles[d]) throw new Error(`registered contract ${d} is missing`);

// Bodies. Every body passes its profile; the cases below change one thing.
const PK = 'case-6';
const packRevision = (version: string, units: string) => ({ packaging_id: PK, version, name: `Case of ${Number(units)} jars, v${version}`, base_units_per_pack: units, gtin: null });
const productBody = (packaging: unknown[]) => ({ names: [{ name: 'Synthetic Sauce 500 g', language: 'en' }], description: null, brand: null, category: null, identifiers: [],
  base_unit: { system: 'ucum', code: '{jar}' }, packaging, tracking: 'lot', shelf_life_days: null, replaces: null, status: 'active' });
const PRODUCT_1 = productBody([packRevision('1', '6.000')]), PRODUCT_2 = productBody([packRevision('1', '6.000'), packRevision('2', '12.000')]);
const packUnit = (version: string, units: string) => ({ system: 'packaging', code: null, packaging_id: PK, version, base_units_per_pack: units });
const fact = (sequence: number, expected_revision: number, amount: string, unit: unknown) => ({
  product_id: PRODUCT, observation: { source_id: 'wms-1', sequence }, occurred_at: new Date(T + sequence * 3_600_000).toISOString(), expected_revision,
  moves: [{ from: { lot_id: null, location_id: '~supplier', status: 'available' }, to: { lot_id: 'LOT-A', location_id: 'DOCK', status: 'available' },
    quantity: { amount, unit }, serial_ids: null, reason: null, links: { transformation_id: null, order_id: null } }],
  reservations: [] });
const FACT_1_BODY = fact(1, 0, '2.000', packUnit('1', '6.000')), FACT_2_BODY = fact(2, 1, '1.000', packUnit('2', '12.000'));
const PARTY_BODY = { kind: 'organization', names: [{ name: 'Synthetic Supplier', language: 'en' }], identifiers: [], protocol_identity: null, roles: ['supplier'], locations: [], parent: null, status: 'active' };
const orderBody = (status: string, lines?: unknown[]) => ({ buyer: { self: true, party_id: null, revision: null }, seller: { self: false, party_id: PARTY, revision: null },
  placed_at: '2026-09-01T09:00:00.000Z', currency: 'USD', external: [{ scheme: 'buyer.po', value: 'PO-0001' }],
  lines: lines ?? [{ line_id: '1', product: { product_id: PRODUCT, revision: PRODUCT, description: null }, quantity: { amount: '10', unit: packUnit('1', '6.000') },
    price: { amount: '30.000000', currency: 'USD' }, requested: null, links: { contract_id: null } }],
  status, terms: { payment_net_days: 30, incoterm: null }, replaces: null });
const FORECAST_BODY = { subject: { product_id: PRODUCT, description: null }, party_id: PARTY, direction: 'demand', horizon: { start: '2026-10-01', end: '2026-12-31' },
  as_of: '2026-09-01T06:00:00.000Z', method: 'trailing 12-week average', quantity: { amount: '600', unit: { system: 'ucum', code: '{jar}', packaging_id: null, version: null, base_units_per_pack: null } },
  confidence: 60, scenario: 'base', status: 'draft' };

type Variant = 'base' | 'fact-unpublished-pack' | 'fact-pack-before-published' | 'product-drops-packaging' | 'product-alters-packaging' | 'order-born-acknowledged'
  | 'order-lines-after-acknowledgment' | 'forecast-subject-changed' | 'party-kind-changed' | 'person-party-business-policy' | 'ledger-projection-differs';

/** Runs the company's history on a source host. A case writes one record the way a host that skipped the rule would. */
async function source(variant: Variant): Promise<Snapshot> {
  const s: State = emptyState();
  const ctx: Context = { audience: AUDIENCE, storeKey, pins: {}, now: T, kinds: protocol.kinds, protocolProfiles: protocol.protocolProfiles };
  let n = 0;
  const signed = async (action: string, org: string | null, payload: Record<string, unknown>) => {
    ctx.now += 60_000;
    const c = draftCommand(AUDIENCE, owner, action, org, payload, ctx.now); c.request_id = fixedId(0xc, ++n);
    return signCommand(c, [owner.key]);
  };
  const call = async (action: string, org: string | null, payload: Record<string, unknown>) => execute(s, await signed(action, org, payload), ctx);
  const payload = (id: string, root_id: string, supersedes: string | null, profile_digest: string, resource_id: string, body: unknown) =>
    ({ id, root_id, supersedes, organization_id: ORG, policy_id: POLICY, resource_id, profile_digest, counterparty_ids: [], body });
  const append = (...a: Parameters<typeof payload>) => call('record.append', ORG, payload(...a));
  /** Writes a signed record without the host rule under test, keeping every projection the rule does not cover consistent. */
  const inject = async (...a: Parameters<typeof payload>) => {
    const p = payload(...a), command = await signed('record.append', ORG, p);
    let validation: any = { profile: { [contract.product]: PRODUCT_PROFILE, [contract.order]: ORDER_PROFILE, [contract.forecast]: FORECAST_PROFILE, [contract.party]: PARTY_PROFILE }[p.profile_digest], level: 'business-rules', business_verified: false };
    if (p.profile_digest === contract.inventory) {
      const company = s.inventory[ORG]!, change = applyInventoryFact(company.ledgers[PRODUCT], p.body as any);
      if (!change.ok) throw new Error(`${variant}: the reducer refuses the injected fact`);
      company.ledgers[PRODUCT] = { ...change.state, policy_id: POLICY };
      const b = p.body as any; company.facts[inventoryKey(b.product_id, b.observation.source_id, b.observation.sequence)] = { hash: await digest(b), record_id: p.id, policy_id: POLICY, profile_digest: p.profile_digest };
      validation = { profile: INVENTORY2_PROFILE, revision: change.state.revision, physical_stock_verified: false };
    }
    if (p.supersedes) s.records[p.supersedes].is_head = false;
    s.records[p.id] = { ...structuredClone(p), command, seq: s.next_seq++, is_head: true, accepted_at: new Date(ctx.now).toISOString(), validation } as BusinessRecord;
  };

  await call('person.register', null, { keys: [ownerKey.keyId] });
  await call('organization.create', ORG, { name: 'Synthetic Import Co', nonce: NONCE, controllers: [owner.id], threshold: 1 });
  await call('policy.create', ORG, { policy_id: POLICY, expected_revision: 0, classification: 'business', stewards: [owner.id], threshold: 1,
    grants: [{ person_id: owner.id, actions: ['read', 'write', 'export'], resource_ids: '*', expires_at: new Date(T + 180 * 86_400_000).toISOString() }] });
  for (const d of Object.values(contract)) await call('profile.admit', ORG, { digest: d });

  await append(PRODUCT, PRODUCT, null, contract.product, PRODUCT, PRODUCT_1);
  await call('inventory.open', ORG, { policy_id: POLICY, product_id: PRODUCT });
  await append(FACT_1, FACT_1, null, contract.inventory, PRODUCT, FACT_1_BODY);
  if (variant === 'fact-pack-before-published') await inject(FACT_2, FACT_2, null, contract.inventory, PRODUCT, FACT_2_BODY);
  if (variant === 'product-drops-packaging') await inject(PRODUCT_V2, PRODUCT, PRODUCT, contract.product, PRODUCT, productBody([packRevision('2', '12.000')]));
  else if (variant === 'product-alters-packaging') await inject(PRODUCT_V2, PRODUCT, PRODUCT, contract.product, PRODUCT, productBody([packRevision('1', '8.000'), packRevision('2', '12.000')]));
  else await append(PRODUCT_V2, PRODUCT, PRODUCT, contract.product, PRODUCT, PRODUCT_2);
  if (variant !== 'fact-pack-before-published') await append(FACT_2, FACT_2, null, contract.inventory, PRODUCT, FACT_2_BODY);
  if (variant === 'fact-unpublished-pack') await inject(fixedId(6, 3), fixedId(6, 3), null, contract.inventory, PRODUCT, fact(3, 2, '1.000', packUnit('1', '600000.000')));

  if (variant === 'party-kind-changed') {
    await append(PARTY, PARTY, null, contract.party, PARTY, PARTY_BODY);
    await inject(fixedId(3, 2), PARTY, PARTY, contract.party, PARTY, { ...PARTY_BODY, kind: 'unit', parent: fixedId(3, 9) });
  } else await append(PARTY, PARTY, null, contract.party, PARTY, PARTY_BODY);
  if (variant === 'person-party-business-policy')
    await inject(fixedId(3, 3), fixedId(3, 3), null, contract.party, fixedId(3, 3), { ...PARTY_BODY, kind: 'person', names: [{ name: 'Synthetic Contact', language: null }], roles: ['customer'] });

  if (variant === 'order-born-acknowledged') await inject(ORDER, ORDER, null, contract.order, ORDER, orderBody('acknowledged'));
  else {
    await append(ORDER, ORDER, null, contract.order, ORDER, orderBody('placed'));
    await append(ORDER_ACK, ORDER, ORDER, contract.order, ORDER, orderBody('acknowledged'));
  }
  if (variant === 'order-lines-after-acknowledgment') {
    const lines = orderBody('acknowledged').lines as any[];
    await inject(fixedId(4, 3), ORDER, ORDER_ACK, contract.order, ORDER, orderBody('acknowledged', [{ ...lines[0], quantity: { ...lines[0].quantity, amount: '20' } }]));
  }

  await append(FORECAST, FORECAST, null, contract.forecast, FORECAST, FORECAST_BODY);
  if (variant === 'forecast-subject-changed')
    await inject(fixedId(5, 2), FORECAST, FORECAST, contract.forecast, FORECAST, { ...FORECAST_BODY, subject: { product_id: null, description: 'Synthetic Sauce, all sizes' }, as_of: '2026-09-02T06:00:00.000Z' });

  const snapshot = buildSnapshot(s, ORG, ctx);
  // Not a signed record: the carried ledger claims stock its signed facts do not produce.
  if (variant === 'ledger-projection-differs') {
    const ledger = snapshot.inventory[ORG].ledgers[PRODUCT], position = Object.values(ledger.positions as Record<string, { quantity: string }>)[0];
    position.quantity = (Number(position.quantity) + 1).toFixed(3);
  }
  return snapshot;
}

const CASES: [Variant, string, string][] = [
  ['fact-unpublished-pack', 'packaging pin (#59)', 'an inventory@2 fact pins a pack conversion (600000 base units per case-6 v1) that no product revision published'],
  ['fact-pack-before-published', 'packaging pin (#59)', 'an inventory@2 fact pins case-6 v2, recorded while the product head published only v1; the later product revision that adds v2 does not make it valid'],
  ['product-drops-packaging', 'product continuity', 'a product revision drops packaging revision case-6 v1'],
  ['product-alters-packaging', 'product continuity', 'a product revision changes packaging revision case-6 v1 in place (6 to 8 base units)'],
  ['order-born-acknowledged', 'order genesis', 'an order whose first record is already acknowledged'],
  ['order-lines-after-acknowledgment', 'order continuity', 'an acknowledged order revised with a changed line quantity'],
  ['forecast-subject-changed', 'forecast continuity', 'a forecast revision that changes its subject'],
  ['party-kind-changed', 'party continuity', 'a party revision that changes its kind from organization to unit'],
  ['person-party-business-policy', 'personnel classification', 'a person party held under a business-classified policy'],
  ['ledger-projection-differs', 'inventory replay', 'the carried inventory@2 ledger holds one more jar than replaying its signed facts produces; no signature is changed'],
];

const refusal = async (snap: Snapshot) => { try { await applySnapshot(emptyState(), structuredClone(snap)); return null; } catch (e: any) { return e?.code ?? String(e); } };
const base = await source('base');
const dest = emptyState(); await applySnapshot(dest, structuredClone(base));
const heads = Object.fromEntries(base.records.filter(r => r.is_head).map(r => [r.root_id, r.id]).sort(([a], [b]) => a < b ? -1 : 1));
const cases = [];
for (const [name, rule, why] of CASES) {
  const snapshot = await source(name);
  const outcome = await refusal(snapshot);
  if (outcome !== 'invalid_snapshot') throw new Error(`${name}: the reference import gave ${outcome}, not invalid_snapshot`);
  cases.push({ name, rule, why, expect: 'invalid_snapshot', snapshot });
}

const out = {
  description: 'v0.4 candidate: whole, signed snapshots a conforming host MUST import or MUST refuse when a company moves to it (migration.ready, spec/v0.4/SPEC.md section 8). The base is one company with one business policy and the five registered business-fact kinds: a product with two revisions (the second adds a packaging revision), an open inventory@2 ledger with two facts, a party, an acknowledged order and a forecast. A conforming host MUST import it and reproduce its projections exactly. Each case is the base with exactly one host import rule broken and the affected commands re-signed with the published key; a conforming host MUST refuse every case with invalid_snapshot. These rules go beyond the profile reducers and fixtures: they are the checks a destination re-runs on import. The keys are published on purpose: never use them for anything real.',
  rule: 'Import replays every signed command and record; it refuses with invalid_snapshot any record a live host would have refused when it was recorded, and any carried projection that replay does not reproduce.',
  keys: { owner: { key_id: ownerKey.keyId, secret_key: ownerKey.secretKey }, source_host: { key_id: storeKey.keyId } },
  base: { expect: 'import', projections: { heads, inventory: dest.inventory[ORG] }, snapshot: base },
  cases,
};
const text = JSON.stringify(out, null, 2) + '\n', target = new URL('../../spec/vectors/snapshot-import.json', import.meta.url);
if (!process.argv.includes('--check')) writeFileSync(target, text);
// A checkout may have converted line endings; the content is what must not drift.
else if (readFileSync(target, 'utf8').replaceAll('\r\n', '\n') !== text) { console.error('spec/vectors/snapshot-import.json is stale; rerun this script without --check'); process.exit(1); }
