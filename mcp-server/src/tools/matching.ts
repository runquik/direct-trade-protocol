import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { viewMethod } from "../near-client.js";
import { getContractId } from "../account-manager.js";
import { handleContractError } from "../errors.js";
import { formatMatchResult, formatRankedMatches } from "../type-builders.js";

export function registerMatchingTools(server: McpServer) {
  server.tool(
    "dtp_find_matches_for_intent",
    "Find all active supply listings that match a buyer's trade intent, ranked by score.",
    {
      intent_id: z.string().describe("The trade intent ID"),
      limit: z.number().default(10).describe("Max results to return"),
    },
    async (params) => {
      try {
        const result = await viewMethod({
          contractId: getContractId(),
          methodName: "find_matches_for_intent",
          args: { intent_id: params.intent_id, offset: 0, limit: params.limit },
        });
        return { content: [{ type: "text", text: `Matches for intent ${params.intent_id}:\n${formatRankedMatches(result)}` }] };
      } catch (e) {
        return { content: [{ type: "text", text: handleContractError(e) }], isError: true };
      }
    }
  );

  server.tool(
    "dtp_find_matches_for_listing",
    "Find all posted trade intents that match a seller's supply listing, ranked by score.",
    {
      listing_id: z.string().describe("The supply listing ID"),
      limit: z.number().default(10).describe("Max results to return"),
    },
    async (params) => {
      try {
        const result = await viewMethod({
          contractId: getContractId(),
          methodName: "find_matches_for_listing",
          args: { listing_id: params.listing_id, offset: 0, limit: params.limit },
        });
        return { content: [{ type: "text", text: `Matches for listing ${params.listing_id}:\n${formatRankedMatches(result)}` }] };
      } catch (e) {
        return { content: [{ type: "text", text: handleContractError(e) }], isError: true };
      }
    }
  );

  server.tool(
    "dtp_check_match",
    "Check if a specific listing is eligible to match a specific intent, and get the match score.",
    {
      intent_id: z.string().describe("The trade intent ID"),
      listing_id: z.string().describe("The supply listing ID"),
    },
    async (params) => {
      try {
        const result = await viewMethod({
          contractId: getContractId(),
          methodName: "check_match",
          args: { intent_id: params.intent_id, listing_id: params.listing_id },
        });
        return { content: [{ type: "text", text: formatMatchResult(result) }] };
      } catch (e) {
        return { content: [{ type: "text", text: handleContractError(e) }], isError: true };
      }
    }
  );
}
