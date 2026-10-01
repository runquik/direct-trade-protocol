// Builds spec/vectors/inventory-state-keys.json: the member names under which inventory state that travels
// in a v0.4 snapshot is keyed. Each key is the SHA-256 of the canonical JSON of the identity tuple (#38).
import { writeFileSync } from 'node:fs';
import { canonicalize } from '../src/canonical.ts';
import { inventoryKey } from '../src/profiles/inventory.ts';

const org = '11111111-1111-1111-1111-111111111111', product = '33333333-3333-3333-3333-333333333333';
const Q = '"', B = String.fromCharCode(92);
const cases: [string, string, unknown[]][] = [
  ['host observations (inventory-v1): [source_id, observation_id]', 'inventory[org].observations', ['scanner-a', 'observation-1']],
  ['host facts (inventory-v2): [product_id, source_id, sequence]', 'inventory[org].facts', [product, 'scanner-a', 1]],
  ['pool observations: [company_id, source_id, observation_id]', 'inventory[org].pools[pool].observations', [org, 'scanner-a', 'observation-1']],
  ['pool packaging: [packaging_id, version]', 'inventory[org].pools[pool].packaging', ['case', '1']],
  ['pool reservations: [reservation_id]', 'inventory[org].pools[pool].reservations', ['order-a']],
  ['ids holding a quotation mark and a reverse solidus still give a plain key', 'inventory[org].observations', ['scanner ' + Q + 'a' + Q, 'shelf' + B + '1']],
];
const refuse: [string, string, string][] = [
  ['the earlier JSON-encoded tuple form', 'inventory[org].observations', JSON.stringify(['scanner-a', 'observation-1'])],
  ['the earlier JSON-encoded tuple form', 'inventory[org].facts', JSON.stringify([product, 'scanner-a', 1])],
  ['the earlier JSON-encoded tuple form', 'inventory[org].pools[pool].reservations', JSON.stringify(['order-a'])],
  ['a raw id', 'inventory[org].pools[pool].reservations', 'order-a'],
  ['an upper-case digest', 'inventory[org].observations', inventoryKey('scanner-a', 'observation-1').toUpperCase()],
];
const out = {
  description: 'Member names of inventory state carried in a v0.4 snapshot. A host MUST key each map by the lower-case hex SHA-256 of the canonical JSON of the identity tuple, and a destination MUST refuse a snapshot carrying any other key in these maps. Keys under "refuse" appear here only as string values.',
  rule: 'key = lower-case hex SHA-256 of canonical JSON (spec/vectors/canonicalization.json) of the tuple array',
  cases: cases.map(([why, map, tuple]) => ({ why, map, tuple, canonical: canonicalize(tuple), key: inventoryKey(...tuple) })),
  refuse: refuse.map(([why, map, key]) => ({ why, map, key })),
};
writeFileSync(new URL('../../spec/vectors/inventory-state-keys.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
