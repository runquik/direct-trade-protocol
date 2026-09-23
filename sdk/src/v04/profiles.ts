// Bounded declarative contracts. No $ref, regex, network resolution or executable validators.
import { demand, digest, exact } from "./wire.ts";
import type { Profile, State } from "./model.ts";
/** Semantics labels a host runs built-in deterministic rules for; a publisher selects one, never redefines it. */
export const SEMANTICS = ["structural", "inventory-v1", "invoice-v1", "product-v1"] as const;
export function checkSchema(schema: unknown): void {
  let nodes = 0;
  function visit(s: any, depth: number) {
    demand(++nodes <= 256 && depth <= 8 && s && typeof s === "object" && !Array.isArray(s), "invalid_schema", "schema complexity exceeded", 400);
    const keys: Record<string, string[]> = { object: ["type", "properties", "required", "additionalProperties"], array: ["type", "items", "maxItems"],
      string: ["type", "maxLength"], integer: ["type", "minimum", "maximum"], boolean: ["type"], null: ["type"] };
    demand(typeof s.type === "string" && Object.hasOwn(keys, s.type), "invalid_schema", "unsupported schema type", 400);
    // `nullable: true` lets a field be absent-as-null without a union; it is the dialect's one optional keyword.
    if (s.nullable !== undefined) demand(s.nullable === true && s.type !== "null", "invalid_schema", "nullable must be true on a non-null type", 400);
    if (s.enum !== undefined) {
      demand(s.type === "string" && Array.isArray(s.enum) && s.enum.length > 0 && s.enum.length <= 64 && new Set(s.enum).size === s.enum.length && s.enum.every((v: any) => typeof v === "string" && v.length <= s.maxLength), "invalid_schema", "invalid bounded enum", 400);
    }
    exact(s, [...keys[s.type], ...(s.enum === undefined ? [] : ["enum"]), ...(s.nullable === undefined ? [] : ["nullable"])]);
    if (s.type === "object") {
      demand(s.properties && typeof s.properties === "object" && !Array.isArray(s.properties) && Object.keys(s.properties).length <= 64 && s.additionalProperties === false, "invalid_schema", "objects must be closed and bounded", 400);
      demand(Array.isArray(s.required) && new Set(s.required).size === s.required.length && s.required.every((v: any) => typeof v === "string" && Object.hasOwn(s.properties, v)), "invalid_schema", "invalid required fields", 400);
      for (const [key, child] of Object.entries(s.properties)) {
        demand(/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(key) && !["constructor", "prototype"].includes(key), "invalid_schema", "invalid field name", 400); visit(child, depth + 1);
      }
    }
    if (s.type === "array") { demand(Number.isInteger(s.maxItems) && s.maxItems >= 0 && s.maxItems <= 256, "invalid_schema", "array bound required", 400); visit(s.items, depth + 1); }
    if (s.type === "string") demand(Number.isInteger(s.maxLength) && s.maxLength > 0 && s.maxLength <= 65536, "invalid_schema", "string bound required", 400);
    if (s.type === "integer") demand(Number.isSafeInteger(s.minimum) && Number.isSafeInteger(s.maximum) && s.minimum <= s.maximum, "invalid_schema", "safe integer bounds required", 400);
  }
  visit(schema, 0);
}
export function validateShape(schema: any, value: any): boolean {
  if (value === null && schema.nullable === true) return true;
  switch (schema.type) {
    case "null": return value === null;
    case "boolean": return typeof value === "boolean";
    case "integer": return Number.isSafeInteger(value) && value >= schema.minimum && value <= schema.maximum;
    case "string": return typeof value === "string" && value.length <= schema.maxLength && (!schema.enum || schema.enum.includes(value));
    case "array": return Array.isArray(value) && value.length <= schema.maxItems && value.every(v => validateShape(schema.items, v));
    case "object": return value !== null && typeof value === "object" && !Array.isArray(value) && schema.required.every((k: string) => Object.hasOwn(value, k)) && Object.entries(value).every(([k, v]) => Object.hasOwn(schema.properties, k) && validateShape(schema.properties[k], v));
    default: return false;
  }
}
/** A kind is what a subscriber selects on: publisher namespace, name and major version. `dtp` is reserved for
 *  protocol kinds, registered in spec/profiles/index.json; every other namespace is a publisher organization id. */
export const PROTOCOL_KIND_NAMESPACE = "dtp";
export const KIND_REGISTRY_FORMAT = "dtp-profile-kinds-1";
export const KIND_PATTERN = "^(dtp|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[a-z][a-z0-9._-]{0,79}@(0|[1-9][0-9]*)$";
const kindRegex = new RegExp(KIND_PATTERN);
export function profileMajor(version: string): number {
  demand(typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version), "invalid_profile", "invalid profile version", 400);
  return Number(version.split(".")[0]);
}
export function profileKind(p: Pick<Profile, "publisher_id" | "name" | "version">): string { return `${p.publisher_id}/${p.name}@${profileMajor(p.version)}`; }
export function isKind(value: unknown): value is string { return typeof value === "string" && value.length <= 160 && kindRegex.test(value); }
/** Operator configuration: the protocol kind registry, loaded from spec/profiles/index.json or an operator's copy of it.
 *  Returns kind -> admitted profile digests. Only the reserved namespace may appear; a private kind needs no registration. */
export function parseKindRegistry(value: unknown): Record<string, string[]> {
  demand(value && typeof value === "object" && !Array.isArray(value) && (value as any).format === KIND_REGISTRY_FORMAT, "invalid_registry", "unsupported kind registry format", 400);
  const kinds = (value as any).kinds;
  demand(kinds && typeof kinds === "object" && !Array.isArray(kinds) && Object.keys(kinds).length <= 256, "invalid_registry", "bounded kinds object required", 400);
  const result: Record<string, string[]> = {};
  for (const [kind, entry] of Object.entries(kinds)) {
    demand(isKind(kind) && kind.startsWith(PROTOCOL_KIND_NAMESPACE + "/"), "invalid_registry", "only protocol kinds are registered", 400);
    const digests = (entry as any)?.digests;
    demand(entry && typeof entry === "object" && Array.isArray(digests) && digests.length >= 1 && digests.length <= 64 && new Set(digests).size === digests.length && digests.every((d: unknown) => typeof d === "string" && /^[0-9a-f]{64}$/.test(d)), "invalid_registry", "kind needs 1-64 distinct profile digests", 400);
    result[kind] = [...digests];
  }
  return result;
}
/** Expands kinds to the admitted, accessible profile digests they select. A kind that selects nothing is an explicit
 *  error, like an unknown digest, never an empty page: a subscriber must learn that a host does not carry a kind. */
export function expandKinds(state: State, kinds: string[], accessible: (p: Profile) => boolean, registry: Record<string, string[]> | undefined): string[] {
  const selected = new Set<string>();
  for (const kind of kinds) {
    demand(isKind(kind), "invalid", "invalid kind", 400);
    const digests = kind.startsWith(PROTOCOL_KIND_NAMESPACE + "/")
      ? (registry?.[kind] ?? []).filter(d => Object.hasOwn(state.profiles, d) && accessible(state.profiles[d]))
      : Object.values(state.profiles).filter(p => accessible(p) && profileKind(p) === kind).map(p => p.digest);
    demand(digests.length > 0, "unsupported_profile", `no admitted profile for kind ${kind}`, 422);
    for (const d of digests) selected.add(d);
  }
  return [...selected].sort();
}
export function profileContract(p: Pick<Profile, "publisher_id" | "name" | "version" | "schema" | "semantics" | "dependencies">) {
  return { publisher_id: p.publisher_id, name: p.name, version: p.version, schema: p.schema, semantics: p.semantics, dependencies: p.dependencies };
}
export async function validateProfile(p: Profile, state: State) {
  checkSchema(p.schema);
  demand(/^[a-z][a-z0-9._-]{0,79}$/.test(p.name) && /^\d+\.\d+\.\d+$/.test(p.version), "invalid_profile", "invalid profile identity/version", 400);
  demand(SEMANTICS.includes(p.semantics), "unsupported_semantics", "unsupported required semantics", 422);
  demand(Array.isArray(p.dependencies) && p.dependencies.length <= 8 && new Set(p.dependencies).size === p.dependencies.length && p.dependencies.every(d => typeof d === "string" && /^[0-9a-f]{64}$/.test(d) && Object.hasOwn(state.profiles, d)), "unsupported_dependency", "all dependencies must be pinned and admitted", 422);
  demand(p.digest === await digest(profileContract(p)), "digest_mismatch", "profile bytes differ from pinned digest", 422);
}
