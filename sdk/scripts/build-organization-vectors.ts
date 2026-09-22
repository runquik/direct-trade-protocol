// Builds spec/vectors/organization-identity.json from fixed inputs. Deterministic: rerunning it
// must leave the file unchanged; `--check` compares without writing. Rules: docs/foundation/organization-identity.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { canonicalize } from '../src/canonical.ts';
import { ORGANIZATION_GENESIS_DOMAIN, organizationGenesisDigest, organizationId } from '../src/foundation/organization.ts';

const p = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const nonce = '0f0e0d0c-0b0a-4908-8706-050403020100';
const accept: [string, unknown][] = [
  ['a sole founder-controller', { nonce, founder: p(1), controllers: [p(1)], threshold: 1 }],
  ['two of three controllers, founder first', { nonce, founder: p(1), controllers: [p(1), p(2), p(3)], threshold: 2 }],
  ['the same controllers with a different founder is a different organization', { nonce, founder: p(2), controllers: [p(1), p(2), p(3)], threshold: 2 }],
  ['the same controllers with a different threshold is a different organization', { nonce, founder: p(1), controllers: [p(1), p(2), p(3)], threshold: 3 }],
  ['a different nonce is a different organization', { nonce: '00010203-0405-4607-8809-0a0b0c0d0e0f', founder: p(1), controllers: [p(1)], threshold: 1 }],
];
const many = Array.from({ length: 17 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
const reject: [string, unknown][] = [
  ['controllers not in ascending order', { nonce, founder: p(1), controllers: [p(2), p(1)], threshold: 1 }],
  ['a repeated controller', { nonce, founder: p(1), controllers: [p(1), p(1)], threshold: 1 }],
  ['a founder who is not an initial controller', { nonce, founder: p(3), controllers: [p(1), p(2)], threshold: 1 }],
  ['a threshold of zero', { nonce, founder: p(1), controllers: [p(1)], threshold: 0 }],
  ['a threshold above the number of controllers', { nonce, founder: p(1), controllers: [p(1), p(2)], threshold: 3 }],
  ['a non-integer threshold', { nonce, founder: p(1), controllers: [p(1)], threshold: '1' }],
  ['no controllers', { nonce, founder: p(1), controllers: [], threshold: 1 }],
  ['more than sixteen controllers', { nonce, founder: many[0], controllers: many, threshold: 1 }],
  ['an uppercase identifier', { nonce, founder: p(1).replace('8111', '8AAA'), controllers: [p(1).replace('8111', '8AAA')], threshold: 1 }],
  ['a nonce that is not UUID-format', { nonce: 'not-a-nonce', founder: p(1), controllers: [p(1)], threshold: 1 }],
  ['an extra member', { nonce, founder: p(1), controllers: [p(1)], threshold: 1, name: 'Example Foods' }],
  ['a missing member', { nonce, founder: p(1), controllers: [p(1)] }],
];
const out = {
  description: 'Organization identity. For every "accept" entry an implementation MUST derive exactly this preimage, genesis_digest and organization_id from the genesis. It MUST refuse every "reject" genesis. Person ids here are fixed synthetic values, not registered identities.',
  domain: ORGANIZATION_GENESIS_DOMAIN,
  rule: 'genesis_digest = SHA-256(UTF-8(canonical JSON of {"domain":domain,"body":genesis})) as lowercase hex; organization_id = its first 32 hex characters formatted 8-4-4-4-12.',
  accept: await Promise.all(accept.map(async ([why, genesis]) => ({
    why, genesis, preimage: canonicalize({ domain: ORGANIZATION_GENESIS_DOMAIN, body: genesis }),
    genesis_digest: await organizationGenesisDigest(genesis as never), organization_id: await organizationId(genesis as never) }))),
  reject: reject.map(([why, genesis]) => ({ why, genesis })),
};
for (const [why, genesis] of reject) {
  const refused = await organizationId(genesis as never).then(() => false, () => true);
  if (!refused) throw new Error(`generator: the reference implementation accepted "${why}"`);
}
const target = new URL('../../spec/vectors/organization-identity.json', import.meta.url), text = JSON.stringify(out, null, 2) + '\n';
if (!process.argv.includes('--check')) writeFileSync(target, text);
// A checkout may have converted line endings; the content is what must not drift.
else if (readFileSync(target, 'utf8').replaceAll('\r\n', '\n') !== text) { console.error('spec/vectors/organization-identity.json is stale; rerun this script without --check'); process.exit(1); }
console.log('vectors:', out.accept.length, 'accept,', out.reject.length, 'reject');
