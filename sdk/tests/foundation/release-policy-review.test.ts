// Independent native verification of the preserved historical signing bytes.
// No foundation or SDK canonicalization/crypto implementation is imported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, createPublicKey, verify } from 'node:crypto';
const load = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
function decode(v: string, length: number) {
  assert.ok(v.startsWith('ed25519:')); const text = v.slice(8), alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n; for (const c of text) { const i = alphabet.indexOf(c); assert.ok(i >= 0); n = n * 58n + BigInt(i); }
  const bytes: number[] = []; while (n > 0) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  const zeroes = text.match(/^1*/)?.[0].length ?? 0; const result = Buffer.from([...Array(zeroes).fill(0), ...bytes]);
  assert.equal(result.length, length); return result;
}
function valid(key: string, signature: string, text: string) {
  const publicKey = createPublicKey({ format: 'der', type: 'spki', key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), decode(key, 32)]) });
  return verify(null, Buffer.from(text, 'utf8'), publicKey, decode(signature, 64));
}
test('independent release review: native Ed25519 verifies historical vectors and rejects changed signed bytes', () => {
  const old = load('../../../spec/vectors/signatures.json'); assert.ok(old.records.length > 0);
  for (const v of old.records) {
    assert.equal(createHash('sha256').update(v.signing_input).digest('hex'), v.payload_hash);
    assert.equal(valid(v.envelope.issuer.key_id, v.envelope.signature, v.signing_input), true);
    assert.equal(valid(v.envelope.issuer.key_id, v.envelope.signature, `${v.signing_input} `), false);
  }
  for (const wire of ['0.3', '0.4']) {
    const v = load(`../../../spec/v${wire}/signing-vector.json`);
    for (const signature of v.command.signatures) {
      assert.equal(valid(signature.key_id, signature.signature, v.signing_input_utf8), true);
      assert.equal(valid(signature.key_id, signature.signature, v.signing_input_utf8.replace(`COMMAND-${wire}`, 'COMMAND-0.1.0')), false);
    }
  }
});
test('independent release review: SDK stays private and historical wire literals remain distinct from public target', () => {
  const pkg = load('../../package.json'), graph = load('../../../docs/foundation/gates.json');
  assert.equal(pkg.private, true); assert.equal(pkg.version, '0.2.0'); assert.equal(graph.release_target, '0.1.0');
  const three = load('../../../spec/v0.3/signing-vector.json'), four = load('../../../spec/v0.4/signing-vector.json');
  assert.equal(three.command.version, '0.3'); assert.equal(four.command.version, '0.4');
  assert.match(three.signing_input_utf8, /PBP-COMMAND-0\.3/); assert.match(four.signing_input_utf8, /DTP-COMMAND-0\.4/);
});
