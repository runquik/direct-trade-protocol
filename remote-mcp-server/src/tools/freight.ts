/**
 * Freight tools — Shippo parcel quotes and label booking.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { viewMethod } from "../near/client.js";
import { getContractId, getResolvedIdentity } from "../identity/identity-resolver.js";
import { getShippingRates, purchaseLabel, estimateParcelDimensions, formatRates } from "../services/shippo.js";
import { milliamountToAmount } from "../shared/type-builders.js";

export function registerFreightTools(server: McpServer) {
  server.tool(
    "dtp_get_freight_quotes",
    "Get shipping rate quotes for a listing/intent pair. Fetches origin/destination from on-chain data and queries Shippo for parcel rates.",
    {
      listing_id: z.string().describe("The supply listing ID (origin address + package info)"),
      intent_id: z.string().describe("The trade intent ID (destination address)"),
    },
    async (params) => {
      try {
        const contractId = getContractId();

        // Fetch listing and intent from chain
        const listing = await viewMethod({
          contractId,
          methodName: "get_listing",
          args: { listing_id: params.listing_id },
        });
        if (!listing) return { content: [{ type: "text", text: `Listing ${params.listing_id} not found.` }], isError: true };

        const intent = await viewMethod({
          contractId,
          methodName: "get_intent",
          args: { intent_id: params.intent_id },
        });
        if (!intent) return { content: [{ type: "text", text: `Intent ${params.intent_id} not found.` }], isError: true };

        // Build Shippo addresses from on-chain delivery specs
        const fromAddr = {
          name: listing.seller,
          street1: "N/A", // DTP doesn't store street addresses on-chain
          city: listing.delivery.destination_city,
          state: listing.delivery.destination_state,
          zip: listing.delivery.destination_zip,
          country: listing.delivery.destination_country || "US",
        };

        const toAddr = {
          name: intent.buyer,
          street1: "N/A",
          city: intent.delivery.destination_city,
          state: intent.delivery.destination_state,
          zip: intent.delivery.destination_zip,
          country: intent.delivery.destination_country || "US",
        };

        // Estimate weight from intent quantity (what the buyer wants)
        const weightLb = milliamountToAmount(intent.goods.quantity.milliamount);
        const parcel = estimateParcelDimensions(weightLb);

        // Get Shippo rates
        const shipment = await getShippingRates(fromAddr, toAddr, [parcel]);

        // Calculate per-unit freight cost for the cheapest option
        const rates = shipment.rates || [];
        let cheapestInfo = "";
        if (rates.length > 0) {
          const sorted = [...rates].sort((a: any, b: any) => parseFloat(a.amount) - parseFloat(b.amount));
          const cheapest = sorted[0]!;
          const freightPerUnit = parseFloat(cheapest.amount) / weightLb;
          const goodsPerUnit = milliamountToAmount(Number(listing.pricing.asking_price_per_unit)) / 1000; // microdollars to dollars
          cheapestInfo = `\nCheapest option landed cost: $${(goodsPerUnit + freightPerUnit).toFixed(2)}/lb ($${goodsPerUnit.toFixed(2)} goods + $${freightPerUnit.toFixed(2)} freight)`;
        }

        return {
          content: [{
            type: "text",
            text: `Freight quotes for ${params.listing_id} → ${params.intent_id}\n  From: ${fromAddr.city}, ${fromAddr.state} ${fromAddr.zip}\n  To: ${toAddr.city}, ${toAddr.state} ${toAddr.zip}\n  Package: ${parcel.weight} lb, ${parcel.length}x${parcel.width}x${parcel.height} in\n\n${formatRates(rates)}${cheapestInfo}`,
          }],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error getting freight quotes: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "dtp_book_shipment",
    "Purchase a shipping label using a Shippo rate ID. Returns tracking number and label URL.",
    {
      rate_id: z.string().describe("The Shippo rate ID from dtp_get_freight_quotes"),
      contract_id: z.string().optional().describe("Optional DTP trade contract ID to associate with this shipment"),
    },
    async (params) => {
      try {
        const result = await purchaseLabel(params.rate_id);

        return {
          content: [{
            type: "text",
            text: [
              `Shipment booked!`,
              `  Tracking: ${result.tracking_number}`,
              `  Tracking URL: ${result.tracking_url_provider}`,
              `  Label: ${result.label_url}`,
              `  Status: ${result.status}`,
              params.contract_id ? `  Contract: ${params.contract_id}` : null,
              `\nPrint the label and ship your goods!`,
            ].filter(Boolean).join("\n"),
          }],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error booking shipment: ${e.message}` }], isError: true };
      }
    }
  );
}
