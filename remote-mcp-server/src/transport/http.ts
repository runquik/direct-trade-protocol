/**
 * Streamable HTTP transport for Claude.ai / Cowork remote MCP.
 * Express server with session management and OAuth middleware.
 */

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "crypto";
import { runMigrations } from "../db/client.js";

type ServerFactory = () => McpServer;

export async function startHttpServer(createServer: ServerFactory, port: number): Promise<void> {
  // Run DB migrations on startup
  await runMigrations();

  const app = express();
  app.use(express.json());

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "dtp-mcp", version: "0.2.0" });
  });

  // Session store for Streamable HTTP transports
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>();

  // MCP endpoint — handles all MCP JSON-RPC traffic
  app.all("/mcp", async (req, res) => {
    // Check for existing session
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      // Reuse existing session
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res);
      return;
    }

    // Handle DELETE for session cleanup
    if (req.method === "DELETE") {
      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        await session.transport.handleRequest(req, res);
        sessions.delete(sessionId);
      } else {
        res.status(404).json({ error: "Session not found" });
      }
      return;
    }

    // Create new session
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    const server = createServer();

    // Clean up on close
    transport.onclose = () => {
      const sid = (transport as any).sessionId;
      if (sid) sessions.delete(sid);
    };

    await server.connect(transport);

    // Store session after connection (sessionId is set during handleRequest)
    await transport.handleRequest(req, res);

    const newSessionId = (transport as any).sessionId;
    if (newSessionId) {
      sessions.set(newSessionId, { transport, server });
    }
  });

  // Session cleanup interval (every 30 minutes)
  setInterval(() => {
    // For now, just log session count. TTL eviction can be added later.
    if (sessions.size > 0) {
      console.log(`Active MCP sessions: ${sessions.size}`);
    }
  }, 30 * 60 * 1000);

  app.listen(port, () => {
    console.log(`DTP MCP Server running on port ${port}`);
    console.log(`  Health: http://localhost:${port}/health`);
    console.log(`  MCP:    http://localhost:${port}/mcp`);
    console.log(`  Mode:   streamable-http`);
  });
}
