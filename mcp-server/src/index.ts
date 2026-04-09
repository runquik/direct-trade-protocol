#!/usr/bin/env node
/**
 * DTP MCP Tool Server — Entry Point
 *
 * Exposes the Direct Trade Protocol smart contract methods as MCP tools,
 * enabling headless B2B trade through Claude.
 *
 * Transport: stdio (spawned by Claude Code as a child process)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadAccounts, loadKeysIntoKeyStore } from "./account-manager.js";
import { registerAdminTools } from "./tools/admin.js";
import { registerPartyTools } from "./tools/party.js";
import { registerListingTools } from "./tools/listing.js";
import { registerIntentTools } from "./tools/intent.js";
import { registerMatchingTools } from "./tools/matching.js";
import { registerOfferTools } from "./tools/offer.js";
import { registerContractTools } from "./tools/contract.js";
import { registerFulfillmentTools } from "./tools/fulfillment.js";
import { registerSettlementTools } from "./tools/settlement.js";

async function main() {
  const server = new McpServer({
    name: "DTP Protocol",
    version: "0.1.0",
  });

  // Register all tool groups
  registerAdminTools(server);
  registerPartyTools(server);
  registerListingTools(server);
  registerIntentTools(server);
  registerMatchingTools(server);
  registerOfferTools(server);
  registerContractTools(server);
  registerFulfillmentTools(server);
  registerSettlementTools(server);

  // Load existing keys into the NEAR key store (if any)
  try {
    loadAccounts();
    await loadKeysIntoKeyStore();
  } catch {
    // First run — no accounts file yet, that's fine
  }

  // Start the server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("DTP MCP Server failed to start:", err);
  process.exit(1);
});
