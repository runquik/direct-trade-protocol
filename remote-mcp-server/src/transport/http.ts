/**
 * Streamable HTTP transport with OAuth for Claude.ai / Cowork.
 */

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";
import { runMigrations } from "../db/client.js";
import { DtpOAuthProvider } from "../auth/oauth.js";

type ServerFactory = () => McpServer;

export async function startHttpServer(createServer: ServerFactory, port: number): Promise<void> {
  await runMigrations();

  const app = express();

  // Railway runs behind a reverse proxy — trust it so express-rate-limit
  // (used by mcpAuthRouter) can read X-Forwarded-For correctly.
  app.set("trust proxy", 1);

  // CORS — required for Claude.ai frontend to connect
  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id");
    res.header("Access-Control-Expose-Headers", "Mcp-Session-Id");
    if (_req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Request/response logging
  app.use((req, res, next) => {
    const start = Date.now();
    const origEnd = res.end.bind(res);
    res.end = function (...args: any[]) {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - start}ms)`);
      return origEnd(...args);
    } as any;
    next();
  });

  app.use(express.json());

  const publicUrl = process.env.PUBLIC_URL || `http://localhost:${port}`;
  const issuerUrl = new URL(publicUrl);
  const mcpServerUrl = new URL("/mcp", publicUrl);
  const provider = new DtpOAuthProvider();

  // OAuth endpoints (/.well-known/*, /authorize, /token, /register)
  app.use(mcpAuthRouter({
    provider,
    issuerUrl,
    resourceServerUrl: mcpServerUrl,
    scopesSupported: ["mcp:tools"],
    serviceDocumentationUrl: new URL("https://github.com/runquik/direct-trade-protocol"),
  }));

  // Health check (unauthenticated)
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "dtp-mcp", version: "0.2.0" });
  });

  // Bearer auth middleware — includes resource_metadata URL in 401 WWW-Authenticate
  // so Claude.ai can discover the OAuth server via RFC 9728.
  const authMiddleware = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpServerUrl),
  });

  // Session store
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer; lastAccess: number }>();

  // MCP POST — handles initialize + subsequent JSON-RPC calls
  app.post("/mcp", authMiddleware, async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        session.lastAccess = Date.now();
        await session.transport.handleRequest(req, res, req.body);
        return;
      }

      // New session — must be an initialize request
      if (!sessionId && isInitializeRequest(req.body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            sessions.set(sid, { transport, server, lastAccess: Date.now() });
          },
        });

        const server = createServer();

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) sessions.delete(sid);
        };

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // Not an initialize request and no valid session
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session ID provided" },
        id: null,
      });
    } catch (err) {
      console.error(`[MCP ERROR] POST /mcp:`, err);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });

  // MCP GET — SSE stream for server-to-client notifications
  app.get("/mcp", authMiddleware, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: "Invalid or missing session ID" });
      return;
    }
    const session = sessions.get(sessionId)!;
    session.lastAccess = Date.now();
    await session.transport.handleRequest(req, res);
  });

  // MCP DELETE — session termination
  app.delete("/mcp", authMiddleware, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: "Invalid or missing session ID" });
      return;
    }
    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res);
    sessions.delete(sessionId);
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
