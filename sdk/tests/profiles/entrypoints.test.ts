import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

test('the package declares a stable entry and clearly separated preview entries', async () => {
  assert.deepEqual(Object.keys(manifest.exports), ['.', './preview', './preview/host']);
  const stable: Record<string, unknown> = await import('../../src/index.ts');
  const preview = await import('../../src/preview.ts');
  const host = await import('../../src/preview-host.ts');
  for (const name of ['canonicalize', 'sha256Hex', 'sha256HexSync']) assert.equal(typeof stable[name], 'function', name);
  assert.equal(typeof preview.inventory.applyInventoryEvent, 'function');
  assert.equal(typeof preview.invoice.validateInvoice, 'function');
  assert.equal(typeof host.v04Engine, 'object');
  // Unreleased layers must never leak into the stable barrel.
  for (const leaked of ['applyInventoryEvent', 'validateInvoice', 'inventory', 'v04Engine']) assert.equal(leaked in stable, false, leaked);
});

function platformImports(entry: string) {
  const seen = new Set<string>(), offenders: string[] = [];
  const visit = (file: string) => {
    if (seen.has(file)) return; seen.add(file);
    for (const match of readFileSync(file, 'utf8').matchAll(/from\s+["']([^"']+)["']/g)) {
      const spec = match[1];
      if (spec.startsWith('.')) visit(resolve(dirname(file), spec));
      else if (/^node:|^(fs|crypto|path|os|buffer|http|net|child_process)$/.test(spec)) offenders.push(`${file} -> ${spec}`);
    }
  };
  visit(resolve(root, entry));
  return { seen, offenders };
}

test('nothing reachable from the portable preview entry imports a platform module', () => {
  const { seen, offenders } = platformImports('src/preview.ts');
  assert.ok(seen.size > 10, 'walk reached the preview modules');
  assert.deepEqual(offenders, []);
});

test('the stable entry is portable too, so key helpers never need a platform module', () => {
  const { seen, offenders } = platformImports('src/index.ts');
  assert.ok(seen.has(resolve(root, 'src/keys.ts')), 'walk reached the key module');
  assert.deepEqual(offenders, []);
});

test('key helpers are reachable through the preview entry and are the stable ones', async () => {
  const stable: Record<string, unknown> = await import('../../src/index.ts');
  const preview = await import('../../src/preview.ts');
  const names = ['generateKeyPair', 'keyPairFromSecret', 'signBytes', 'verifyBytes', 'encodeKeyId', 'decodeKeyId',
    'encodeSignature', 'decodeSignature', 'encodeSecretKey', 'decodeSecretKey'];
  for (const name of names) {
    assert.equal(typeof (preview.keys as Record<string, unknown>)[name], 'function', name);
    assert.equal((preview.keys as Record<string, unknown>)[name], stable[name], `${name} is one function, not a copy`);
  }
});

test('a host holding its own key can sign and verify identity material through the preview entry alone', async () => {
  const { keys, identity } = await import('../../src/preview.ts');
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
