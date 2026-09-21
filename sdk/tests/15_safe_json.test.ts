import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UnsafeJsonError, assertSafeJsonText, assertSafeMemberNames, parseUntrustedJson, parseUntrustedJsonBytes } from '../src/safe-json.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
// The vector file holds every hostile text as a string VALUE, so loading it is itself safe.
const vectors = parseUntrustedJson(readFileSync(resolve(repo, 'spec/vectors/unsafe-json.json'), 'utf8')) as
  { reject: { why: string; text: string }[]; accept: { why: string; text: string }[] };
const B = String.fromCharCode(92), Q = '"';

test('conformance vectors: unsafe member names are refused before parsing, everything else parses', () => {
  assert.ok(vectors.reject.length >= 15 && vectors.accept.length >= 8);
  for (const { why, text } of vectors.reject) {
    assert.throws(() => assertSafeJsonText(text), UnsafeJsonError, why);
    assert.throws(() => parseUntrustedJson(text), UnsafeJsonError, why);
  }
  for (const { why, text } of vectors.accept) {
    assert.doesNotThrow(() => assertSafeJsonText(text), why);
    assert.deepEqual(parseUntrustedJson(text), JSON.parse(text), why);
  }
});

test('the text guard and the producer-side guard agree on every randomly generated document', () => {
  let seed = 0x5eed;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const alphabet = ['a', 'b', 'Z', '0', ' ', '_', B, Q, '/', '\n', '\t', String.fromCharCode(0x13), String.fromCharCode(0xe9), String.fromCharCode(0x65e5), '{', '}', '[', ']', ':', ','];
  const word = () => Array.from({ length: Math.floor(random() * 4) }, () => alphabet[Math.floor(random() * alphabet.length)]).join('');
  const value = (depth: number): unknown => {
    const pick = random();
    if (depth > 3 || pick < 0.3) return [word(), Math.floor(random() * 1000), null, true][Math.floor(random() * 4)];
    if (pick < 0.55) return Array.from({ length: Math.floor(random() * 4) }, () => value(depth + 1));
    return Object.fromEntries(Array.from({ length: Math.floor(random() * 4) }, () => [word(), value(depth + 1)]));
  };
  let refused = 0, allowed = 0;
  for (let i = 0; i < 4000; i++) {
    const document = value(0);
    let namesAreSafe = true;
    try { assertSafeMemberNames(document); } catch { namesAreSafe = false; }
    for (const text of [JSON.stringify(document), JSON.stringify(document, null, 2)]) {
      let textIsSafe = true;
      try { assertSafeJsonText(text); } catch (error) { assert.ok(error instanceof UnsafeJsonError); textIsSafe = false; }
      assert.equal(textIsSafe, namesAreSafe, text);
    }
    namesAreSafe ? allowed++ : refused++;
  }
  assert.ok(refused > 200 && allowed > 200, `generator exercised both outcomes (${refused} refused, ${allowed} allowed)`);
});

test('bytes: invalid UTF-8 is rejected, and hostile values survive untouched', () => {
  assert.throws(() => parseUntrustedJsonBytes(new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d])));
  const text = '{"note":' + Q + B + B + ' and ' + B + 'n' + Q + '}';
  assert.deepEqual(parseUntrustedJsonBytes(new TextEncoder().encode(text)), { note: B + ' and \n' });
  assert.throws(() => parseUntrustedJson(undefined as unknown as string), TypeError);
});

test('producers learn before signing that a receiver would refuse the record', () => {
  for (const name of [B, Q, 'a' + B + 'b', '\n', String.fromCharCode(0x13)]) {
    assert.throws(() => assertSafeMemberNames({ body: [{ [name]: 1 }] }), UnsafeJsonError, JSON.stringify(name));
  }
  assert.doesNotThrow(() => assertSafeMemberNames({ 'ordinary name': { 'with/solidus': [B, Q, '\n'] }, [String.fromCharCode(0x65e5)]: 1 }));
  const cyclic: Record<string, unknown> = { a: 1 }; cyclic.self = cyclic;
  assert.doesNotThrow(() => assertSafeMemberNames(cyclic));
});

// Each probe runs in a fresh process, because the fault is a property of the whole isolate.
// Whether an affected engine misreads a name depends on how it happens to hold the text in
// memory: identical logic faults every time in one launch mode and never in another. A CommonJS
// script given the texts as literals is the mode observed to fault reliably, so probes use it.
const probe = (body: string) => execFileSync(process.execPath, ['-e', body], { encoding: 'utf8', cwd: here });
const polluter = '{' + Q + B + B + Q + ':1}', target = '{' + Q + B + 'n' + Q + ':1}';
const literals = `const polluter=${JSON.stringify(polluter)},target=${JSON.stringify(target)},expected=JSON.stringify({[String.fromCharCode(10)]:1});`;

test('on any engine, affected or not, guarded parsing never lets the parser fault be reached', t => {
  const unguarded = JSON.parse(probe(`${literals}
    const before = JSON.stringify(JSON.parse(target)); JSON.parse(polluter);
    process.stdout.write(JSON.stringify({ before, after: JSON.stringify(JSON.parse(target)) }));`));
  const affected = unguarded.before !== unguarded.after;
  t.diagnostic(`this runtime (${process.version}) ${affected ? 'IS' : 'is not'} affected by the engine's member-name fault`);

  // A host that only ever parses through the guard: the polluting text is refused unparsed, so the
  // isolate stays clean and an ordinary document read afterwards is read correctly, on any engine.
  const guarded = JSON.parse(probe(`${literals}
    import('../src/safe-json.ts').then(({ parseUntrustedJson }) => {
      const outcomes = [];
      for (const text of [polluter, polluter + ' trailing garbage', target]) {
        try { parseUntrustedJson(text); outcomes.push('parsed'); } catch (error) { outcomes.push(error.name); }
      }
      process.stdout.write(JSON.stringify({ outcomes, clean: JSON.stringify(JSON.parse(target)) === expected }));
    });`));
  assert.deepEqual(guarded.outcomes, ['UnsafeJsonError', 'UnsafeJsonError', 'UnsafeJsonError']);
  assert.equal(guarded.clean, true, 'the isolate was never poisoned');
});

test('a parse that throws still poisons an affected engine, so checking after JSON.parse is too late', t => {
  const { threw, poisoned } = JSON.parse(probe(`${literals}
    const before = JSON.stringify(JSON.parse(target)); let threw = false;
    try { JSON.parse(polluter + ' trailing garbage'); } catch { threw = true; }
    process.stdout.write(JSON.stringify({ threw, poisoned: before !== JSON.stringify(JSON.parse(target)) }));`));
  assert.equal(threw, true);
  t.diagnostic(poisoned ? 'this engine WAS poisoned by a parse that failed' : 'this engine is not affected');
});

test('no unguarded parse of external JSON remains in the SDK or the reference stores', () => {
  const roots = ['sdk/src', 'supabase/functions'];
  // Trusted or same-process text only. Every entry needs a reason.
  const allowed = new Map([
    ['sdk/src/safe-json.ts', 'the guard itself'],
    ['supabase/functions/dtp-store/db.ts', 'columns read back from the store, which were admitted through the guard'],
  ]);
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) { if (entry !== 'node_modules') walk(path); continue; }
      if (!/\.(ts|js|mjs)$/.test(entry)) continue;
      const name = relative(repo, path).split('\\').join('/');
      if (allowed.has(name)) continue;
      readFileSync(path, 'utf8').split('\n').forEach((line, index) => {
        if (/\bJSON\.parse\s*\(|\.json\s*\(\s*\)/.test(line)) offenders.push(`${name}:${index + 1}`);
      });
    }
  };
  for (const root of roots) walk(resolve(repo, root));
  assert.deepEqual(offenders, [], 'use parseUntrustedJson, parseUntrustedJsonBytes or parseUntrustedResponse');
});
