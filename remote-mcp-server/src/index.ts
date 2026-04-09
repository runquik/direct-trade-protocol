#!/usr/bin/env node
/**
 * DTP Remote MCP Server — Dual entry point.
 *
 * TRANSPORT=streamable-http → Express HTTP server for Railway/Claude.ai
 * TRANSPORT=stdio (default) → Stdio for Claude Code local dev
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerOrgTools } from "./tools/org.js";
import { registerPartyTools } from "./tools/party.js";
import { registerListingTools } from "./tools/listing.js";
import { registerIntentTools } from "./tools/intent.js";
import { registerMatchingTools } from "./tools/matching.js";
import { registerOfferTools } from "./tools/offer.js";
import { registerContractTools } from "./tools/contract.js";
import { registerFulfillmentTools } from "./tools/fulfillment.js";
import { registerSettlementTools } from "./tools/settlement.js";
import { registerFreightTools } from "./tools/freight.js";
import { registerKybTools } from "./tools/kyb.js";

function createServer(): McpServer {
  const server = new McpServer({
    name: "DTP Protocol",
    version: "0.2.0",
  });

  // Organization management
  registerOrgTools(server);

  // Trade flow
  registerPartyTools(server);
  registerListingTools(server);
  registerIntentTools(server);
  registerMatchingTools(server);
  registerOfferTools(server);
  registerContractTools(server);
  registerFulfillmentTools(server);
  registerSettlementTools(server);

  // Freight
  registerFreightTools(server);

  // KYB
  registerKybTools(server);

  return server;
}

async function main() {
  const transport = process.env.TRANSPORT || "stdio";

  if (transport === "streamable-http") {
    // HTTP mode — Railway / Claude.ai
    const { startHttpServer } = await import("./transport/http.js");
    const port = parseInt(process.env.PORT || "3000");
    await startHttpServer(createServer, port);
  } else {
    // Stdio mode — Claude Code local dev
    const server = createServer();
    const stdioTransport = new StdioServerTransport();
    await server.connect(stdioTransport);
  }
}

main().catch((err) => {
  console.error("DTP MCP Server failed to start:", err);
  process.exit(1);
});
