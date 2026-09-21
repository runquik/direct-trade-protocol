import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

test('the package declares a stable entry and clearly separated preview entries', async () => {
  assert.deepEqual(Object.keys(manifest.exports), ['.', './preview', './preview/host']);
  const stable: Record<string, unknown> = await import('../../src/index.ts');
  const preview = await import('../../src/preview.ts');
  const host = await import('../../src/preview-host.ts');
  for (const name of ['canonicalize', 'sha256Hex', 'sha256HexSync']) assert.equal(typeof stable[name], 'function', name);
  assert.equal(typeof preview.inventory.applyInventoryEvent, 'function');
  assert.equal(typeof preview.invoice.validateInvoice, 'function');
  assert.equal(typeof host.v04Engine, 'object');
  // Unreleased layers must never leak into the stable barrel.
  for (const leaked of ['applyInventoryEvent', 'validateInvoice', 'inventory', 'v04Engine']) assert.equal(leaked in stable, false, leaked);
});

test('nothing reachable from the portable preview entry imports a platform module', () => {
  const seen = new Set<string>(), offenders: string[] = [];
  const visit = (file: string) => {
    if (seen.has(file)) return; seen.add(file);
    for (const match of readFileSync(file, 'utf8').matchAll(/from\s+["']([^"']+)["']/g)) {
      const spec = match[1];
      if (spec.startsWith('.')) visit(resolve(dirname(file), spec));
      else if (/^node:|^(fs|crypto|path|os|buffer|http|net|child_process)$/.test(spec)) offenders.push(`${file} -> ${spec}`);
    }
  };
  visit(resolve(root, 'src/preview.ts'));
  assert.ok(seen.size > 10, 'walk reached the preview modules');
  assert.deepEqual(offenders, []);
});
