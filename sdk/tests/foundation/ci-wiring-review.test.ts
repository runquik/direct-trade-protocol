import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('independent CI review: foundation command includes all direct helper and independent review suites', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['test:foundation'], 'node --test "tests/foundation/*.test.ts"');
  assert.equal(pkg.scripts['foundation:report'], 'node scripts/foundation-gates.ts');
});

test('independent CI review: foundation tests are an unconditional failing local-conformance step', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/protocol.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const local = workflow.split('  local-conformance:\n')[1]?.split('\n  postgres-concurrency:')[0];
  assert.ok(local); assert.match(local, /working-directory: sdk/);
  const step = local.split(/(?=      - )/).find(s => s.startsWith('      - run: npm run test:foundation\n'));
  assert.ok(step, 'required foundation step must exist');
  assert.doesNotMatch(step, /continue-on-error|\n\s+if:|\|\||--test-name-pattern|--test-skip-pattern/);
  assert.doesNotMatch(local.slice(0, local.indexOf('    steps:')), /continue-on-error|\n\s+if:/);
});

test('onboarding integration tests run unconditionally in local conformance CI', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/protocol.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const local = workflow.split('  local-conformance:\n')[1]?.split('\n  postgres-concurrency:')[0];
  assert.ok(local);
  const step = local.split(/(?=      - )/).find(s => s.startsWith('      - run: npm run test:onboarding\n'));
  assert.ok(step);
  assert.doesNotMatch(step, /continue-on-error|\n\s+if:|\|\||--test-name-pattern|--test-skip-pattern/);
});
