// Conformance: spec/vectors/nul-string.json, the U+0000 rule of SPEC.md section 2 (#95). Command cases run against a
// PGlite-backed reference host, whose jsonb store cannot hold U+0000, so a refusal here is the kernel's, not storage's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDtpStore } from "../../scripts/dtp-v04-dev-server.ts";
import { parseUntrustedJson } from "../../src/safe-json.ts";
import { generateKeyPair } from "../../src/keys.ts";
import { execute } from "../../src/v04/engine.ts";
import { emptyState } from "../../src/v04/model.ts";
import type { Context } from "../../src/v04/model.ts";
import { draftCommand, organizationId, signCommand } from "../../src/v04/wire.ts";
import { Client, company, grant, person, policy, profile, record } from "./helpers.ts";
import type { Person } from "./helpers.ts";

type Case = { name: string; where: "command" | "snapshot"; action: string; field: string; value: string; expected: "accept" | { code: string; status: number } };
const vectors = parseUntrustedJson(readFileSync(new URL("../../../spec/vectors/nul-string.json", import.meta.url), "utf8")) as { cases: Case[] };
const outcome = (r: { status: number; error?: { code: string } }) => r.status === 200 ? "accept" : { code: r.error?.code, status: r.status };

test("nul-string vectors cover commands and snapshot import, refused and accepted", () => {
  const has = (where: string, refused: boolean) => vectors.cases.some(c => c.where === where && (c.expected !== "accept") === refused);
  for (const where of ["command", "snapshot"]) assert.ok(has(where, true) && has(where, false), where);
  for (const c of vectors.cases) assert.equal(c.value.includes("\u0000"), c.expected !== "accept", `${c.name}: only U+0000 is refused`);
});

test("nul-string vectors: a host refuses U+0000 in a command with 400 nul_character, before storage", async () => {
  const host = await createDtpStore(), client = new Client(host.audience);
  try {
    const owner = await person(client);
    const org = await company(client, owner), pol = await policy(client, owner, org, [grant(owner)]), prof = await profile(client, owner, org);
    for (const c of vectors.cases.filter(v => v.where === "command")) {
      let r;
      if (c.action === "organization.create") {
        const nonce = crypto.randomUUID(), id = await organizationId(owner.id, nonce);
        r = await client.act(owner, c.action, id, { name: c.value, nonce, controllers: [owner.id], threshold: 1 });
        const listed = await client.ok(owner, "organizations.list", null, {});
        assert.equal(JSON.stringify(listed).includes(id), c.expected === "accept", `${c.name}: stored only when accepted`);
      } else {
        assert.equal(c.action, "record.append");
        const rec = record(org, pol, crypto.randomUUID(), prof, { note: c.value });
        r = await client.act(owner, c.action, org, rec);
        if (r.status === 200) assert.equal(r.result.id, rec.id, c.name);
      }
      assert.deepEqual(outcome(r), c.expected, c.name);
    }
  } finally { await host.close(); }
});

test("nul-string vectors: a destination refuses a snapshot carrying U+0000 at migration.ready with 400 nul_character", async () => {
  for (const c of vectors.cases.filter(v => v.where === "snapshot")) {
    assert.equal(c.field, "organization.name");
    const dest = await createDtpStore(), b = new Client(dest.audience);
    try {
      // An in-memory source that admitted the value before this rule: the name and its signed genesis are rewritten in
      // its state, the genesis re-signed by the owner, so the snapshot breaks no rule but this one.
      const state = emptyState(), source: Context = { audience: "https://nul-source.test", storeKey: await generateKeyPair(), pins: { [dest.audience]: dest.keyId }, now: Date.now() };
      dest.pins[source.audience] = source.storeKey.keyId;
      const call = async (p: Person, action: string, org: string | null, payload: any) => execute(state, await signCommand(draftCommand(source.audience, p, action, org, payload, Date.now()), [p.key]), { ...source, now: Date.now() });
      const owner = await person(b), nonce = crypto.randomUUID(), org = await organizationId(owner.id, nonce);
      await call(owner, "person.register", null, { keys: [owner.key.keyId] });
      await call(owner, "organization.create", org, { name: "Synthetic NUL source", nonce, controllers: [owner.id], threshold: 1 });
      const genesis = state.organizations[org].history[0];
      state.organizations[org].name = c.value;
      state.organizations[org].history[0] = await signCommand({ ...genesis, payload: { ...genesis.payload, name: c.value } }, [owner.key]);
      const manifest = await call(owner, "migration.prepare", org, { destination: { audience: dest.audience, key_id: dest.keyId } }), migration_id = manifest.body.manifest.migration_id;
      await b.ok(owner, "migration.stage", null, { manifest });
      for (let index = 0; index < manifest.body.manifest.chunk_hashes.length; index++) {
        const chunk = await call(owner, "migration.chunk", org, { migration_id, index });
        await b.ok(owner, "migration.upload", null, { migration_id, index, data: chunk.data });
      }
      assert.deepEqual(outcome(await b.act(owner, "migration.ready", null, { migration_id })), c.expected, c.name);
    } finally { await dest.close(); }
  }
});
