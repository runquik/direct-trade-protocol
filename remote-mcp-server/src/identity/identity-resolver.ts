/**
 * Identity resolver — the core abstraction replacing account-manager.ts.
 *
 * In remote mode: OAuth token → user → org membership → NEAR account
 * In stdio mode: falls back to env var or hardcoded test identity
 */

import { eq, and } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { users, memberships, organizations } from "../db/schema.js";
import { addKey, hasKey } from "../near/client.js";

export interface ResolvedIdentity {
  userId: string;
  orgId: string;
  orgName: string;
  nearAccount: string;
  role: "admin" | "member";
  perTradeLimitCents: number | null;
  dailyLimitCents: number | null;
}

// Request-scoped identity (set by transport middleware)
const identityStore = new Map<string, ResolvedIdentity>();

export function setRequestIdentity(requestId: string, identity: ResolvedIdentity): void {
  identityStore.set(requestId, identity);
}

export function clearRequestIdentity(requestId: string): void {
  identityStore.delete(requestId);
}

// For the tool handler context — uses AsyncLocalStorage-style lookup
let currentRequestId: string | null = null;

export function setCurrentRequestId(requestId: string): void {
  currentRequestId = requestId;
}

export function getCurrentIdentity(): string {
  if (!currentRequestId) {
    // Stdio fallback
    return process.env.DTP_DEFAULT_ACCOUNT || "";
  }
  const identity = identityStore.get(currentRequestId);
  if (!identity) {
    throw new Error("No organization found. Use dtp_create_org to create one or dtp_join_org to join an existing one.");
  }
  return identity.nearAccount;
}

export function getContractId(): string {
  return process.env.DTP_CONTRACT_ID || "dtp.direct-trade-protocol.testnet";
}

export function getCurrentRole(): "admin" | "member" {
  if (!currentRequestId) return "admin";
  const identity = identityStore.get(currentRequestId);
  if (!identity) throw new Error("No identity resolved");
  return identity.role;
}

export function requireAdmin(): void {
  if (getCurrentRole() !== "admin") {
    throw new Error("This action requires org admin privileges.");
  }
}

export function getResolvedIdentity(): ResolvedIdentity | null {
  if (!currentRequestId) return null;
  return identityStore.get(currentRequestId) || null;
}

/**
 * Resolve a user's identity from their OAuth subject claim.
 * Returns null if user has no org membership.
 */
export async function resolveIdentityFromOAuthSub(oauthSub: string): Promise<ResolvedIdentity | null> {
  const db = getDb();

  // Find user
  const [user] = await db.select().from(users).where(eq(users.oauthSub, oauthSub)).limit(1);
  if (!user) return null;

  // Find their org membership (take first org for MVP — multi-org in v2)
  const [membership] = await db
    .select()
    .from(memberships)
    .where(eq(memberships.userId, user.id))
    .limit(1);
  if (!membership) return null;

  // Get org
  const [org] = await db.select().from(organizations).where(eq(organizations.id, membership.orgId)).limit(1);
  if (!org) return null;

  // Ensure the org's NEAR key is loaded into the keystore
  if (!(await hasKey(org.nearAccount))) {
    await addKey(org.nearAccount, org.nearPrivateKey);
  }

  return {
    userId: user.id,
    orgId: org.id,
    orgName: org.name,
    nearAccount: org.nearAccount,
    role: membership.role as "admin" | "member",
    perTradeLimitCents: org.perTradeLimitCents,
    dailyLimitCents: org.dailyLimitCents,
  };
}
