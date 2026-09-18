// Independent desired-invariant probes. Synthetic evidence is never release evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { dependencies, evaluate, fingerprint, validate } from '../../scripts/foundation-gates.ts';
import type { Graph, Evidence } from '../../scripts/foundation-gates.ts';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
function put(root: string, path: string, body: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), body);
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dtp-independent-foundation-gates-'));
  put(root, 'source.txt', 'source'); put(root, 'proof.txt', 'synthetic fixture only');
  put(root, 'fixture.test.ts', "import { test } from 'node:test'; test('fixture',()=>{});");
  const graph: Graph = {
    format: 1, release_target: '0.1.0',
    participants: [{ id: 'author', kind: 'agent' }, { id: 'reviewer', kind: 'agent' }, { id: 'builder', kind: 'external' }],
    gates: Object.entries(dependencies).map(([id, deps]) => ({
      id, required: true, authors: ['author'], depends_on: [...deps], inputs: ['source.txt', 'fixture.test.ts'],
      checks: [{ id: `${id}-tests`, kind: 'test', title: 'test', command: ['--test', 'fixture.test.ts'] },
        { id: `${id}-review`, kind: 'review', title: 'review' },
        ...(id === 'F10' ? [{ id: 'F10-external', kind: 'external' as const, title: 'external' }] : [])],
    })),
  };
  const evidence: Evidence = { format: 1, observations: [], findings: [] };
  const refresh = () => {
    evidence.observations = graph.gates.flatMap(g => g.checks.map(c => ({
      check: c.id, status: 'passed' as const, fingerprint: fingerprint(graph, g.id, root),
      actor: c.kind === 'test' ? 'author' : c.kind === 'external' ? 'builder' : 'reviewer',
      summary: 'Synthetic independent regression fixture, not a real approval',
      artifacts: { 'proof.txt': createHash('sha256').update('synthetic fixture only').digest('hex') },
      ...(c.kind === 'test' ? { command: ['node', ...c.command!], runtime: 'v22.23.2', exit_code: 0, tests: 1, skipped: 0 } : {}),
    })));
  };
  refresh();
  return { root, graph, evidence, refresh, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('a finding cannot close using an unrelated gate review and retest', () => {
  const f = fixture(); try {
    assert.equal(evaluate(f.graph, f.evidence, f.root).ready, true);
    f.evidence.findings.push({ id: 'pg-isolation', gate: 'F9', author: 'reviewer', status: 'closed', closure_checks: ['F0-tests', 'F0-review'] });
    const result = evaluate(f.graph, f.evidence, f.root);
    assert.equal(result.ready, false, 'F0 baseline approval cannot close an F9 persistence defect');
    assert.ok(result.open_blockers.includes('pg-isolation'));
  } finally { f.cleanup(); }
});

test('a finding requires a scoped retest as well as a scoped independent review', () => {
  const f = fixture(); try {
    f.evidence.findings.push({ id: 'recovery-defect', gate: 'F1', author: 'reviewer', status: 'closed', closure_checks: ['F1-review'] });
    assert.equal(evaluate(f.graph, f.evidence, f.root).ready, false, 'a review alone does not establish a fix was retested');
  } finally { f.cleanup(); }
});

test('an executable check cannot name a missing test file while claiming a pass', () => {
  const f = fixture(); try {
    f.graph.gates[0].checks[0].command = ['--test', 'never-implemented.test.ts'];
    f.refresh();
    assert.equal(evaluate(f.graph, f.evidence, f.root).ready, false, 'declared executable inputs must exist and be source-bound');
  } finally { f.cleanup(); }
});

test('mandatory acceptance checks cannot be replaced by a renamed smoke check', () => {
  const f = fixture(); try {
    f.graph.gates.find(g => g.id === 'F9')!.checks[0] = { id: 'F9-smoke', kind: 'test', title: 'version only', command: ['--version'] };
    assert.throws(() => validate(f.graph), /mandatory|acceptance|command|test|check/i);
  } finally { f.cleanup(); }
});

test('CI runner may record tests but cannot supply review or external-builder approval', () => {
  const f = fixture(); try {
    f.graph.participants.push({ id: 'ci', kind: 'runner' }); f.refresh();
    for (const o of f.evidence.observations) if (o.check.endsWith('-tests')) o.actor = 'ci';
    assert.equal(evaluate(f.graph, f.evidence, f.root).ready, true, 'registered CI runner is a valid test executor');
    for (const check of ['F0-review', 'F10-external']) {
      const observation = f.evidence.observations.find(o => o.check === check)!, prior = observation.actor; observation.actor = 'ci';
      const result = evaluate(f.graph, f.evidence, f.root); assert.equal(result.ready, false);
      assert.ok(result.gates.some(g => g.reasons.some(r => r.includes('test runner cannot supply independent review')))); observation.actor = prior;
    }
  } finally { f.cleanup(); }
});

test('CI runner cannot be declared an implementer, and changing its participant role invalidates old evidence', () => {
  const f = fixture(); try {
    f.graph.participants.push({ id: 'ci', kind: 'runner' }); f.refresh();
    f.graph.gates[0].authors.push('ci'); assert.throws(() => validate(f.graph), /runner cannot be an implementer/); f.graph.gates[0].authors.pop();
    f.graph.participants.find(p => p.id === 'ci')!.kind = 'external';
    assert.equal(evaluate(f.graph, f.evidence, f.root).ready, false, 'a roster relabel cannot reuse source-bound approvals');
  } finally { f.cleanup(); }
});

for (const [gate, path] of [
  ['F1', 'sdk/src/canonical.ts'],
  ['F1', 'sdk/src/keys.ts'],
  ['F0', 'sdk/src/profiles/inventory.ts'],
  ['F0', 'sdk/src/profiles/invoice.ts'],
  ['F0', 'sdk/src/profiles/decimal.ts'],
  ['F0', 'sdk/package-lock.json'],
  ['F0', '.node-version'],
  ['F0', 'docs/foundation/baseline-audit.md'],
] as const) {
  test(`${gate} fingerprint includes ${path}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'dtp-foundation-input-coverage-'));
    try {
      const graph = JSON.parse(readFileSync(join(repo, 'docs/foundation/gates.json'), 'utf8')) as Graph;
      for (const input of new Set(graph.gates.flatMap(g => g.inputs))) {
        const original = join(repo, input);
        if (existsSync(original) && lstatSync(original).isDirectory()) mkdirSync(join(root, input), { recursive: true });
        else put(root, input, 'synthetic declared source');
      }
      put(root, path, 'before');
      const before = fingerprint(graph, gate, root);
      put(root, path, 'changed');
      assert.notEqual(fingerprint(graph, gate, root), before, 'a real acceptance dependency cannot change without invalidating evidence');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
