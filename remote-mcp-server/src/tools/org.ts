/**
 * Organization management tools.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createOrganization, getOrganization, updateTradeLimits } from "../identity/org-manager.js";
import { createInvite, joinOrg, removeMember, getOrgMembers } from "../identity/member-manager.js";
import { getResolvedIdentity, requireAdmin, resolveIdentityFromOAuthSub } from "../identity/identity-resolver.js";
import { viewMethod } from "../near/client.js";
import { formatParty } from "../shared/type-builders.js";

// Stub: in remote mode, OAuth sub comes from transport. For now, use a placeholder.
function getOAuthSub(): string {
  return process.env.DTP_OAUTH_SUB || "test-user";
}

export function registerOrgTools(server: McpServer) {
  server.tool(
    "dtp_create_org",
    "Create a new DTP organization. Creates a NEAR testnet account, registers your business on-chain, and makes you the admin.",
    {
      name: z.string().describe("Business name (e.g., 'Yellowbird Foods')"),
      business_type: z.enum(["Producer", "Distributor", "Retailer", "Cooperative", "Agent"]).describe("Type of business"),
      jurisdiction: z.string().default("US").describe("ISO country code"),
    },
    async (params) => {
      try {
        const result = await createOrganization({
          name: params.name,
          businessType: params.business_type,
          jurisdiction: params.jurisdiction,
          creatorOauthSub: getOAuthSub(),
        });
        return {
          content: [{
            type: "text",
            text: `Organization created!\n  Name: ${params.name}\n  NEAR account: ${result.nearAccount}\n  Type: ${params.business_type}\n  Role: admin\n\nYou can now post listings, intents, and trade. Use dtp_invite_member to add team members.`,
          }],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "dtp_join_org",
    "Join an existing organization using an invite code from the admin.",
    {
      invite_code: z.string().describe("8-character invite code from your org admin"),
    },
    async (params) => {
      try {
        const result = await joinOrg(getOAuthSub(), params.invite_code);
        return {
          content: [{
            type: "text",
            text: `Joined organization: ${result.orgName}\n  Role: member\n\nYou can now trade on behalf of this organization.`,
          }],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "dtp_org_info",
    "View your organization's details: name, on-chain identity, members, trade limits.",
    {},
    async () => {
      try {
        const identity = getResolvedIdentity();
        if (!identity) {
          return { content: [{ type: "text", text: "You're not part of an organization yet. Use dtp_create_org or dtp_join_org." }] };
        }

        const org = await getOrganization(identity.orgId);
        if (!org) {
          return { content: [{ type: "text", text: "Organization not found." }], isError: true };
        }

        const members = await getOrgMembers(identity.orgId);
        const contractId = process.env.DTP_CONTRACT_ID || "dtp.direct-trade-protocol.testnet";

        // Get on-chain party data
        let partyInfo = "";
        try {
          const party = await viewMethod({
            contractId,
            methodName: "get_party",
            args: { account: org.nearAccount },
          });
          if (party) {
            partyInfo = `\n\nOn-chain identity:\n${formatParty(party)}`;
          }
        } catch {
          partyInfo = "\n\n(Could not fetch on-chain party data)";
        }

        const memberLines = members.map((m) =>
          `  ${m.role === "admin" ? "[admin]" : "[member]"} ${m.displayName || m.email || "unnamed"}`
        );

        const limits = [];
        if (org.perTradeLimitCents) limits.push(`Per-trade max: $${(org.perTradeLimitCents / 100).toFixed(2)}`);
        if (org.dailyLimitCents) limits.push(`Daily max: $${(org.dailyLimitCents / 100).toFixed(2)}`);

        return {
          content: [{
            type: "text",
            text: [
              `Organization: ${org.name}`,
              `  NEAR account: ${org.nearAccount}`,
              `  Type: ${org.businessType}`,
              `  KYB status: ${org.kybStatus}`,
              limits.length ? `  Trade limits: ${limits.join(", ")}` : `  Trade limits: none set`,
              `  Members (${members.length}):`,
              ...memberLines,
              partyInfo,
            ].join("\n"),
          }],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "dtp_invite_member",
    "Generate an invite code for a new team member. The code expires in 7 days. Admin only.",
    {},
    async () => {
      try {
        requireAdmin();
        const identity = getResolvedIdentity()!;
        const code = await createInvite(identity.orgId, identity.userId);
        return {
          content: [{
            type: "text",
            text: `Invite code: ${code}\n\nShare this with your team member. They use dtp_join_org with this code.\nExpires in 7 days.`,
          }],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "dtp_remove_member",
    "Remove a member from the organization. Admin only.",
    {
      user_email: z.string().describe("Email of the member to remove"),
    },
    async (params) => {
      try {
        requireAdmin();
        const identity = getResolvedIdentity()!;
        await removeMember(identity.orgId, params.user_email);
        return {
          content: [{ type: "text", text: `Member ${params.user_email} removed from the organization.` }],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "dtp_set_trade_limits",
    "Set per-trade and daily trade limits for the organization. Admin only.",
    {
      per_trade_max_dollars: z.number().optional().describe("Maximum dollars per trade (null = unlimited)"),
      daily_max_dollars: z.number().optional().describe("Maximum total dollars per day (null = unlimited)"),
    },
    async (params) => {
      try {
        requireAdmin();
        const identity = getResolvedIdentity()!;
        const perTrade = params.per_trade_max_dollars ? Math.round(params.per_trade_max_dollars * 100) : null;
        const daily = params.daily_max_dollars ? Math.round(params.daily_max_dollars * 100) : null;
        await updateTradeLimits(identity.orgId, perTrade, daily);
        return {
          content: [{
            type: "text",
            text: `Trade limits updated:\n  Per-trade: ${perTrade ? `$${(perTrade / 100).toFixed(2)}` : "unlimited"}\n  Daily: ${daily ? `$${(daily / 100).toFixed(2)}` : "unlimited"}`,
          }],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "dtp_whoami",
    "Show your current identity: user, organization, role, and NEAR account.",
    {},
    async () => {
      try {
        const identity = getResolvedIdentity();
        if (!identity) {
          return {
            content: [{ type: "text", text: "Not connected to any organization.\n\nUse dtp_create_org to create one or dtp_join_org to join an existing one." }],
          };
        }
        return {
          content: [{
            type: "text",
            text: `You:\n  Organization: ${identity.orgName}\n  NEAR account: ${identity.nearAccount}\n  Role: ${identity.role}\n  Contract: ${process.env.DTP_CONTRACT_ID || "dtp.direct-trade-protocol.testnet"}`,
          }],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );
}
