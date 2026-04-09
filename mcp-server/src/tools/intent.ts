import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callMethod, viewMethod } from "../near-client.js";
import { getCurrentIdentity, getContractId } from "../account-manager.js";
import { handleContractError } from "../errors.js";
import {
  buildGoodsSpec, buildDeliverySpec, buildBuyerPricing,
  isoToUnixMs, formatIntent,
} from "../type-builders.js";

export function registerIntentTools(server: McpServer) {
  server.tool(
    "dtp_post_intent",
    "Post a new trade intent as a buyer. Declares what you want to purchase, including a ceiling price.",
    {
      category: z.string().describe("Product category (e.g., 'food.produce.berries.blueberries')"),
      product_name: z.string().describe("What you want to buy (e.g., 'Organic IQF Blueberries')"),
      description: z.string().describe("Description of what you need"),
      product_type: z.enum(["Commodity", "Branded", "ValueAdded"]).default("Commodity"),
      quantity_amount: z.number().describe("Desired quantity (e.g., 200 for 200 lb)"),
      quantity_unit: z.string().describe("Unit (e.g., 'lb')"),
      grade: z.string().describe("Desired quality grade"),
      packaging: z.string().describe("Preferred packaging"),
      // Delivery
      destination_city: z.string().describe("Delivery city"),
      destination_state: z.string().describe("Delivery state"),
      destination_zip: z.string().describe("Delivery ZIP"),
      destination_country: z.string().default("US"),
      delivery_earliest: z.string().describe("Earliest acceptable delivery (ISO: YYYY-MM-DD)"),
      delivery_latest: z.string().describe("Latest acceptable delivery (ISO: YYYY-MM-DD)"),
      delivery_method: z.enum(["Delivered", "FobOrigin", "ThirdPartyLogistics"]).default("Delivered"),
      // Pricing
      ceiling_price_per_unit: z.number().describe("Maximum price per unit in dollars (e.g., 3.00)"),
      // Expiry
      expires_at: z.string().describe("Intent expiry date (ISO: YYYY-MM-DD)"),
    },
    async (params) => {
      try {
        const signer = getCurrentIdentity();
        const result = await callMethod({
          contractId: getContractId(),
          methodName: "post_intent",
          args: {
            goods: buildGoodsSpec(params),
            delivery: buildDeliverySpec(params),
            pricing: buildBuyerPricing(params),
            finance: null,
            freight: null,
            expires_at: isoToUnixMs(params.expires_at),
          },
          signerAccountId: signer,
        });
        return {
          content: [{ type: "text", text: `Intent posted: ${result}\n  Product: ${params.product_name}\n  Quantity: ${params.quantity_amount} ${params.quantity_unit}\n  Ceiling: $${params.ceiling_price_per_unit}/${params.quantity_unit}\n  Buyer: ${signer}` }],
        };
      } catch (e) {
        return { content: [{ type: "text", text: handleContractError(e) }], isError: true };
      }
    }
  );

  server.tool(
    "dtp_cancel_intent",
    "Cancel a posted trade intent. Must be called by the buyer.",
    {
      intent_id: z.string().describe("The intent ID to cancel"),
    },
    async (params) => {
      try {
        await callMethod({
          contractId: getContractId(),
          methodName: "cancel_intent",
          args: { intent_id: params.intent_id },
          signerAccountId: getCurrentIdentity(),
        });
        return { content: [{ type: "text", text: `Intent ${params.intent_id} cancelled.` }] };
      } catch (e) {
        return { content: [{ type: "text", text: handleContractError(e) }], isError: true };
      }
    }
  );

  server.tool(
    "dtp_get_intent",
    "Get details of a trade intent.",
    {
      intent_id: z.string().describe("The intent ID"),
    },
    async (params) => {
      try {
        const result = await viewMethod({
          contractId: getContractId(),
          methodName: "get_intent",
          args: { intent_id: params.intent_id },
        });
        if (!result) {
          return { content: [{ type: "text", text: `Intent ${params.intent_id} not found.` }] };
        }
        return { content: [{ type: "text", text: formatIntent(result) }] };
      } catch (e) {
        return { content: [{ type: "text", text: handleContractError(e) }], isError: true };
      }
    }
  );
}
