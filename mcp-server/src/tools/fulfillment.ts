import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callMethod, viewMethod } from "../near-client.js";
import { getCurrentIdentity, getContractId } from "../account-manager.js";
import { handleContractError } from "../errors.js";
import { amountToMilliamount, formatFulfillment } from "../type-builders.js";

export function registerFulfillmentTools(server: McpServer) {
  server.tool(
    "dtp_seller_attest_delivery",
    "Seller attests that goods have been delivered. Creates a fulfillment record and moves the contract to InFulfillment.",
    {
      contract_id: z.string().describe("The trade contract ID"),
      quantity_delivered: z.number().describe("Quantity actually delivered (e.g., 500 for 500 lb)"),
      unit: z.string().describe("Unit of quantity (e.g., 'lb')"),
      notes: z.string().optional().describe("Optional delivery notes"),
    },
    async (params) => {
      try {
        const signer = getCurrentIdentity();
        const result = await callMethod({
          contractId: getContractId(),
          methodName: "seller_attest_delivery",
          args: {
            contract_id: params.contract_id,
            quantity_delivered: {
              milliamount: amountToMilliamount(params.quantity_delivered),
              unit: params.unit,
            },
            notes: params.notes ?? null,
          },
          signerAccountId: signer,
        });
        return {
          content: [{
            type: "text",
            text: `Delivery attested: ${result}\n  Contract: ${params.contract_id}\n  Delivered: ${params.quantity_delivered} ${params.unit}\n  Seller: ${signer}\n  Status: awaiting buyer confirmation`,
          }],
        };
      } catch (e) {
        return { content: [{ type: "text", text: handleContractError(e) }], isError: true };
      }
    }
  );

  server.tool(
    "dtp_buyer_attest_delivery",
    "Buyer confirms receipt of goods. This triggers automatic settlement — escrow is released to the seller.",
    {
      fulfillment_id: z.string().describe("The fulfillment ID from seller's delivery attestation"),
      notes: z.string().optional().describe("Optional receipt notes"),
    },
    async (params) => {
      try {
        const signer = getCurrentIdentity();
        const result = await callMethod({
          contractId: getContractId(),
          methodName: "buyer_attest_delivery",
          args: {
            fulfillment_id: params.fulfillment_id,
            notes: params.notes ?? null,
            deductions: [],
          },
          signerAccountId: signer,
        });
        return {
          content: [{
            type: "text",
            text: `Receipt confirmed and settlement triggered: ${result}\n  Fulfillment: ${params.fulfillment_id}\n  Buyer: ${signer}\n  Status: Settled`,
          }],
        };
      } catch (e) {
        return { content: [{ type: "text", text: handleContractError(e) }], isError: true };
      }
    }
  );

  server.tool(
    "dtp_get_fulfillment",
    "Get details of a fulfillment record.",
    {
      fulfillment_id: z.string().describe("The fulfillment ID"),
    },
    async (params) => {
      try {
        const result = await viewMethod({
          contractId: getContractId(),
          methodName: "get_fulfillment",
          args: { fulfillment_id: params.fulfillment_id },
        });
        if (!result) {
          return { content: [{ type: "text", text: `Fulfillment ${params.fulfillment_id} not found.` }] };
        }
        return { content: [{ type: "text", text: formatFulfillment(result) }] };
      } catch (e) {
        return { content: [{ type: "text", text: handleContractError(e) }], isError: true };
      }
    }
  );
}
