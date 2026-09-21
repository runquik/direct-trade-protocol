// Read-only historical compatibility qualification. No generators, stores, network or evidence rewrites.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { signingInput, verifyRecord } from '../../src/sign.ts';
import { canonicalBytes } from '../../src/canonical.ts';
import { decodeSignature, verifyBytes } from '../../src/keys.ts';
import * as v03 from '../../src/v03/wire.ts';
import * as v04 from '../../src/v04/wire.ts';
import { createIdentity } from '../../src/foundation/identity.ts';

const json = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const signatures = json('../../../spec/vectors/signatures.json');
const three = json('../../../spec/v0.3/signing-vector.json');
const four = json('../../../spec/v0.4/signing-vector.json');
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

test('release contract: original v0.2 record vectors retain exact signed field bytes and signatures', async () => {
  assert.ok(signatures.records.length > 0);
  for (const vector of signatures.records) {
    const original = structuredClone(vector.envelope), bytes = signingInput(vector.envelope);
    assert.equal(new TextDecoder().decode(bytes), vector.signing_input, vector.name);
    assert.equal(hash(bytes), vector.payload_hash, vector.name);
    assert.equal((await verifyRecord(vector.envelope)).ok, true, vector.name);
    assert.deepEqual(vector.envelope, original, 'verification cannot mutate historical record');
  }
});

test('release contract: original PBP0.3 vector verifies without renaming its domain or identity', async () => {
  const command = three.command, bytes = v03.commandBytes(command);
  assert.equal(new TextDecoder().decode(bytes), three.signing_input_utf8);
  assert.equal(hash(canonicalBytes(command)), 'a038e962914ae30176b689001b4ceb6ebdfcb39b43c06810c21be2461b3566a9');
  assert.equal(three.request_hash, hash(canonicalBytes(command)));
  assert.equal(await v03.personId(command.actor.key_id), 'd794e3a3-1a47-11e4-d93f-c62a16c7b12c');
  v03.validateCommand(command, command.audience, Date.parse(command.issued_at));
  assert.deepEqual([...await v03.signaturesOf(command)], [command.actor.key_id]);
  assert.throws(() => v03.validateCommand(command, command.audience, Date.parse(command.expires_at)), /expired|window/);
});

test('release contract: original DTP0.4 vector verifies without relabeling it public0.1.0', async () => {
  const command = four.command, bytes = v04.commandBytes(command);
  assert.equal(new TextDecoder().decode(bytes), four.signing_input_utf8);
  assert.equal(hash(canonicalBytes(command)), 'bd6c42f8bdb78cfe1654cdae831c66621ca2c33754bd3b5e449eaee3775bb671');
  assert.equal(four.request_hash, hash(canonicalBytes(command)));
  assert.equal(await v04.personId(command.actor.key_id), '5ebde7f6-73d7-63b4-e649-fd39204fe5e6');
  v04.validateCommand(command, command.audience, Date.parse(command.issued_at));
  assert.deepEqual([...await v04.verifyCommand(command)], [command.actor.key_id]);
  assert.throws(() => v04.validateCommand(command, command.audience, Date.parse(command.expires_at)), /expired|window/);
});

test('release contract: native and relabeled commands fail wrong-generation schema/signature checks', async () => {
  assert.throws(() => v04.validateCommand(three.command, three.command.audience, Date.parse(three.command.issued_at)));
  assert.throws(() => v03.validateCommand(four.command, four.command.audience, Date.parse(four.command.issued_at)));
  await assert.rejects(v04.verifyCommand(three.command), /signature/);
  await assert.rejects(v03.signaturesOf(four.command), /signature/);
  for (const version of ['0.4', '0.1.0']) await assert.rejects(v04.verifyCommand({ ...three.command, version }), /signature/);
  for (const version of ['0.3', '0.1.0']) await assert.rejects(v03.signaturesOf({ ...four.command, version }), /signature/);
  assert.throws(() => v04.validateCommand({ ...four.command, version: '0.1.0' }, four.command.audience, Date.parse(four.command.issued_at)));
  for (const command of [three.command, four.command]) assert.equal((await verifyRecord(command)).ok, false);
});

test('release contract: changing only PBP branding breaks original signature rather than converting it', async () => {
  const { signatures: proofs, ...command } = three.command;
  const wrong = canonicalBytes({ domain: 'DTP-COMMAND-0.3', command });
  assert.equal(await verifyBytes(proofs[0].key_id, wrong, decodeSignature(proofs[0].signature)), false);
  const key = three.command.actor.key_id, founder = three.person_id, nonce = '00000000-0000-4000-8000-000000000099';
  assert.notEqual(await v03.personId(key), await v04.personId(key));
  assert.notEqual(await v03.organizationId(founder, nonce), await v04.organizationId(founder, nonce));
});

test('release contract: version metadata on a legacy envelope is not newer protocol admission', async () => {
  const legacy = { ...signatures.records[0].envelope, version: '0.4' };
  // v0.2 signingInput deliberately selects its original fields. A newer label is
  // ignored by that cryptographic helper, not proof that v0.4 accepts this object.
  assert.equal((await verifyRecord(legacy)).ok, true);
  assert.throws(() => v04.validateCommand(legacy, four.command.audience, Date.parse(four.command.issued_at)));
  assert.throws(() => v03.validateCommand(legacy, three.command.audience, Date.parse(three.command.issued_at)));
});

test('release contract: historical register commands are not foundation person genesis', async () => {
  const resolver = { id: '00000000-0000-4000-8000-000000000090', key_id: four.command.actor.key_id };
  for (const command of [three.command, four.command]) {
    await assert.rejects(createIdentity({ body: command, signatures: command.signatures } as any, resolver, Date.parse(command.issued_at)), /fields/);
  }
});
