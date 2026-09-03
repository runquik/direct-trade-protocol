// Runtime access to the type registry + JSON Schema validation. Shared by the store and the tests.
import { Validator, type OutputUnit } from "@cfworker/json-schema";
import { ID_BASE, REGISTRY, SCHEMAS } from "./schemas.ts";
import { assertNoFloats, FloatNotAllowedError } from "./canonical.ts";
import { namespaceOf } from "./envelope.ts";

export type PrincipalKind = "company" | "module";

export interface TypeInfo {
  type: string;
  namespace: string;
  file: string;
  schema_versions: readonly string[];
  writable_by: readonly PrincipalKind[];
  subject: string;
  default_visibility: string;
  strict: boolean;
  schema: Record<string, unknown>;
  transitions: Transitions | null;
  roles: Record<string, string>;
}

export interface Transition {
  from: string;
  to: string;
  by: string[];
  within?: string;
  after?: string;
  trigger?: string;
  note?: string;
}
export interface Transitions {
  status_field: string | null;
  initial: { status: string[]; by: string[] };
  transitions: Transition[];
}

export interface ValidationIssue {
  path: string;
  message: string;
  keyword: string;
}

const WRAPPER_KEYWORDS = new Set(["properties", "$ref", "items", "allOf", "anyOf", "if", "then", "false"]);

function pointerToPath(p: string): string {
  // "#/a/0/b" -> "$.a[0].b"
  const parts = p.replace(/^#/, "").split("/").filter((x) => x.length > 0);
  let out = "$";
  for (const raw of parts) {
    const seg = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    out += /^\d+$/.test(seg) ? `[${seg}]` : `.${seg}`;
  }
  return out;
}

function toIssues(errors: OutputUnit[]): ValidationIssue[] {
  // cfworker reports every nested failure. Keep the specific ones: drop structural wrappers,
  // and drop container-level errors when a deeper error explains them.
  const all = errors.map((e) => ({ path: pointerToPath(e.instanceLocation), message: e.error, keyword: e.keyword }));
  const specific = all.filter((i) => !WRAPPER_KEYWORDS.has(i.keyword));
  const pool = specific.length ? specific : all;
  const out: ValidationIssue[] = [];
  const seen = new Set<string>();
  for (const i of pool) {
    const hasDeeper = pool.some((o) => o !== i && o.path.startsWith(i.path) && o.path.length > i.path.length);
    if (hasDeeper && (i.keyword === "additionalProperties" || i.keyword === "oneOf" || i.keyword === "not")) continue;
    const key = i.path + "|" + i.keyword;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(i);
  }
  return out.slice(0, 20);
}

const validators = new Map<string, Validator>();

/** Build a validator for one schema file, with every other schema registered for $ref resolution. */
function validatorFor(file: string): Validator {
  let v = validators.get(file);
  if (v) return v;
  const root = SCHEMAS[file];
  if (!root) throw new Error(`unknown schema file ${file}`);
  v = new Validator(root as any, "2020-12", false);
  for (const [f, s] of Object.entries(SCHEMAS)) {
    if (f === file) continue;
    v.addSchema(s as any, ID_BASE + f);
  }
  validators.set(file, v);
  return v;
}

export function listTypes(): string[] {
  return Object.keys(REGISTRY.types);
}

export function typeInfo(type: string): TypeInfo | null {
  const entry = (REGISTRY.types as Record<string, any>)[type];
  if (!entry) return null;
  const schema = SCHEMAS[entry.file] as Record<string, any>;
  return {
    type,
    namespace: namespaceOf(type),
    file: entry.file,
    schema_versions: entry.schema_versions,
    writable_by: entry.writable_by,
    subject: entry.subject,
    default_visibility: entry.default_visibility,
    strict: entry.strict,
    schema,
    transitions: (schema["x-dtp-transitions"] as Transitions | null) ?? null,
    roles: (schema["x-dtp-roles"] as Record<string, string>) ?? {},
  };
}

export function envelopeSchema(): Record<string, unknown> {
  return SCHEMAS[REGISTRY.envelope];
}

export interface ValidateOutcome {
  ok: boolean;
  issues: ValidationIssue[];
}

/** Validate the envelope shape (not the body's type-specific schema, not the signature). */
export function validateEnvelope(instance: unknown): ValidateOutcome {
  try {
    assertNoFloats(instance);
  } catch (e) {
    if (e instanceof FloatNotAllowedError) return { ok: false, issues: [{ path: e.path, message: e.message, keyword: "float_not_allowed" }] };
    throw e;
  }
  const r = validatorFor(REGISTRY.envelope).validate(instance);
  return { ok: r.valid, issues: toIssues(r.errors) };
}

/** Validate a body against the schema registered for `type`. */
export function validateBody(type: string, body: unknown): ValidateOutcome {
  const info = typeInfo(type);
  if (!info) return { ok: false, issues: [{ path: "$.type", message: `unknown type ${type}`, keyword: "unknown_type" }] };
  const r = validatorFor(info.file).validate(body);
  return { ok: r.valid, issues: toIssues(r.errors).map((i) => ({ ...i, path: "$.body" + i.path.slice(1) })) };
}

export function supportsVersion(type: string, version: string): boolean {
  const info = typeInfo(type);
  return !!info && info.schema_versions.includes(version);
}

/** Does the body use any x_ extension keys (record is "extended" but conformant)? */
export function hasExtensions(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  return Object.keys(body as object).some((k) => k.startsWith("x_"));
}
