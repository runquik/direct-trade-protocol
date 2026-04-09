/**
 * Email notification service for DTP trade events.
 *
 * Sends notifications when key trade events occur:
 * - Match found (new listing matches an org's intent)
 * - Offer received
 * - Contract formed (offer accepted)
 * - Delivery attested by seller
 * - Settlement complete
 *
 * For MVP, logs notifications to console. SMTP integration can be added
 * by setting the SMTP_URL environment variable.
 */

export type TradeEvent =
  | "match_found"
  | "offer_received"
  | "contract_formed"
  | "delivery_attested"
  | "settlement_complete";

interface Notification {
  event: TradeEvent;
  recipientEmail?: string;
  recipientOrg: string;
  subject: string;
  body: string;
}

export async function sendNotification(notification: Notification): Promise<void> {
  const smtpUrl = process.env.SMTP_URL;

  if (smtpUrl) {
    // TODO: Implement SMTP sending via nodemailer or similar
    // For now, fall through to console logging
  }

  // Console logging for MVP
  console.log(`[NOTIFICATION] ${notification.event}`);
  console.log(`  To: ${notification.recipientEmail || notification.recipientOrg}`);
  console.log(`  Subject: ${notification.subject}`);
  console.log(`  ${notification.body}`);
}

// Convenience functions for common trade events

export async function notifyMatchFound(params: {
  buyerOrg: string;
  sellerOrg: string;
  intentId: string;
  listingId: string;
  score: number;
}): Promise<void> {
  await sendNotification({
    event: "match_found",
    recipientOrg: params.buyerOrg,
    subject: `DTP: Match found for your intent ${params.intentId}`,
    body: `Listing ${params.listingId} matches your intent with score ${params.score}/10000. Review and submit an offer through Claude.`,
  });
}

export async function notifyOfferReceived(params: {
  recipientOrg: string;
  offerId: string;
  offerFrom: string;
  productName: string;
  totalPrice: string;
}): Promise<void> {
  await sendNotification({
    event: "offer_received",
    recipientOrg: params.recipientOrg,
    subject: `DTP: New offer received — ${params.productName}`,
    body: `${params.offerFrom} submitted offer ${params.offerId} for ${params.productName} at ${params.totalPrice}. Review and accept through Claude.`,
  });
}

export async function notifyContractFormed(params: {
  buyerOrg: string;
  sellerOrg: string;
  contractId: string;
  totalValue: string;
}): Promise<void> {
  for (const org of [params.buyerOrg, params.sellerOrg]) {
    await sendNotification({
      event: "contract_formed",
      recipientOrg: org,
      subject: `DTP: Contract ${params.contractId} formed`,
      body: `Trade contract ${params.contractId} is now active. Total value: ${params.totalValue}. Escrow is locked.`,
    });
  }
}

export async function notifyDeliveryAttested(params: {
  buyerOrg: string;
  contractId: string;
  fulfillmentId: string;
}): Promise<void> {
  await sendNotification({
    event: "delivery_attested",
    recipientOrg: params.buyerOrg,
    subject: `DTP: Delivery attested for contract ${params.contractId}`,
    body: `The seller has attested delivery (${params.fulfillmentId}). Please confirm receipt through Claude to trigger settlement.`,
  });
}

export async function notifySettlementComplete(params: {
  buyerOrg: string;
  sellerOrg: string;
  settlementId: string;
  netAmount: string;
}): Promise<void> {
  for (const org of [params.buyerOrg, params.sellerOrg]) {
    await sendNotification({
      event: "settlement_complete",
      recipientOrg: org,
      subject: `DTP: Settlement ${params.settlementId} complete`,
      body: `Trade settled. Net amount: ${params.netAmount}. Escrow released.`,
    });
  }
}
