import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

test('the package declares a stable entry and clearly separated preview entries', async () => {
  assert.deepEqual(Object.keys(manifest.exports), ['.', './preview', './preview/foundation', './preview/host']);
  const stable: Record<string, unknown> = await import('../../src/index.ts');
  const preview = await import('../../src/preview.ts');
  const foundation = await import('../../src/preview-foundation.ts');
  const host = await import('../../src/preview-host.ts');
  for (const name of ['canonicalize', 'sha256Hex', 'sha256HexSync']) assert.equal(typeof stable[name], 'function', name);
  assert.equal(typeof preview.inventory.applyInventoryEvent, 'function');
  assert.equal(typeof preview.invoice.validateInvoice, 'function');
  assert.equal(typeof foundation.identityLog.verifyIdentityLog, 'function');
  assert.equal(typeof host.v04Engine, 'object');
  // Unreleased layers must never leak into the stable barrel.
  for (const leaked of ['applyInventoryEvent', 'validateInvoice', 'inventory', 'v04Engine']) assert.equal(leaked in stable, false, leaked);
});

test('the foundation entry is the preview entry without the v0.4 candidate, and shares its module objects', async () => {
  const preview: Record<string, unknown> = await import('../../src/preview.ts');
  const foundation: Record<string, unknown> = await import('../../src/preview-foundation.ts');
  const candidate = Object.keys(preview).filter(name => name.startsWith('v04'));
  assert.deepEqual(candidate.sort(), ['v04Client', 'v04Model', 'v04Permissions', 'v04Profiles', 'v04Wire']);
  assert.deepEqual(Object.keys(foundation).sort(), Object.keys(preview).filter(name => !name.startsWith('v04')).sort());
  for (const name of Object.keys(foundation)) assert.equal(foundation[name], preview[name], `${name} is one module, not a copy`);
});

function imports(entry: string) {
  const seen = new Set<string>(), platform: string[] = [], bare: string[] = [];
  const visit = (file: string) => {
    if (seen.has(file)) return; seen.add(file);
    for (const match of readFileSync(file, 'utf8').matchAll(/from\s+["']([^"']+)["']/g)) {
      const spec = match[1];
      if (spec.startsWith('.')) visit(resolve(dirname(file), spec));
      else if (/^node:|^(fs|crypto|path|os|buffer|http|net|child_process)$/.test(spec)) platform.push(`${file} -> ${spec}`);
      else bare.push(`${file} -> ${spec}`);
    }
  };
  visit(resolve(root, entry));
  return { seen, platform, bare };
}

test('nothing reachable from the portable preview entry imports a platform module', () => {
  const { seen, platform } = imports('src/preview.ts');
  assert.ok(seen.size > 10, 'walk reached the preview modules');
  assert.deepEqual(platform, []);
});

test('the stable entry is portable too, so key helpers never need a platform module', () => {
  const { seen, platform, bare } = imports('src/index.ts');
  assert.ok(seen.has(resolve(root, 'src/keys.ts')), 'walk reached the key module');
  assert.deepEqual(platform, []); assert.deepEqual(bare, []);
});

test('the foundation entry reaches no package at all, while the preview entry needs the JSON Schema validator', () => {
  const foundation = imports('src/preview-foundation.ts');
  assert.ok(foundation.seen.has(resolve(root, 'src/foundation/identity-log.ts')) && foundation.seen.has(resolve(root, 'src/onboarding/client.ts')), 'walk reached the foundation modules');
  assert.deepEqual(foundation.platform, []); assert.deepEqual(foundation.bare, []);
  const preview = imports('src/preview.ts');
  assert.ok(preview.bare.some(edge => edge.endsWith('-> @cfworker/json-schema')), 'the control case: the full preview entry does depend on a package');
});

/** Loads an entry in a child Node whose resolver refuses every bare specifier, from a directory with no node_modules. */
function loadWithoutPackages(entry: string) {
  const hooks = pathToFileURL(resolve(root, 'tests/profiles/refuse-bare-specifiers.mjs')).href;
  const register = `data:text/javascript,import { register } from "node:module"; register(${JSON.stringify(hooks)});`;
  const url = pathToFileURL(resolve(root, entry)).href;
  return spawnSync(process.execPath, ['--import', register, '--input-type=module', '-e', `const m = await import(${JSON.stringify(url)}); console.log("loaded " + Object.keys(m).length);`],
    { encoding: 'utf8', timeout: 60_000, cwd: tmpdir() });
}

test('the foundation entry loads in a plain ESM environment where no package can be resolved; the preview entry does not', () => {
  const foundation = loadWithoutPackages('src/preview-foundation.ts');
  assert.equal(foundation.status, 0, foundation.stderr);
  assert.match(foundation.stdout, /^loaded \d+/);
  const preview = loadWithoutPackages('src/preview.ts');
  assert.notEqual(preview.status, 0, 'the control case: the full preview entry cannot load without its dependency');
  assert.match(preview.stderr, /REFUSED_BARE_SPECIFIER @cfworker\/json-schema/);
});

test('key helpers are reachable through both preview entries and are the stable ones', async () => {
  const stable: Record<string, unknown> = await import('../../src/index.ts');
  const preview = await import('../../src/preview.ts');
  const foundation = await import('../../src/preview-foundation.ts');
  const names = ['generateKeyPair', 'keyPairFromSecret', 'signBytes', 'verifyBytes', 'encodeKeyId', 'decodeKeyId',
    'encodeSignature', 'decodeSignature', 'encodeSecretKey', 'decodeSecretKey'];
  for (const name of names) {
    assert.equal(typeof (preview.keys as Record<string, unknown>)[name], 'function', name);
    assert.equal((preview.keys as Record<string, unknown>)[name], stable[name], `${name} is one function, not a copy`);
    assert.equal((foundation.keys as Record<string, unknown>)[name], stable[name], `${name} through the foundation entry`);
  }
  for (const name of ['canonicalize', 'canonicalBytes', 'sha256Hex']) assert.equal((foundation.canonical as Record<string, unknown>)[name], stable[name], name);
  assert.equal((foundation.safeJson as Record<string, unknown>).parseUntrustedJson, stable.parseUntrustedJson);
});

test('a host holding its own key can sign and verify identity material through the foundation entry alone', async () => {
  const { keys, identity } = await import('../../src/preview-foundation.ts');
  const now = 1_800_000_000_000;
  const [operational, recovery, next] = await Promise.all([keys.generateKeyPair(), keys.generateKeyPair(), keys.generateKeyPair()]);
  // The host keeps only an encoded secret; it rebuilds its signing key without an internal import.
  const resolver = await keys.keyPairFromSecret((await keys.generateKeyPair()).secretKey);
  const genesis = await identity.signIdentity('DTP-PERSON-GENESIS-1',
    { nonce: crypto.randomUUID(), operational: { keys: [operational.keyId], threshold: 1 }, recovery: { keys: [recovery.keyId], threshold: 1 } }, [operational, recovery]);
  const state = await identity.createIdentity(genesis, { id: crypto.randomUUID(), key_id: resolver.keyId }, now);
  const moved = await identity.transitionIdentity(state, await identity.signIdentity('DTP-IDENTITY-TRANSITION-1',
    { identity_id: state.head.identity_id, expected_digest: state.head_digest, sequence: 1, kind: 'rotate' as const,
      operational: { keys: [next.keyId], threshold: 1 }, recovery: state.head.recovery, issued_at: now, expires_at: now + 300_000 }, [operational, next]), now);
  const request = { identity_id: state.head.identity_id, audience: 'https://relying.example', challenge: 'a'.repeat(64) };
  const { proof } = await identity.issueResolution(moved, request, resolver, moved.head.effective_at);
  const head = await identity.verifyResolution(proof, { ...request, resolver_id: moved.resolver_id, resolver_key: resolver.keyId,
    resolver_epoch: 0, minimum_sequence: 1, minimum_digest: moved.head_digest }, moved.head.effective_at);
  assert.equal(head.sequence, 1);
  // Raw countersignature over bytes of the host's choosing, again through the same door.
  const bytes = new TextEncoder().encode(moved.head_digest);
  assert.equal(await keys.verifyBytes(resolver.keyId, bytes, await keys.signBytes(resolver.secretKey, bytes)), true);
});
