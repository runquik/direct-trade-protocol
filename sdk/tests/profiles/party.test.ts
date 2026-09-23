import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalize } from '../../src/canonical.ts';
import { parseUntrustedJson } from '../../src/safe-json.ts';
import { checkSchema, validateShape } from '../../src/v04/profiles.ts';
import { PARTY_KIND, PARTY_PROFILE, PARTY_SCHEMA, PARTY_SEMANTICS, checkPartyContinuity, isDuns, isGln, validateParty } from '../../src/profiles/party.ts';
import type { PartyBody } from '../../src/profiles/party.ts';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const fixtures = parseUntrustedJson(readFileSync(here('../../../spec/profiles/party/1/fixtures.json'), 'utf8')) as {
  kind: string; profile: string; semantics: string; contract_digest: string; accept: { why: string; body: unknown }[]; reject: { why: string; body: unknown }[];
  continuity: { accept: { why: string; previous: PartyBody; next: PartyBody }[]; reject: { why: string; previous: PartyBody; next: PartyBody }[] } };
const contract = parseUntrustedJson(readFileSync(here('../../../spec/profiles/party/1/profile.json'), 'utf8')) as Record<string, unknown>;

test('party@1 fixtures: accepted bodies pass the dialect schema and the rules; rejected bodies are refused; continuity pairs judged exactly', () => {
  assert.equal(fixtures.kind, PARTY_KIND); assert.equal(fixtures.profile, PARTY_PROFILE); assert.equal(fixtures.semantics, PARTY_SEMANTICS);
  assert.ok(fixtures.accept.length >= 5 && fixtures.reject.length >= 18 && fixtures.continuity.accept.length >= 3 && fixtures.continuity.reject.length >= 4);
  checkSchema(contract.schema);
  for (const v of fixtures.accept) { assert.ok(validateShape(contract.schema, v.body), v.why); assert.deepEqual(validateParty(v.body), [], v.why); }
  for (const v of fixtures.reject) assert.ok(validateParty(v.body).length > 0, v.why);
  for (const v of fixtures.continuity.accept) assert.deepEqual(checkPartyContinuity(v.previous, v.next), [], v.why);
  for (const v of fixtures.continuity.reject) assert.ok(checkPartyContinuity(v.previous, v.next).length > 0, v.why);
});

test('party@1 contract: the published contract is the reference schema, its digest is recomputed with a second SHA-256, and the generator reproduces both files', () => {
  assert.deepEqual(contract, { publisher_id: 'dtp', name: 'party', version: '1.0.0', schema: PARTY_SCHEMA, semantics: PARTY_SEMANTICS, dependencies: [] });
  assert.equal(createHash('sha256').update(canonicalize(contract), 'utf8').digest('hex'), fixtures.contract_digest);
  const run = spawnSync(process.execPath, [here('../../scripts/build-party-profile.ts'), '--check'], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(run.status, 0, run.stderr);
});

test('party@1 rules: GLN and DUNS are judged by content, roles never widen, and a unit needs its parent', () => {
  assert.ok(isGln('0614141000005') && isGln('0614141000012') && !isGln('0614141000006') && !isGln('061414100000') && !isGln('00012345678905'));
  assert.ok(isDuns('123456789') && !isDuns('12345678') && !isDuns('12345678a'));
  const base = fixtures.accept[0].body as PartyBody;
  const issue = (edit: (b: PartyBody) => void) => { const b = structuredClone(base); edit(b); return validateParty(b).map(i => i.path); };
  assert.deepEqual(issue(b => { (b as any).roles = ['admin']; }), ['$.roles']);
  assert.deepEqual(issue(b => { b.kind = 'unit'; }), ['$.parent']);
  assert.deepEqual(issue(b => { b.locations[0].address.country = 'us'; }), ['$.locations[0].address.country']);
  assert.deepEqual(validateParty({}), [{ path: '$', message: 'exact party fields required' }]);
});
