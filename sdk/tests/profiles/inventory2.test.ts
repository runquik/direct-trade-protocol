import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalize } from '../../src/canonical.ts';
import { parseUntrustedJson } from '../../src/safe-json.ts';
import { checkSchema, validateShape } from '../../src/v04/profiles.ts';
import { INVENTORY2_KIND, INVENTORY2_PROFILE, INVENTORY2_SCHEMA, INVENTORY2_SEMANTICS, OBSERVATION_WINDOW, applyInventoryFact, openInventoryLedger, projectInventoryV1 } from '../../src/profiles/inventory2.ts';
import type { InventoryFact, InventoryLedger } from '../../src/profiles/inventory2.ts';
import type { ProductBody } from '../../src/profiles/product.ts';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const fixtures = parseUntrustedJson(readFileSync(here('../../../spec/profiles/inventory/2/fixtures.json'), 'utf8')) as {
  kind: string; profile: string; semantics: string; observation_window: number; contract_digest: string; organization_id: string;
  flows: { why: string; product_id: string; product: ProductBody; facts: { why: string; fact: InventoryFact; expect: { ok: boolean; duplicate?: boolean; code?: string } }[]; final: InventoryLedger; bridge: { location_id: string; projection: unknown } | null }[] };
const contract = parseUntrustedJson(readFileSync(here('../../../spec/profiles/inventory/2/profile.json'), 'utf8')) as Record<string, unknown>;

test('inventory@2 fixtures: every flow replays to exactly the expected outcomes and the exact final ledger; refused and duplicate facts leave no trace', () => {
  assert.equal(fixtures.kind, INVENTORY2_KIND); assert.equal(fixtures.profile, INVENTORY2_PROFILE); assert.equal(fixtures.semantics, INVENTORY2_SEMANTICS); assert.equal(fixtures.observation_window, OBSERVATION_WINDOW);
  assert.ok(fixtures.flows.length >= 2 && fixtures.flows[0].facts.length >= 30 && fixtures.flows[1].facts.length >= 9);
  checkSchema(contract.schema);
  const codes = new Set<string>();
  for (const flow of fixtures.flows) {
    let ledger = openInventoryLedger(fixtures.organization_id, flow.product_id, flow.product);
    for (const step of flow.facts) {
      assert.ok(validateShape(contract.schema, step.fact), step.why);
      const before = structuredClone(ledger), r = applyInventoryFact(ledger, structuredClone(step.fact));
      assert.deepEqual(r.ok ? { ok: true, duplicate: r.duplicate } : { ok: false, code: r.code }, step.expect, step.why);
      if (r.ok && !r.duplicate) { assert.equal(r.state.revision, before.revision + 1, step.why); ledger = r.state; }
      else { assert.deepEqual(r.state, before, `${step.why}: no effect`); if (!r.ok) codes.add(r.code); }
      assert.deepEqual(ledger, r.ok && !r.duplicate ? r.state : before);
    }
    assert.deepEqual(ledger, flow.final, flow.why);
    if (flow.bridge) assert.deepEqual(projectInventoryV1(ledger, flow.bridge.location_id), flow.bridge.projection, flow.why);
  }
  for (const code of ['invalid', 'wrong_scope', 'observation_conflict', 'stale_observation', 'revision_conflict', 'unit_mismatch', 'tracking_mismatch', 'insufficient_stock', 'insufficient_reservation', 'serial_conflict']) assert.ok(codes.has(code), `fixtures exercise ${code}`);
});

test('inventory@2 contract: the published contract is the reference schema, its digest is recomputed with a second SHA-256, and the generator reproduces both files', () => {
  assert.deepEqual(contract, { publisher_id: 'dtp', name: 'inventory', version: '2.0.0', schema: INVENTORY2_SCHEMA, semantics: INVENTORY2_SEMANTICS, dependencies: [] });
  assert.equal(createHash('sha256').update(canonicalize(contract), 'utf8').digest('hex'), fixtures.contract_digest);
  const run = spawnSync(process.execPath, [here('../../scripts/build-inventory-profile.ts'), '--check'], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(run.status, 0, run.stderr);
});

test('inventory@2 invariants: the sum over positions plus what left is what came in; state size follows sources, not facts', () => {
  const flow = fixtures.flows[0], ledger = flow.final;
  const thousandths = (v: string) => { const [w, f = ''] = v.split('.'); return BigInt(w) * 1000n + BigInt(f.padEnd(3, '0')); };
  const onHand = Object.values(ledger.positions).reduce((n, p) => n + thousandths(p.quantity), 0n);
  // 120 received + 1 + 1 (audit) + 7 (L3) in; 10 fulfilled + 5 adjusted + 10 produced + 29 shipped out.
  assert.equal(onHand, (120n + 1n + 1n + 7n - 10n - 5n - 10n - 29n) * 1000n);
  assert.deepEqual(Object.keys(ledger.sources).sort(), ['audit', 'count', 'mes', 'orders', 'wms']);
  assert.deepEqual(Object.keys(ledger.sources.audit.recent).sort(), ['100', '40'], 'the window keeps only recent sequences');
  assert.equal(ledger.sources.audit.high_water, 100);
  assert.ok(Object.values(ledger.positions).every(p => thousandths(p.quantity) > 0n || p.serials.length > 0), 'empty positions are dropped');
  const bad = applyInventoryFact(ledger, { ...flow.facts[0].fact, expected_revision: ledger.revision, observation: { source_id: 'wms', sequence: 999 }, moves: [{ ...flow.facts[0].fact.moves[0], quantity: { amount: '1', unit: { system: 'ucum', code: '{jar}', packaging_id: null, version: null, base_units_per_pack: null } }, from: { lot_id: 'L1', location_id: 'shelf', status: 'available' }, to: { lot_id: 'L1', location_id: 'shelf', status: 'available' } }] });
  assert.equal(bad.ok, false); if (!bad.ok) assert.match(bad.message, /same position/);
});
