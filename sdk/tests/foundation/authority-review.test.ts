import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthorityState, issueGrant, revokeGrant, authorizeAndCharge, AuthorityError } from '../../src/foundation/authority.ts';
import type { CapabilityGrant, ExecutionAuthority, ApprovalEvidence } from '../../src/foundation/authority.ts';
import type { EntityReference } from '../../src/foundation/datatypes.ts';

const uuid = () => crypto.randomUUID();
const person = (): EntityReference => ({ kind: 'person', id: uuid(), organization_id: null });
const now = 1_800_000_000_000;
function fixture() {
  const owner = person(), agencyOwner = person(), worker = person(), otherWorker = person(), client = uuid(), agency = uuid();
  const scope = { organization_id: client, operations: ['trade.quote'], profiles: ['a'.repeat(64)], resource_ids: [uuid()] };
  const metric = { issuer: { kind: 'organization' as const, id: client, organization_id: null }, type: 'money.usd-minor', value: 'USD' };
  const root: CapabilityGrant = { id: uuid(), parent_id: null, subject: { kind: 'organization', id: agency, organization_id: null }, scope,
    not_before: now, expires_at: now + 60_000, delegation_depth: 2, limits: [{ metric, amount: '100' }], approval: null };
  let state = createAuthorityState([{ organization_id: client, controllers: [owner], threshold: 1 }, { organization_id: agency, controllers: [agencyOwner], threshold: 1 }]);
  state = issueGrant(state, root, [{ principal: owner }], now);
  const child: CapabilityGrant = { ...root, id: uuid(), parent_id: root.id, subject: worker, delegation_depth: 1 };
  state = issueGrant(state, child, [{ principal: agencyOwner }], now);
  const intent: ExecutionAuthority = { actor: worker, grant_id: child.id, scope, operation_id: uuid(), intent_digest: 'b'.repeat(64), plan_digest: 'c'.repeat(64), usage: [{ metric, amount: '60' }], approvals: [] };
  return { owner, agencyOwner, worker, otherWorker, client, agency, scope, metric, root, child, state, intent };
}

test('independent authority review: retry cannot substitute an active but out-of-scope grant', () => {
  const f = fixture(), accepted = authorizeAndCharge(f.state, f.intent, now);
  const unrelated: CapabilityGrant = { ...f.child, id: uuid(), parent_id: null, scope: { ...f.scope, operations: ['trade.inspect'] }, delegation_depth: 0 };
  const state = issueGrant(accepted.state, unrelated, [{ principal: f.owner }], now);
  assert.throws(() => authorizeAndCharge(state, { ...f.intent, grant_id: unrelated.id }, now), AuthorityError,
    'active unrelated authority must not replace the current right to this recorded operation');
});

test('independent authority review: expired or revoked ancestry blocks retry and new execution', () => {
  const f = fixture(), accepted = authorizeAndCharge(f.state, f.intent, now).state;
  assert.throws(() => authorizeAndCharge(accepted, f.intent, f.root.expires_at), /inactive/);
  const revoked = revokeGrant(accepted, f.root.id, [{ principal: f.owner }]);
  assert.throws(() => authorizeAndCharge(revoked, f.intent, now), /inactive/);
  assert.throws(() => authorizeAndCharge(revoked, { ...f.intent, operation_id: uuid() }, now), /inactive/);
});

test('independent authority review: sibling and descendant spending shares the full live ancestor budget', () => {
  const f = fixture();
  const sibling = { ...f.child, id: uuid(), subject: f.otherWorker };
  let state = issueGrant(f.state, sibling, [{ principal: f.agencyOwner }], now);
  const grandchild = { ...f.child, id: uuid(), parent_id: f.child.id, subject: f.worker, delegation_depth: 0 };
  state = issueGrant(state, grandchild, [{ principal: f.worker }], now);
  state = authorizeAndCharge(state, { ...f.intent, grant_id: grandchild.id }, now).state;
  const remaining = { ...f.intent, actor: f.otherWorker, grant_id: sibling.id, operation_id: uuid(), usage: [{ metric: f.metric, amount: '40' }] };
  state = authorizeAndCharge(state, remaining, now).state;
  assert.equal(state.grants.find(e => e.grant.id === f.root.id)!.used[0].amount, '100');
  assert.throws(() => authorizeAndCharge(state, { ...remaining, operation_id: uuid(), usage: [{ metric: f.metric, amount: '1' }] }, now), /cumulative/);
});

test('independent authority review: limits cannot be weakened by replacing a metric issuer or changing delegation time', () => {
  const f = fixture(), child = { ...f.child, id: uuid(), parent_id: f.child.id, subject: f.otherWorker, delegation_depth: 0 };
  for (const patch of [{ not_before: now - 1 }, { expires_at: f.child.expires_at + 1 }, { limits: [{ metric: { ...f.metric, issuer: { ...f.metric.issuer, id: f.agency } }, amount: '1' }] }]) {
    assert.throws(() => issueGrant(f.state, { ...child, ...patch }, [{ principal: f.worker }], now), AuthorityError);
  }
});

test('independent authority review: ancestor approval survives a child removing its own rule and excludes self approval', () => {
  const f = fixture(), approver = person();
  let state = createAuthorityState(f.state.governance);
  const root = { ...f.root, approval: { people: [f.worker, approver], threshold: 1, exclude_actor: true } };
  state = issueGrant(state, root, [{ principal: f.owner }], now);
  state = issueGrant(state, { ...f.child, approval: null }, [{ principal: f.agencyOwner }], now);
  const approval: ApprovalEvidence = { person: approver, organization_id: f.client, operation_id: f.intent.operation_id, intent_digest: f.intent.intent_digest, plan_digest: f.intent.plan_digest, grant_id: root.id, expires_at: now + 1000 };
  for (const patch of [{ person: f.worker }, { plan_digest: 'd'.repeat(64) }, { operation_id: uuid() }, { expires_at: now }]) {
    assert.throws(() => authorizeAndCharge(state, { ...f.intent, approvals: [{ ...approval, ...patch }] }, now), /approval/);
  }
  assert.doesNotThrow(() => authorizeAndCharge(state, { ...f.intent, approvals: [approval] }, now));
});

test('independent authority review: failed approval cannot consume budget in the supplied authoritative state', () => {
  const f = fixture();
  let state = createAuthorityState(f.state.governance);
  state = issueGrant(state, { ...f.root, approval: { people: [f.owner], threshold: 1, exclude_actor: false } }, [{ principal: f.owner }], now);
  state = issueGrant(state, f.child, [{ principal: f.agencyOwner }], now);
  const before = structuredClone(state);
  assert.throws(() => authorizeAndCharge(state, f.intent, now), /approval/);
  assert.deepEqual(state, before);
});

test('independent authority review: malformed nested grants, consent arrays and input accessors do not run hidden code', () => {
  const f = fixture(); let calls = 0;
  const grant = { ...f.child, id: uuid() }; Object.defineProperty(grant.scope, 'profiles', { enumerable: true, get() { calls++; return ['a'.repeat(64)]; } });
  assert.throws(() => issueGrant(f.state, grant, [{ principal: f.agencyOwner }], now), AuthorityError);
  const consents = [{ principal: f.agencyOwner }]; Object.defineProperty(consents, '0', { enumerable: true, get() { calls++; return { principal: f.agencyOwner }; } });
  assert.throws(() => revokeGrant(f.state, f.child.id, consents), AuthorityError);
  assert.equal(calls, 0);
});

test('independent authority review: one agency cannot revoke a client mandate or impersonate its worker', () => {
  const f = fixture();
  assert.throws(() => revokeGrant(f.state, f.root.id, [{ principal: f.agencyOwner }]), /quorum/);
  assert.throws(() => authorizeAndCharge(f.state, { ...f.intent, actor: f.agencyOwner }, now), /subject/);
  assert.throws(() => authorizeAndCharge(f.state, { ...f.intent, scope: { ...f.scope, organization_id: f.agency } }, now), /scope/);
});
