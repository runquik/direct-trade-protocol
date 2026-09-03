// GET /schemas, GET /schemas/{type}, POST /debug/canonicalize
import { listTypes, typeInfo, envelopeSchema } from "../../../../sdk/src/registry.ts";
import { PROTOCOL_VERSION, ID_BASE } from "../../../../sdk/src/schemas.ts";
import { canonicalize, FloatNotAllowedError, sha256Hex } from "../../../../sdk/src/canonical.ts";
import { signingObject, verifyRecord } from "../../../../sdk/src/sign.ts";
import type { Envelope } from "../../../../sdk/src/envelope.ts";
import { StoreError } from "../errors.ts";

export function schemaIndex() {
  const types: Record<string, unknown> = {};
  for (const t of listTypes()) {
    const i = typeInfo(t)!;
    types[t] = {
      namespace: i.namespace,
      schema_versions: i.schema_versions,
      writable_by: i.writable_by,
      subject: i.subject,
      default_visibility: i.default_visibility,
      strict: i.strict,
      schema_url: ID_BASE + i.file,
      status_field: i.transitions?.status_field ?? null,
    };
  }
  return { protocol_version: PROTOCOL_VERSION, envelope_url: ID_BASE + "core/envelope.schema.json", types };
}

export function schemaFor(type: string) {
  if (type === "envelope" || type === "core.envelope") return envelopeSchema();
  const i = typeInfo(type);
  if (!i) throw new StoreError("not_found", `unknown type ${type}`);
  return i.schema;
}

/** Cross-language de-risker: returns the exact bytes the store signs/hashes, and whether a supplied signature verifies. */
export async function debugCanonicalize(input: unknown) {
  if (!input || typeof input !== "object") throw new StoreError("bad_request", "send the envelope (signature optional)");
  try {
    const obj = signingObject(input as Envelope);
    const canonical = canonicalize(obj);
    const payload_hash = await sha256Hex(canonical);
    const env = input as Envelope;
    let signature_valid: boolean | null = null;
    let signature_error: string | undefined;
    if (typeof env.signature === "string" && env.issuer?.key_id) {
      const v = await verifyRecord(env);
      signature_valid = v.ok;
      signature_error = v.error;
    }
    return { canonical, payload_hash, signature_valid, signature_error, key_id: env.issuer?.key_id ?? null };
  } catch (e) {
    if (e instanceof FloatNotAllowedError) throw new StoreError("float_not_allowed", e.message, { path: e.path });
    throw e;
  }
}
