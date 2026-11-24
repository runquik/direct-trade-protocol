// A removed controller's membership ends at the source and in the snapshot replay alike (SPEC.md section 3, #225).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair } from '../../src/keys.ts';
import type { KeyPair } from '../../src/keys.ts';
import { emptyState } from '../../src/v04/model.ts';
import type { Context } from '../../src/v04/model.ts';
import { execute } from '../../src/v04/engine.ts';
import { buildSnapshot, validateSnapshot } from '../../src/v04/snapshot.ts';
import { draftCommand, organizationId, personId, signCommand } from '../../src/v04/wire.ts';

type Actor = { id: string; key: KeyPair };
const audience = 'https://controller-removal-snapshot.test', DAY = 86400000;

test('a snapshot of a company whose removed controller was a member before promotion validates', async () => {
  const state = emptyState();
  const ctx: Context = { audience, storeKey: await generateKeyPair(), pins: {}, now: Date.now() };
  const call = async (a: Actor, action: string, org: string | null, payload: any, cosigners: Actor[] = []) => {
    ctx.now += 1000; return execute(state, await signCommand(draftCommand(audience, a, action, org, payload, ctx.now), [a.key, ...cosigners.map(x => x.key)]), ctx);
  };
  const person = async () => { const key = await generateKeyPair(); const a = { key, id: await personId(key.keyId) }; await call(a, 'person.register', null, { keys: [key.keyId] }); return a; };
  const owner = await person(), worker = await person();
  const nonce = crypto.randomUUID(), org = await organizationId(owner.id, nonce), invitation_id = crypto.randomUUID();
  await call(owner, 'organization.create', org, { name: 'Synthetic removal company', nonce, controllers: [owner.id], threshold: 1 });
  await call(owner, 'membership.invite', org, { invitation_id, person_id: worker.id, permissions: ['members.manage'], expires_at: new Date(ctx.now + 30 * DAY).toISOString() });
  await call(worker, 'membership.accept', org, { invitation_id });
  await call(owner, 'organization.policy', org, { controllers: [owner.id, worker.id], threshold: 1 }, [worker]);
  await call(owner, 'organization.policy', org, { controllers: [owner.id], threshold: 1 });
  assert.equal(state.organizations[org].members[worker.id].active, false);
  await validateSnapshot(emptyState(), buildSnapshot(state, org, ctx));
});
