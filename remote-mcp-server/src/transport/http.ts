/**
 * Streamable HTTP transport with OAuth for Claude.ai / Cowork.
 */

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { randomUUID } from "crypto";
import { runMigrations } from "../db/client.js";
import { DtpOAuthProvider } from "../auth/oauth.js";

type ServerFactory = () => McpServer;

export async function startHttpServer(createServer: ServerFactory, port: number): Promise<void> {
  await runMigrations();

  const app = express();
  app.use(express.json());

  const publicUrl = process.env.PUBLIC_URL || `http://localhost:${port}`;
  const issuerUrl = new URL(publicUrl);
  const provider = new DtpOAuthProvider();

  // OAuth endpoints (/.well-known/*, /authorize, /token, /register)
  app.use(mcpAuthRouter({
    provider,
    issuerUrl,
    scopesSupported: ["mcp:tools"],
    serviceDocumentationUrl: new URL("https://github.com/runquik/direct-trade-protocol"),
  }));

  // Health check (unauthenticated)
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "dtp-mcp", version: "0.2.0" });
  });

  // Bearer auth middleware for MCP endpoint
  const authMiddleware = requireBearerAuth({ verifier: provider });

  // Session store
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer; lastAccess: number }>();

  // MCP endpoint — protected by OAuth
  app.all("/mcp", authMiddleware, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      session.lastAccess = Date.now();
      await session.transport.handleRequest(req, res);
      return;
    }

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

    // New session
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    const server = createServer();

    transport.onclose = () => {
      const sid = (transport as any).sessionId;
      if (sid) sessions.delete(sid);
    };

    await server.connect(transport);
    await transport.handleRequest(req, res);

    const newSessionId = (transport as any).sessionId;
    if (newSessionId) {
      sessions.set(newSessionId, { transport, server, lastAccess: Date.now() });
    }
  });

  // Session cleanup every 30 minutes — expire after 2 hours idle
  setInterval(() => {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const [id, session] of sessions) {
      if (session.lastAccess < cutoff) {
        sessions.delete(id);
      }
    }
  }, 30 * 60 * 1000);

  app.listen(port, () => {
    console.log(`DTP MCP Server running on port ${port}`);
    console.log(`  Health:    ${publicUrl}/health`);
    console.log(`  MCP:       ${publicUrl}/mcp`);
    console.log(`  OAuth:     ${publicUrl}/.well-known/oauth-authorization-server`);
    console.log(`  Mode:      streamable-http + OAuth 2.1`);
  });
}
