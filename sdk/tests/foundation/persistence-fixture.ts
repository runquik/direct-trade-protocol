/** Synthetic trusted-hook fixture; NOT an authentication implementation. Reusable with a real PostgreSQL Db. */
import assert from 'node:assert/strict';
import type { Db } from '../../../supabase/functions/dtp-store/db.ts';
import { createSemanticRegistry, operationDescriptorDigest } from '../../src/foundation/semantics.ts';
import type { OperationDescriptor, OperationIntent, JsonObject } from '../../src/foundation/semantics.ts';
import type { EntityReference, RevisionReference } from '../../src/foundation/datatypes.ts';
import type { CapabilityGrant, Governance, AuthorityState } from '../../src/foundation/authority.ts';
import { createFoundationStore, entityRevisionDigest } from '../../src/foundation/persistence.ts';
import type { FoundationStoreOptions, PersistenceHooks, StoredRevision } from '../../src/foundation/persistence.ts';
export const PROFILE = 'a'.repeat(64), HANDLER = 'b'.repeat(64);
export async function persistenceFixture(db: Db, initialQuantity = 10, prerequisites: string[] = []) {
  const organization_id = crypto.randomUUID(), actor: EntityReference = { kind: 'person', id: crypto.randomUUID(), organization_id: null };
  const resource: EntityReference = { kind: 'resource', id: crypto.randomUUID(), organization_id };
  const governance: Governance = { organization_id, controllers: [actor], threshold: 1 };
  const metric = { issuer: { kind: 'organization' as const, id: organization_id, organization_id: null }, type: 'quantity.cases', value: 'cases' };
  const state = { now: 1800000000000, readAllowed: true, liveAllowed: true, profilesAllowed: true, handlerCalls: 0, accountingCalls: 0 };
  const descriptor: OperationDescriptor = { profile_digest: PROFILE, name: 'stock.consume', input_profile_digests: [PROFILE], output_profile_digests: [PROFILE], required_grants: prerequisites,
    allowed_effects: ['resource.update', 'record.append'], max_inputs: 2, max_resources: 1, max_effects: 2, concurrency: 'exact-revision', retry: 'business-operation-id' };
  const descriptorDigest = await operationDescriptorDigest(descriptor);
  const registry = await createSemanticRegistry([{ descriptor, descriptor_digest: descriptorDigest, handler_digest: HANDLER, evaluate(input) {
    state.handlerCalls++;
    const snapshot = input.snapshots[0], quantity = input.intent.parameters.quantity;
    assert.equal(typeof quantity, 'number'); assert.ok((quantity as number) > 0 && (quantity as number) <= (snapshot.body!.quantity as number), 'insufficient stock');
    return { expected_resources: [{ resource, revision: snapshot.current_revision }], effects: [
      { kind: 'resource.update', resource, expected_revision: snapshot.current_revision, next_revision_id: input.intent.parameters.next_revision_id, profile_digest: PROFILE, body: { quantity: (snapshot.body!.quantity as number) - (quantity as number) } },
      { kind: 'record.append', record_id: input.intent.parameters.record_id, resource, profile_digest: PROFILE, body: { quantity } },
    ] };
  } }], [{ profile_digest: PROFILE, validate: body => Object.keys(body).length === 1 && Number.isSafeInteger(body.quantity) && (body.quantity as number) >= 0 }]);
  const hooks: PersistenceHooks = {
    async authenticateOperation(_tx, input) {
      assert.equal(input.request.signature, 'synthetic-authorized');
      assert.deepEqual(input.request.actor, actor);
      return { intent: input.request.intent as unknown as OperationIntent, actor, grant_id: input.request.grant_id as string };
    },
    async authorizeLive() { assert.ok(state.liveAllowed, 'live authority denied'); },
    async authorizeRead() { assert.ok(state.readAllowed, 'read policy denied'); },
    async authorizeProfiles() { assert.ok(state.profilesAllowed, 'profile use denied'); },
    // Explicit test-only callback, NOT a database-backed authentication deadline.
    async beforeCommit() {},
    async approveUsage(_tx, input) {
      state.accountingCalls++;
      return { usage: [{ metric, amount: String(input.verified.intent.parameters.quantity) }], approvals: [] };
    },
    async authenticateGovernance(_tx, input) {
      assert.equal(input.request.signature, 'synthetic-controller');
      assert.equal(input.organization_id, organization_id);
      return { consents: [{ principal: actor }], governance: [governance] };
    },
    async verifyImport(_tx, input) {
      const v = input.revision;
      assert.deepEqual(v.original_signed_record, { revision: v.revision, profile_digest: v.profile_digest, body: v.body, signature: 'synthetic-original' });
      assert.equal(await entityRevisionDigest(v.revision.entity, v.revision.revision_id, v.profile_digest, v.body), v.revision.digest);
    },
  };
  const options: FoundationStoreOptions = { semantics: registry, now: () => state.now, hooks };
  const store = createFoundationStore(db, options), controller = { signature: 'synthetic-controller' };
  await store.bootstrap(organization_id, governance, controller);
  const initialBody = { quantity: initialQuantity }, revisionId = crypto.randomUUID();
  const initialRevision: RevisionReference = { entity: resource, revision_id: revisionId, digest: await entityRevisionDigest(resource, revisionId, PROFILE, initialBody) };
  const initial: StoredRevision = { revision: initialRevision, profile_digest: PROFILE, body: initialBody, original_signed_record: { revision: initialRevision as any, profile_digest: PROFILE, body: initialBody, signature: 'synthetic-original' } };
  await store.importRevision(organization_id, initial, controller);
  const grant: CapabilityGrant = { id: crypto.randomUUID(), parent_id: null, subject: actor, scope: { organization_id, operations: ['stock.consume'], profiles: [PROFILE], resource_ids: [resource.id] },
    not_before: state.now - 1, expires_at: state.now + 1000000, delegation_depth: 0, limits: [{ metric, amount: String(initialQuantity) }], approval: null };
  await store.govern(organization_id, { action: 'grant', grant }, controller);
  const request = (quantity = 2): JsonObject => ({ signature: 'synthetic-authorized', actor: actor as any, grant_id: grant.id,
    intent: { operation_id: crypto.randomUUID(), organization_id, profile_digest: PROFILE, operation: 'stock.consume', descriptor_digest: descriptorDigest, handler_digest: HANDLER,
      resources: [resource as any], inputs: [], parameters: { quantity, next_revision_id: crypto.randomUUID(), record_id: crypto.randomUUID() } } });
  const authority = async () => (await db.query<{ body: AuthorityState }>('select body from dtp_foundation.organization_authority where organization_id=$1', [organization_id]))[0].body;
  const counts = async () => {
    const out: Record<string, number> = {};
    for (const table of ['entity_revisions', 'resource_heads', 'business_receipts', 'transactional_outbox', 'governance_history'])
      out[table] = (await db.query<{ n: number }>(`select count(*)::int as n from dtp_foundation.${table} where organization_id=$1`, [organization_id]))[0].n;
    return out;
  };
  return { db, store, options, hooks, state, organization_id, actor, resource, governance, controller, grant, metric, initial, request, authority, counts };
}
