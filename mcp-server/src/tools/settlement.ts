import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { viewMethod } from "../near-client.js";
import { getContractId } from "../account-manager.js";
import { handleContractError } from "../errors.js";
import { formatSettlement } from "../type-builders.js";

export function registerSettlementTools(server: McpServer) {
  server.tool(
    "dtp_get_settlement",
    "Get details of a completed settlement.",
    {
      settlement_id: z.string().describe("The settlement ID"),
    },
    async (params) => {
      try {
        const result = await viewMethod({
          contractId: getContractId(),
          methodName: "get_settlement",
          args: { settlement_id: params.settlement_id },
        });
        if (!result) {
          return { content: [{ type: "text", text: `Settlement ${params.settlement_id} not found.` }] };
        }
        return { content: [{ type: "text", text: formatSettlement(result) }] };
      } catch (e) {
        return { content: [{ type: "text", text: handleContractError(e) }], isError: true };
      }
    }
  );
}
