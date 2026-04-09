/**
 * Trade limit enforcement — per-trade and daily caps.
 */

import { eq, and, gte } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { tradeActivity } from "../db/schema.js";

export async function checkTradeLimit(
  orgId: string,
  amountCents: number,
  perTradeLimitCents: number | null,
  dailyLimitCents: number | null
): Promise<{ allowed: boolean; reason?: string }> {
  // Per-trade check
  if (perTradeLimitCents !== null && amountCents > perTradeLimitCents) {
    return {
      allowed: false,
      reason: `Trade amount $${(amountCents / 100).toFixed(2)} exceeds per-trade limit of $${(perTradeLimitCents / 100).toFixed(2)}`,
    };
  }

  // Daily limit check
  if (dailyLimitCents !== null) {
    const db = getDb();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const rows = await db.select()
      .from(tradeActivity)
      .where(and(
        eq(tradeActivity.orgId, orgId),
        gte(tradeActivity.createdAt, todayStart)
      ));

    const todayTotal = rows.reduce((sum, r) => sum + r.amountCents, 0);

    if (todayTotal + amountCents > dailyLimitCents) {
      return {
        allowed: false,
        reason: `Daily trade limit reached. Today: $${(todayTotal / 100).toFixed(2)} + this trade $${(amountCents / 100).toFixed(2)} exceeds limit of $${(dailyLimitCents / 100).toFixed(2)}`,
      };
    }
  }

  return { allowed: true };
}

export async function recordTradeActivity(
  orgId: string,
  userId: string,
  action: string,
  amountCents: number,
  nearTxHash?: string
): Promise<void> {
  const db = getDb();
  await db.insert(tradeActivity).values({
    orgId,
    userId,
    action,
    amountCents,
    nearTxHash: nearTxHash || null,
  });
}
