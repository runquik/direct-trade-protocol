/**
 * Organization lifecycle management.
 * Create org → NEAR sub-account → register Party on-chain → store in DB.
 */

import { createHash } from "crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { organizations, users, memberships } from "../db/schema.js";
import { createSubAccount, callMethod, addKey } from "../near/client.js";
import { getContractId } from "./identity-resolver.js";

const MASTER_ACCOUNT = () => process.env.DTP_MASTER_ACCOUNT || "direct-trade-protocol.testnet";

function generateNearAccountName(orgName: string): string {
  const hash = createHash("sha256").update(orgName + Date.now()).digest("hex").slice(0, 8);
  return `org-${hash}`;
}

export async function createOrganization(params: {
  name: string;
  businessType: string;
  jurisdiction: string;
  creatorOauthSub: string;
}): Promise<{ orgId: string; nearAccount: string }> {
  const db = getDb();

  // Get or create user
  let [user] = await db.select().from(users).where(eq(users.oauthSub, params.creatorOauthSub)).limit(1);
  if (!user) {
    const [newUser] = await db.insert(users).values({
      oauthSub: params.creatorOauthSub,
    }).returning();
    user = newUser!;
  }

  // Check if user already has an org
  const [existing] = await db.select().from(memberships).where(eq(memberships.userId, user.id)).limit(1);
  if (existing) {
    throw new Error("You already belong to an organization. Leave it first to create a new one.");
  }

  // Create NEAR sub-account
  const subName = generateNearAccountName(params.name);
  const nearAccountId = `${subName}.${MASTER_ACCOUNT()}`;

  // Ensure master key is loaded
  const masterKey = process.env.DTP_MASTER_PRIVATE_KEY;
  if (masterKey) {
    await addKey(MASTER_ACCOUNT(), masterKey);
  }

  const keys = await createSubAccount({
    parentAccountId: MASTER_ACCOUNT(),
    newAccountId: nearAccountId,
    initialBalanceNear: "1",
  });

  // Register Party on-chain
  await callMethod({
    contractId: getContractId(),
    methodName: "register_party",
    args: {
      business_name: params.name,
      business_type: params.businessType,
      jurisdiction: params.jurisdiction,
    },
    signerAccountId: nearAccountId,
  });

  // Store in DB
  const [org] = await db.insert(organizations).values({
    name: params.name,
    nearAccount: nearAccountId,
    nearPrivateKey: keys.privateKey, // TODO: encrypt with KEY_ENCRYPTION_KEY
    businessType: params.businessType,
    jurisdiction: params.jurisdiction,
  }).returning();

  // Make creator the admin
  await db.insert(memberships).values({
    userId: user.id,
    orgId: org!.id,
    role: "admin",
  });

  return { orgId: org!.id, nearAccount: nearAccountId };
}

export async function getOrganization(orgId: string) {
  const db = getDb();
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  return org || null;
}

export async function updateTradeLimits(orgId: string, perTradeCents: number | null, dailyCents: number | null) {
  const db = getDb();
  await db.update(organizations).set({
    perTradeLimitCents: perTradeCents,
    dailyLimitCents: dailyCents,
    updatedAt: new Date(),
  }).where(eq(organizations.id, orgId));
}
