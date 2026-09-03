// Envelope + body + signature validation. Pure functions over the SDK; no DB access.
import { validateEnvelope, validateBody, typeInfo, supportsVersion, type TypeInfo } from "../../../sdk/src/registry.ts";
import { verifyRecord } from "../../../sdk/src/sign.ts";
import { namespaceOf, type Envelope } from "../../../sdk/src/envelope.ts";
import { StoreError } from "./errors.ts";

export const MAX_BODY_BYTES = 256 * 1024;

export interface ValidatedRecord {
  env: Envelope<Record<string, unknown>>;
  info: TypeInfo;
  payload_hash: string;
}

/** Steps 1-5 of the write pipeline: shape, registry, body schema, signature. Does not touch the DB. */
export async function validateSignedEnvelope(input: unknown): Promise<ValidatedRecord> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new StoreError("envelope_invalid", "request body must be a JSON object (the signed envelope)");
  }
  const envCheck = validateEnvelope(input);
  if (!envCheck.ok) {
    const isFloat = envCheck.issues.some((i) => i.keyword === "float_not_allowed");
    throw new StoreError(isFloat ? "float_not_allowed" : "envelope_invalid", "envelope failed validation", { issues: envCheck.issues });
  }
  const env = input as Envelope<Record<string, unknown>>;

  if (env.namespace !== namespaceOf(env.type)) {
    throw new StoreError("envelope_invalid", `namespace ${env.namespace} does not match type ${env.type}`);
  }
  if (env.counterparty_ids.includes(env.subject_company_id)) {
    throw new StoreError("envelope_invalid", "subject_company_id must not appear in counterparty_ids");
  }
  if (env.supersedes === null && env.root_id !== env.record_id) {
    throw new StoreError("envelope_invalid", "a genesis record (supersedes null) must have root_id == record_id");
  }
  const info = typeInfo(env.type);
  if (!info) throw new StoreError("unknown_type", `unknown record type ${env.type}`);
  if (!supportsVersion(env.type, env.schema_version)) {
    throw new StoreError("unknown_type", `type ${env.type} has no schema version ${env.schema_version}`, { supported: info.schema_versions });
  }
  const bodyCheck = validateBody(env.type, env.body);
  if (!bodyCheck.ok) throw new StoreError("schema_invalid", `body does not conform to ${env.type}`, { issues: bodyCheck.issues });

  const v = await verifyRecord(env);
  if (!v.ok) throw new StoreError("signature_invalid", v.error ?? "signature does not verify", { key_id: env.issuer.key_id });

  return { env, info, payload_hash: v.payload_hash };
}

export function statusFromBody(info: TypeInfo, body: Record<string, unknown>): string | null {
  const f = info.transitions?.status_field;
  if (!f) return null;
  const v = body[f];
  return typeof v === "string" ? v : null;
}
