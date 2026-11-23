// Conformance: spec/vectors/string-length.json, what a string length bound counts (SPEC.md section 5, #215). Each
// command case runs against the reference host; the bound is in Unicode code points, never UTF-16 code units or bytes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDtpStore } from "../../scripts/dtp-v04-dev-server.ts";
import { parseUntrustedJson } from "../../src/safe-json.ts";
import { checkSchema, validateShape } from "../../src/v04/profiles.ts";
import { codePoints } from "../../src/profiles/length.ts";
import { organizationId } from "../../src/v04/wire.ts";
import { Client, company, grant, person, policy, profile, record } from "./helpers.ts";

type Case = { name: string; where: "command"; action: string; field: string; schema?: any; value: string;
  length: { code_points: number; utf16_units: number; utf8_bytes: number }; expected: "accept" | { code: string; status: number } };
const vectors = parseUntrustedJson(readFileSync(new URL("../../../spec/vectors/string-length.json", import.meta.url), "utf8")) as { cases: Case[] };
const outcome = (r: { status: number; error?: { code: string } }) => r.status === 200 ? "accept" : { code: r.error?.code, status: r.status };

test("string-length vectors: the stated lengths are right, and a code-unit or byte count would decide some case differently", () => {
  for (const c of vectors.cases) {
    assert.deepEqual(c.length, { code_points: [...c.value].length, utf16_units: c.value.length, utf8_bytes: new TextEncoder().encode(c.value).length }, c.name);
    assert.equal(codePoints(c.value), c.length.code_points, c.name);
  }
  const bound = (c: Case) => c.action === "organization.create" ? 120 : c.schema.properties.note.maxLength;
  for (const unit of ["utf16_units", "utf8_bytes"] as const)
    assert.ok(vectors.cases.some(c => (c.length[unit] <= bound(c)) !== (c.expected === "accept")), `a host counting ${unit} fails a case`);
  assert.ok(vectors.cases.some(c => c.expected === "accept" && c.length.code_points === bound(c)), "a case sits exactly at a bound");
});

test("string-length vectors: the dialect's validateShape counts code points", () => {
  for (const c of vectors.cases.filter(v => v.schema)) {
    checkSchema(c.schema);
    assert.equal(validateShape(c.schema, { note: c.value }), c.expected === "accept", c.name);
  }
  // An enum value is bounded by maxLength in the same unit.
  checkSchema({ type: "string", maxLength: 2, enum: ["\u{1F600}\u{1F600}"] });
  assert.throws(() => checkSchema({ type: "string", maxLength: 2, enum: ["\u{1F600}\u{1F600}\u{1F600}"] }));
});

test("string-length vectors: a host bounds command fields and record bodies in code points", async () => {
  const host = await createDtpStore(), client = new Client(host.audience);
  try {
    const owner = await person(client);
    const org = await company(client, owner), pol = await policy(client, owner, org, [grant(owner)]);
    const profiles = new Map<string, string>();
    for (const c of vectors.cases) {
      let r;
      if (c.action === "organization.create") {
        assert.equal(c.field, "name");
        const nonce = crypto.randomUUID(), id = await organizationId(owner.id, nonce);
        r = await client.act(owner, c.action, id, { name: c.value, nonce, controllers: [owner.id], threshold: 1 });
      } else {
        assert.deepEqual([c.action, c.field], ["record.append", "body.note"]);
        const key = JSON.stringify(c.schema);
        if (!profiles.has(key)) profiles.set(key, await profile(client, owner, org, c.schema));
        r = await client.act(owner, c.action, org, record(org, pol, crypto.randomUUID(), profiles.get(key)!, { note: c.value }));
      }
      assert.deepEqual(outcome(r), c.expected, c.name);
    }
  } finally { await host.close(); }
});
