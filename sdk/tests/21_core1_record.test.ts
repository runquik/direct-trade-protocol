// Core-1 signed records (DTP-RECORD-1, spec/core-1/README.md part 5): the conformance vectors, and the reference's
// own guarantees beside them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EnvelopeError, signEnvelope, type Signed } from "../src/core1/envelope.ts";
import { RecordError, checkRecordSigners, checkSupersession, parseRecord, recordDigest, signRecord, verifyRecord, type RecordBody } from "../src/core1/record.ts";
import { parseUntrustedJson } from "../src/safe-json.ts";

type Head = { head: any; head_digest: string };
const vectors = parseUntrustedJson(readFileSync(new URL("../../spec/core-1/vectors/record.json", import.meta.url), "utf8")) as {
  keys: { label: string; key_id: string; secret_key: string }[];
  heads: { [name: string]: Head };
  accept: { why: string; envelope: unknown; profile: string; person: string; organization: string | null; digest: string; signers: string[] }[];
  reject: { why: string; envelope: unknown; profile?: string; person?: string; organization?: string; code: string }[];
  supersession: { accept: { why: string; previous: unknown; next: unknown }[]; reject: { why: string; previous: unknown; next: unknown; code: string }[] };
};

async function run(v: { envelope: unknown; profile?: string; person?: string; organization?: string | null }) {
  const verified = await verifyRecord(v.envelope, v.profile === undefined ? {} : { profile: v.profile });
  if (v.person !== undefined) checkRecordSigners(verified.record, verified.signers, vectors.heads[v.person], v.organization ? vectors.heads[v.organization] : null);
  return verified;
}

test("conformance vectors: accepted records give their digest and signers; refused ones give their code", async () => {
  assert.ok(vectors.accept.length >= 4 && vectors.reject.length >= 18);
  for (const v of vectors.accept) {
    const { digest, signers } = await run(v);
    assert.equal(digest, v.digest, v.why);
    assert.deepEqual([...signers].sort(), [...v.signers].sort(), v.why);
  }
  for (const v of vectors.reject) {
    await assert.rejects(run(v), (error: unknown) => (error instanceof RecordError || error instanceof EnvelopeError) && error.code === v.code, v.why);
  }
  const codes = new Set(vectors.reject.map(v => v.code));
  for (const code of ["invalid_signature", "invalid_record", "unexpected_profile", "wrong_head", "unauthorized_signer"]) assert.ok(codes.has(code), code);
});

test("conformance vectors: supersession", async () => {
  for (const v of vectors.supersession.accept) {
    const previous = await verifyRecord(v.previous), next = await verifyRecord(v.next);
    checkSupersession(previous, next.record);
  }
  assert.ok(vectors.supersession.reject.length >= 5);
  for (const v of vectors.supersession.reject) {
    const previous = await verifyRecord(v.previous), next = await verifyRecord(v.next);
    assert.throws(() => checkSupersession(previous, next.record), (error: unknown) => error instanceof RecordError && error.code === v.code, v.why);
  }
});

test("the record digest covers the signatures: the same body signed by another key has another digest", async () => {
  const [a1, a2] = vectors.keys;
  const body = vectors.accept[0].envelope as { body: RecordBody };
  const one = await signRecord(body.body, [a1.secret_key]), two = await signRecord(body.body, [a2.secret_key]);
  assert.notEqual(await recordDigest(one), await recordDigest(two));
  assert.equal(await recordDigest(one), vectors.accept[0].digest);
});

test("the record digest does not depend on the order of the signatures (#188)", async () => {
  const both = vectors.accept.find(v => v.signers.length === 2)!;
  const signed = both.envelope as Signed<RecordBody>;
  const reversed: Signed<RecordBody> = { body: signed.body, signatures: [...signed.signatures].reverse() };
  assert.notDeepEqual(reversed.signatures, signed.signatures);
  assert.equal(await recordDigest(reversed), both.digest);
  const previous = await verifyRecord(signed), other = await verifyRecord(reversed);
  assert.equal(other.digest, previous.digest);
  // A successor that names the digest supersedes either copy of its predecessor.
  const next = parseRecord({ ...signed.body, sequence: 2, supersedes: both.digest });
  checkSupersession(previous, next);
  checkSupersession(other, next);
});

test("the reference refuses to sign what a verifier refuses", async () => {
  const body = structuredClone((vectors.accept[0].envelope as { body: RecordBody }).body);
  const key = vectors.keys[0].secret_key;
  for (const bad of [{ ...body, sequence: 2 }, { ...body, payload: [] }, { ...body, extra: 1 }, { ...body, organization: undefined }]) {
    await assert.rejects(signRecord(bad as RecordBody, [key]), (error: unknown) => error instanceof RecordError && error.code === "invalid_record");
  }
});

test("a record envelope signed under another domain does not verify as a record", async () => {
  const body = (vectors.accept[0].envelope as { body: RecordBody }).body;
  const other = await signEnvelope("DTP-PERSON-GENESIS-1", body, [vectors.keys[0].secret_key]);
  await assert.rejects(verifyRecord(other), (error: unknown) => error instanceof EnvelopeError && error.code === "invalid_signature");
});

test("parseRecord accepts organization null and an organisation reference, and nothing in between", () => {
  const body = (vectors.accept[0].envelope as { body: RecordBody }).body;
  assert.equal(parseRecord(structuredClone(body)).organization, null);
  assert.throws(() => parseRecord({ ...body, organization: {} }), RecordError);
  assert.throws(() => parseRecord({ ...body, organization: { id: body.issuer.identity } }), RecordError);
});
