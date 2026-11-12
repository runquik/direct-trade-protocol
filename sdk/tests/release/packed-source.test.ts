// The version names the artifact only if a change to packed-entry source cannot land without touching the current
// version's changelog entry (#181). Each entry records the digest of the source its packed entries are built from;
// a pull request that changes that source either bumps the version with a new entry, or, when no packed entry
// behaves differently, records the new digest in the current entry with a line naming the change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packedSourceDigest, packedSourceFiles } from '../../scripts/packed-source-digest.ts';

const sdk = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const manifest = JSON.parse(readFileSync(resolve(sdk, 'package.json'), 'utf8'));
const changelog = readFileSync(resolve(sdk, 'CHANGELOG.md'), 'utf8');
const DIGEST = /^Packed source: `([0-9a-f]{64})`/gm;

function entry(version: string): string {
  const start = changelog.indexOf(`\n## ${version}\n`);
  assert.ok(start >= 0, `sdk/CHANGELOG.md has no "## ${version}" entry`);
  const end = changelog.indexOf('\n## ', start + 1);
  return changelog.slice(start, end < 0 ? undefined : end);
}

test('the packed entries reach the SDK core and the previews, and not the reference host', () => {
  const files = packedSourceFiles();
  for (const path of ['src/index.ts', 'src/preview.ts', 'src/preview-foundation.ts', 'src/foundation/identity-log.ts', 'src/profiles/inventory2.ts', 'src/profiles/flow.ts']) {
    assert.ok(files.includes(path), `${path} is packed`);
  }
  assert.ok(!files.includes('src/preview-host.ts'), 'the reference host needs no bump');
  assert.deepEqual(files, [...files].sort());
});

test('the digest covers each file\'s path and bytes', () => {
  const files = packedSourceFiles();
  assert.notEqual(packedSourceDigest(files), packedSourceDigest(files.slice(1)));
  assert.equal(packedSourceDigest(files), packedSourceDigest([...files]));
});

test('the current version\'s changelog entry records the digest of the packed-entry source', () => {
  const recorded = [...entry(manifest.version).matchAll(DIGEST)].map(m => m[1]);
  assert.equal(recorded.length, 1, `the "## ${manifest.version}" entry records exactly one "Packed source: \`<sha256>\`" line`);
  const actual = packedSourceDigest();
  assert.equal(recorded[0], actual,
    `packed-entry source changed since the "## ${manifest.version}" entry was written (digest now ${actual}). ` +
    'If a packed entry behaves differently, bump the version and add an entry; otherwise record the new digest in ' +
    'the current entry with a line naming the change. See the preamble of sdk/CHANGELOG.md.');
});
