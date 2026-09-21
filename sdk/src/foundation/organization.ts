/** Organization identity: a keyless derived identifier, controlled by people through governance.
 * Pure derivation only. Authenticating every initial controller's consent is a HOST obligation.
 * Decision record and normative rules: docs/foundation/organization-identity.md.
 */
import { canonicalBytes, sha256Hex } from '../canonical.ts';
import { copyIdentityData } from './identity.ts';
import type { Governance } from './authority.ts';

export const ORGANIZATION_GENESIS_DOMAIN = 'DTP-ORGANIZATION-GENESIS-1';
export interface OrganizationGenesis { nonce: string; founder: string; controllers: string[]; threshold: number }
function need(ok: unknown, reason: string): asserts ok { if (!ok) throw new Error(reason); }
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
/** Returns a detached, validated copy. Rejects accessors, extra members and unordered controllers. */
export function parseOrganizationGenesis(value: OrganizationGenesis): OrganizationGenesis {
  const g = copyIdentityData(value), fields = ['nonce', 'founder', 'controllers', 'threshold'];
  need(g && typeof g === 'object' && !Array.isArray(g), 'organization genesis object required');
  const keys = Object.keys(g);
  need(keys.length === fields.length && fields.every(k => Object.hasOwn(g, k)), 'exact organization genesis fields required');
  need(uuid(g.nonce), 'invalid organization nonce'); need(uuid(g.founder), 'invalid founder');
  need(Array.isArray(g.controllers) && g.controllers.length >= 1 && g.controllers.length <= 16 && g.controllers.every(uuid), '1-16 person controllers required');
  // One controller set, one id: strictly ascending order also excludes duplicates.
  need(g.controllers.every((c, i) => i === 0 || g.controllers[i - 1] < c), 'controllers must be distinct and ascending');
  need(g.controllers.includes(g.founder), 'founder must be an initial controller');
  need(Number.isSafeInteger(g.threshold) && g.threshold >= 1 && g.threshold <= g.controllers.length, 'invalid controller quorum');
  return g;
}
export async function organizationGenesisDigest(genesis: OrganizationGenesis): Promise<string> {
  return sha256Hex(canonicalBytes({ domain: ORGANIZATION_GENESIS_DOMAIN, body: parseOrganizationGenesis(genesis) }));
}
/** First 128 bits of the genesis digest, UUID-formatted. Compare the FULL digest on any collision. */
export async function organizationId(genesis: OrganizationGenesis): Promise<string> {
  const h = await organizationGenesisDigest(genesis);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
/** The initial governance exactly as the genesis states it, for createAuthorityState. */
export async function organizationGovernance(genesis: OrganizationGenesis): Promise<Governance> {
  const g = parseOrganizationGenesis(genesis);
  return { organization_id: await organizationId(g), controllers: g.controllers.map(id => ({ kind: 'person' as const, id, organization_id: null })), threshold: g.threshold };
}
