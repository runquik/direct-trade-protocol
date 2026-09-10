import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair } from '../../src/keys.ts';
import type { KeyPair } from '../../src/keys.ts';
import { emptyState } from '../../src/v04/model.ts';
import type { Context, SignedToken } from '../../src/v04/model.ts';
import { execute } from '../../src/v04/engine.ts';
import { digest, draftCommand, organizationId, personId, signCommand, signToken } from '../../src/v04/wire.ts';

type Actor = { id: string; key: KeyPair };
const object = (properties: Record<string, any>, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const string = (maxLength = 200) => ({ type: 'string', maxLength });
const denied = (error: any) => [400, 401, 403, 404, 409, 413, 422].includes(error?.status);

async function host(audience: string) {
  let state = emptyState();
  const ctx: Context = { audience, storeKey: await generateKeyPair(), pins: {}, now: Date.now() };
  ctx.assessmentPins = { [audience]: ctx.storeKey.keyId };
  const command = async (actor: Actor, action: string, org: string | null, payload: any, extra: KeyPair[] = []) =>
    signCommand(draftCommand(audience, actor, action, org, payload, ctx.now), [actor.key, ...extra]);
  const send = async (input: any) => { const candidate = structuredClone(state); const result = await execute(candidate, input, ctx); state = candidate; return result; };
  const call = async (actor: Actor, action: string, org: string | null, payload: any, extra: KeyPair[] = []) => send(await command(actor, action, org, payload, extra));
  const person = async () => { const key = await generateKeyPair(), actor = { key, id: await personId(key.keyId) }; await call(actor, 'person.register', null, { keys: [key.keyId] }); return actor; };
  const owner = await person(), worker = await person();
  const company = async () => { const nonce = crypto.randomUUID(), org = await organizationId(owner.id, nonce); await call(owner, 'organization.create', org, { name: 'Synthetic evidence company', nonce, controllers: [owner.id], threshold: 1 }); return org; };
  const org = await company(), invitation_id = crypto.randomUUID(), expires = new Date(ctx.now + 86400000).toISOString();
  await call(owner, 'membership.invite', org, { invitation_id, person_id: worker.id, permissions: [], expires_at: expires });
  await call(worker, 'membership.accept', org, { invitation_id });
  const grant = (actor: Actor, actions = ['read', 'write', 'export'], resources: string[] | '*' = '*') => ({ person_id: actor.id, actions, resource_ids: resources, expires_at: expires });
  const policy = async (workerActions = ['read']) => { const policy_id = crypto.randomUUID(); await call(owner, 'policy.create', org, { policy_id, expected_revision: 0, classification: 'business', stewards: [owner.id], threshold: 1, grants: [grant(owner), ...(workerActions.length ? [grant(worker, workerActions)] : [])] }); return policy_id; };
  const profile = async (name: string, schema = object({ note: string() }), dependencies: string[] = [], semantics = 'structural') => {
    const contract = { publisher_id: org, name, version: '1.0.0', schema, dependencies, semantics }, hash = await digest(contract);
    const { publisher_id: _, ...payload } = contract;
    await call(owner, 'profile.publish', org, { ...payload, digest: hash, visibility: 'private', readers: [] }); return hash;
  };
  const append = async (policy_id: string, profile_digest: string, body: any = { note: 'SYNTHETIC EVIDENCE CANARY' }, counterparty_ids: string[] = []) => {
    const id = crypto.randomUUID(), payload = { id, root_id: id, supersedes: null, organization_id: org, policy_id, resource_id: crypto.randomUUID(), profile_digest, counterparty_ids, body };
    await call(owner, 'record.append', org, payload); return payload;
  };
  const install = async (profiles: string[], policy_id: string, actions = ['read']) => {
    const artifact_digest = 'd'.repeat(64), assessment = await signToken({ kind: 'module-assessment', issuer: audience, issued_at: new Date(ctx.now).toISOString(), expires_at: expires, artifact_digest, outcome: 'approved' }, ctx);
    const release = await call(owner, 'release.publish', org, { module_id: crypto.randomUUID(), version: '1.0.0', artifact_digest, profiles, actions, visibility: 'private', assessment });
    const actor = { id: crypto.randomUUID(), key: await generateKeyPair() };
    await call(owner, 'installation.create', org, { installation_id: actor.id, release_digest: release.digest, key_id: actor.key.keyId, policy_ids: [policy_id], actions, mode: 'interactive', expires_at: expires }, [actor.key]);
    return actor;
  };
  const moduleCall = async (actor: Actor, action: string, payload: any) => {
    const c = draftCommand(audience, actor, action, org, payload, ctx.now); c.actor.kind = 'installation'; c.requested_by = owner.id;
    return send(await signCommand(c, [actor.key, owner.key]));
  };
  return { ctx, owner, worker, org, company, grant, policy, profile, append, install, moduleCall, command, call, send };
}

async function pair() {
  const source = await host('https://evidence-source.test'), destination = await host('https://evidence-destination.test');
  source.ctx.pins[destination.ctx.audience] = destination.ctx.storeKey.keyId; destination.ctx.pins[source.ctx.audience] = source.ctx.storeKey.keyId;
  const sourcePolicy = await source.policy(), destinationPolicy = await destination.policy(), profile = await source.profile('evidence.notes');
  const record = await source.append(sourcePolicy, profile), resource_id = crypto.randomUUID();
  const recipient = { organization_id: destination.org, audience: destination.ctx.audience, policy_id: destinationPolicy, resource_id };
  const issue = (record_ids = [record.id], actor = source.owner, target = recipient) => source.call(actor, 'evidence.issue', source.org,
    { record_ids, recipient: target, purpose: 'Synthetic financing review', expires_at: new Date(source.ctx.now + 60000).toISOString() });
  const inspect = (token: SignedToken, accepted_profiles = [profile], actor = destination.owner, org = destination.org) =>
    destination.call(actor, 'evidence.inspect', org, { token, accepted_profiles });
  return { source, destination, sourcePolicy, destinationPolicy, profile, record, recipient, issue, inspect };
}

test('evidence review: valid recipient sees exact signed versions without false live-state claims', async () => {
  const f = await pair(), token = await f.issue(), viewed = await f.inspect(token);
  assert.equal(viewed.records[0].id, f.record.id); assert.deepEqual(viewed.records[0].body, f.record.body);
  assert.match(viewed.freshness, /historical/); assert.match(viewed.source_revocation, /cannot be recalled/);
});

test('evidence review: read alone does not permit export, nor export alone permit reading', async () => {
  const f = await pair(), page = { after: 0, limit: 10, profile_digests: [f.profile] };
  assert.equal((await f.source.call(f.source.worker, 'records.list', f.source.org, page)).records.length, 1);
  assert.equal((await f.source.call(f.source.worker, 'records.export', f.source.org, page)).records.length, 0);
  await assert.rejects(f.issue(undefined, f.source.worker), denied);
  await f.source.call(f.source.owner, 'policy.update', f.source.org, { policy_id: f.sourcePolicy, expected_revision: 1, classification: 'business', stewards: [f.source.owner.id], threshold: 1,
    grants: [f.source.grant(f.source.owner), f.source.grant(f.source.worker, ['export'])] });
  assert.equal((await f.source.call(f.source.worker, 'records.export', f.source.org, page)).records.length, 0);
  await assert.rejects(f.issue(undefined, f.source.worker), denied);
});

test('evidence review: source authority and exact recipient company/compartment are both required', async () => {
  const f = await pair(), token = await f.issue(), anotherOrg = await f.destination.company();
  await assert.rejects(f.inspect(token, undefined, f.destination.owner, anotherOrg), denied);
  await f.destination.call(f.destination.owner, 'policy.update', f.destination.org, { policy_id: f.destinationPolicy, expected_revision: 1, classification: 'business', stewards: [f.destination.owner.id], threshold: 1,
    grants: [f.destination.grant(f.destination.owner, ['read'], [crypto.randomUUID()])] });
  await assert.rejects(f.inspect(token), denied);
});

test('evidence review: wrong host, untrusted issuer, tampering and expired disclosure are rejected', async () => {
  const f = await pair(), token = await f.issue();
  const modified = structuredClone(token); modified.body.records[0].body.note = 'tampered'; await assert.rejects(f.inspect(modified), denied);
  f.source.ctx.pins['https://another-recipient.test'] = (await generateKeyPair()).keyId;
  const wrongHost = await f.issue(undefined, undefined, { ...f.recipient, audience: 'https://another-recipient.test' }); await assert.rejects(f.inspect(wrongHost), denied);
  delete f.destination.ctx.pins[f.source.ctx.audience]; await assert.rejects(f.inspect(token), denied);
  f.destination.ctx.pins[f.source.ctx.audience] = f.source.ctx.storeKey.keyId;
  f.destination.ctx.now = f.source.ctx.now + 60001; await assert.rejects(f.inspect(token), denied);
});

test('evidence review: strict payload schema rejects omitted, duplicate and undeclared acceptance fields', async () => {
  const f = await pair(), token = await f.issue();
  for (const payload of [{ token }, { token, accepted_profiles: [f.profile, f.profile] }, { token, accepted_profiles: ['constructor'] }, { token, accepted_profiles: [f.profile], ignore_permissions: true }]) {
    await assert.rejects(f.destination.call(f.destination.owner, 'evidence.inspect', f.destination.org, payload), (error: any) => error?.status === 400);
  }
});

test('evidence review: profile dependencies travel with an honest evidence bundle', async () => {
  const f = await pair(), derived = await f.source.profile('evidence.derived', object({ note: string() }), [f.profile]);
  const record = await f.source.append(f.sourcePolicy, derived), token = await f.issue([record.id]);
  const viewed = await f.inspect(token, [derived]);
  assert.equal(viewed.records[0].id, record.id);
  assert.ok(viewed.profiles.some((profile: any) => profile.digest === f.profile), 'required dependency omitted from portable evidence');
});

test('evidence review: signed outer issuer claims cannot substitute for deterministic record validation', async () => {
  const f = await pair(), token = await f.issue();
  token.body.records[0].validation = { profile: f.profile, level: 'structural', business_verified: true };
  const signedClaim = await signToken(token.body, f.source.ctx);
  try {
    const viewed = await f.inspect(signedClaim);
    assert.notEqual(viewed.records[0].validation.business_verified, true, 'unverified issuer projection returned as protocol business verification');
  } catch (error) { assert.ok(denied(error), `unexpected error: ${String(error)}`); }
});

test('evidence review: module export needs its own export action even when the human has it', async () => {
  const f = await pair(), module = await f.source.install([f.profile], f.sourcePolicy, ['read']);
  const page = await f.source.moduleCall(module, 'records.export', { after: 0, limit: 10, profile_digests: [f.profile] });
  assert.equal(page.records.length, 0);
});

test('evidence review: an installed module cannot inspect an undeclared disclosed profile', async () => {
  const f = await pair(), token = await f.issue(), unrelated = await f.destination.profile('local.notes');
  const module = await f.destination.install([unrelated], f.destinationPolicy);
  await assert.rejects(f.destination.moduleCall(module, 'evidence.inspect', { token, accepted_profiles: [f.profile] }), denied);
});

test('evidence review: a signed source envelope cannot make a schema-invalid signed record acceptable', async () => {
  const f = await pair(), token = await f.issue(), record = token.body.records[0];
  record.body.note = 123;
  record.command.payload.body = structuredClone(record.body);
  record.command = await signCommand(record.command, [f.source.owner.key]);
  await assert.rejects(f.inspect(await signToken(token.body, f.source.ctx)), denied);
});

async function invoiceFixture() {
  const source = await host('https://live-invoice-review.test'), invoicePolicy = await source.policy(), referencePolicy = await source.policy([]), buyer = await source.company();
  const referenceProfile = await source.profile('trade.contract', object({ seller_company_id: string(), buyer_company_id: string() }));
  const contract = await source.append(referencePolicy, referenceProfile, { seller_company_id: source.org, buyer_company_id: buyer });
  const money = object({ amount: string(), currency: string(10) });
  const schema = object({ contract_id: string(), seller_company_id: string(), buyer_company_id: string(),
    line_items: { type: 'array', maxItems: 10, items: object({ quantity: object({ amount: string(), unit: string(10) }), unit_price: money, amount: money }) },
    subtotal: money, deductions: { type: 'array', maxItems: 10, items: object({ reason: string(), amount: money }) }, total: money, paid_amount: money,
    status: string(30), settlement_event_ids: { type: 'array', maxItems: 10, items: string() }, issued_at: string(), due_at: string() });
  const profile = await source.profile('invoice', schema, [], 'invoice-v1'), usd = (amount: string) => ({ amount, currency: 'USD' });
  const body = { contract_id: contract.id, seller_company_id: source.org, buyer_company_id: buyer,
    line_items: [{ quantity: { amount: '2', unit: 'case' }, unit_price: usd('100'), amount: usd('200') }],
    subtotal: usd('200'), deductions: [], total: usd('200'), paid_amount: usd('0'), status: 'issued', settlement_event_ids: [],
    issued_at: new Date(source.ctx.now).toISOString(), due_at: new Date(source.ctx.now + 86400000).toISOString() };
  const invoice = await source.append(invoicePolicy, profile, body, [buyer]);
  const read = (actor = source.owner, recordId = invoice.id) => source.call(actor, 'record.get', source.org, { id: recordId, profile_digest: profile });
  return { source, invoicePolicy, referencePolicy, buyer, referenceProfile, contract, profile, body, invoice, read };
}

test('live invoice review: a publisher-chosen type name does not establish understood reference meaning', async () => {
  const f = await invoiceFixture(), before = await f.read();
  assert.equal(before.live_validation.complete, false);
  assert.ok(before.live_validation.issues.some((issue: any) => issue.code === 'reference_unknown'));
  f.source.ctx.referenceProfiles = { 'trade.contract': [f.referenceProfile] };
  const understood = await f.read();
  assert.equal(understood.live_validation.complete, true);
  assert.equal(understood.validation.complete, false, 'original persisted acceptance assessment must not mutate');
  assert.deepEqual(understood.command, before.command);
});

test('live invoice review: missing and unreadable references produce the same unknown assessment', async () => {
  const f = await invoiceFixture(); f.source.ctx.referenceProfiles = { 'trade.contract': [f.referenceProfile] };
  const protectedReference = await f.read(f.source.worker);
  const missing = await f.source.append(f.invoicePolicy, f.profile, { ...f.body, contract_id: crypto.randomUUID() }, [f.buyer]);
  const absentReference = await f.read(f.source.worker, missing.id);
  assert.deepEqual(protectedReference.live_validation, absentReference.live_validation);
  assert.equal(protectedReference.live_validation.complete, false);
});

test('live invoice review: module profile permissions also constrain derived reference validation', async () => {
  const f = await invoiceFixture(); f.source.ctx.referenceProfiles = { 'trade.contract': [f.referenceProfile] };
  assert.equal((await f.read()).live_validation.complete, true);
  const module = await f.source.install([f.profile], f.invoicePolicy);
  const viewed = await f.source.moduleCall(module, 'record.get', { id: f.invoice.id, profile_digest: f.profile });
  assert.equal(viewed.live_validation.complete, false);
  assert.ok(viewed.live_validation.issues.some((issue: any) => issue.code === 'reference_unknown'));
});

test('live invoice review: understood references with contradictory parties are reported invalid', async () => {
  const f = await invoiceFixture(); f.source.ctx.referenceProfiles = { 'trade.contract': [f.referenceProfile] };
  const contract = await f.source.append(f.referencePolicy, f.referenceProfile, { seller_company_id: f.source.org, buyer_company_id: crypto.randomUUID() });
  const invoice = await f.source.append(f.invoicePolicy, f.profile, { ...f.body, contract_id: contract.id }, [f.buyer]);
  const viewed = await f.read(f.source.owner, invoice.id);
  assert.equal(viewed.live_validation.valid, false);
  assert.ok(viewed.live_validation.issues.some((issue: any) => issue.code === 'reference_mismatch'));
});
