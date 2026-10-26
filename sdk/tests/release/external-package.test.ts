// The external builder path: the SDK as a packed artifact in a consumer's node_modules, a host configured from a file
// with no source edit, and the example module run from outside the repository tree. This is SDK integration coverage
// by the same author, not independent conformance evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateKeyPair } from '../../src/keys.ts';
import { personId, draftCommand, signCommand } from '../../src/v04/wire.ts';
import { createDtpStore, parseDevHostConfig, persistentHostKey, readDevHostConfig } from '../../scripts/dtp-v04-dev-server.ts';

const sdk = resolve(dirname(fileURLToPath(import.meta.url)), '../../'), repo = resolve(sdk, '..');
// Asynchronous on purpose: the in-process host must keep serving while the child talks to it.
const run = (cwd: string, args: string[], env: Record<string, string> = {}) => new Promise<{ status: number | null; stdout: string; stderr: string }>(resolve => {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
  const timer = setTimeout(() => child.kill(), 300000);
  child.on('close', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
});

// npm ships beside node; calling its CLI through process.execPath avoids depending on PATH or a shell.
const npmCli = join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');

/** Package names (not subpaths) of every bare import in the JavaScript under a directory. */
function bareImports(dir: string): Set<string> {
  const names = new Set<string>();
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { for (const n of bareImports(path)) names.add(n); continue; }
    if (!name.endsWith('.js')) continue;
    const text = readFileSync(path, 'utf8');
    const statics = text.matchAll(/^\s*(?:import|export)\b[^'"]*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/gm);
    for (const match of [...statics, ...text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)]) {
      const spec = match[1] ?? match[2];
      if (spec.startsWith('.') || spec.startsWith('node:')) continue;
      names.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
    }
  }
  return names;
}

/** Copies the declared runtime dependencies, transitively, from the SDK's own node_modules into a consumer's. */
function installDeclared(manifest: { dependencies?: Record<string, string> }, modules: string) {
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    const target = join(modules, name);
    if (existsSync(target)) continue;
    cpSync(join(sdk, 'node_modules', name), target, { recursive: true });
    installDeclared(JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')), modules);
  }
}

test('the packed SDK loads from a consumer node_modules and the external module example runs against a file-configured host', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dtp-external-package-'));
  try {
    // 1. Pack the real artifact with `npm pack` (its prepack hook runs build:package) and unpack it into a consumer's
    // node_modules, so the shipped manifest and its `files` list are what the consumer gets. Packing needs no network.
    const pack = await run(sdk, [npmCli, 'pack', '--json', '--pack-destination', root]);
    assert.equal(pack.status, 0, pack.stdout + pack.stderr);
    const [{ filename }] = JSON.parse(pack.stdout.slice(pack.stdout.indexOf('[')));
    const pkg = join(root, 'node_modules/@dtp/sdk');
    mkdirSync(pkg, { recursive: true });
    const untar = spawnSync('tar', ['-xzf', join(root, filename), '-C', pkg, '--strip-components=1'], { encoding: 'utf8' });
    assert.equal(untar.status, 0, untar.stderr);
    const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
    for (const entry of ['index', 'preview', 'preview-foundation']) for (const ext of ['.js', '.d.ts'])
      assert.ok(existsSync(join(pkg, 'dist', entry + ext)), `the tarball ships dist/${entry}${ext}`);
    // Every package the shipped JavaScript imports is a runtime dependency of the shipped manifest, not a devDependency.
    const declared = Object.keys(manifest.dependencies ?? {});
    const imported = bareImports(join(pkg, 'dist'));
    assert.ok(imported.size > 0, 'control: the walk finds the package the preview entry imports');
    for (const specifier of imported) assert.ok(declared.includes(specifier), `${specifier} is imported by dist/ but not declared in dependencies`);
    // Only what the manifest declares (and what those packages declare) is installed, as `npm install <tgz>` would.
    installDeclared(manifest, join(root, 'node_modules'));

    // 2. Every portable entry loads by bare specifier from node_modules on this runtime: no type stripping, no repository paths.
    writeFileSync(join(root, 'probe.mjs'), [
      "const stable = await import('@dtp/sdk'), foundation = await import('@dtp/sdk/preview/foundation'), preview = await import('@dtp/sdk/preview');",
      'console.log(JSON.stringify({ canonicalize: typeof stable.canonicalize, log: typeof foundation.identityLog.verifyIdentityLog, client: typeof preview.v04Client.DtpClient, product: typeof foundation.product.validateProduct, shared: foundation.identityLog === preview.identityLog }));',
    ].join('\n'));
    const probe = await run(root, ['probe.mjs']);
    assert.equal(probe.status, 0, probe.stderr);
    assert.deepEqual(JSON.parse(probe.stdout), { canonicalize: 'function', log: 'function', client: 'function', product: 'function', shared: true });

    // 3. The example, copied out of the repository so it can only reach the package, prepares the host configuration...
    const example = join(root, 'example'), source = join(repo, 'examples/external-module');
    mkdirSync(example);
    for (const file of readdirSync(source).filter(f => f.endsWith('.mjs'))) cpSync(join(source, file), join(example, file));
    const home = join(root, 'synthetic');
    const prepare = await run(example, ['prepare.mjs'], { DTP_EXAMPLE_HOME: home });
    assert.equal(prepare.status, 0, prepare.stderr);
    const config = readDevHostConfig(join(home, 'dev-host.json'));
    assert.equal(config.port, 8790);
    assert.equal(config.data_dir, join(home, 'host-data'));
    assert.deepEqual(Object.keys(config.assessment_pins!), ['https://assessor.example.invalid']);

    // ...the host starts from that configuration alone...
    const store = await createDtpStore({ assessmentPins: config.assessment_pins, pins: config.pins });
    try {
      // ...and the example seeds two companies and installs the module, then the module reads and is refused, all over HTTP.
      const seed = await run(example, ['seed.mjs'], { DTP_EXAMPLE_HOME: home, DTP_AUDIENCE: store.audience });
      assert.equal(seed.status, 0, seed.stderr);
      const read = await run(example, ['read.mjs'], { DTP_EXAMPLE_HOME: home, DTP_AUDIENCE: store.audience });
      assert.equal(read.status, 0, read.stderr);
      const report = JSON.parse(read.stdout);
      assert.equal(report.company_a.records, 5, 'one product and four facts');
      assert.equal(report.company_a.products, 1);
      assert.equal(report.company_a.facts, 4);
      assert.equal(report.company_a.ledger_revision, 4);
      assert.deepEqual(report.company_a.accepted_profile_digests.slice().sort(), Object.values(report.baseline.kinds).sort(), 'the kind selector expanded to exactly the pinned contracts');
      assert.equal(report.replay.ok, true); assert.equal(report.replay.same, true, 'the same signed read recomputes under current authority');
      assert.equal(report.company_b_refusal.ok, false); assert.equal(report.company_b_refusal.status, 403, "another company's records are refused");
      assert.equal(report.tampered.status, 401, 'bytes changed after signing');
      assert.equal(report.expired.status, 401, 'an expired command');
      assert.equal(report.write_refused.status, 403, 'a read-only installation cannot write');
      // The assessment keeps identifiers and provenance: the dock holds 20 jars and the shelf 80 with 30 reserved, both below the module's minimum of 60 unreserved.
      assert.deepEqual(report.assessment.exceptions.map((e: any) => [e.position.location_id, e.on_hand, e.reserved, e.unreserved, e.replenish]).sort(),
        [['dock', '20', '0', '20', '40'], ['shelf', '80', '30', '50', '10']]);
      const exception = report.assessment.exceptions.find((e: any) => e.position.location_id === 'shelf');
      assert.deepEqual(exception.position, { lot_id: 'L1', location_id: 'shelf', status: 'available' });
      assert.ok(exception.identifiers.some((i: any) => i.scheme === 'gs1.gtin' && i.value === '00012345678905'));
      assert.deepEqual(exception.provenance.facts.map((f: any) => f.sequence).sort(), [2, 3, 4], 'every fact that touched the position, by source observation');
      assert.ok(exception.provenance.facts.every((f: any) => typeof f.record_id === 'string' && Number.isInteger(f.seq) && f.source_id === 'wms'));
      assert.equal(exception.product.root_id, report.company_a.product_id, 'the assessment names the product by its root, as the ledger does');
    } finally { await store.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a data directory keeps the host key and the state across restarts, and deleting it is the reset', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dtp-dev-host-data-'));
  try {
    const dataDir = join(root, 'host-data');
    const first = await persistentHostKey(dataDir), again = await persistentHostKey(dataDir);
    assert.equal(again.keyId, first.keyId, 'the same key is read back');
    const key = await generateKeyPair(), person = { id: await personId(key.keyId), key };
    const call = async (audience: string, action: string, payload: Record<string, unknown>) => {
      const response = await fetch(audience + '/dtp/v0.4/commands', { method: 'POST', body: JSON.stringify(await signCommand(draftCommand(audience, person, action, null, payload), [key])) });
      return { status: response.status, ...await response.json() };
    };
    const one = await createDtpStore({ key: first, dataDir });
    try { assert.equal((await call(one.audience, 'person.register', { keys: [key.keyId] })).status, 200); } finally { await one.close(); }
    const two = await createDtpStore({ key: await persistentHostKey(dataDir), dataDir });
    try {
      assert.equal(two.keyId, first.keyId);
      assert.equal((await call(two.audience, 'organizations.list', {})).status, 200, 'the person registered before the restart is still known');
    } finally { await two.close(); }
    rmSync(dataDir, { recursive: true, force: true });
    const three = await createDtpStore({ key: await persistentHostKey(dataDir), dataDir });
    try {
      assert.notEqual(three.keyId, first.keyId, 'a deleted data directory is a new host');
      assert.equal((await call(three.audience, 'organizations.list', {})).status, 403, 'and it knows nobody');
    } finally { await three.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the host configuration file is closed: unknown members and malformed values are refused', () => {
  assert.deepEqual(parseDevHostConfig('{}', '/base'), {});
  assert.deepEqual(parseDevHostConfig('{"port":0,"data_dir":"x","pins":{"https://a.invalid":"ed25519:1"},"assessment_pins":{},"revoked_assessments":["a"],"reference_profiles":{"trade.contract":["b"]},"max_state_bytes":1}', '/base'),
    { port: 0, data_dir: resolve('/base', 'x'), pins: { 'https://a.invalid': 'ed25519:1' }, assessment_pins: {}, revoked_assessments: ['a'], reference_profiles: { 'trade.contract': ['b'] }, max_state_bytes: 1 });
  for (const text of ['[]', '{"secret":1}', '{"port":"8790"}', '{"port":70000}', '{"data_dir":""}', '{"pins":["x"]}', '{"assessment_pins":{"a":1}}', '{"revoked_assessments":"a"}', '{"reference_profiles":{"a":"b"}}', '{"max_state_bytes":0}', '{"ke\\"y":1}'])
    assert.throws(() => parseDevHostConfig(text, '/base'), text);
});
