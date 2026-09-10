// Bounded declarative contracts. No $ref, regex, network resolution or executable validators.
import { demand, digest, exact } from "./wire.ts";
import type { Profile, State } from "./model.ts";
export function checkSchema(schema: unknown): void {
  let nodes = 0;
  function visit(s: any, depth: number) {
    demand(++nodes <= 256 && depth <= 8 && s && typeof s === "object" && !Array.isArray(s), "invalid_schema", "schema complexity exceeded", 400);
    const keys: Record<string, string[]> = { object: ["type", "properties", "required", "additionalProperties"], array: ["type", "items", "maxItems"],
      string: ["type", "maxLength"], integer: ["type", "minimum", "maximum"], boolean: ["type"], null: ["type"] };
    demand(typeof s.type === "string" && Object.hasOwn(keys, s.type), "invalid_schema", "unsupported schema type", 400);
    if (s.enum !== undefined) {
      demand(s.type === "string" && Array.isArray(s.enum) && s.enum.length > 0 && s.enum.length <= 64 && new Set(s.enum).size === s.enum.length && s.enum.every((v: any) => typeof v === "string" && v.length <= s.maxLength), "invalid_schema", "invalid bounded enum", 400);
    }
    exact(s, [...keys[s.type], ...(s.enum === undefined ? [] : ["enum"])]);
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
export function profileContract(p: Pick<Profile, "publisher_id" | "name" | "version" | "schema" | "semantics" | "dependencies">) {
  return { publisher_id: p.publisher_id, name: p.name, version: p.version, schema: p.schema, semantics: p.semantics, dependencies: p.dependencies };
}
export async function validateProfile(p: Profile, state: State) {
  checkSchema(p.schema);
  demand(/^[a-z][a-z0-9._-]{0,79}$/.test(p.name) && /^\d+\.\d+\.\d+$/.test(p.version), "invalid_profile", "invalid profile identity/version", 400);
  demand(["structural", "inventory-v1", "invoice-v1"].includes(p.semantics), "unsupported_semantics", "unsupported required semantics", 422);
  demand(Array.isArray(p.dependencies) && p.dependencies.length <= 8 && new Set(p.dependencies).size === p.dependencies.length && p.dependencies.every(d => typeof d === "string" && /^[0-9a-f]{64}$/.test(d) && Object.hasOwn(state.profiles, d)), "unsupported_dependency", "all dependencies must be pinned and admitted", 422);
  demand(p.digest === await digest(profileContract(p)), "digest_mismatch", "profile bytes differ from pinned digest", 422);
}
