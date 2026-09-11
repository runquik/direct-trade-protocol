# Build against DTP 0.4 without building a workspace

This guide is for a company-built app, an independent module or a small protocol client. The current deliverable is a **reference candidate** with synthetic fixtures. It is not a production identity service, payroll system or hosted app marketplace. Read the [candidate specification](../spec/v0.4/SPEC.md) before handling authority, private records or migration.

## Start a disposable host

Use the Node version in [`.node-version`](../.node-version), currently 22.23.2, and the checked-in lockfile. From `sdk`, after installing the locked dependencies:

```powershell
npm run dev:dtp-v04
```

The development server listens on `127.0.0.1:8790`; inspect [its health endpoint](http://127.0.0.1:8790/dtp/v0.4/health). It generates a host key and in-memory PGlite database; restarting loses that state. It does not read the shared v0.2 backend environment or deploy anything. Do not use it as durable company hosting.

The host's exact advertised audience is signed into commands. The complete command URL is `<audience>/dtp/v0.4/commands`. For remote hosting, obtain and approve the host key through a trusted enrollment path; blindly trusting a health response is not identity verification.

## First signed round trip

The following TypeScript can run from a file under `sdk/scripts/` using the pinned Node runtime. It generates synthetic credentials in memory and creates a synthetic company. Keep keys in secure custody in a real adapter; this example intentionally prints no private key.

```ts
import { generateKeyPair } from "../src/keys.ts";
import { personId, organizationId } from "../src/v04/wire.ts";
import { DtpClient } from "../src/v04/client.ts";

const health = await fetch("http://127.0.0.1:8790/dtp/v0.4/health").then(r => r.json());
const audience = health.audience;
const client = new DtpClient(audience);
const key = await generateKeyPair();
const person = { id: await personId(key.keyId), key };

async function call(action: string, organization: string | null, payload: Record<string, unknown>) {
  const command = await client.prepare(person, action, organization, payload);
  // A production adapter retains this exact command before sending, so an
  // uncertain network outcome can be retried without inventing a new action.
  return client.send(command);
}

await call("person.register", null, { keys: [key.keyId] });
const nonce = crypto.randomUUID();
const company = await organizationId(person.id, nonce);
await call("organization.create", company, {
  name: "Synthetic scanner company", nonce,
  controllers: [person.id], threshold: 1,
});
console.log({ person: person.id, company });
```

For independent implementations, reproduce [the signing vector](../spec/v0.4/signing-vector.json), not just this SDK example. JSON float amounts, ad hoc UUID derivation, wrong audience, altered payload fields or an expired command must fail. An application that imports the same signing implementation is useful integration coverage but not independent conformance evidence.

`DtpClient.prepare` also accepts additional signing keys for controller/steward quorum. `send` accepts an optional abort signal and throws `DtpResponseError` with status/code/message for a protocol error. Prepare once and retain the command for uncertain transport retries; calling `prepare` again generates a new request ID. Refresh authority and reconcile state after expiry rather than endlessly retry an expired signature.

## Add a private capability in the right order

1. **Identity and membership.** Register people, create a company, and have additional users accept company-specific invitations. A person can serve three companies without sharing their data. Select the company explicitly on every command.
2. **Policy and resources.** Create a steward-controlled policy. Grant only required actions on opaque resource IDs. A controller needs a grant to read data, just like other users. For employee data, separate compensation from time and personnel records; there is no automatic employee-self mapping.
3. **Profile.** Publish a closed bounded schema, precise semantics and version. Calculate its contract digest from `{publisher_id,name,version,schema,semantics,dependencies}`. A private profile can stay private. A structural profile validates fields, not an undisclosed business algorithm.
4. **Record.** Append an owner/policy/resource/profile-bound signed record. Keep external observation identifiers issuer-scoped. Use the returned minimal receipt to perform a separate authorized `record.get`, rather than assuming writes return all readable data.
5. **Module descriptor, if needed.** Publish an immutable artifact release with exact profiles/actions. Installation additionally needs an explicitly trusted, unexpired artifact assessment and a fresh module-key proof. A private unpublished application still needs an authorized interface; declaring a release is not uploading or executing its code.

Publish a simple schema with only the [supported dialect](../spec/v0.4/SPEC.md#5-profiles-schemas-and-module-releases). Avoid `$ref`, open objects and executable validators. Example record body schema:

```json
{
  "type": "object",
  "properties": {
    "source_id": { "type": "string", "maxLength": 80 },
    "observation_id": { "type": "string", "maxLength": 120 },
    "note": { "type": "string", "maxLength": 1000 }
  },
  "required": ["source_id", "observation_id", "note"],
  "additionalProperties": false
}
```

This example does **not** deduplicate observations or calculate inventory. Use the shared inventory profile for those semantics. Custom `source_id`/`observation_id` field names alone do not activate a hidden reducer.

## Read records as an explicit consumer

`record.get` needs `{id,profile_digest}`. Lists/workspace/export use `{after,limit,profile_digests}` and filter authority before pagination. Use exact accepted profile digests; an unknown required version should produce an explicit incompatibility instead of silent field loss.

Keep the greatest processed sequence when the last page has `next_cursor:null`. Persist business/observation time separately from host arrival order. Record history includes superseded versions; derive heads deliberately. Sequences change when a company migrates, so resume synchronization against the destination rather than reusing the old host cursor as a global identity.

Write receipts contain an ID, sequence and duplicate flag, not a blanket grant to read. Replaying a previously signed request does not bypass membership, policy, module or assessment revocation. Reconcile after a lost acknowledgement before creating a fresh business operation.

For invoices, render original `validation` separately from current `live_validation`. Reference recognition additionally requires the host's explicit `referenceProfiles` pins; naming your custom schema `trade.contract` is not sufficient. Neither report is a buyer signature, paid settlement or clean-lien finding. Unknown/inaccessible references must remain unknown. Do not present an arithmetic check as full business approval.

## Bring an inventory app

Start from [the inventory fixture contract](../spec/v0.4/fixtures/README.md). Map your actual scanner meaning to company, stock pool, product, base unit, source/observation identity, event time and expected revision. Create the authorized pool first. For case/each conversion, publish and pin an exact packaging revision rather than maintain an unversioned global conversion.

Your adapter must handle duplicate observations, stale expected revisions, insufficient available stock and wrong-policy failures explicitly. Do not resolve a reservation conflict by retrying with a new observation ID without re-reading stock and reconsidering the action. A fresh ID is a new business assertion, not a safe network retry.

The shared profile provides packaging, receipt/adjustment, reservation/release and fulfillment invariants. It does not yet model complete warehouse genealogy, pallet splitting, cold-chain assurance, accounting ownership or every ERP workflow. Extend through a documented profile and independently checked fixtures, not hidden extra JSON fields.

## Exchange with a company on another host

Host administrators explicitly configure trusted host keys. Each company administrator imports fresh remote authority proofs through the same signed API. These proofs establish a short-lived trusted location/generation assertion; they do not grant access to the other company's records.

For sharing, an authorized person selects exact record versions using `evidence.issue`, naming the remote recipient organization, audience, policy/resource and purpose. The recipient calls `evidence.inspect` with its accepted profile set under that compartment's read authority. Tokens include the bounded profile dependency closure; private dependency redistribution still needs authority. They are short-lived and contain plaintext; transmit them only to authorized recipients. Their expiry limits API inspection, not possession of copies. Inspecting evidence never turns it into locally owned current state. Display `issuer_projection` as the source host's historical assertion, not the recipient's new validation; selected inventory evidence is not a complete stock replay.

When the source company moves, the observer calls `authority.relocate` with the durable old-host commit and fresh new-host authority. The protocol checks both hosts' proof chain and the next generation. Use a separate explicit read/disclosure to get updated business data; a locator change is not a subscription or automatic replication service.

## Rehearse leaving a host before depending on it

Use two disposable stores and synthetic records first. The exact [migration and recovery sequence](../spec/v0.4/SPEC.md#8-cooperative-migration-and-recovery) is part of the integration contract, not a convenience export button.

- Obtain controller and every policy's steward quorum for the complete snapshot.
- Prepare, stage and upload bounded chunks; use destination status to resume.
- Obtain signed readiness before committing. Concurrent source changes require a new snapshot, not force-overwriting the check.
- Commit/freeze, then finalize using the durable receipt. Verify exact records, profiles, policies and inventory at the destination and reinstall modules with fresh authority.
- Before commit, cancel at the source and abort the destination stage when abandoning a move. After commit, retry finalization; **do not reactivate the source**.
- Move one company while its buyer stays behind. Check authority relocation and explicit evidence access, not merely file-count equality.

The current maximum snapshot is 32 MiB; default reference state capacity is 128 MiB. Readiness preserves 64 KiB completion headroom per pending ready migration and enough safe-integer sequence space. Finalization atomically replaces the staged snapshot and removes chunks, so it does not retain a second full copy. Do not lower host capacity or bypass reservations mid-move. Keep pins, persistent storage and backups available through cutover. The in-memory development host cannot rehearse recovery from actual durable-host loss; restarting it discards the staging state.

## What you can build next, and what you cannot assume

This grammar can support future profiles for materials, manufacturing, freight, retail/B2B trade, finance, employee/time/payroll results and specialized company apps. It does not supply those workflows automatically. Give each proposed profile an owner, privacy/threat model, exact meanings, version policy, constraints, positive/negative vectors and a second consumer implementation.

The future Passport workspace can provide login, company switching, dashboard/module UX and unified attention. A future marketplace can host/scaffold modules, run security screening and let publishers choose community availability. Neither is implemented by this protocol update. MCP/AI is an optional client adapter and must execute the same signed, bounded operations; model output is never authority.

Before proposing production use, review the release evidence for the exact branch/runtime, perform independent security/privacy review, choose real key custody and recovery, define quotas and operational admission policies, test persistence/backups and close the relevant domain-specific gaps. Do not interpret a locally green suite as permission to upload real employee records or automatically approve an executable module.

Useful commands from `sdk`: `npm run build:dtp-v04` regenerates command artifacts/vectors, `npm run test:dtp-v04` exercises the candidate, and `npm run release:report` generates its gate report. Consult [the exact release-gate evidence](release/v04-gates.json), not an old test count copied into a guide. Run these on a disposable test environment; none authorizes a merge or deployment.
