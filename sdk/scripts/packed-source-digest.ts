// The digest of the source that the packed entries are built from (#181). `tsconfig.build.json` names the entries;
// the TypeScript program lists every file they reach, which is exactly what `npm pack` compiles into `dist/`.
// Source no packed entry reaches (the reference host, scripts, tests) is not covered: it needs no version bump.
// Run `node scripts/packed-source-digest.ts` from `sdk/` to print the digest a changelog entry records.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const sdk = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every source file a packed entry reaches, as `src/…` paths, sorted. */
export function packedSourceFiles(): string[] {
  const config = ts.getParsedCommandLineOfConfigFile(resolve(sdk, 'tsconfig.build.json'), {}, {
    ...ts.sys, onUnRecoverableConfigFileDiagnostic: d => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n')); },
  });
  if (!config) throw new Error('tsconfig.build.json did not parse');
  const program = ts.createProgram(config.fileNames, { ...config.options, noEmit: true });
  return program.getSourceFiles()
    .map(file => relative(sdk, file.fileName).split(sep).join('/'))
    .filter(path => path.startsWith('src/'))
    .sort();
}

/** SHA-256 over each reached file's path and bytes (line endings normalised to LF), lowercase hex. */
export function packedSourceDigest(files = packedSourceFiles()): string {
  const hash = createHash('sha256');
  for (const path of files) {
    const text = readFileSync(resolve(sdk, path), 'utf8').replace(/\r\n/g, '\n');
    hash.update(`${path}\0${Buffer.byteLength(text)}\0`).update(text);
  }
  return hash.digest('hex');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(packedSourceDigest());
