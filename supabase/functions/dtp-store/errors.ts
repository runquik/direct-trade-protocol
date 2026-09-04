// Error codes for the DTP protocol store. Wire shape: { error: { code, message, details } }.

export type ErrorCode =
  | "bad_request"
  | "envelope_invalid"
  | "schema_invalid"
  | "float_not_allowed"
  | "unknown_type"
  | "auth_required"
  | "auth_invalid"
  | "signature_invalid"
  | "issuer_mismatch"
  | "key_unknown"
  | "key_inactive"
  | "forbidden"
  | "grant_missing"
  | "issuer_not_party"
  | "not_found"
  | "duplicate_record_id"
  | "supersedes_conflict"
  | "transition_forbidden"
  | "payload_too_large"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  envelope_invalid: 422,
  schema_invalid: 422,
  float_not_allowed: 422,
  unknown_type: 422,
  auth_required: 401,
  auth_invalid: 401,
  signature_invalid: 401,
  issuer_mismatch: 401,
  key_unknown: 401,
  key_inactive: 403,
  forbidden: 403,
  grant_missing: 403,
  issuer_not_party: 403,
  not_found: 404,
  duplicate_record_id: 409,
  supersedes_conflict: 409,
  transition_forbidden: 409,
  payload_too_large: 413,
  internal: 500,
};

export class StoreError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "StoreError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details ?? {};
  }
  toBody(): { error: { code: ErrorCode; message: string; details: unknown } } {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export function isStoreError(e: unknown): e is StoreError {
  return e instanceof StoreError || (typeof e === "object" && e !== null && (e as any).name === "StoreError");
}

/** Postgres unique-violation (SQLSTATE 23505) → the constraint name, or null if `e` is something else. */
export function uniqueViolation(e: unknown): string | null {
  const err = e as { code?: string; constraint_name?: string; constraint?: string; message?: string } | null;
  if (!err || err.code !== "23505") return null;
  return err.constraint_name ?? err.constraint ?? (err.message?.match(/constraint "([^"]+)"/)?.[1] ?? "unique");
}
