/**
 * KYB (Know Your Business) tools — doc upload and on-chain attestation.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getResolvedIdentity, requireAdmin, getContractId } from "../identity/identity-resolver.js";
import { callMethod } from "../near/client.js";
import { handleContractError } from "../shared/errors.js";
import { getDb } from "../db/client.js";
import { organizations } from "../db/schema.js";

export function registerKybTools(server: McpServer) {
  server.tool(
    "dtp_upload_business_docs",
    "Upload business formation documents (Articles of Incorporation, EIN letter) for KYB verification. Admin only.",
    {
      doc_type: z.enum(["articles_of_incorporation", "ein_letter", "business_license", "other"]).describe("Type of document"),
      doc_description: z.string().describe("Brief description of the document"),
      // In production, this would accept a file upload. For MVP, we accept a description
      // and update the KYB status to indicate docs are pending review.
    },
    async (params) => {
      try {
        requireAdmin();
        const identity = getResolvedIdentity()!;
        const db = getDb();

        await db.update(organizations).set({
          kybStatus: "docs_uploaded",
          updatedAt: new Date(),
        }).where(eq(organizations.id, identity.orgId));

        return {
          content: [{
            type: "text",
            text: `Business document recorded: ${params.doc_type}\n  Description: ${params.doc_description}\n  KYB status: docs_uploaded\n\nUse dtp_submit_kyb to submit your KYB attestation to the blockchain.`,
          }],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "dtp_submit_kyb",
    "Submit a KYB (Know Your Business) attestation to the on-chain Party record. This links your NEAR account to your legal business entity. Admin only.",
    {
      legal_name: z.string().describe("Legal entity name as registered (e.g., 'Yellowbird Foods LLC')"),
      tax_id: z.string().describe("Tax identifier (EIN for US entities, e.g., '12-3456789')"),
      jurisdiction: z.string().default("US").describe("ISO country code of registration"),
    },
    async (params) => {
      try {
        requireAdmin();
        const identity = getResolvedIdentity()!;
        const db = getDb();

        // Submit KYB attestation on-chain
        await callMethod({
          contractId: getContractId(),
          methodName: "add_kyb_attestation",
          args: {
            kyb: {
              legal_name: params.legal_name,
              tax_id: params.tax_id,
              jurisdiction: params.jurisdiction,
              provider: "self_reported",
              attestation_ref: null,
              issued_at: Date.now(),
              expires_at: null,
              status: "Pending",
            },
          },
          signerAccountId: identity.nearAccount,
        });

        // Update DB
        await db.update(organizations).set({
          kybStatus: "pending",
          kybLegalName: params.legal_name,
          kybTaxId: params.tax_id,
          updatedAt: new Date(),
        }).where(eq(organizations.id, identity.orgId));

        return {
          content: [{
            type: "text",
            text: `KYB attestation submitted on-chain.\n  Legal name: ${params.legal_name}\n  Tax ID: ${params.tax_id}\n  Jurisdiction: ${params.jurisdiction}\n  Provider: self_reported\n  Status: Pending\n\nThis attestation is now visible to trading counterparties.`,
          }],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: handleContractError(e) }], isError: true };
      }
    }
  );
}
