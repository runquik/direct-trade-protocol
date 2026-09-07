// New 0.3 vector only; never regenerates the frozen 0.2 signing fixtures.
import { readFileSync, writeFileSync } from "node:fs";
import { keyPairFromSecret } from "../src/keys.ts";
import { personId, draftCommand, signCommand, commandBytes, digest } from "../src/v03/wire.ts";
const fixed = JSON.parse(readFileSync(new URL("../../spec/vectors/keys.json", import.meta.url), "utf8"));
const key = await keyPairFromSecret(fixed.secret_key), person = { id: await personId(key.keyId), key };
const command = draftCommand("https://store.example.test", person, "person.register", null, { keys: [key.keyId] }, Date.parse("2026-09-07T00:00:00.000Z"));
command.request_id = "00000000-0000-4000-8000-000000000003";
const signed = await signCommand(command, [key]);
writeFileSync(new URL("../../spec/v0.3/signing-vector.json", import.meta.url), JSON.stringify({
  description: "PBP 0.3 fixed signing vector. Uses the public test-only key in ../vectors/keys.json; never use it in a real identity.",
  person_id: person.id, command: signed, signing_input_utf8: new TextDecoder().decode(commandBytes(signed)), request_hash: await digest(signed),
}, null, 2) + "\n");
console.log("Generated PBP 0.3 fixed signing vector.");
