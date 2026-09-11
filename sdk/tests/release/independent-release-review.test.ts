import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { emptyEvidence, expectedDependencies, gateFingerprint, evaluate, main } from '../../scripts/release-gates.ts';
import type { Graph, Evidence } from '../../scripts/release-gates.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dtp-independent-release-review-'));
  mkdirSync(join(root, 'sdk'));
  writeFileSync(join(root, 'input.txt'), 'SYNTHETIC SOURCE');
  writeFileSync(join(root, 'review.txt'), 'SYNTHETIC OBSERVATION ARTIFACT; NOT REAL RELEASE EVIDENCE');
  const graph: Graph = { version: 1, release: 'DTP-0.4', initial_status: 'pending', checks: [], gates: [] };
  for (const [id, dependencies] of Object.entries(expectedDependencies)) {
    const check = id.toLowerCase() + '-review';
    graph.checks.push({ id: check, title: id, kind: id === 'G00' ? 'node' : 'manual', files: ['input.txt'], ...(id === 'G00' ? { args: ['--version'] } : {}) });
    graph.gates.push({ id, title: id, owner: 'synthetic-author', required: true, depends_on: [...dependencies], inputs: ['input.txt'], checks: [check] });
  }
  const evidence = emptyEvidence(), artifactHash = createHash('sha256').update(readFileSync(join(root, 'review.txt'))).digest('hex');
  for (const gate of graph.gates) evidence.observations.push({ check_id: gate.checks[0], status: 'passed', source_hash: gateFingerprint(graph, gate.id, root), recorded_at: new Date().toISOString(), actor: 'synthetic-reviewer', summary: 'Synthetic evaluator fixture, not real test execution', artifacts: { 'review.txt': artifactHash }, ...(gate.id === 'G00' ? { exit_code: 0, skipped_tests: 0, runtime: 'v22.23.2', command: ['node', '--version'] } : {}) });
  writeFileSync(join(root, 'graph.json'), JSON.stringify(graph));
  writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence));
  return { root, graph, evidence, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('independent release review: an unavailable runtime rerun supersedes previously green evidence', () => {
  const f = fixture(); try {
    assert.equal(evaluate(f.graph, f.evidence, f.root).ready, true);
    let failed = false;
    try { failed = main(['run-check', '--graph', 'graph.json', '--evidence', 'evidence.json', '--check', 'g00-review', '--node', join(f.root, 'unavailable-node.exe')], f.root) !== 0; }
    catch { failed = true; }
    assert.equal(failed, true, 'runtime failure must not succeed');
    const observed = JSON.parse(readFileSync(join(f.root, 'evidence.json'), 'utf8')) as Evidence;
    assert.equal(evaluate(f.graph, observed, f.root).ready, false, 'a failed actual rerun must invalidate the previous successful observation');
    assert.notEqual(observed.observations.filter(o => o.check_id === 'g00-review').at(-1)!.status, 'passed');
  } finally { f.cleanup(); }
});

test('independent release review: executable passes require a pinned runtime and explicit zero skipped tests', () => {
  const f = fixture(); try {
    assert.equal(evaluate(f.graph, f.evidence, f.root).ready, true);
    for (const changes of [{ runtime: 'v24.0.0' }, { runtime: 'not-a-runtime' }, { skipped_tests: undefined }, { skipped_tests: -1 }, { skipped_tests: 0.5 }]) {
      const evidence = structuredClone(f.evidence);
      Object.assign(evidence.observations[0], changes);
      let rejected = false;
      try { rejected = !evaluate(f.graph, evidence, f.root).ready; } catch { rejected = true; }
      assert.equal(rejected, true, `invalid executable evidence accepted: ${JSON.stringify(changes)}`);
    }
  } finally { f.cleanup(); }
});
