// The digest of everything the packed entries are built from (#181, #212). `tsconfig.build.json` names the entries;
// the TypeScript program lists every file they reach, which is exactly what `npm pack` compiles into `dist/`.
// Source no packed entry reaches (the reference host, scripts, tests) is not covered: it needs no version bump.
// Beside the source, the digest covers the other inputs that decide how the artifact behaves (#212):
//   - the packed `package.json`, except its `version`, its `devDependencies` and the scripts that neither build the
//     artifact nor run when a consumer installs it;
//   - the installed version and integrity of each runtime dependency, from the lock file;
//   - the compiler options `tsconfig.build.json` resolves to, and the installed compiler's version, which together
//     decide the JavaScript `dist/` contains.
// Run `node scripts/packed-source-digest.ts` from `sdk/` to print the digest a changelog entry records.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

/** The scripts that build the artifact (`prepack` runs `build:package`) or run in a consumer's install. */
export const PACKED_SCRIPTS = ['build:package', 'prepack', 'prepare', 'preinstall', 'install', 'postinstall'] as const;

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
}

/** The inputs beside the source, read from `sdk/`. */
export function packedInputs(): PackedInputs {
  const read = (name: string) => JSON.parse(readFileSync(resolve(sdk, name), 'utf8'));
  return { manifest: read('package.json'), lock: read('package-lock.json'), compilerOptions: { ...buildConfig().options }, compilerVersion: ts.version };
}

/** The inputs beside the source, as one canonical JSON text: what the digest hashes after the source files. */
export function packedInputsText(inputs: PackedInputs = packedInputs()): string {
  const { version: _version, devDependencies: _dev, scripts = {}, ...manifest } = inputs.manifest as Record<string, unknown> & { scripts?: Record<string, string> };
  const packedScripts = Object.fromEntries(PACKED_SCRIPTS.filter(name => name in scripts).map(name => [name, scripts[name]]));
  const dependencies = Object.keys((manifest.dependencies ?? {}) as Record<string, string>).sort().map(name => {
    const entry = inputs.lock.packages[`node_modules/${name}`] ?? {};
    return { name, version: entry.version ?? null, integrity: entry.integrity ?? null };
  });
  // Absolute paths differ between machines; the build's own config path names no option.
  const { configFilePath: _config, ...options } = inputs.compilerOptions;
  const compilerOptions = Object.fromEntries(Object.entries(options).map(([key, value]) =>
    [key, typeof value === 'string' && isAbsolute(value) ? toPosix(relative(sdk, value)) : value]));
  return JSON.stringify(sorted({ manifest: { ...manifest, scripts: packedScripts }, dependencies, compiler: { version: inputs.compilerVersion, options: compilerOptions } }));
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
