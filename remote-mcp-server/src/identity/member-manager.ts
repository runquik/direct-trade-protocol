/**
 * Organization member management — invites, join, remove.
 */

import { randomBytes } from "crypto";
import { eq, and } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { users, memberships, inviteCodes, organizations } from "../db/schema.js";

function generateInviteCode(): string {
  return randomBytes(4).toString("hex").toUpperCase(); // 8-char code
}

export async function createInvite(orgId: string, creatorUserId: string): Promise<string> {
  const db = getDb();
  const code = generateInviteCode();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await db.insert(inviteCodes).values({
    orgId,
    code,
    createdBy: creatorUserId,
    expiresAt,
  });

  return code;
}

export async function joinOrg(oauthSub: string, code: string): Promise<{ orgId: string; orgName: string }> {
  const db = getDb();

  // Find invite
  const [invite] = await db.select().from(inviteCodes)
    .where(and(eq(inviteCodes.code, code), eq(inviteCodes.usedBy, null as any)))
    .limit(1);

  if (!invite) {
    throw new Error("Invalid or already-used invite code.");
  }
  if (invite.expiresAt < new Date()) {
    throw new Error("This invite code has expired. Ask your org admin for a new one.");
  }

  // Get or create user
  let [user] = await db.select().from(users).where(eq(users.oauthSub, oauthSub)).limit(1);
  if (!user) {
    const [newUser] = await db.insert(users).values({ oauthSub }).returning();
    user = newUser!;
  }

  // Check not already in an org
  const [existing] = await db.select().from(memberships).where(eq(memberships.userId, user.id)).limit(1);
  if (existing) {
    throw new Error("You already belong to an organization.");
  }

  // Join
  await db.insert(memberships).values({
    userId: user.id,
    orgId: invite.orgId,
    role: "member",
  });

  // Mark invite used
  await db.update(inviteCodes).set({ usedBy: user.id }).where(eq(inviteCodes.id, invite.id));

  // Get org name
  const [org] = await db.select().from(organizations).where(eq(organizations.id, invite.orgId)).limit(1);

  return { orgId: invite.orgId, orgName: org?.name || "Unknown" };
}

export async function removeMember(orgId: string, userEmail: string): Promise<void> {
  const db = getDb();

  const [user] = await db.select().from(users).where(eq(users.email, userEmail)).limit(1);
  if (!user) throw new Error(`No user found with email ${userEmail}`);

  const [membership] = await db.select().from(memberships)
    .where(and(eq(memberships.userId, user.id), eq(memberships.orgId, orgId)))
    .limit(1);
  if (!membership) throw new Error("User is not a member of this organization.");
  if (membership.role === "admin") throw new Error("Cannot remove an admin. Transfer admin role first.");

  await db.delete(memberships).where(eq(memberships.id, membership.id));
}

export async function getOrgMembers(orgId: string) {
  const db = getDb();
  const rows = await db.select({
    userId: users.id,
    email: users.email,
    displayName: users.displayName,
    role: memberships.role,
    joinedAt: memberships.createdAt,
  })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.orgId, orgId));

  return rows;
}
