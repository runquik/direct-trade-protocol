import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const data = (s: string) => `data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;
const expected = {
  'mcp-server': '0e5a076a855fbd40d39bd00eec76233aad457fa1971ec7ceb387377565c88b54',
  'remote-mcp-server': '81600a844a3e9e2330865548cf9c38d962c2f5768cc84bed0b77e4414398e646',
};

for (const [archive, originalHash] of Object.entries(expected)) {
  test(`independent archive review: ${archive} compiled entry refuses before imported adapter code evaluates`, () => {
    let source = read(`${archive}/src/index.ts`);
    const parsed = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
    const imports = parsed.statements.filter(ts.isImportDeclaration);
    // Substitute every static dependency with a valid module exporting its required
    // bindings and throwing a canary on evaluation. Never load actual legacy code.
    for (const node of [...imports].reverse()) {
      const spec = (node.moduleSpecifier as ts.StringLiteral).text;
      let replacement: string;
      if (spec === './archive-disabled.js') {
        replacement = ts.transpileModule(read(`${archive}/src/archive-disabled.ts`), {
          compilerOptions: { module: ts.ModuleKind.ESNext },
        }).outputText;
      } else {
        const bindings = node.importClause?.namedBindings;
        assert.ok(bindings && ts.isNamedImports(bindings), 'review fixture must handle every dependency binding');
        replacement = bindings.elements.map(e => `export const ${(e.propertyName ?? e.name).text}=null;`).join('\n')
          + '\nthrow new Error("ADAPTER_EVALUATED_BEFORE_GUARD");';
      }
      source = source.slice(0, node.moduleSpecifier.getStart(parsed)) + JSON.stringify(data(replacement)) + source.slice(node.moduleSpecifier.end);
    }
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', compiled], {
      encoding: 'utf8', timeout: 5_000,
      env: { SystemRoot: process.env.SystemRoot ?? '', TRANSPORT: 'streamable-http', DTP_ENABLE_UNSUPPORTED_V01_ARCHIVE: '1' },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DTP_ARCHIVE_REFERENCE_ONLY/);
    assert.doesNotMatch(result.stderr, /ADAPTER_EVALUATED_BEFORE_GUARD|SyntaxError|ERR_MODULE_NOT_FOUND/);
    assert.equal(result.stdout, '');
  });

  test(`independent archive review: ${archive} preserves historical entry except the explicit guard`, () => {
    const source = read(`${archive}/src/index.ts`).replace(/\r\n/g, '\n');
    assert.equal(source.split('import "./archive-disabled.js";\n').length, 2);
    const original = source.replace('import "./archive-disabled.js";\n', '');
    assert.equal(createHash('sha256').update(original).digest('hex'), originalHash);
  });

  test(`independent archive review: ${archive} has no alternate package entry or lifecycle execution`, () => {
    const pkg = JSON.parse(read(`${archive}/package.json`));
    for (const field of ['bin', 'exports', 'module', 'browser']) assert.equal(pkg[field], undefined, field);
    assert.equal(pkg.private, true);
    assert.ok(Object.keys(pkg.scripts).length >= 4);
    for (const [name, script] of Object.entries(pkg.scripts)) assert.equal(script, 'node archive-disabled.cjs', name);
    const result = spawnSync(process.execPath, ['.'], {
      cwd: join(root, archive), encoding: 'utf8', timeout: 5_000,
      env: { SystemRoot: process.env.SystemRoot ?? '', TRANSPORT: 'streamable-http' },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DTP_ARCHIVE_REFERENCE_ONLY/);
  });
}
