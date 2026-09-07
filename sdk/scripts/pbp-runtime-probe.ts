// Runs under Node and Deno. No external service, filesystem, secret or company data.
import { generateKeyPair } from "../src/keys.ts";
import { execute } from "../src/v03/engine.ts";
import { emptyState } from "../src/v03/model.ts";
import { draftCommand, signCommand, personId, organizationId, PbpError } from "../src/v03/wire.ts";
const key = await generateKeyPair(), owner = { id: await personId(key.keyId), key };
const options = { audience: "https://runtime.example.test", storeKey: await generateKeyPair(), trustedSources: [], now: Date.now() };
const state = emptyState();
const send = async (action: string, org: string | null, payload: Record<string, any>) => execute(state, await signCommand(draftCommand(options.audience, owner, action, org, payload), [key]), { ...options, now: Date.now() });
await send("person.register", null, { keys: [key.keyId] });
const nonce = crypto.randomUUID(), org = await organizationId(owner.id, nonce);
await send("organization.create", org, { nonce, name: "Runtime probe", controllers: [owner.id], threshold: 1 });
const view = await send("workspace.view", org, {}) as any;
if (view.organization.id !== org) throw new Error("incorrect organization context");
const bad = await signCommand(draftCommand(options.audience, owner, "workspace.view", org, {}), [key]);
bad.expires_at = new Date(Date.now() + 60000).toISOString();
try { await execute(state, bad, options); throw new Error("accepted tampering"); }
catch (e) { if (!(e instanceof PbpError) || e.code !== "signature_invalid") throw e; }
console.log("PASS: runtime Ed25519, schema validation, authority bootstrap, scoped workspace and tamper rejection");
