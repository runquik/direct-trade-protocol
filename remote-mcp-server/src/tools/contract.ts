import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callMethod, viewMethod } from "../near/client.js";
import { getCurrentIdentity, getContractId } from "../identity/identity-resolver.js";
import { handleContractError } from "../shared/errors.js";
import { formatContract } from "../shared/type-builders.js";

export function registerContractTools(server: McpServer) {
  server.tool(
    "dtp_accept_offer",
    "Accept an offer to form a trade contract. If the offer targets your intent, you (buyer) accept. If it targets your listing, you (seller) accept. Escrow is locked at this point.",
    {
      offer_id: z.string().describe("The offer ID to accept"),
      arbitrator: z.string().optional().describe("Optional NEAR account ID of a dispute arbitrator"),
    },
    async (params) => {
      try {
        const signer = getCurrentIdentity();
        const result = await callMethod({
          contractId: getContractId(),
          methodName: "accept_offer",
          args: {
            offer_id: params.offer_id,
            arbitrator: params.arbitrator ?? null,
            standing_agreement_id: null,
          },
          signerAccountId: signer,
        });
        return {
          content: [{
            type: "text",
            text: `Contract formed: ${result}\n  Offer: ${params.offer_id}\n  Accepted by: ${signer}\n  Status: Active (escrow locked)`,
          }],
        };
      } catch (e) {
        return { content: [{ type: "text", text: handleContractError(e) }], isError: true };
      }
    }
  );

  server.tool(
    "dtp_get_contract",
    "Get details of a trade contract.",
    {
      contract_id: z.string().describe("The contract ID"),
    },
    async (params) => {
      try {
        const result = await viewMethod({
          contractId: getContractId(),
          methodName: "get_contract",
          args: { contract_id: params.contract_id },
        });
        if (!result) {
          return { content: [{ type: "text", text: `Contract ${params.contract_id} not found.` }] };
        }
        return { content: [{ type: "text", text: formatContract(result) }] };
      } catch (e) {
        return { content: [{ type: "text", text: handleContractError(e) }], isError: true };
      }
    }
  );
}
