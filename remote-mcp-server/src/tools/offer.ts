import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callMethod, viewMethod } from "../near/client.js";
import { getCurrentIdentity, getContractId } from "../identity/identity-resolver.js";
import { handleContractError } from "../shared/errors.js";
import {
  buildGoodsSpec, buildDeliverySpec, dollarsToMicrodollars,
  isoToUnixMs, formatOffer,
} from "../shared/type-builders.js";

export function registerOfferTools(server: McpServer) {
  server.tool(
    "dtp_submit_offer",
    "Submit an offer targeting a trade intent (as seller) or a supply listing (as buyer). The current identity is the offerer.",
    {
      target_id: z.string().describe("The intent ID or listing ID to target"),
      target_type: z.enum(["Intent", "Listing"]).describe("'Intent' if you're a seller responding to a buyer's intent, 'Listing' if you're a buyer responding to a seller's listing"),
      // Goods
      category: z.string().describe("Product category"),
      product_name: z.string().describe("Product name"),
      description: z.string().describe("Product description"),
      product_type: z.enum(["Commodity", "Branded", "ValueAdded"]).default("Commodity"),
      quantity_amount: z.number().describe("Offered quantity"),
      quantity_unit: z.string().describe("Unit"),
      grade: z.string().describe("Grade"),
      packaging: z.string().describe("Packaging"),
      // Delivery
      destination_city: z.string().describe("Delivery city"),
      destination_state: z.string().describe("State"),
      destination_zip: z.string().describe("ZIP"),
      destination_country: z.string().default("US"),
      delivery_earliest: z.string().describe("Earliest delivery (ISO: YYYY-MM-DD)"),
      delivery_latest: z.string().describe("Latest delivery (ISO: YYYY-MM-DD)"),
      delivery_method: z.enum(["Delivered", "FobOrigin", "ThirdPartyLogistics"]).default("Delivered"),
      // Pricing
      price_per_unit: z.number().describe("Offered price per unit in dollars"),
      total_price: z.number().describe("Total price in dollars"),
      // Expiry
      expires_at: z.string().describe("Offer expiry date (ISO: YYYY-MM-DD)"),
    },
    async (params) => {
      try {
        const signer = getCurrentIdentity();
        const result = await callMethod({
          contractId: getContractId(),
          methodName: "submit_offer",
          args: {
            target_id: params.target_id,
            target_type: params.target_type,
            goods: buildGoodsSpec(params),
            delivery: buildDeliverySpec(params),
            finance: null,
            freight: null,
            price_per_unit: dollarsToMicrodollars(params.price_per_unit),
            total_price: dollarsToMicrodollars(params.total_price),
            certifications: [],
            expires_at: isoToUnixMs(params.expires_at),
          },
          signerAccountId: signer,
        });
        return {
          content: [{
            type: "text",
            text: `Offer submitted: ${result}\n  Target: ${params.target_type} ${params.target_id}\n  Price: $${params.price_per_unit}/${params.quantity_unit}, Total: $${params.total_price}\n  Offerer: ${signer}`,
          }],
        };
      } catch (e) {
        return { content: [{ type: "text", text: handleContractError(e) }], isError: true };
      }
    }
  );

  server.tool(
    "dtp_retract_offer",
    "Retract a submitted offer. Must be called by the offerer.",
    {
      offer_id: z.string().describe("The offer ID to retract"),
    },
    async (params) => {
      try {
        await callMethod({
          contractId: getContractId(),
          methodName: "retract_offer",
          args: { offer_id: params.offer_id },
          signerAccountId: getCurrentIdentity(),
        });
        return { content: [{ type: "text", text: `Offer ${params.offer_id} retracted.` }] };
      } catch (e) {
        return { content: [{ type: "text", text: handleContractError(e) }], isError: true };
      }
    }
  );

  server.tool(
    "dtp_get_offer",
    "Get details of an offer.",
    {
      offer_id: z.string().describe("The offer ID"),
    },
    async (params) => {
      try {
        const result = await viewMethod({
          contractId: getContractId(),
          methodName: "get_offer",
          args: { offer_id: params.offer_id },
        });
        if (!result) {
          return { content: [{ type: "text", text: `Offer ${params.offer_id} not found.` }] };
        }
        return { content: [{ type: "text", text: formatOffer(result) }] };
      } catch (e) {
        return { content: [{ type: "text", text: handleContractError(e) }], isError: true };
      }
    }
  );
}
