/** Independent synthetic business-policy fixture with real person signatures, not a production host. */
import { generateKeyPair } from '../../src/keys.ts';
import { createIdentity, signIdentity, issueResolution } from '../../src/foundation/identity.ts';
import { createPersonAuthentication, signPersonOperation } from '../../src/foundation/person-authentication.ts';
import { createFoundationStore } from '../../src/foundation/persistence.ts';
import { persistenceFixture } from './persistence-fixture.ts';
import type { Db } from '../../../supabase/functions/dtp-store/db.ts';
import type { KeyPair } from '../../src/keys.ts';
import type { JsonObject, OperationIntent } from '../../src/foundation/semantics.ts';
import type { Signed, Resolution } from '../../src/foundation/identity.ts';

export async function personReviewFixture(db: Db, threshold = 1) {
  const [operational, second, recovery, resolver] = await Promise.all(Array.from({ length: 4 }, generateKeyPair));
  const genesis = await signIdentity('DTP-PERSON-GENESIS-1', { nonce: crypto.randomUUID(), operational: { keys: threshold === 1 ? [operational.keyId] : [operational.keyId, second.keyId], threshold }, recovery: { keys: [recovery.keyId], threshold: 1 } }, threshold === 1 ? [operational, recovery] : [operational, second, recovery]);
  const resolver_id = crypto.randomUUID(), identity = await createIdentity(genesis, { id: resolver_id, key_id: resolver.keyId }, Date.now() - 1000);
  const actor = { kind: 'person' as const, id: identity.head.identity_id, organization_id: null }, host_id = crypto.randomUUID(), audience = 'https://independent-person-host.example';
  const options = { host_id, audience, identities: [{ person_id: actor.id, resolver_id, resolver_key: resolver.keyId, resolver_epoch: 0, minimum_sequence: 0, minimum_digest: identity.head_digest }] };
  const auth = createPersonAuthentication(options), base = await persistenceFixture(db); base.state.now = Date.now();
  const grant = { ...base.grant, id: crypto.randomUUID(), subject: actor, not_before: Date.now() - 1000, expires_at: Date.now() + 120000 };
  await base.store.govern(base.organization_id, { action: 'grant', grant }, base.controller);
  const storeOptions = { ...base.options, now: () => Date.now(), hooks: { ...base.hooks, authenticateOperation: auth.authenticateOperation, beforeCommit: auth.beforeCommit } };
  const store = createFoundationStore(db, storeOptions);
  const unsigned = () => { const request = base.request(); return { intent: request.intent as unknown as OperationIntent, actor, grant_id: grant.id }; };
  const challenge = async (request = unsigned(), organization = base.organization_id) => db.transaction(tx => auth.issueChallenge(tx, { organization_id: organization, person_id: actor.id, intent: request.intent, grant_id: request.grant_id }));
  const request = async (input = unsigned(), keys: KeyPair[] = threshold === 1 ? [operational] : [operational, second], proofOverride?: (proof: Signed<Resolution>) => Promise<Signed<Resolution>>) => {
    const c = await challenge(input), result = await issueResolution(identity, { identity_id: actor.id, audience, challenge: c.nonce }, resolver, Date.now());
    const resolution = proofOverride ? await proofOverride(result.proof) : result.proof;
    return signPersonOperation({ ...input, challenge: c, resolution }, keys);
  };
  const consumed = (nonce: string) => db.query<{ consumed_at: string | null; consumed_request_digest: string | null; deadline_ms: string | null }>('select consumed_at,consumed_request_digest,deadline_ms from dtp_foundation.person_auth_challenges where host_id=$1 and nonce=$2', [host_id, nonce]);
  return { ...base, store, storeOptions, auth, authOptions: options, operational, second, recovery, resolver, resolver_id, identity, actor, host_id, audience, grant, unsigned, challenge, request, consumed };
}
export const asJson = (value: unknown) => value as JsonObject;
