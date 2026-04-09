import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callMethod, viewMethod } from "../near/client.js";
import { getCurrentIdentity, getContractId } from "../identity/identity-resolver.js";
import { handleContractError } from "../shared/errors.js";
import { formatParty } from "../shared/type-builders.js";

export function registerPartyTools(server: McpServer) {
  server.tool(
    "dtp_register_party",
    "Register the current identity as a DTP party (business) on-chain. Must be done before posting intents or listings.",
    {
      business_name: z.string().describe("Display name of the business (e.g., 'Willamette Valley Farms')"),
      business_type: z.enum(["Producer", "Distributor", "Retailer", "Cooperative", "Agent"]).describe("Type of business"),
      jurisdiction: z.string().describe("ISO country code (e.g., 'US')"),
    },
    async (params) => {
      try {
        const signer = getCurrentIdentity();
        await callMethod({
          contractId: getContractId(),
          methodName: "register_party",
          args: {
            business_name: params.business_name,
            business_type: params.business_type,
            jurisdiction: params.jurisdiction,
          },
          signerAccountId: signer,
        });
        return {
          content: [{ type: "text", text: `Party registered: ${signer}\n  Name: ${params.business_name}\n  Type: ${params.business_type}\n  Jurisdiction: ${params.jurisdiction}` }],
        };
      } catch (e) {
        return { content: [{ type: "text", text: handleContractError(e) }], isError: true };
      }
    }
  );

  server.tool(
    "dtp_get_party",
    "Get a party's registration details by account ID.",
    {
      account_id: z.string().describe("NEAR account ID of the party"),
    },
    async (params) => {
      try {
        const result = await viewMethod({
          contractId: getContractId(),
          methodName: "get_party",
          args: { account: params.account_id },
        });
        if (!result) {
          return { content: [{ type: "text", text: `No party registered for ${params.account_id}` }] };
        }
        return { content: [{ type: "text", text: formatParty(result) }] };
      } catch (e) {
        return { content: [{ type: "text", text: handleContractError(e) }], isError: true };
      }
    }
  );

  server.tool(
    "dtp_get_account_summary",
    "Get a full on-chain summary of an account: party info, counts, volume, reputation.",
    {
      account_id: z.string().describe("NEAR account ID"),
    },
    async (params) => {
      try {
        const result = await viewMethod({
          contractId: getContractId(),
          methodName: "get_account_summary",
          args: { account: params.account_id },
        });
        if (!result) {
          return { content: [{ type: "text", text: `No party registered for ${params.account_id}` }] };
        }
        const lines = [
          formatParty(result.party),
          `  Catalog entries: ${result.catalog_count}`,
          `  Lots owned: ${result.lots_owned}`,
          `  Active listings: ${result.active_listings}`,
          `  Active intents: ${result.active_intents}`,
          `  Open contracts: ${result.open_contracts}`,
          `  Total trades: ${result.total_trades}`,
          `  Total volume: $${(Number(result.total_volume_microdollars) / 1_000_000).toFixed(2)}`,
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text", text: handleContractError(e) }], isError: true };
      }
    }
  );
}
