/**
 * Maps NEAR contract panic messages to user-friendly error strings.
 */

const ERROR_MAP: Record<string, string> = {
  "Party not registered": "This account isn't registered as a DTP party yet. Use dtp_register_party first.",
  "Party already registered": "This account is already registered. Use dtp_get_party to see details.",
  "Intent not found": "No trade intent found with that ID.",
  "Listing not found": "No supply listing found with that ID.",
  "Offer not found": "No offer found with that ID.",
  "Contract not found": "No trade contract found with that ID.",
  "Fulfillment not found": "No fulfillment record found with that ID.",
  "Only buyer can cancel": "Switch to the buyer's identity to cancel this intent (use dtp_switch_identity).",
  "Only seller can withdraw": "Switch to the seller's identity to withdraw this listing.",
  "Only offerer can retract": "Switch to the offerer's identity to retract this offer.",
  "Only buyer can accept offer on their intent": "Switch to the buyer's identity to accept this offer.",
  "Only seller can accept offer on their listing": "Switch to the seller's identity to accept this offer.",
  "Only seller can attest delivery": "Switch to the seller's identity to attest delivery.",
  "Only buyer can attest receipt": "Switch to the buyer's identity to confirm receipt.",
  "Only buyer can initiate dispute": "Switch to the buyer's identity to initiate a dispute.",
  "Intent not in Posted state": "This intent is no longer in Posted state and cannot be cancelled.",
  "Intent not open for offers": "This intent is not open for offers.",
  "Listing not active": "This listing is not in Active state.",
  "Offer not available for acceptance": "This offer has already been accepted, rejected, or retracted.",
  "Offer not retractable": "This offer is no longer in a retractable state.",
  "Contract not in deliverable state": "This contract is not ready for delivery attestation.",
  "Fulfillment already exists for this contract": "Delivery has already been attested for this contract.",
  "Awaiting seller attestation first": "The seller must attest delivery before the buyer can confirm receipt.",
  "landed cost exceeds buyer ceiling": "The total cost (goods + freight) exceeds the buyer's maximum price ceiling.",
  "PACA-covered trades must have net_days <= 30": "PACA-covered produce trades must settle within 30 days.",
  "net_days must be <= 60 in v1": "Payment terms cannot exceed 60 days in DTP v1.",
  "GS1 GLN must be exactly 13 digits": "GS1 GLN must be exactly 13 digits.",
  "D-U-N-S number must be exactly 9 digits": "D-U-N-S number must be exactly 9 digits.",
  "Lot not found": "No goods lot found with that ID.",
  "Insufficient lot quantity available": "Not enough quantity available in this lot.",
  "Catalog entry not found": "No catalog entry found with that ID.",
  "Dispute window has closed": "The dispute window has passed. Auto-settlement is now available.",
  "Dispute window has not elapsed yet": "The dispute window hasn't passed yet — buyer can still attest or dispute.",
};

export function friendlyError(rawError: string): string {
  // NEAR RPC errors often wrap the panic message in various formats
  for (const [pattern, friendly] of Object.entries(ERROR_MAP)) {
    if (rawError.includes(pattern)) {
      return friendly;
    }
  }
  return rawError;
}

export function extractPanicMessage(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message;
    // near-api-js wraps panics in various ways
    const panicMatch = msg.match(/Smart contract panicked: (.+?)(?:,|$)/);
    if (panicMatch) return panicMatch[1]!;
    // ServerTransactionError format
    const execMatch = msg.match(/ExecutionError\("(.+?)"\)/);
    if (execMatch) return execMatch[1]!;
    return msg;
  }
  return String(error);
}

export function handleContractError(error: unknown): string {
  const raw = extractPanicMessage(error);
  return friendlyError(raw);
}
