import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Graph } from '../../scripts/foundation-gates.ts';

const workflow = () => readFileSync(new URL('../../../.github/workflows/protocol.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
test('independent foundation CI: every foundation source module receives the pinned Deno check', () => {
  const job = workflow().split('  local-conformance:\n')[1]?.split(/\n  [a-z][a-z-]*:\n/)[0]; assert.ok(job);
  const step = job.split(/(?=      - )/).find(s => s.startsWith('      - run: npx --yes deno@2.9.6 check --config ../supabase/functions/pbp-store/deno.json src/foundation/*.ts\n'));
  assert.ok(step, 'all foundation modules must receive the exact pinned Deno check');
  assert.doesNotMatch(step, /continue-on-error|\n\s+if:|\|\|/);
  assert.doesNotMatch(job.slice(0, job.indexOf('    steps:')), /continue-on-error|\n\s+if:/);
});
test('independent foundation CI: isolated pinned PostgreSQL service matches the harness default and required runner step', () => {
  const text = workflow(), job = text.split('  foundation-postgres:\n')[1]?.split(/\n  [a-z][a-z-]*:\n/)[0]; assert.ok(job);
  assert.match(job, /image: postgres@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73/);
  assert.match(job, /POSTGRES_DB: dtp_foundation_tests/); assert.match(job, /POSTGRES_USER: dtp_test/);
  assert.match(job, /POSTGRES_PASSWORD: synthetic-dtp-local-only/); assert.match(job, /- 15439:5432/);
  assert.match(job, /node-version-file: \.node-version/); assert.match(job, /npm ci --prefix sdk/);
  const step = job.split(/(?=      - )/).find(s => s.startsWith('      - run: node sdk/scripts/foundation-run.ts "$GITHUB_WORKSPACE" F1-postgres-tests ci\n'));
  assert.ok(step, 'mandatory exact source-bound check must execute'); assert.doesNotMatch(step, /continue-on-error|\n\s+if:|\|\||--test-name-pattern|--test-skip-pattern/);
  for (const check of ['F9-postgres-tests', 'F9-person-auth-postgres-tests']) {
    const required = job.split(/(?=      - )/).find(s => s.startsWith(`      - run: node sdk/scripts/foundation-run.ts "$GITHUB_WORKSPACE" ${check} ci\n`));
    assert.ok(required, `${check} must execute as a required source-bound check`); assert.doesNotMatch(required, /continue-on-error|\n\s+if:|\|\||--test-name-pattern|--test-skip-pattern/);
  }
  assert.doesNotMatch(job.slice(0, job.indexOf('    steps:')), /continue-on-error|\n\s+if:/);
  assert.match(job, /if: always\(\)/); assert.match(job, /docs\/foundation\/evidence\.json/); assert.match(job, /docs\/foundation\/runs\//); assert.match(job, /if-no-files-found: error/);
});

test('independent foundation CI: CI role, database tests and workflow are source-bound without granting acceptance approval', () => {
  const graph = JSON.parse(readFileSync(new URL('../../../docs/foundation/gates.json', import.meta.url), 'utf8')) as Graph;
  assert.deepEqual(graph.participants.find(p => p.id === 'ci'), { id: 'ci', kind: 'runner' });
  assert.ok(graph.gates.every(g => !g.authors.includes('ci')));
  assert.ok(graph.gates.find(g => g.id === 'F0')!.inputs.includes('.github/workflows/protocol.yml'));
  const gate = graph.gates.find(g => g.id === 'F1')!, check = gate.checks.find(c => c.id === 'F1-postgres-tests')!;
  assert.equal(check.kind, 'test'); assert.deepEqual(check.command, ['--test', 'sdk/tests/foundation-postgres/identity-registry.test.ts']);
  assert.ok(gate.inputs.includes(check.command![1]));
  assert.ok(gate.checks.some(c => c.id === 'F1-tests')); assert.ok(gate.checks.some(c => c.id === 'F1-review' && c.kind === 'review'));
  const persistence = graph.gates.find(g => g.id === 'F9')!;
  for (const [id, path] of [['F9-postgres-tests', 'sdk/tests/foundation-postgres/persistence.test.ts'], ['F9-person-auth-postgres-tests', 'sdk/tests/foundation-postgres/person-authentication-review.test.ts']]) {
    const check = persistence.checks.find(c => c.id === id)!; assert.equal(check.kind, 'test'); assert.ok(check.command?.includes(path)); assert.ok(persistence.inputs.includes(path));
  }
});
