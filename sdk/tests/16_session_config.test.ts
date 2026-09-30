// Session configuration: opening this repository must not start a frozen v0.1 MCP server (#36),
// and the legacy marketplace plugin must keep its own, self-contained MCP declaration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const archive = /(?:^|[\/'"\s])(?:remote-mcp-server|mcp-server)(?:[\/'"\s]|$)/;

test('project MCP configuration does not start a frozen v0.1 MCP server', () => {
  const path = join(root, '.mcp.json');
  if (!existsSync(path)) return;
  const servers = JSON.parse(readFileSync(path, 'utf8')).mcpServers ?? {};
  for (const [name, server] of Object.entries(servers)) {
    assert.doesNotMatch(JSON.stringify(server), archive, `.mcp.json server "${name}"`);
  }
});

test('legacy plugin declares its MCP servers inside its own directory', () => {
  const dir = join(root, 'plugins/dtp');
  const manifest = JSON.parse(readFileSync(join(dir, '.claude-plugin/plugin.json'), 'utf8'));
  assert.equal(manifest.mcpServers, './.mcp.json');
  const servers = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8')).mcpServers;
  assert.ok(Object.keys(servers).length > 0);
  for (const [name, server] of Object.entries(servers)) {
    assert.doesNotMatch(JSON.stringify(server), archive, `plugin server "${name}"`);
    assert.doesNotMatch(JSON.stringify(server), /\.\.\//, `plugin server "${name}" must not reach outside the plugin`);
  }
});
