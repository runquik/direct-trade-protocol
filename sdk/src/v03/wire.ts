// PBP 0.3 signed commands. Separate from the frozen DTP/PBP 0.2 envelope.
import { canonicalBytes, canonicalize, sha256Hex, assertNoFloats } from "../canonical.ts";
import { signBytes, verifyBytes, encodeSignature, decodeSignature, type KeyPair } from "../keys.ts";
import { Validator } from "@cfworker/json-schema";
import { COMMAND_SCHEMA } from "./schema.ts";
const commandValidator = new Validator(COMMAND_SCHEMA, "2020-12", false);

export type Actor = { kind: "person" | "installation"; id: string; key_id: string };
export interface Command {
  version: "0.3";
  audience: string;
  request_id: string;
  issued_at: string;
  expires_at: string;
  organization_id: string | null;
  actor: Actor;
  requested_by: string | null;
  action: string;
  payload: Record<string, any>;
  signatures: { key_id: string; signature: string }[];
}
export class PbpError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 403) { super(message); this.code = code; this.status = status; }
}
export function demand(ok: unknown, code: string, message: string, status = 403): asserts ok {
  if (!ok) throw new PbpError(code, message, status);
}
export const same = (a: unknown, b: unknown) => canonicalize(a) === canonicalize(b);
export const digest = (value: unknown) => sha256Hex(canonicalBytes(value));
/** Self-certifying person ID, stable after rotation; genesis key history is preserved. */
export async function personId(keyId: string): Promise<string> {
  const h = await digest({ domain: "PBP-PERSON-0.3", genesis_key: keyId });
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
/** Organization identity is anchored to its founder and a nonce, not a store URL or name. */
export async function organizationId(founderId: string, nonce: string): Promise<string> {
  const h = await digest({ domain: "PBP-ORGANIZATION-0.3", founder_id: founderId, nonce });
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
export const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
export function exact(value: unknown, fields: string[]): asserts value is Record<string, any> {
  demand(value && typeof value === "object" && !Array.isArray(value), "invalid", "expected an object", 400);
  demand(same(Object.keys(value).sort(), [...fields].sort()), "invalid", "unexpected or missing fields", 400);
}
export function instant(value: unknown): number {
  demand(typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value), "invalid", "expected UTC millisecond timestamp", 400);
  const time = Date.parse(value);
  demand(Number.isFinite(time) && new Date(time).toISOString() === value, "invalid", "invalid timestamp", 400);
  return time;
}
export function commandBytes(command: Command): Uint8Array {
  const { signatures: _, ...unsigned } = command;
  return canonicalBytes({ domain: "PBP-COMMAND-0.3", command: unsigned });
}
export async function signaturesOf(command: Command): Promise<Set<string>> {
  const keys = new Set<string>();
  demand(Array.isArray(command.signatures) && command.signatures.length > 0 && command.signatures.length <= 16, "invalid", "1-16 signatures required", 400);
  for (const proof of command.signatures) {
    exact(proof, ["key_id", "signature"]);
    demand(!keys.has(proof.key_id), "invalid", "duplicate signature key", 400);
    let valid = false;
    try { valid = await verifyBytes(proof.key_id, commandBytes(command), decodeSignature(proof.signature)); } catch { /* reject malformed encodings */ }
    demand(valid, "signature_invalid", "command signature does not verify", 401);
    keys.add(proof.key_id);
  }
  demand(keys.has(command.actor.key_id), "signature_invalid", "actor must sign the command", 401);
  return keys;
}
export function validateCommand(input: unknown, audience: string, now: number): asserts input is Command {
  demand(commandValidator.validate(input).valid, "invalid", "command shape or action payload does not conform to PBP 0.3", 400);
  exact(input, ["version", "audience", "request_id", "issued_at", "expires_at", "organization_id", "actor", "requested_by", "action", "payload", "signatures"]);
  demand(input.version === "0.3" && input.audience === audience, "wrong_audience", "wrong protocol version or store audience", 400);
  demand(uuid(input.request_id) && (input.organization_id === null || uuid(input.organization_id)), "invalid", "invalid command IDs", 400);
  exact(input.actor, ["kind", "id", "key_id"]);
  demand(["person", "installation"].includes(input.actor.kind) && uuid(input.actor.id) && typeof input.actor.key_id === "string", "invalid", "invalid actor", 400);
  demand(input.requested_by === null || uuid(input.requested_by), "invalid", "invalid requester", 400);
  demand(typeof input.action === "string" && input.payload && typeof input.payload === "object" && !Array.isArray(input.payload), "invalid", "invalid action payload", 400);
  const start = instant(input.issued_at), end = instant(input.expires_at);
  demand(start <= now + 30000 && end > now && end > start && end - start <= 300000, "expired", "command outside its five-minute validity window", 401);
  assertNoFloats(input);
}
export async function signCommand(command: Command, keys: KeyPair[]): Promise<Command> {
  const result = structuredClone(command);
  result.signatures = [];
  for (const key of keys) result.signatures.push({ key_id: key.keyId, signature: encodeSignature(await signBytes(key.secretKey, commandBytes(result))) });
  return result;
}
export function draftCommand(audience: string, person: { id: string; key: KeyPair }, action: string,
  organization_id: string | null, payload: Record<string, any>, now = Date.now()): Command {
  return { version: "0.3", audience, request_id: crypto.randomUUID(), issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + 120000).toISOString(), organization_id,
    actor: { kind: "person", id: person.id, key_id: person.key.keyId }, requested_by: person.id, action, payload, signatures: [] };
}
