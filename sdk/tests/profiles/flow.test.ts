import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalize } from '../../src/canonical.ts';
import { parseUntrustedJson } from '../../src/safe-json.ts';
import { checkSchema, validateShape } from '../../src/v04/profiles.ts';
import { FLOW_KIND, FLOW_PROFILE, FLOW_SCHEMA, FLOW_SEMANTICS, applyFlowFact, checkFlowOwner, flowUnpublishedPackaging, goodsLedgerKey, openFlowBook, openGoodsLedger, openMoneyLedger, projectInventory2 } from '../../src/profiles/flow.ts';
import type { FlowBook, FlowFact } from '../../src/profiles/flow.ts';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const load = (p: string) => parseUntrustedJson(readFileSync(here(p), 'utf8')) as any;
const fixtures = load('../../../spec/profiles/flow/1/fixtures.json'), contract = load('../../../spec/profiles/flow/1/profile.json');
const open = (flow: any): FlowBook => { let b = openFlowBook(fixtures.organization_id, flow.book_id); for (const o of flow.openings) b = o.kind === 'goods' ? openGoodsLedger(b, o.product_id, o.product) : openMoneyLedger(b, o.currency, o.account, o.balance); return b; };

test('flow@1 fixtures: every fact reaches its outcome, refusals and duplicates leave the book unchanged, the final book and projection are exact, and the contract and generator are reproducible', () => {
  assert.equal(fixtures.kind, FLOW_KIND); assert.equal(fixtures.profile, FLOW_PROFILE); assert.equal(fixtures.semantics, FLOW_SEMANTICS);
  checkSchema(contract.schema);
  const codes = new Set<string>();
  for (const flow of fixtures.flows) {
    let book = open(flow);
    for (const step of flow.facts) {
      assert.ok(validateShape(contract.schema, step.fact), step.why);
      const r = applyFlowFact(book, structuredClone(step.fact));
      assert.deepEqual(r.ok ? { ok: true, duplicate: r.duplicate } : { ok: false, code: r.code }, step.expect, step.why);
      if (!r.ok || r.duplicate) assert.equal(r.state, book, `${step.why}: unchanged`); else book = r.state;
      if (!r.ok) codes.add(r.code);
    }
    assert.deepEqual(book, flow.final, flow.why);
    if (flow.bridge) assert.deepEqual(projectInventory2(book, flow.bridge.product_id), flow.bridge.projection);
  }
  for (const code of ['invalid', 'wrong_scope', 'revision_conflict', 'insufficient_stock', 'rights_mismatch', 'unit_mismatch', 'ledger_unavailable', 'stale_observation', 'observation_conflict', 'serial_conflict', 'tracking_mismatch']) assert.ok(codes.has(code), `fixtures exercise ${code}`);
  assert.deepEqual(contract, { publisher_id: 'dtp', name: 'flow', version: '1.0.0', schema: FLOW_SCHEMA, semantics: FLOW_SEMANTICS, dependencies: [] });
  assert.equal(createHash('sha256').update(canonicalize(contract), 'utf8').digest('hex'), fixtures.contract_digest);
  const run = spawnSync(process.execPath, [here('../../scripts/build-flow-profile.ts'), '--check'], { encoding: 'utf8', timeout: 60_000 }); assert.equal(run.status, 0, run.stderr);
});

test('flow@1 rules beyond the fixtures: every ledger in a fact is chained to the fact, own references are spelled once, and packaging must be published', () => {
  const flow = fixtures.flows[0], transform = flow.facts.find((f: any) => f.fact.act.verb === 'transform' && f.expect.ok);
  let book = open(flow); for (const step of flow.facts) { if (step === transform) break; const r = applyFlowFact(book, step.fact); if (r.ok) book = r.state; }
  const after = applyFlowFact(book, transform.fact) as { ok: true; state: FlowBook };
  const digest = createHash('sha256').update(canonicalize(transform.fact), 'utf8').digest('hex');
  for (const l of transform.fact.ledgers) { assert.equal(after.state.ledgers[l.key].head, digest); assert.equal(after.state.ledgers[l.key].revision, l.expected_revision + 1); }
  const fact = flow.facts[0].fact as FlowFact, org = fixtures.organization_id;
  assert.deepEqual(checkFlowOwner(fact, org), []);
  const spelled = structuredClone(fact); spelled.legs[0].to.location.ref!.minted_by = org;
  assert.deepEqual(checkFlowOwner(spelled, org).map(i => i.path), ['$.legs[0].to.location.ref.minted_by']);
  const packed = structuredClone(fact); packed.legs[0].quantity.unit = { system: 'packaging', code: null, packaging_id: 'sack', version: '1', base_units_per_pack: '25' };
  const product = (root: string) => root === fact.legs[0].asset.product ? { packaging: [{ packaging_id: 'sack', version: '1', name: 'Sack', base_units_per_pack: '25', gtin: null }] } : undefined;
  assert.equal(flowUnpublishedPackaging(packed, product), false);
  assert.equal(flowUnpublishedPackaging(packed, () => undefined), true);
  assert.equal(flowUnpublishedPackaging(fact, () => undefined), false, 'a base-unit quantity needs no packaging');
  assert.throws(() => openGoodsLedger(after.state, fact.legs[0].asset.product!, { base_unit: { system: 'ucum', code: 'kg' }, tracking: 'lot' }), /exists/);
  assert.equal(goodsLedgerKey(fact.legs[0].asset.product!), fact.ledgers[0].key);
});
