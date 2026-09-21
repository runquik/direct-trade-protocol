// Independent runner tests write only disposable fixture repositories, never real evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFoundationCheck } from '../../scripts/foundation-run.ts';
import { dependencies, validate } from '../../scripts/foundation-gates.ts';
import type { Graph, Evidence } from '../../scripts/foundation-gates.ts';

function fixture(body = "test('probe',()=>assert.equal(1,1));") {
  const root = mkdtempSync(join(tmpdir(), 'dtp-foundation-run-review-'));
  mkdirSync(join(root, 'docs/foundation'), { recursive: true });
  const graph: Graph = { format: 1, release_target: '0.1.0', participants: [{ id: 'author', kind: 'agent' }, { id: 'reviewer', kind: 'agent' }, { id: 'builder', kind: 'external' }],
    gates: Object.entries(dependencies).map(([id, depends_on]) => ({ id, required: true, authors: ['author'], depends_on, inputs: ['probe.test.ts', 'source.txt', 'docs/foundation/gates.json'], checks: [
      { id: `${id}-tests`, kind: 'test', title: 'fixture', command: ['--test', 'probe.test.ts'] },
      { id: `${id}-review`, kind: 'review', title: 'review' },
      ...(id === 'F10' ? [{ id: 'F10-external', kind: 'external' as const, title: 'external' }] : []),
    ] })) };
  writeFileSync(join(root, 'docs/foundation/gates.json'), JSON.stringify(graph));
  writeFileSync(join(root, 'docs/foundation/evidence.json'), JSON.stringify({ format: 1, observations: [], findings: [] }));
  writeFileSync(join(root, 'source.txt'), 'source');
  writeFileSync(join(root, 'probe.test.ts'), `import {test} from 'node:test'; import assert from 'node:assert/strict'; ${body}`);
  const evidence = () => JSON.parse(readFileSync(join(root, 'docs/foundation/evidence.json'), 'utf8')) as Evidence;
  return { root, graph, evidence, run: () => runFoundationCheck(root, 'F0-tests', 'author'), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('runner independent: records a pending attempt before child tests and exact executable provenance after', async () => {
  const f = fixture("import{readFileSync}from'node:fs';test('pending before child',()=>{const e=JSON.parse(readFileSync('docs/foundation/evidence.json','utf8'));assert.equal(e.observations.at(-1).status,'pending');});");
  try {
    const result = await f.run();
    assert.equal(result.status, 'passed'); assert.equal(result.skipped, 0); assert.equal(result.tests, 1);
    assert.deepEqual(result.command, [process.execPath, '--test', 'probe.test.ts']); assert.equal(result.runtime, 'v22.23.2');
    assert.deepEqual(f.evidence().observations.map(o => o.status), ['pending', 'passed']);
    assert.equal(existsSync(join(f.root, 'docs/foundation/run.lock')), false);
    const log = JSON.parse(readFileSync(join(f.root, Object.keys(result.artifacts)[0]), 'utf8'));
    assert.equal(log.code, 0); assert.equal(log.todo, 0); assert.equal(log.cancelled, 0); assert.equal(log.source_unchanged, true);
  } finally { f.cleanup(); }
});

test('runner independent: failed runtime preflight invalidates an earlier passing attempt', async () => {
  const f = fixture(), descriptor = Object.getOwnPropertyDescriptor(process, 'version')!;
  try {
    assert.equal((await f.run()).status, 'passed');
    Object.defineProperty(process, 'version', { ...descriptor, value: 'v25.4.0' });
    await assert.rejects(f.run(), /pinned Node/);
    assert.notEqual(f.evidence().observations.at(-1)!.status, 'passed', 'failed rerun must not leave stale green latest');
  } finally { Object.defineProperty(process, 'version', descriptor); f.cleanup(); }
});

test('runner independent: local checks do not inherit shared database targets', async () => {
  const f = fixture("test('no shared target',()=>{assert.equal(process.env.STORE_URL,undefined);assert.equal(process.env.DTP_TEST_DATABASE_URL,undefined);});");
  const oldStore = process.env.STORE_URL, oldDatabase = process.env.DTP_TEST_DATABASE_URL;
  try {
    process.env.STORE_URL = 'https://synthetic-shared-target.invalid';
    process.env.DTP_TEST_DATABASE_URL = 'postgres://synthetic:unused@synthetic-target.invalid/test';
    assert.equal((await f.run()).status, 'passed', 'local validation must not be redirected to an ambient shared database');
  } finally {
    if (oldStore === undefined) delete process.env.STORE_URL; else process.env.STORE_URL = oldStore;
    if (oldDatabase === undefined) delete process.env.DTP_TEST_DATABASE_URL; else process.env.DTP_TEST_DATABASE_URL = oldDatabase;
    f.cleanup();
  }
});

test('runner independent: exact declared execution excludes ambient NODE_OPTIONS injection', async () => {
  const f = fixture("test('no ambient preload',()=>assert.equal(process.env.DTP_SYNTHETIC_PRELOAD,undefined));"), oldOptions = process.env.NODE_OPTIONS;
  try {
    writeFileSync(join(f.root, 'preload.cjs'), "process.env.DTP_SYNTHETIC_PRELOAD='injected';");
    process.env.NODE_OPTIONS = `--require=${JSON.stringify(join(f.root, 'preload.cjs'))}`;
    assert.equal((await f.run()).status, 'passed', 'unhashed ambient preloads must not modify declared check execution');
  } finally { if (oldOptions === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = oldOptions; f.cleanup(); }
});

test('runner independent: successful raw tests with changed source cannot produce a passing observation', async () => {
  const f = fixture("import{writeFileSync}from'node:fs';test('source changed',()=>{writeFileSync('source.txt','changed');assert.ok(true);});");
  try { const result = await f.run(); assert.equal(result.status, 'failed'); const log = JSON.parse(readFileSync(join(f.root, Object.keys(result.artifacts)[0]), 'utf8')); assert.equal(log.source_unchanged, false); }
  finally { f.cleanup(); }
});

test('runner independent: skip or TODO cannot qualify even when Node exits zero', async () => {
  for (const declaration of ["test.skip('not run',()=>{});", "test.todo('not implemented');"]) {
    const f = fixture(declaration); try { assert.equal((await f.run()).status, 'failed'); } finally { f.cleanup(); }
  }
});

test('runner independent: concurrent runs cannot overwrite an active attempt', async () => {
  const f = fixture("test('brief wait',async()=>{await new Promise(r=>setTimeout(r,150));});");
  try { const first = f.run(); await assert.rejects(f.run(), /another run|lock/); assert.equal((await first).status, 'passed'); assert.equal(f.evidence().observations.length, 2); }
  finally { f.cleanup(); }
});

test('runner independent: external evidence edits are preserved and prevent a passing append', async () => {
  const f = fixture("import{readFileSync,writeFileSync}from'node:fs';test('external evidence edit',()=>{const p='docs/foundation/evidence.json';const e=JSON.parse(readFileSync(p,'utf8'));e.findings.push({id:'concurrent-review',gate:'F0',author:'reviewer',status:'open',closure_checks:[]});writeFileSync(p,JSON.stringify(e));});");
  try { await assert.rejects(f.run(), /evidence changed/); assert.equal(f.evidence().findings[0].id, 'concurrent-review'); assert.equal(f.evidence().observations.at(-1)!.status, 'pending'); }
  finally { f.cleanup(); }
});

test('runner independent: symlinked artifact directory is rejected without writing outside the fixture', async () => {
  const f = fixture(), outside = mkdtempSync(join(tmpdir(), 'dtp-run-review-outside-'));
  try {
    symlinkSync(outside, join(f.root, 'docs/foundation/runs'), 'junction');
    await assert.rejects(f.run(), /symlink/);
    assert.equal(f.evidence().observations.at(-1)!.status, 'pending');
    assert.deepEqual(readdirSync(outside), []);
  } finally { f.cleanup(); rmSync(outside, { recursive: true, force: true }); }
});

test('runner independent: output overflow remains failed with bounded retained output', async () => {
  const f = fixture("test('bounded flood',()=>{process.stdout.write('x'.repeat(17*1024*1024));});");
  try {
    const result = await f.run(); assert.equal(result.status, 'failed');
    const log = JSON.parse(readFileSync(join(f.root, Object.keys(result.artifacts)[0]), 'utf8'));
    assert.ok(Buffer.byteLength(log.stdout) + Buffer.byteLength(log.stderr) <= 16*1024*1024);
  } finally { f.cleanup(); }
});

test('runner independent: declared test filenames cannot smuggle Node preload options', () => {
  const f = fixture();
  try {
    f.graph.gates[0].checks[0].command = ['--test', '--import=./unhashed-preload.test.ts', 'probe.test.ts'];
    assert.throws(() => validate(f.graph), /command|path|option|test/i, 'a suffix does not make a Node option an eligible test filename');
  } finally { f.cleanup(); }
});
