/**
 * OAuth 2.1 provider for DTP MCP server.
 *
 * Auto-approve flow: every Claude.ai/Cowork user automatically gets
 * a session. No login page — this is testnet, no real credentials to protect.
 * The OAuth flow exists because Claude.ai requires it for remote MCP plugins.
 */

import { randomUUID } from "crypto";
import { Response } from "express";
import { eq } from "drizzle-orm";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { OAuthClientInformationFull, OAuthTokens, OAuthTokenRevocationRequest } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidRequestError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { getDb } from "../db/client.js";
import { oauthClients, oauthTokens, users } from "../db/schema.js";

// ── Clients Store (PostgreSQL-backed) ──────────────────────────────────

class DtpClientsStore implements OAuthRegisteredClientsStore {
  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const db = getDb();
    const [row] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).limit(1);
    if (!row) return undefined;
    return JSON.parse(row.clientInfo) as OAuthClientInformationFull;
  }

  async registerClient(clientMetadata: OAuthClientInformationFull): Promise<OAuthClientInformationFull> {
    const db = getDb();
    await db.insert(oauthClients).values({
      clientId: clientMetadata.client_id,
      clientInfo: JSON.stringify(clientMetadata),
    }).onConflictDoUpdate({
      target: oauthClients.clientId,
      set: { clientInfo: JSON.stringify(clientMetadata) },
    });
    return clientMetadata;
  }
}

// ── Auth codes (in-memory, short-lived) ─────────────────────────────────

interface AuthCodeData {
  client: OAuthClientInformationFull;
  params: AuthorizationParams;
  userId: string; // auto-generated user ID
}

const authCodes = new Map<string, AuthCodeData>();

// ── OAuth Provider ──────────────────────────────────────────────────────

export class DtpOAuthProvider implements OAuthServerProvider {
  clientsStore = new DtpClientsStore();

  /**
   * Auto-approve: generate auth code immediately and redirect back.
   * No login page — every user gets a fresh identity.
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response
  ): Promise<void> {
    if (!client.redirect_uris.includes(params.redirectUri)) {
      throw new InvalidRequestError("Unregistered redirect_uri");
    }

    const code = randomUUID();
    const userId = randomUUID(); // Auto-generated user identity

    authCodes.set(code, { client, params, userId });

    // Auto-expire codes after 10 minutes
    setTimeout(() => authCodes.delete(code), 10 * 60 * 1000);

    const targetUrl = new URL(params.redirectUri);
    const searchParams = new URLSearchParams({ code });
    if (params.state) {
      searchParams.set("state", params.state);
    }
    targetUrl.search = searchParams.toString();

    res.redirect(targetUrl.toString());
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    const codeData = authCodes.get(authorizationCode);
    if (!codeData) throw new Error("Invalid authorization code");
    return codeData.params.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    _redirectUri?: string,
    _resource?: URL
  ): Promise<OAuthTokens> {
    const codeData = authCodes.get(authorizationCode);
    if (!codeData) throw new Error("Invalid authorization code");
    if (codeData.client.client_id !== client.client_id) {
      throw new Error("Authorization code was not issued to this client");
    }

    authCodes.delete(authorizationCode);

    const db = getDb();

    // Create or find user
    const oauthSub = codeData.userId;
    const [existing] = await db.select().from(users).where(eq(users.oauthSub, oauthSub)).limit(1);
    if (!existing) {
      await db.insert(users).values({ oauthSub });
    }

    // Issue token
    const accessToken = randomUUID();
    const refreshToken = randomUUID();
    const expiresIn = 86400; // 24 hours
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    await db.insert(oauthTokens).values({
      token: accessToken,
      userId: existing?.id || (await db.select().from(users).where(eq(users.oauthSub, oauthSub)).limit(1))[0]!.id,
      clientId: client.client_id,
      scopes: (codeData.params.scopes || []).join(" "),
      expiresAt,
    });

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: expiresIn,
      refresh_token: refreshToken,
      scope: (codeData.params.scopes || []).join(" "),
    };
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    _refreshToken: string,
    scopes?: string[],
    _resource?: URL
  ): Promise<OAuthTokens> {
    // Issue a fresh token (simple refresh for testnet)
    const accessToken = randomUUID();
    const expiresIn = 86400;

    // Find any user for this client (simplified for testnet)
    const db = getDb();
    const [anyToken] = await db.select().from(oauthTokens).where(eq(oauthTokens.clientId, client.client_id)).limit(1);

    if (anyToken) {
      await db.insert(oauthTokens).values({
        token: accessToken,
        userId: anyToken.userId,
        clientId: client.client_id,
        scopes: (scopes || []).join(" "),
        expiresAt: new Date(Date.now() + expiresIn * 1000),
      });
    }

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: expiresIn,
      scope: (scopes || []).join(" "),
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const db = getDb();
    const [row] = await db.select().from(oauthTokens).where(eq(oauthTokens.token, token)).limit(1);
    if (!row) throw new Error("Invalid token");
    if (row.expiresAt && row.expiresAt < new Date()) throw new Error("Token expired");

    // Get the user's OAuth sub
    const [user] = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);

    return {
      token,
      clientId: row.clientId,
      scopes: row.scopes ? row.scopes.split(" ") : [],
      expiresAt: row.expiresAt ? Math.floor(row.expiresAt.getTime() / 1000) : undefined,
      extra: {
        userId: row.userId,
        oauthSub: user?.oauthSub,
      },
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest
  ): Promise<void> {
    const db = getDb();
    await db.delete(oauthTokens).where(eq(oauthTokens.token, request.token));
  }
}
