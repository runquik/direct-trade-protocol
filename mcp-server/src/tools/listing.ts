import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callMethod, viewMethod } from "../near-client.js";
import { getCurrentIdentity, getContractId } from "../account-manager.js";
import { handleContractError } from "../errors.js";
import {
  buildGoodsSpec, buildDeliverySpec, buildPackStructure, buildSellerPricing,
  isoToUnixMs, formatListing,
} from "../type-builders.js";

export function registerListingTools(server: McpServer) {
  server.tool(
    "dtp_post_listing",
    "Post a new supply listing as a seller. Prices are in dollars, quantities in natural units (lb, kg, etc).",
    {
      // Goods
      category: z.string().describe("Product category (e.g., 'food.produce.berries.blueberries')"),
      product_name: z.string().describe("Product display name (e.g., 'Organic IQF Blueberries')"),
      description: z.string().describe("Product description"),
      product_type: z.enum(["Commodity", "Branded", "ValueAdded"]).default("Commodity"),
      quantity_amount: z.number().describe("Available quantity (e.g., 500 for 500 lb)"),
      quantity_unit: z.string().describe("Unit (e.g., 'lb', 'kg', 'case')"),
      grade: z.string().describe("Quality grade (e.g., 'USDA Fancy', 'Grade A')"),
      packaging: z.string().describe("Packaging description (e.g., '30 lb case')"),
      // Pack structure
      unit_size_amount: z.number().describe("Size of one unit (e.g., 30 for 30 lb bags)"),
      unit_size_unit: z.string().describe("Unit of pack size (e.g., 'lb')"),
      units_per_case: z.number().describe("Units per case"),
      cases_per_pallet: z.number().describe("Cases per pallet"),
      moq_amount: z.number().describe("Minimum order quantity amount"),
      moq_unit: z.string().describe("MOQ unit"),
      moq_label: z.string().describe("MOQ label (e.g., '1 case')"),
      // Delivery
      destination_city: z.string().describe("Origin/delivery city"),
      destination_state: z.string().describe("State"),
      destination_zip: z.string().describe("ZIP code"),
      destination_country: z.string().default("US"),
      delivery_earliest: z.string().describe("Earliest delivery date (ISO: YYYY-MM-DD)"),
      delivery_latest: z.string().describe("Latest delivery date (ISO: YYYY-MM-DD)"),
      delivery_method: z.enum(["Delivered", "FobOrigin", "ThirdPartyLogistics"]).default("Delivered"),
      // Pricing
      asking_price_per_unit: z.number().describe("Asking price per unit in dollars (e.g., 2.50)"),
      pricing_model: z.enum(["Flat", "Tiered", "Negotiable"]).default("Flat"),
      // Dates
      available_from: z.string().describe("Available from date (ISO: YYYY-MM-DD)"),
      expires_at: z.string().describe("Listing expiry date (ISO: YYYY-MM-DD)"),
      // Optional
      lot_id: z.string().optional().describe("On-chain lot ID if listing is lot-backed"),
    },
    async (params) => {
      try {
        const signer = getCurrentIdentity();
        const result = await callMethod({
          contractId: getContractId(),
          methodName: "post_listing",
          args: {
            lot_id: params.lot_id ?? null,
            goods: buildGoodsSpec(params),
            pack_structure: buildPackStructure(params),
            delivery: buildDeliverySpec(params),
            pricing: buildSellerPricing(params),
            finance: null,
            freight: null,
            certifications: [],
            available_from: isoToUnixMs(params.available_from),
            expires_at: isoToUnixMs(params.expires_at),
          },
          signerAccountId: signer,
        });
        return {
          content: [{ type: "text", text: `Listing posted: ${result}\n  Product: ${params.product_name}\n  Quantity: ${params.quantity_amount} ${params.quantity_unit}\n  Price: $${params.asking_price_per_unit}/${params.quantity_unit}\n  Seller: ${signer}` }],
        };
      } catch (e) {
        return { content: [{ type: "text", text: handleContractError(e) }], isError: true };
      }
    }
  );

  server.tool(
    "dtp_withdraw_listing",
    "Withdraw an active listing. Must be called by the seller.",
    {
      listing_id: z.string().describe("The listing ID to withdraw"),
    },
    async (params) => {
      try {
        await callMethod({
          contractId: getContractId(),
          methodName: "withdraw_listing",
          args: { listing_id: params.listing_id },
          signerAccountId: getCurrentIdentity(),
        });
        return { content: [{ type: "text", text: `Listing ${params.listing_id} withdrawn.` }] };
      } catch (e) {
        return { content: [{ type: "text", text: handleContractError(e) }], isError: true };
      }
    }
  );

  server.tool(
    "dtp_get_listing",
    "Get details of a supply listing.",
    {
      listing_id: z.string().describe("The listing ID"),
    },
    async (params) => {
      try {
        const result = await viewMethod({
          contractId: getContractId(),
          methodName: "get_listing",
          args: { listing_id: params.listing_id },
        });
        if (!result) {
          return { content: [{ type: "text", text: `Listing ${params.listing_id} not found.` }] };
        }
        return { content: [{ type: "text", text: formatListing(result) }] };
      } catch (e) {
        return { content: [{ type: "text", text: handleContractError(e) }], isError: true };
      }
    }
  );
}
