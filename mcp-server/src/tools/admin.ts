/**
 * Admin tools: account creation, identity switching, initialization.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  initAccounts,
  loadKeysIntoKeyStore,
  addIdentity,
  switchIdentity,
  getCurrentIdentity,
  getContractId,
  listIdentities,
  loadAccounts,
} from "../account-manager.js";
import { createSubAccount, addKey } from "../near-client.js";

export function registerAdminTools(server: McpServer) {
  // ── dtp_init ──────────────────────────────────────────────────────────
  server.tool(
    "dtp_init",
    "Initialize the DTP MCP server with your NEAR testnet master account and contract ID. Run this once before using other tools.",
    {
      master_account: z.string().describe("Your NEAR testnet master account ID (e.g., direct-trade-protocol.testnet)"),
      master_private_key: z.string().describe("Private key for the master account (ed25519:...)"),
      contract_id: z.string().describe("Account ID where the DTP contract is deployed (e.g., dtp.direct-trade-protocol.testnet)"),
    },
    async (params) => {
      try {
        initAccounts(params.master_account, params.contract_id, params.master_private_key);
        // Load ALL identity keys into the NEAR keystore (not just master)
        await loadKeysIntoKeyStore();
        return {
          content: [{ type: "text", text: `DTP initialized.\n  Master: ${params.master_account}\n  Contract: ${params.contract_id}\n  Current identity: ${params.master_account}\n  Identities loaded: ${listIdentities().length}` }],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // ── dtp_create_account ────────────────────────────────────────────────
  server.tool(
    "dtp_create_account",
    "Create a new NEAR testnet sub-account for a business identity. The account is funded from the master account.",
    {
      name: z.string().describe("Short name for the sub-account (e.g., 'buyer1', 'seller1'). Will become <name>.<master>.testnet"),
      label: z.string().describe("Human-readable business name (e.g., 'Pacific Northwest Grocery Co-op')"),
      business_type: z.enum(["Producer", "Distributor", "Retailer", "Cooperative", "Agent"]).describe("Type of business"),
    },
    async (params) => {
      try {
        const data = loadAccounts();
        const newAccountId = `${params.name}.${data.masterAccount}`;

        const keys = await createSubAccount({
          parentAccountId: data.masterAccount,
          newAccountId,
          initialBalanceNear: "1",
        });

        addIdentity(newAccountId, params.label, params.business_type, keys.privateKey);

        return {
          content: [{
            type: "text",
            text: `Account created: ${newAccountId}\n  Label: ${params.label}\n  Type: ${params.business_type}\n  Funded: 1 NEAR\n  Public key: ${keys.publicKey}\n\nUse dtp_switch_identity to switch to this account.`,
          }],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error creating account: ${e.message}` }], isError: true };
      }
    }
  );

  // ── dtp_switch_identity ───────────────────────────────────────────────
  server.tool(
    "dtp_switch_identity",
    "Switch the active NEAR account used for signing transactions. All subsequent call methods will use this identity.",
    {
      account_id: z.string().describe("The NEAR account ID to switch to"),
    },
    async (params) => {
      try {
        switchIdentity(params.account_id);
        await loadKeysIntoKeyStore(); // Ensure key is loaded
        const identities = listIdentities();
        const current = identities.find((i) => i.isCurrent);
        return {
          content: [{
            type: "text",
            text: `Switched to: ${params.account_id}\n  Label: ${current?.label}\n  Type: ${current?.businessType}`,
          }],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // ── dtp_list_identities ───────────────────────────────────────────────
  server.tool(
    "dtp_list_identities",
    "List all available NEAR testnet identities and show which is currently active.",
    {},
    async () => {
      const identities = listIdentities();
      if (identities.length === 0) {
        return {
          content: [{ type: "text", text: "No identities configured. Use dtp_init to set up the master account, then dtp_create_account for business identities." }],
        };
      }
      const lines = identities.map((i) =>
        `${i.isCurrent ? "→ " : "  "}${i.accountId} — ${i.label} (${i.businessType})`
      );
      return { content: [{ type: "text", text: `Identities:\n${lines.join("\n")}` }] };
    }
  );

  // ── dtp_whoami ────────────────────────────────────────────────────────
  server.tool(
    "dtp_whoami",
    "Show the current active identity and contract info.",
    {},
    async () => {
      try {
        const currentId = getCurrentIdentity();
        const contractId = getContractId();
        const identities = listIdentities();
        const current = identities.find((i) => i.isCurrent);
        return {
          content: [{
            type: "text",
            text: `Current identity: ${currentId}\n  Label: ${current?.label}\n  Type: ${current?.businessType}\n  Contract: ${contractId}`,
          }],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );
}
