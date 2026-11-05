// A packed tarball ships no lockfile, so a consumer's install resolves the manifest's `dependencies` fresh. Only an exact
// version there makes the consumer run the same runtime code the conformance suite ran from this lockfile (#139).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sdk = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const manifest = JSON.parse(readFileSync(resolve(sdk, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(resolve(sdk, 'package-lock.json'), 'utf8'));
const EXACT = /^\d+\.\d+\.\d+$/;

test('every runtime dependency is pinned to the exact version the lockfile installs', () => {
  const deps: Record<string, string> = manifest.dependencies ?? {};
  assert.ok(Object.keys(deps).length > 0);
  assert.deepEqual(lock.packages[''].dependencies, deps, 'lockfile root agrees with package.json');
  for (const [name, spec] of Object.entries(deps)) {
    assert.match(spec, EXACT, `${name} must be an exact version, not a range`);
    const entry = lock.packages[`node_modules/${name}`];
    assert.equal(entry?.version, spec, `${name}: lockfile installs ${entry?.version}`);
    // A pinned package that itself floats dependencies would reopen the gap one level down.
    assert.equal(entry.dependencies, undefined, `${name} has no dependencies of its own`);
  }
});
