// The digest of everything the packed entries are built from (#181, #212). `tsconfig.build.json` names the entries;
// the TypeScript program lists every file they reach, which is exactly what `npm pack` compiles into `dist/`.
// Source no packed entry reaches (the reference host, scripts, tests) is not covered: it needs no version bump.
// Beside the source, the digest covers the other inputs that decide how the artifact behaves (#212):
//   - the packed `package.json`, except its `version`, its `devDependencies` and the scripts that neither build the
//     artifact nor run when a consumer installs it (see `packedScriptNames`);
//   - the bytes of each file in `sdk/` that a kept script names, such as `node scripts/x.mjs`;
//   - the installed version and integrity of each runtime dependency and of every package it needs, from the lock file;
//   - the compiler options `tsconfig.build.json` resolves to, and the installed compiler's version, which together
//     decide the JavaScript `dist/` contains.
// Run `node scripts/packed-source-digest.ts` from `sdk/` to print the digest a changelog entry records.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const sdk = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toPosix = (path: string) => path.split(sep).join('/');

function buildConfig(): ts.ParsedCommandLine {
  const config = ts.getParsedCommandLineOfConfigFile(resolve(sdk, 'tsconfig.build.json'), {}, {
    ...ts.sys, onUnRecoverableConfigFileDiagnostic: d => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n')); },
  });
  if (!config) throw new Error('tsconfig.build.json did not parse');
  return config;
}

/** Every source file a packed entry reaches, as `src/…` paths, sorted. */
export function packedSourceFiles(): string[] {
  const config = buildConfig();
  const program = ts.createProgram(config.fileNames, { ...config.options, noEmit: true });
  return program.getSourceFiles()
    .map(file => toPosix(relative(sdk, file.fileName)))
    .filter(path => path.startsWith('src/'))
    .sort();
}

/**
 * The npm lifecycle scripts that run when the artifact is packed (`prepack`, `prepare`, `postpack`) or when a consumer
 * installs it (`preinstall`, `install`, `postinstall`, `prepare`), with the deprecated `prepublish` and the hooks of
 * `prepare`. `prepack` runs `build:package`, which `packedScriptNames` reaches through its reference.
 */
export const LIFECYCLE_SCRIPTS = ['prepublish', 'preprepare', 'prepare', 'postprepare', 'prepack', 'postpack', 'preinstall', 'install', 'postinstall'] as const;

/** A script command's words: split on whitespace and shell operators, quotes removed. */
function words(command: string): string[] {
  return command.split(/[\s;&|()<>`]+/).map(word => word.replace(/^['"]+|['"]+$/g, '')).filter(Boolean);
}

/** `true` when `word` names `name`, as itself or as a glob such as `build:*` (`npm-run-all`, `run-s`). */
function names(word: string, name: string): boolean {
  if (word === name) return true;
  if (!word.includes('*')) return false;
  const pattern = word.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${pattern}$`).test(name);
}

/**
 * Every script that can run while the artifact is packed or installed (#212): the lifecycle scripts, the `pre` and
 * `post` hook of every script kept (npm runs them around `npm run <name>`), and every script a kept script names as
 * a word of its command (`npm run build:package`, `run-s build:*`). Naming is over-approximated on purpose: a word
 * that happens to equal a script name keeps that script, which can only move the digest more often.
 */
export function packedScriptNames(scripts: Record<string, string>): string[] {
  const kept = new Set<string>();
  const queue: string[] = LIFECYCLE_SCRIPTS.filter(name => name in scripts);
  while (queue.length) {
    const name = queue.shift()!;
    if (kept.has(name)) continue;
    kept.add(name);
    const reached = words(scripts[name]);
    for (const other of Object.keys(scripts)) {
      if (kept.has(other)) continue;
      if (other === `pre${name}` || other === `post${name}` || reached.some(word => names(word, other))) queue.push(other);
    }
  }
  return [...kept].sort();
}

/** The files in `sdk/` that the given scripts name as words of their commands, as sorted `sdk/`-relative paths. */
export function scriptFiles(scripts: Record<string, string>, kept: readonly string[]): string[] {
  const files = new Set<string>();
  for (const name of kept) {
    for (const word of words(scripts[name])) {
      const path = resolve(sdk, word.replace(/^--?[\w-]+=/, ''));
      const inside = relative(sdk, path);
      if (inside.startsWith('..') || isAbsolute(inside) || !existsSync(path) || !statSync(path).isFile()) continue;
      files.add(toPosix(inside));
    }
  }
  return [...files].sort();
}

/** Sorts object keys at every depth, so the same value always serializes to the same text. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted((value as Record<string, unknown>)[key])]));
  }
  return value;
}

export interface PackedInputs {
  manifest: Record<string, unknown>;
  lock: { packages: Record<string, Record<string, unknown>> };
  compilerOptions: Record<string, unknown>;
  compilerVersion: string;
  /** The bytes of each file a kept script names, by `sdk/`-relative path. */
  scriptFiles: Record<string, string>;
}

/** The inputs beside the source, read from `sdk/`. */
export function packedInputs(): PackedInputs {
  const read = (name: string) => JSON.parse(readFileSync(resolve(sdk, name), 'utf8'));
  const manifest = read('package.json');
  const scripts = (manifest.scripts ?? {}) as Record<string, string>;
  const files = scriptFiles(scripts, packedScriptNames(scripts));
  return {
    manifest, lock: read('package-lock.json'), compilerOptions: { ...buildConfig().options }, compilerVersion: ts.version,
    scriptFiles: Object.fromEntries(files.map(path => [path, readFileSync(resolve(sdk, path), 'utf8').replace(/\r\n/g, '\n')])),
  };
}

/**
 * The lock entries a consumer installs for the runtime dependencies: each one and, transitively, each package it
 * needs, resolved as Node resolves it (the nearest `node_modules/<name>` from the dependent's own folder outward).
 */
function runtimePackages(manifest: Record<string, unknown>, lock: PackedInputs['lock']): Array<{ path: string; version: unknown; integrity: unknown }> {
  const found = new Map<string, Record<string, unknown>>();
  const visit = (from: string, name: string) => {
    let base = from;
    for (;;) {
      const path = `${base ? `${base}/` : ''}node_modules/${name}`;
      const entry = lock.packages[path];
      if (entry) {
        if (found.has(path)) return;
        found.set(path, entry);
        const needs = { ...(entry.dependencies as Record<string, string> ?? {}), ...(entry.optionalDependencies as Record<string, string> ?? {}), ...(entry.peerDependencies as Record<string, string> ?? {}) };
        for (const next of Object.keys(needs)) visit(path, next);
        return;
      }
      if (!base) { found.set(path, {}); return; }
      const cut = base.lastIndexOf('/node_modules/');
      base = cut < 0 ? '' : base.slice(0, cut);
    }
  };
  for (const name of Object.keys((manifest.dependencies ?? {}) as Record<string, string>)) visit('', name);
  return [...found.keys()].sort().map(path => ({ path, version: found.get(path)!.version ?? null, integrity: found.get(path)!.integrity ?? null }));
}

/** The inputs beside the source, as one canonical JSON text: what the digest hashes after the source files. */
export function packedInputsText(inputs: PackedInputs = packedInputs()): string {
  const { version: _version, devDependencies: _dev, scripts = {}, ...manifest } = inputs.manifest as Record<string, unknown> & { scripts?: Record<string, string> };
  const packedScripts = Object.fromEntries(packedScriptNames(scripts).map(name => [name, scripts[name]]));
  const dependencies = runtimePackages(manifest, inputs.lock);
  // Absolute paths differ between machines, at any depth (`typeRoots`, `rootDirs`, `paths`); the build's own config
  // path names no option.
  const { configFilePath: _config, ...options } = inputs.compilerOptions;
  const portable = (value: unknown): unknown =>
    typeof value === 'string' ? (isAbsolute(value) ? toPosix(relative(sdk, value)) : value)
      : Array.isArray(value) ? value.map(portable)
        : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, portable(inner)]))
          : value;
  const compilerOptions = portable(options);
  return JSON.stringify(sorted({
    manifest: { ...manifest, scripts: packedScripts }, scriptFiles: inputs.scriptFiles, dependencies,
    compiler: { version: inputs.compilerVersion, options: compilerOptions },
  }));
}

/**
 * SHA-256, lowercase hex, over each reached source file's path and bytes (line endings normalised to LF), then over
 * the canonical text of the other packed inputs.
 */
export function packedSourceDigest(files = packedSourceFiles(), inputs: PackedInputs = packedInputs()): string {
  const hash = createHash('sha256');
  for (const path of files) {
    const text = readFileSync(resolve(sdk, path), 'utf8').replace(/\r\n/g, '\n');
    hash.update(`${path}\0${Buffer.byteLength(text)}\0`).update(text);
  }
  const text = packedInputsText(inputs);
  hash.update(`inputs\0${Buffer.byteLength(text)}\0`).update(text);
  return hash.digest('hex');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(packedSourceDigest());
