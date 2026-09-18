import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const archives = ['mcp-server', 'remote-mcp-server'];
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const sha = (path: string) => createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
const cleanEnv = { SystemRoot: process.env.SystemRoot ?? '', DTP_ENABLE_UNSUPPORTED_V01_ARCHIVE: '1' };
function files(path: string): string[] {
  if (!existsSync(path)) return [];
  if (!lstatSync(path).isDirectory()) return [path];
  return readdirSync(path).filter(n => !['node_modules', '.git', 'dist'].includes(n)).flatMap(n => files(join(path, n)));
}

for (const archive of archives) {
  test(`${archive}: ordinary package entry and lifecycle commands refuse without dependencies`, () => {
    const pkg = JSON.parse(read(`${archive}/package.json`));
    assert.equal(pkg.private, true);
    assert.equal(pkg.main, 'archive-disabled.cjs');
    for (const command of ['build', 'dev', 'start', 'prepack', ...(archive === 'remote-mcp-server' ? ['db:migrate'] : [])]) {
      assert.equal(pkg.scripts[command], 'node archive-disabled.cjs', `${command} cannot revive historical execution`);
      const result = spawnSync(process.execPath, ['archive-disabled.cjs'], { cwd: join(root, archive), env: cleanEnv, timeout: 5_000, encoding: 'utf8' });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /DTP_ARCHIVE_REFERENCE_ONLY/);
      assert.equal(result.stdout, '');
      assert.doesNotMatch(result.stderr, /MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/);
    }
    const required = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(join(root, archive))})`], { env: cleanEnv, timeout: 5_000, encoding: 'utf8' });
    assert.equal(required.status, 1);
    assert.match(required.stderr, /DTP_ARCHIVE_REFERENCE_ONLY/);
  });

  test(`${archive}: freshly compiled entry guards before adapter imports and initialization`, () => {
    const source = ts.createSourceFile('index.ts', read(`${archive}/src/index.ts`), ts.ScriptTarget.Latest, true);
    const imports = source.statements.filter(ts.isImportDeclaration);
    assert.ok(imports.length > 1);
    assert.equal((imports[0].moduleSpecifier as ts.StringLiteral).text, './archive-disabled.js');
    const guard = read(`${archive}/src/archive-disabled.ts`);
    const output = ts.transpileModule(guard, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', output], { env: cleanEnv, timeout: 5_000, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DTP_ARCHIVE_REFERENCE_ONLY/);
    assert.doesNotMatch(guard, /process\.env|\bimport\b|\brequire\s*\(/);
  });

  test(`${archive}: historical dependency graph remains unchanged and agrees with manifest`, () => {
    const pkg = JSON.parse(read(`${archive}/package.json`));
    const lock = JSON.parse(read(`${archive}/package-lock.json`));
    assert.equal(pkg.name, lock.name); assert.equal(pkg.version, lock.version);
    assert.deepEqual(pkg.dependencies, lock.packages[''].dependencies);
    assert.deepEqual(pkg.devDependencies, lock.packages[''].devDependencies);
    // Normalize checkout line endings only; dependency contents are immutable here.
    const digest = createHash('sha256').update(read(`${archive}/package-lock.json`).replace(/\r\n/g, '\n')).digest('hex');
    const expected = archive === 'mcp-server' ? '496ca4b25a4bf3c02b9b61e3f291ce5dea9184046949efff24c7f1840a897319' : 'f4f941617eab946f73afbdfe8a66e4d8e7c4454cd247a41eda3bd2ea5f243831';
    assert.equal(digest, expected);
  });
}

test('automatic archive deployment is refused and exact historical recipes retained', () => {
  const docker = read('remote-mcp-server/Dockerfile');
  assert.match(docker, /DTP_ARCHIVE_REFERENCE_ONLY/);
  assert.equal(docker.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#')).length, 0, 'no automatic build stage can execute');
  assert.match(read('remote-mcp-server/railway.toml'), /startCommand = "node archive-disabled\.cjs"/);
  assert.equal(sha('remote-mcp-server/Dockerfile.reference'), 'a7a4cf97bd34e700728967978b3590a2f62c0b20091916ffae755661e12043d1');
  assert.equal(sha('remote-mcp-server/railway.toml.reference'), '7d81ebe34060020b05d6ed42721aa7ac008200f5fd9a6ebc03ab37dc8207dba5');
  assert.match(read('.gitattributes'), /remote-mcp-server\/Dockerfile\.reference -text/);
  assert.match(read('.gitattributes'), /remote-mcp-server\/railway\.toml\.reference -text/);
});

test('supported runtime source, package scripts and CI have no legacy-adapter execution dependency', () => {
  const forbidden = /(?:^|[\/'"\s])(?:remote-mcp-server|mcp-server)(?:[\/'"\s]|$)|\bdtp-(?:remote-)?mcp-server\b/;
  for (const scope of ['sdk/src', 'sdk/scripts', 'supabase/functions', 'modules']) {
    for (const file of files(join(root, scope)).filter(f => /\.(?:ts|tsx|js|mjs|cjs)$/.test(f))) {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
          if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) assert.doesNotMatch(node.moduleSpecifier.text, forbidden, relative(root, file));
        }
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
          for (const arg of node.arguments) if (ts.isStringLiteral(arg)) assert.doesNotMatch(arg.text, forbidden, relative(root, file));
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  const pkg = JSON.parse(read('sdk/package.json'));
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'scripts', 'files', 'exports']) assert.doesNotMatch(JSON.stringify(pkg[field] ?? {}), forbidden, field);
  for (const file of files(join(root, '.github/workflows'))) assert.doesNotMatch(readFileSync(file, 'utf8'), /(?:\.\.\/|\.\/|prefix\s+|working-directory:\s*)(?:remote-mcp-server|mcp-server)(?:\/|\s|$)/, relative(root, file));
});
