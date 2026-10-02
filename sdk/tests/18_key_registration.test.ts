// Conformance: the key registration rule (spec/v0.4/SPEC.md section 2, #47). A key enters an identity or authority
// record only if it decodes to a point of prime order; verification of existing signatures is unchanged (#45).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { decodeKeyId, encodeSignature, generateKeyPair, keyOrder, registrableKey, verifyBytes } from "../src/keys.ts";
import type { KeyPair } from "../src/keys.ts";
import { emptyState } from "../src/v04/model.ts";
import type { Command, Context } from "../src/v04/model.ts";
import { execute } from "../src/v04/engine.ts";
import { commandBytes, draftCommand, personId, signCommand } from "../src/v04/wire.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../spec/vectors/${name}`, import.meta.url), "utf8"));
type Vector = { name: string; expected: "accept" | "refuse"; order: string; public_key_hex: string; key_id: string };
const vectors = read("key-registration.json") as { cases: Vector[] };
const hex = (s: string) => Uint8Array.from(Buffer.from(s, "hex"));
// The identity key signs every message with R = identity and S = 0 (signature-verification.json, "identity A, canonical").
const IDENTITY_KEY = vectors.cases.find(c => c.name === "identity, canonical")!.key_id;
const FORGED = hex("01" + "00".repeat(63));

test("key registration vectors: the reference accepts and refuses exactly as the vectors require", () => {
  for (const c of vectors.cases) {
    assert.deepEqual(decodeKeyId(c.key_id), hex(c.public_key_hex), `${c.name}: key id encoding`);
    assert.equal(keyOrder(hex(c.public_key_hex)), c.order, `${c.name}: order`);
    assert.equal(registrableKey(c.key_id), c.expected === "accept", c.name);
  }
});

test("key registration vectors: all eight small-order points are refused, each by its canonical encoding", () => {
  const small = vectors.cases.filter(c => c.order === "small");
  assert.equal(new Set(small.map(c => c.public_key_hex)).size, 8);
  assert.ok(small.every(c => c.expected === "refuse"));
  assert.ok(vectors.cases.some(c => c.order === "mixed") && vectors.cases.filter(c => c.expected === "accept").length >= 2);
});

test("key registration vectors: every small- or mixed-order key in the verification vectors is refused here", () => {
  const listed = new Set(vectors.cases.filter(c => c.expected === "refuse").map(c => c.public_key_hex));
  for (const c of read("signature-verification.json").cases as { name: string; public_key_hex: string }[]) {
    if (keyOrder(hex(c.public_key_hex)) !== "prime") assert.ok(listed.has(c.public_key_hex), c.name);
  }
});

test("key registration: freshly generated keys and every key in the existing vectors are registrable", async () => {
  for (let i = 0; i < 16; i++) assert.ok(registrableKey((await generateKeyPair()).keyId));
  const skip = new Set(["key-registration.json", "signature-verification.json"]);
  const dir = new URL("../../spec/vectors/", import.meta.url);
  let checked = 0;
  for (const file of readdirSync(dir).filter(f => f.endsWith(".json") && !skip.has(f))) {
    for (const keyId of new Set(readFileSync(new URL(file, dir), "utf8").match(/ed25519:[1-9A-HJ-NP-Za-km-z]+/g) ?? [])) {
      let bytes: Uint8Array; try { bytes = decodeKeyId(keyId); } catch { continue; } // signatures and secret keys
      assert.ok(registrableKey(keyId), `${file}: ${keyId} (${bytes.length} bytes)`); checked++;
    }
  }
  assert.ok(checked > 0);
});

async function v04() {
  let state = emptyState();
  const ctx: Context = { audience: "http://registration.invalid", storeKey: await generateKeyPair(), pins: {}, now: Date.now() };
  const send = async (command: Command) => { const next = structuredClone(state); const result = await execute(next, command, ctx); state = next; return result; };
  const forge = (command: Command): Command => ({ ...command, signatures: [...command.signatures, { key_id: IDENTITY_KEY, signature: encodeSignature(FORGED) }] });
  return { ctx, send, forge, get state() { return state; } };
}

test("v0.4: person.register refuses a small-order key even with a signature that verifies", async () => {
  const f = await v04();
  const actor = { id: await personId(IDENTITY_KEY), key: { keyId: IDENTITY_KEY } as KeyPair };
  const command = f.forge(draftCommand(f.ctx.audience, actor, "person.register", null, { keys: [IDENTITY_KEY] }, f.ctx.now));
  assert.ok(await verifyBytes(IDENTITY_KEY, commandBytes(command), FORGED), "the forged possession proof verifies");
  await assert.rejects(f.send(command), (e: any) => e.status === 400 && /prime order/.test(e.message));
  assert.equal(Object.keys(f.state.persons).length, 0);
});

test("v0.4: person.rotate refuses to add a small-order key; the person keeps its keys", async () => {
  const f = await v04();
  const key = await generateKeyPair(), actor = { id: await personId(key.keyId), key };
  await f.send(await signCommand(draftCommand(f.ctx.audience, actor, "person.register", null, { keys: [key.keyId] }, f.ctx.now), [key]));
  const rotate = f.forge(await signCommand(draftCommand(f.ctx.audience, actor, "person.rotate", null, { add: [IDENTITY_KEY], revoke: [] }, f.ctx.now), [key]));
  await assert.rejects(f.send(rotate), (e: any) => e.status === 400 && /prime order/.test(e.message));
  assert.deepEqual(f.state.persons[actor.id].keys, [key.keyId]);
});
