// The DTP v0.2 record envelope. Body types are generated into ./types.ts from spec/schemas.

export type Visibility = "public" | "counterparties" | "granted" | "private";

export interface Issuer {
  key_id: string;
  company_id: string;
  module_id: string | null;
}

/** Envelope fields that are signed (everything except `signature`). */
export interface UnsignedEnvelope<TBody = Record<string, unknown>> {
  record_id: string;
  root_id: string;
  type: string;
  namespace: string;
  schema_version: string;
  subject_company_id: string;
  counterparty_ids: string[];
  issuer: Issuer;
  visibility: Visibility;
  created_at: string;
  supersedes: string | null;
  body: TBody;
}

export interface Envelope<TBody = Record<string, unknown>> extends UnsignedEnvelope<TBody> {
  signature: string;
}

/** Fields the store adds when it returns a record. */
export interface StoredRecord<TBody = Record<string, unknown>> extends Envelope<TBody> {
  seq: number;
  received_at: string;
  payload_hash: string;
  is_head: boolean;
  superseded_by: string | null;
}

export const SIGNED_FIELDS = [
  "record_id",
  "root_id",
  "type",
  "namespace",
  "schema_version",
  "subject_company_id",
  "counterparty_ids",
  "issuer",
  "visibility",
  "created_at",
  "supersedes",
  "body",
] as const;

export function namespaceOf(type: string): string {
  const i = type.indexOf(".");
  return i < 0 ? type : type.slice(0, i);
}

/** RFC 3339 UTC with milliseconds and Z, as DTP requires. */
export function nowIso(): string {
  return new Date().toISOString();
}

export function newRecordId(): string {
  return crypto.randomUUID();
}
