import { test } from "node:test";
import assert from "node:assert/strict";
import { createDtpStore } from "../../scripts/dtp-v04-dev-server.ts";
import { DtpClient } from "../../src/v04/client.ts";
import { generateKeyPair } from "../../src/keys.ts";
import { organizationId, personId } from "../../src/v04/wire.ts";

// #97: an integer on the wire is an optional minus sign and digits. A correctly signed command whose
// text writes a number with a fraction or an exponent is refused before parsing, even when binary64
// parsing would turn it back into the signed integer.
test("v0.4 HTTP refuses a signed command whose text writes an integer with a fraction or an exponent", async () => {
  const store = await createDtpStore(); try {
    const client = new DtpClient(store.audience), key = await generateKeyPair(), owner = { id: await personId(key.keyId), key };
    await client.send(await client.prepare(owner, "person.register", null, { keys: [key.keyId] }));
    const nonce = crypto.randomUUID(), org = await organizationId(owner.id, nonce);
    const command = await client.prepare(owner, "organization.create", org, { name: "Synthetic Test Co", nonce, controllers: [owner.id], threshold: 1 });
    const text = JSON.stringify(command);
    assert.ok(text.includes('"threshold":1,') || text.includes('"threshold":1}'));
    const send = (body: string) => fetch(store.audience + "/dtp/v0.4/commands", { method: "POST", body });
    for (const literal of ["1.0", "1e0", "1E0", "1.0000000000000001"]) {
      const response = await send(text.replace('"threshold":1', '"threshold":' + literal));
      assert.equal(response.status, 400, literal);
      assert.equal((await response.json()).error.code, "non_integer_number", literal);
    }
    const accepted = await send(text);
    assert.equal(accepted.status, 200, "the same command written with integer literals is accepted");
  } finally { await store.close(); }
});
