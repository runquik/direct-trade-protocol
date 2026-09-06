// Local record invariants only. Referenced records, financial arithmetic and real
// delivery/payment verification remain module responsibilities (SPEC section 1).
import { canonicalize } from "../../../sdk/src/canonical.ts";
import type { Envelope } from "../../../sdk/src/envelope.ts";
import { StoreError } from "./errors.ts";

const equal = (a: unknown, b: unknown) => canonicalize(a ?? null) === canonicalize(b ?? null);
function reject(message: string): never { throw new StoreError("transition_forbidden", message); }

export function checkIntegrity(env: Envelope<Record<string, unknown>>, prev: Record<string, unknown> | null): void {
  const body = env.body;
  if (env.type === "finance.invoice") {
    const assigned = body.assigned_to_company_id ?? null;
    const before = prev?.assigned_to_company_id ?? null;
    if (before !== null && assigned !== before) reject("invoice assignment cannot be removed or reassigned; an assignment-release protocol is not defined in v0.2");
    if (assigned !== before && env.issuer.company_id !== body.seller_company_id) reject("only the seller may assign an invoice");
  }
  if (env.type !== "trade.fulfillment") return;
  const seller = body.seller_attestation as Record<string, unknown>;
  const buyer = body.buyer_attestation as Record<string, unknown> | null;
  if (!prev) {
    if (seller.company_id !== body.seller_company_id || seller.record_id !== env.record_id) reject("seller attestation must identify the seller and this exact signed genesis version");
    if (buyer !== null) reject("seller genesis cannot contain a buyer attestation");
    return;
  }
  if (prev.buyer_attestation != null && !equal(prev.buyer_attestation, buyer)) reject("an existing buyer attestation cannot be changed or removed");
  if (prev.buyer_attestation == null && buyer !== null) {
    if (env.issuer.company_id !== body.buyer_company_id || body.status !== "buyer_attested" ||
      buyer.company_id !== body.buyer_company_id || buyer.record_id !== env.record_id) {
      reject("only the buyer can add an attestation, identifying this exact signed buyer_attested version");
    }
  }
  if (body.status === "buyer_attested" && !buyer) reject("buyer_attested requires buyer_attestation");
  if (!equal(prev.deductions, body.deductions)) {
    if (prev.status !== "seller_attested" || env.issuer.company_id !== body.buyer_company_id ||
      !["buyer_attested", "disputed"].includes(String(body.status))) {
      reject("deductions may only be established by the buyer when acknowledging or disputing seller-attested delivery");
    }
  }
}
