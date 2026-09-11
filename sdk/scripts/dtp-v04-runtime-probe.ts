// Same executable runs in Node and Deno. Synthetic, in-memory, no external service.
import { generateKeyPair } from "../src/keys.ts";
import { execute } from "../src/v04/engine.ts";
import { emptyState } from "../src/v04/model.ts";
import { digest, draftCommand, signCommand, personId, organizationId, DtpError } from "../src/v04/wire.ts";
const key = await generateKeyPair(), owner = { id: await personId(key.keyId), key };
const ctx = { audience: "https://runtime.example.test", storeKey: await generateKeyPair(), pins: {}, now: Date.now() };
const state = emptyState();
const send = async (action: string, org: string | null, payload: Record<string, any>) => execute(state, await signCommand(draftCommand(ctx.audience, owner, action, org, payload), [key]), { ...ctx, now: Date.now() });
await send("person.register", null, { keys: [key.keyId] });
const nonce = crypto.randomUUID(), org = await organizationId(owner.id, nonce);
await send("organization.create", org, { nonce, name: "Synthetic runtime company", controllers: [owner.id], threshold: 1 });
const definition = { publisher_id: org, name: "runtime.note", version: "1.0.0", schema: { type: "object", properties: { note: { type: "string", maxLength: 100 } }, required: ["note"], additionalProperties: false }, semantics: "structural", dependencies: [] };
const profile = await digest(definition);
const { publisher_id: _, ...publication } = definition;
await send("profile.publish", org, { ...publication, digest: profile, visibility: "community", readers: [] });
const policy = crypto.randomUUID();
await send("policy.create", org, { policy_id: policy, expected_revision: 0, classification: "business", stewards: [owner.id], threshold: 1, grants: [{ person_id: owner.id, actions: ["read", "write", "export"], resource_ids: "*", expires_at: new Date(Date.now() + 60000).toISOString() }] });
const id = crypto.randomUUID();
await send("record.append", org, { id, root_id: id, supersedes: null, organization_id: org, policy_id: policy, resource_id: crypto.randomUUID(), profile_digest: profile, counterparty_ids: [], body: { note: "runtime round-trip" } });
const read = await send("record.get", org, { id, profile_digest: profile }) as any;
if (read.body.note !== "runtime round-trip") throw new Error("record mismatch");
const bad = await signCommand(draftCommand(ctx.audience, owner, "record.get", org, { id, profile_digest: profile }), [key]);
bad.payload.id = crypto.randomUUID();
try { await execute(state, bad, { ...ctx, now: Date.now() }); throw new Error("accepted tampering"); }
catch (error) { if (!(error instanceof DtpError) || error.code !== "signature_invalid") throw error; }
console.log("PASS: DTP v0.4 Ed25519, exact command schema, custom profile, compartment grant, signed record round-trip and tamper rejection");
