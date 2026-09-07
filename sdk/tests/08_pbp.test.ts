// PBP 0.3 authority integration tests. Always ephemeral localhost, never STORE_URL.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPbpStore } from "../scripts/pbp-dev-server.ts";
import { PbpClient } from "../src/v03/client.ts";
import { draftCommand, signCommand, personId, organizationId, commandBytes, signaturesOf, PbpError, digest, type Command } from "../src/v03/wire.ts";
import { verifyTransfer } from "../src/v03/engine.ts";
import { generateKeyPair, keyPairFromSecret, type KeyPair } from "../src/keys.ts";
import { contractBody } from "./helpers.ts";

type Person = { id: string; key: KeyPair };
let store: Awaited<ReturnType<typeof createPbpStore>>, client: PbpClient;
let owner: Person, second: Person, cfo: Person, employee: Person;
const end = () => new Date(Date.now() + 86400000).toISOString();
const usd = (amount: string) => ({ amount, currency: "USD" });
async function person(): Promise<Person> {
  const key = await generateKeyPair(), p = { id: await personId(key.keyId), key };
  await client.act(p, "person.register", null, { keys: [key.keyId] }); return p;
}
async function company(name = "Example", controllers = [owner]) {
  const nonce = crypto.randomUUID(), id = await organizationId(controllers[0].id, nonce);
  await client.act(controllers[0], "organization.create", id, { name, nonce, controllers: controllers.map(p => p.id), threshold: controllers.length }, controllers.slice(1).map(p => p.key));
  return id;
}
async function member(org: string, who: Person, permissions: string[], by = owner, expiry = end()) {
  const invitation_id = crypto.randomUUID();
  await client.act(by, "membership.invite", org, { invitation_id, person_id: who.id, permissions, expires_at: expiry });
  await client.act(who, "membership.accept", org, { invitation_id });
}
async function rejected(work: Promise<unknown>, code: string) {
  await assert.rejects(work, (e: unknown) => { assert.ok(e instanceof PbpError); assert.equal(e.code, code, e.message); return true; });
}
function invoice(seller: string, buyer: string, visibility = "private") {
  const id = crypto.randomUUID();
  return { record_id: id, root_id: id, supersedes: null, type: "finance.invoice", subject_company_id: seller,
    counterparty_ids: [buyer], visibility, body: { invoice_number: id, seller_company_id: seller, buyer_company_id: buyer,
      contract_id: crypto.randomUUID(), line_items: [{ description: "sample", quantity: { amount: "1", unit: "case" }, unit_price: usd("100"), amount: usd("100") }],
      subtotal: usd("100"), deductions: [], total: usd("100"), issued_at: new Date().toISOString(), due_at: end(),
      payment_terms: { net_days: 30, paca_covered: false }, status: "issued", paid_amount: usd("0"), settlement_event_ids: [], assigned_to_company_id: null } };
}
async function moduleFor(org: string, permissions: string[]) {
  const id = crypto.randomUUID();
  await client.act(owner, "module.publish", org, { module_id: id, manifest: { version: "1.0.0", name: "Test Books", permissions } }); return id;
}
async function installation(org: string, module: string, permissions: string[], mode = "automation", by = owner) {
  const id = crypto.randomUUID(), key = await generateKeyPair();
  await client.act(by, "installation.create", org, { installation_id: id, module_id: module, manifest_version: "1.0.0", key_id: key.keyId,
    permissions, mode, expires_at: end() }, [key]); return { id, key };
}
async function moduleCommand(inst: { id: string; key: KeyPair }, org: string, action: string, payload: any, requester?: Person) {
  const draft = draftCommand(client.audience, owner, action, org, payload);
  draft.actor = { kind: "installation", id: inst.id, key_id: inst.key.keyId };
  draft.requested_by = requester?.id ?? null;
  return signCommand(draft, [inst.key, ...(requester ? [requester.key] : [])]);
}
before(async () => { store = await createPbpStore(); client = new PbpClient(store.audience); owner = await person(); second = await person(); cfo = await person(); employee = await person(); });
after(async () => store?.close());

test("PBP: self-certifying person enrollment and exact request retry", async () => {
  const key = await generateKeyPair(), p = { id: await personId(key.keyId), key };
  const cmd = await signCommand(draftCommand(store.audience, p, "person.register", null, { keys: [key.keyId] }), [key]);
  assert.deepEqual(await client.send(cmd), await client.send(cmd));
  const forged = { id: crypto.randomUUID(), key: await generateKeyPair() };
  await rejected(client.act(forged, "person.register", null, { keys: [forged.key.keyId] }), "invalid");
});

test("PBP: one fractional CFO has different rights in three isolated companies", async () => {
  const a = await company("CFO A"), b = await company("CFO B"), c = await company("CFO C");
  await member(a, cfo, ["records.read:finance.invoice"]);
  await member(b, cfo, ["records.read:trade.contract"]);
  await member(c, cfo, ["records.read:finance.invoice"]);
  const ar = await client.act(owner, "record.append", a, invoice(a, b));
  const cr = await client.act(owner, "record.append", c, invoice(c, b));
  const id = crypto.randomUUID();
  const br = await client.act(owner, "record.append", b, { record_id: id, root_id: id, supersedes: null, type: "trade.contract",
    subject_company_id: b, counterparty_ids: [a], visibility: "private", body: contractBody(b, a) });
  const expected = [[a, ar.record_id], [b, br.record_id], [c, cr.record_id]];
  for (const [org, recordId] of expected) {
    const view = await client.act(cfo, "workspace.view", org, {});
    assert.deepEqual(view.records.map((r: any) => r.record_id), [recordId]);
    assert.equal(view.person_id, cfo.id);
    await rejected(client.act(cfo, "membership.invite", org, { invitation_id: crypto.randomUUID(), person_id: employee.id, permissions: [], expires_at: end() }), "forbidden");
  }
  const listed = await client.act(cfo, "organizations.list", null, {});
  assert.ok([a, b, c].every(id => listed.some((o: any) => o.id === id)));
  await client.act(owner, "membership.revoke", b, { person_id: cfo.id });
  await rejected(client.act(cfo, "workspace.view", b, {}), "forbidden");
  assert.equal((await client.act(cfo, "workspace.view", a, {})).records.length, 1);
  assert.equal((await client.act(cfo, "workspace.view", c, {})).records.length, 1);
});

test("PBP: membership requires acceptance and cannot outlive or exceed its delegator", async () => {
  const org = await company();
  await member(org, employee, ["members.manage", "records.read:finance.invoice"]);
  await rejected(client.act(employee, "membership.invite", org, { invitation_id: crypto.randomUUID(), person_id: cfo.id,
    permissions: ["installations.manage"], expires_at: end() }), "forbidden");
  const invite = crypto.randomUUID();
  await client.act(owner, "membership.invite", org, { invitation_id: invite, person_id: cfo.id, permissions: ["records.read:finance.invoice"], expires_at: end() });
  await rejected(client.act(cfo, "workspace.view", org, {}), "forbidden");
  await rejected(client.act(employee, "membership.accept", org, { invitation_id: invite }), "forbidden");
  await client.act(cfo, "membership.accept", org, { invitation_id: invite });
  await rejected(client.act(employee, "membership.invite", org, { invitation_id: crypto.randomUUID(), person_id: second.id,
    permissions: [], expires_at: new Date(Date.now() + 2 * 86400000).toISOString() }), "forbidden");
});

test("PBP: invitation is invalid if its authorizer loses authority before acceptance", async () => {
  const org = await company(), expiry = end();
  await member(org, employee, ["members.manage", "records.read:finance.invoice"], owner, expiry);
  const id = crypto.randomUUID();
  await client.act(employee, "membership.invite", org, { invitation_id: id, person_id: cfo.id, permissions: ["records.read:finance.invoice"], expires_at: expiry });
  await client.act(owner, "membership.revoke", org, { person_id: employee.id });
  await rejected(client.act(cfo, "membership.accept", org, { invitation_id: id }), "forbidden");
});

test("PBP: controller policy and full-company export require distinct-person quorum", async () => {
  const org = await company("Quorum", [owner, second]);
  await rejected(client.act(owner, "organization.export", org, {}), "approval_required");
  assert.equal((await client.act(owner, "organization.export", org, {}, [second.key])).snapshot.organization.id, org);
  await rejected(client.act(owner, "organization.policy", org, { controllers: [owner.id], threshold: 1 }), "approval_required");
  await rejected(client.act(owner, "membership.revoke", org, { person_id: second.id }), "forbidden");
  await client.act(owner, "organization.policy", org, { controllers: [owner.id], threshold: 1 }, [second.key]);
  await rejected(client.act(second, "workspace.view", org, {}), "forbidden");
});

test("PBP: root proof-of-possession recovery, key rotation and last-key safeguard", async () => {
  const who = await person(), backup = await generateKeyPair(), org = await company("Recovery", [who]);
  await client.act(who, "person.rotate", null, { add: [backup.keyId], revoke: [] }, [backup]);
  const recovered = { id: who.id, key: backup };
  const newClient = new PbpClient(store.audience); // No bearer/session secret needs recovering from the server.
  assert.equal((await newClient.act(recovered, "workspace.view", org, {})).organization.id, org);
  await newClient.act(recovered, "person.rotate", null, { add: [], revoke: [who.key.keyId] });
  await rejected(client.act(who, "workspace.view", org, {}), "forbidden");
  await rejected(client.act(recovered, "person.rotate", null, { add: [], revoke: [backup.keyId] }), "forbidden");
});

test("PBP: modules pin immutable manifests and use separate company installation keys", async () => {
  const a = await company(), b = await company(), rights = ["records.read:finance.invoice"];
  const mod = await moduleFor(a, rights);
  const ia = await installation(a, mod, rights), ib = await installation(b, mod, rights);
  await client.act(owner, "record.append", a, invoice(a, b, "granted"));
  await client.act(owner, "record.append", b, invoice(b, a, "granted"));
  const ac = await moduleCommand(ia, a, "records.list", { after: 0, limit: 100 });
  assert.equal((await client.send(ac)).records.length, 1);
  await rejected(client.send(await moduleCommand(ia, b, "records.list", { after: 0, limit: 100 })), "forbidden");
  await client.act(owner, "module.publish", a, { module_id: mod, manifest: { version: "2.0.0", name: "New", permissions: [...rights, "records.write:finance.invoice"] } });
  const view = await client.act(owner, "workspace.view", a, {});
  assert.equal(view.installations[0].manifest.version, "1.0.0");
  await client.act(owner, "installation.revoke", a, { installation_id: ia.id });
  await rejected(client.send(ac), "forbidden");
  assert.equal((await client.send(await moduleCommand(ib, b, "records.list", { after: 0, limit: 100 }))).records.length, 1);
});

test("PBP: interactive actions require both human and installation authority", async () => {
  const org = await company(), other = await company(), rights = ["records.read:finance.invoice", "records.write:finance.invoice"];
  const mod = await moduleFor(org, rights), installed = await installation(org, mod, rights, "interactive");
  await member(org, employee, ["records.read:finance.invoice"]);
  const data = invoice(org, other, "granted");
  await rejected(client.send(await moduleCommand(installed, org, "record.append", data)), "approval_required");
  await rejected(client.send(await moduleCommand(installed, org, "record.append", data, employee)), "forbidden");
  const command = await moduleCommand(installed, org, "record.append", data, owner);
  const created = await client.send(command);
  assert.equal(created.command.requested_by, owner.id);
  assert.equal(created.command.actor.id, installed.id);
  assert.deepEqual(await client.send(command), created);
});

test("PBP: writable data access is not authority to accept financing", async () => {
  const seller = await company(), financer = await company();
  await member(seller, cfo, ["records.read:finance.advance_offer", "records.write:finance.advance_offer"]);
  const id = crypto.randomUUID();
  const offer = { record_id: id, root_id: id, supersedes: null, type: "finance.advance_offer", subject_company_id: seller,
    counterparty_ids: [financer], visibility: "counterparties", body: { invoice_id: crypto.randomUUID(), seller_company_id: seller,
      financer_company_id: financer, advance_amount: usd("100"), advance_bps: 9000, fee: { fee_bps: 100, apr_bps: 1200 },
      repayment: { source: "buyer_payment", due_at: end() }, recourse: "full", pricing_basis: [{ record_id: crypto.randomUUID(), type: "finance.invoice" }], expires_at: end(), status: "offered" } };
  await client.act(owner, "record.append", financer, offer);
  const accepting = { ...offer, record_id: crypto.randomUUID(), supersedes: id, body: { ...offer.body, status: "accepted" } };
  await rejected(client.act(cfo, "record.append", seller, accepting), "forbidden");
  await member(seller, cfo, ["records.read:finance.advance_offer", "records.write:finance.advance_offer", "finance.accept_offer"]);
  assert.equal((await client.act(cfo, "record.append", seller, accepting)).body.status, "accepted");
});

test("PBP: v0.2 finance integrity guards still reject buyer payment-field changes", async () => {
  const seller = await company(), buyer = await company(), original = invoice(seller, buyer, "counterparties");
  await client.act(owner, "record.append", seller, original);
  const changing = { ...original, record_id: crypto.randomUUID(), supersedes: original.record_id, body: { ...original.body, status: "acknowledged", paid_amount: usd("100") } };
  await rejected(client.act(owner, "record.append", buyer, changing), "transition_forbidden");
  assert.equal((await client.act(owner, "record.append", buyer, { ...changing, body: { ...original.body, status: "acknowledged" } })).body.status, "acknowledged");
});

test("PBP: record read and export scopes are enforced before pagination", async () => {
  const org = await company(), other = await company();
  await member(org, employee, ["records.read:finance.invoice", "records.export"]);
  for (let i = 0; i < 3; i++) await client.act(owner, "record.append", other, invoice(other, org));
  const own = await client.act(owner, "record.append", org, invoice(org, other));
  const page = await client.act(employee, "records.export", org, { after: 0, limit: 1 });
  assert.equal(page.records[0].record_id, own.record_id); assert.equal(page.next_cursor, null);
  await rejected(client.act(employee, "organization.export", org, {}), "forbidden");
});

test("PBP: wrong audience, expired commands, duplicate IDs and tampering fail closed", async () => {
  const c = draftCommand(store.audience, owner, "organizations.list", null, {});
  await rejected(client.send(await signCommand({ ...c, audience: "https://other.invalid" }, [owner.key])), "wrong_audience");
  const old = draftCommand(store.audience, owner, "organizations.list", null, {}, Date.now() - 360000);
  await rejected(client.send(await signCommand(old, [owner.key])), "expired");
  const signed = await signCommand(c, [owner.key]); await client.send(signed);
  await rejected(client.send(await signCommand({ ...c, expires_at: new Date(Date.now() + 90000).toISOString() }, [owner.key])), "conflict");
  signed.action = "workspace.view"; await rejected(client.send(signed), "signature_invalid");
});

test("PBP: membership revocation invalidates a previously signed request and cached read", async () => {
  const org = await company(); await member(org, employee, ["records.read:finance.invoice"]);
  const cached = await signCommand(draftCommand(store.audience, employee, "workspace.view", org, {}), [employee.key]);
  await client.send(cached);
  const queued = await signCommand(draftCommand(store.audience, employee, "workspace.view", org, {}), [employee.key]);
  await client.act(owner, "membership.revoke", org, { person_id: employee.id });
  await rejected(client.send(cached), "forbidden"); await rejected(client.send(queued), "forbidden");
});

test("PBP: signed company migration freezes source, pins destination and preserves records", async () => {
  const org = await company("Portable", [owner, second]), other = await company();
  await member(org, cfo, ["records.read:finance.invoice"]);
  const record = await client.act(owner, "record.append", org, invoice(org, other));
  const rights = ["records.read:finance.invoice"], mod = await moduleFor(org, rights);
  await installation(org, mod, rights);
  const dest = await createPbpStore({ trustedSources: [store.keyId] });
  try {
    const dc = new PbpClient(dest.audience);
    // Same self-certifying controller identity, independently registered at destination.
    await dc.act(owner, "person.register", null, { keys: [owner.key.keyId] });
    // Every step uses signed public API commands; no database edits or vendor secret-key transfer.
    const preview = await client.act(owner, "migration.preview", org, {}, [second.key]);
    await rejected(client.act(owner, "migration.commit", org, { destination: { audience: dest.audience, key_id: dest.keyId }, snapshot_hash: "0".repeat(64) }, [second.key]), "conflict");
    const transfer = await client.act(owner, "migration.commit", org, { destination: { audience: dest.audience, key_id: dest.keyId }, snapshot_hash: preview.snapshot_hash }, [second.key]);
    await verifyTransfer(transfer, { audience: dest.audience, key_id: dest.keyId }, [store.keyId]);
    await rejected(verifyTransfer(transfer, { audience: dest.audience, key_id: dest.keyId }, []), "untrusted_source");
    await rejected(verifyTransfer(transfer, { audience: "https://wrong-store.invalid", key_id: dest.keyId }, [store.keyId]), "invalid_transfer");
    await rejected(verifyTransfer(transfer, { audience: dest.audience, key_id: store.keyId }, [store.keyId]), "invalid_transfer");
    assert.equal(await digest(await client.act(owner, "migration.receipt", org, {}, [second.key])), await digest(transfer));
    await rejected(client.act(owner, "membership.revoke", org, { person_id: cfo.id }), "migrated");
    const tampered = structuredClone(transfer); tampered.snapshot.organization.name = "changed";
    await rejected(dc.act(owner, "migration.import", null, { transfer: tampered }), "signature_invalid");
    const imported = await dc.act(owner, "migration.import", null, { transfer });
    assert.equal(imported.organization_id, org);
    const view = await dc.act(cfo, "workspace.view", org, {});
    assert.equal(view.records[0].record_id, record.record_id);
    assert.deepEqual(view.records[0].command, record.command);
    assert.equal(view.installations[0].active, false);
    await rejected(dc.act(owner, "migration.import", null, { transfer }), "conflict");
  } finally { await dest.close(); }
});

test("PBP: oversized and malformed HTTP bodies do not expose internal errors", async () => {
  const send = (body: string) => fetch(store.audience + "/pbp-store/commands", { method: "POST", body });
  assert.equal((await send("x".repeat(1024 * 1024 + 1))).status, 413);
  assert.equal((await send("{")).status, 400);
  assert.equal((await send("[".repeat(60) + "0" + "]".repeat(60))).status, 400);
});

test("PBP: fixed 0.3 signing vector round-trips independently of v0.2 envelope signing", async () => {
  const vector = JSON.parse(readFileSync(new URL("../../spec/v0.3/signing-vector.json", import.meta.url), "utf8"));
  const fixed = JSON.parse(readFileSync(new URL("../../spec/vectors/keys.json", import.meta.url), "utf8"));
  const signed = await signCommand(vector.command, [await keyPairFromSecret(fixed.secret_key)]);
  assert.deepEqual(signed, vector.command);
  assert.equal(new TextDecoder().decode(commandBytes(signed)), vector.signing_input_utf8);
  assert.equal(await digest(signed), vector.request_hash);
  assert.equal((await signaturesOf(signed)).size, 1);
});

test("PBP: narrowing permissions invalidates cached record and workspace data", async () => {
  const org = await company(), other = await company();
  await member(org, employee, ["records.read:finance.invoice"]);
  await client.act(owner, "record.append", org, invoice(org, other));
  const view = await signCommand(draftCommand(store.audience, employee, "workspace.view", org, {}), [employee.key]);
  const read = await signCommand(draftCommand(store.audience, employee, "records.list", org, { after: 0, limit: 100 }), [employee.key]);
  assert.equal((await client.send(view)).records.length, 1); assert.equal((await client.send(read)).records.length, 1);
  await member(org, employee, []);
  assert.deepEqual((await client.send(view)).records, []); assert.deepEqual((await client.send(read)).records, []);
});

test("PBP: two keys belonging to one controller do not satisfy two-person quorum", async () => {
  const a = await person(), b = await person(), org = await company("Two people", [a, b]), backup = await generateKeyPair();
  await client.act(a, "person.rotate", null, { add: [backup.keyId], revoke: [] }, [backup]);
  await rejected(client.act(a, "organization.export", org, {}, [backup]), "approval_required");
});

test("PBP: installation creation cannot exceed the installing member's permissions", async () => {
  const org = await company(); await member(org, employee, ["installations.manage", "records.read:finance.invoice"]);
  const mod = await moduleFor(org, ["records.read:finance.invoice", "records.write:finance.invoice"]);
  await rejected(installation(org, mod, ["records.write:finance.invoice"], "automation", employee), "forbidden");
});

test("PBP: unauthenticated and unknown input fields fail closed", async () => {
  const draft = draftCommand(store.audience, owner, "organizations.list", null, {});
  const unsigned = await fetch(store.audience + "/pbp-store/commands", { method: "POST", body: JSON.stringify(draft) });
  assert.equal(unsigned.status, 400);
  const signed = await signCommand(draft, [owner.key]);
  const extra = await fetch(store.audience + "/pbp-store/commands", { method: "POST", body: JSON.stringify({ ...signed, admin: true }) });
  assert.equal(extra.status, 400);
});
