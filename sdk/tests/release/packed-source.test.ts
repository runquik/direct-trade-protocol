// The version names the artifact only if a change to packed-entry source cannot land without touching the current
// version's changelog entry (#181). Each entry records the digest of the source its packed entries are built from;
// a pull request that changes that source either bumps the version with a new entry, or, when no packed entry
// behaves differently, records the new digest in the current entry with a line naming the change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { packedInputs, packedInputsText, packedScriptNames, packedSourceDigest, packedSourceFiles, type PackedInputs } from '../../scripts/packed-source-digest.ts';

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

// #212: a change to the packed `package.json`, a runtime dependency or the compiler settings changes the artifact as
// surely as a change to `src/`, so it must change the digest too; what does not reach the artifact must not.
function changed(edit: (inputs: PackedInputs) => void): string {
  const inputs = structuredClone(packedInputs());
  edit(inputs);
  return packedSourceDigest(packedSourceFiles(), inputs);
}

test('the digest covers the packed package.json, the runtime dependencies and the compiler settings (#212)', () => {
  const files = packedSourceFiles();
  const base = packedSourceDigest(files);
  const dependency = Object.keys(packedInputs().manifest.dependencies as Record<string, string>)[0];
  const cases: Record<string, (inputs: PackedInputs) => void> = {
    'a runtime dependency moves': i => {
      (i.manifest.dependencies as Record<string, string>)[dependency] = '0.0.0';
      Object.assign(i.lock.packages[`node_modules/${dependency}`], { version: '0.0.0', integrity: 'sha512-other' });
    },
    'the lock file installs other bytes under the same version': i => { i.lock.packages[`node_modules/${dependency}`].integrity = 'sha512-other'; },
    'a runtime dependency is added': i => { (i.manifest.dependencies as Record<string, string>)['left-pad'] = '1.3.0'; },
    '`files` changes': i => { i.manifest.files = (i.manifest.files as string[]).filter(f => f !== 'CHANGELOG.md'); },
    '`exports` changes': i => { delete (i.manifest.exports as Record<string, unknown>)['./preview']; },
    '`engines` changes': i => { i.manifest.engines = { node: '>=20' }; },
    'the build script changes': i => { (i.manifest.scripts as Record<string, string>)['build:package'] = 'tsc -p other.json'; },
    'an install script is added': i => { (i.manifest.scripts as Record<string, string>).postinstall = 'node setup.js'; },
    // npm runs a script's `pre` and `post` hooks around it: `prepack` runs `npm run build:package`.
    'a `postbuild:package` hook is added': i => { (i.manifest.scripts as Record<string, string>)['postbuild:package'] = 'node -e "1"'; },
    'a `prebuild:package` hook is added': i => { (i.manifest.scripts as Record<string, string>)['prebuild:package'] = 'node -e "1"'; },
    'a `postpack` hook is added': i => { (i.manifest.scripts as Record<string, string>).postpack = 'node -e "1"'; },
    'a file a build script runs changes': i => { i.scriptFiles['tsconfig.build.json'] += ' '; },
    'a package the runtime dependency needs moves': i => {
      Object.assign(i.lock.packages[`node_modules/${dependency}`], { dependencies: { 'nested-dep': '^1.0.0' } });
      i.lock.packages[`node_modules/${dependency}/node_modules/nested-dep`] = { version: '1.0.0', integrity: 'sha512-nested' };
    },
    'the compiler target changes': i => { i.compilerOptions.target = ts.ScriptTarget.ES2021; },
    'a compiler option is added': i => { i.compilerOptions.useDefineForClassFields = false; },
    'the compiler version changes': i => { i.compilerVersion = '0.0.0'; },
  };
  for (const [name, edit] of Object.entries(cases)) assert.notEqual(changed(edit), base, `${name}: the digest must change`);
  const same: Record<string, (inputs: PackedInputs) => void> = {
    'the version moves (a bump records its own entry)': i => { i.manifest.version = '9.9.9-dev.9'; },
    'a dev dependency moves': i => { i.manifest.devDependencies = {}; },
    'a test script changes': i => { (i.manifest.scripts as Record<string, string>).test = 'node --test other'; },
    'manifest keys are reordered': i => { i.manifest = Object.fromEntries(Object.entries(i.manifest).reverse()); },
    'the build\'s own config path, which names no option': i => { i.compilerOptions.configFilePath = '/elsewhere/tsconfig.build.json'; },
    'a script no lifecycle script reaches is added': i => { (i.manifest.scripts as Record<string, string>)['postbuild:other'] = 'node -e "1"'; },
  };
  for (const [name, edit] of Object.entries(same)) assert.equal(changed(edit), base, `${name}: the digest must not change`);
});

test('a script the build reaches through `npm run` is covered, and array-valued path options are machine-independent (#212)', () => {
  const withStamp = (stamp: string) => changed(i => {
    Object.assign(i.manifest.scripts as Record<string, string>, { 'build:package': 'tsc -p tsconfig.build.json && npm run --silent stamp', stamp });
  });
  assert.notEqual(withStamp('node -e "2"'), withStamp('node -e "1"'), 'a change to a script only `npm run` reaches must change the digest');
  const inputs = structuredClone(packedInputs());
  inputs.compilerOptions.typeRoots = [resolve(sdk, 'types')];
  const text = packedInputsText(inputs);
  assert.match(text, /"typeRoots":\["types"\]/);
  assert.ok(!text.includes(sdk), 'no absolute path of this machine reaches the digest');
});

test('every script that runs while packing or installing is kept, and only those (#212)', () => {
  assert.deepEqual(packedScriptNames({
    prepack: 'npm run build:package', 'build:package': 'tsc -p tsconfig.build.json && run-s stamp:*',
    'prebuild:package': 'node clean.mjs', 'postbuild:package': 'npm run-script finish', finish: 'node finish.mjs',
    'stamp:a': 'node a.mjs', 'stamp:b': 'node b.mjs', postinstall: 'node setup.mjs',
    test: 'node --test', 'pretest': 'node pre.mjs', lint: 'eslint .',
  }), ['build:package', 'finish', 'postbuild:package', 'postinstall', 'prebuild:package', 'prepack', 'stamp:a', 'stamp:b']);
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
