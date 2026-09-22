/** Real Ed25519 person authentication; other persistence authorization hooks remain explicitly synthetic. */
import type { Db } from '../../../supabase/functions/dtp-store/db.ts';
import { generateKeyPair } from '../../src/keys.ts';
import { createIdentity, issueResolution, signIdentity } from '../../src/foundation/identity.ts';
import type { IdentityState } from '../../src/foundation/identity.ts';
import { createPersonAuthentication, signPersonOperation } from '../../src/foundation/person-authentication.ts';
import { createFoundationStore } from '../../src/foundation/persistence.ts';
import type { OperationIntent, JsonObject } from '../../src/foundation/semantics.ts';
import { persistenceFixture } from './persistence-fixture.ts';

export async function personAuthenticationFixture(db: Db, threshold = 1) {
  const f = await persistenceFixture(db);
  const [ordinary, second, recovery, resolver, next] = await Promise.all(Array.from({ length: 5 }, () => generateKeyPair()));
  const operational = { keys: threshold === 1 ? [ordinary.keyId] : [ordinary.keyId, second.keyId], threshold };
  const genesis = await signIdentity('DTP-PERSON-GENESIS-1', { nonce: crypto.randomUUID(), operational, recovery: { keys: [recovery.keyId], threshold: 1 } }, threshold === 1 ? [ordinary, recovery] : [ordinary, second, recovery]);
  const resolverId = crypto.randomUUID(), identity = await createIdentity(genesis, { id: resolverId, key_id: resolver.keyId }, Date.now() - 10000);
  const person = { kind: 'person' as const, id: identity.head.identity_id, organization_id: null };
  const config = { host_id: crypto.randomUUID(), audience: 'https://workspace.example', identities: [{ person_id: person.id, resolver_id: resolverId, resolver_key: resolver.keyId, resolver_epoch: 0, minimum_sequence: 0, minimum_digest: identity.head_digest }] };
  const adapter = createPersonAuthentication(config);
  f.state.now = Date.now();
  const grant = { ...f.grant, id: crypto.randomUUID(), subject: person, not_before: Date.now() - 1000, expires_at: Date.now() + 300000 };
  await f.store.govern(f.organization_id, { action: 'grant', grant }, f.controller);
  const options = { ...f.options, now: Date.now, hooks: { ...f.hooks, authenticateOperation: adapter.authenticateOperation, beforeCommit: adapter.beforeCommit } };
  const store = createFoundationStore(db, options);
  const intent = (quantity = 2) => (f.request(quantity).intent as unknown as OperationIntent);
  const issue = async (i = intent(), org = f.organization_id, grantId = grant.id) => db.transaction(tx => adapter.issueChallenge(tx, { organization_id: org, person_id: person.id, intent: i, grant_id: grantId }));
  const proof = async (challenge: Awaited<ReturnType<typeof issue>>, state: IdentityState = identity) => (await issueResolution(state, { identity_id: person.id, audience: config.audience, challenge: challenge.nonce }, resolver, Date.now())).proof;
  const request = async (i = intent(), keys = threshold === 1 ? [ordinary] : [ordinary, second]) => {
    const challenge = await issue(i), resolution = await proof(challenge);
    return signPersonOperation({ intent: i, actor: person, grant_id: grant.id, challenge, resolution }, keys);
  };
  const run = async (value: Awaited<ReturnType<typeof request>>) => store.execute(f.organization_id, value as unknown as JsonObject);
  return { ...f, adapter, config, store, options, genesis, identity, person, ordinary, second, recovery, resolver, next, resolverId, personGrant: grant, intent, issue, proof, personRequest: request, run };
}
