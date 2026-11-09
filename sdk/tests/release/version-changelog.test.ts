// Every packed artifact names itself: the version follows the decided label, has a changelog entry, and is the
// version the lockfile and the example module agree on (#73, owner decisions of 2026-10-22 and 2026-11-04).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sdk = resolve(dirname(fileURLToPath(import.meta.url)), '../../'), repo = resolve(sdk, '..');
const json = (path: string) => JSON.parse(readFileSync(resolve(repo, path), 'utf8'));
const manifest = json('sdk/package.json'), lock = json('sdk/package-lock.json');
const changelog = readFileSync(resolve(sdk, 'CHANGELOG.md'), 'utf8');
const DEV_LABEL = /^0\.2\.1-dev\.([1-9]\d*)$/;
const headings = [...changelog.matchAll(/^## (\S+)$/gm)].map(m => m[1]);

test('the SDK version uses the decided development label 0.2.1-dev.N', () => {
  assert.match(manifest.version, DEV_LABEL);
  assert.equal(manifest.private, true, 'a development label claims no publication');
});

test('the lockfile records the same version as package.json', () => {
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].version, manifest.version);
});

test('the current version has a changelog entry, and it is the newest one', () => {
  assert.ok(headings.includes(manifest.version), `sdk/CHANGELOG.md has no "## ${manifest.version}" entry`);
  assert.equal(headings[0], manifest.version, 'the newest changelog entry is the current version');
  assert.equal(new Set(headings).size, headings.length, 'each version has one entry');
});

test('changelog entries run newest first, each development bump one above the next', () => {
  const dev = headings.filter(h => DEV_LABEL.test(h)).map(h => Number(DEV_LABEL.exec(h)![1]));
  assert.deepEqual(dev, Array.from({ length: dev.length }, (_, i) => dev.length - i), 'dev entries are N, N-1, ..., 1 with no gap');
  assert.equal(headings[headings.length - 1], '0.2.0', 'the unlabelled 0.2.0 builds are the oldest entry');
  assert.equal(headings.length, dev.length + 1, 'no entry other than 0.2.1-dev.N and 0.2.0');
});

test('the example module depends on the tarball npm pack writes for this version', () => {
  const example = json('examples/external-module/package.json');
  assert.equal(example.dependencies['@dtp/sdk'], `file:../../sdk/dtp-sdk-${manifest.version}.tgz`);
});
