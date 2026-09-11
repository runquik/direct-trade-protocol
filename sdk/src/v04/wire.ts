// v0.4 is explicitly domain-separated; v0.2/v0.3 signed bytes are unchanged.
import { canonicalBytes, canonicalize, sha256Hex, assertNoFloats } from "../canonical.ts";
import { signBytes, verifyBytes, encodeSignature, decodeSignature, decodeKeyId } from "../keys.ts";
import type { KeyPair } from "../keys.ts";
import type { Command, Context, SignedToken } from "./model.ts";
import { Validator } from "@cfworker/json-schema";
import { COMMAND_SCHEMA } from "./schema.ts";
const commandValidator=new Validator(COMMAND_SCHEMA,"2020-12",false);
export class DtpError extends Error {
  code: string; status: number;
  constructor(code: string, message: string, status = 403) { super(message); this.code = code; this.status = status; }
}
export function demand(ok: unknown, code: string, message: string, status = 403): asserts ok {
  if (!ok) throw new DtpError(code, message, status);
}
export const same = (a: unknown, b: unknown) => canonicalize(a) === canonicalize(b);
export const digest = (value: unknown) => sha256Hex(canonicalBytes(value));
export const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
export function exact(value: unknown, fields: string[]): asserts value is Record<string, any> {
  demand(value && typeof value === "object" && !Array.isArray(value), "invalid", "expected object", 400);
  demand(same(Object.keys(value).sort(), [...fields].sort()), "invalid", "unexpected or missing fields", 400);
}
export function instant(value: unknown): number {
  demand(typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value), "invalid", "expected UTC millisecond instant", 400);
  const n = Date.parse(value); demand(Number.isFinite(n) && new Date(n).toISOString() === value, "invalid", "invalid instant", 400); return n;
}
export function validKey(key: unknown): asserts key is string {
  try { demand(typeof key === "string", "invalid", "expected public key", 400); decodeKeyId(key); }
  catch { throw new DtpError("invalid", "invalid public key", 400); }
}
const idHash = async (value: unknown) => { const h = await digest(value); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`; };
export const personId = (key: string) => idHash({ domain: "DTP-PERSON-0.4", genesis_key: key });
export const organizationId = (founder: string, nonce: string) => idHash({ domain: "DTP-ORGANIZATION-0.4", founder_id: founder, nonce });
export function commandBytes(c: Command): Uint8Array {
  const { signatures: _, ...command } = c; return canonicalBytes({ domain: "DTP-COMMAND-0.4", command });
}
export function validateCommand(input: unknown, audience: string, now: number): asserts input is Command {
  demand(commandValidator.validate(input).valid,"invalid","command or action payload does not conform to v0.4",400);
  exact(input, ["version", "audience", "request_id", "issued_at", "expires_at", "organization_id", "actor", "requested_by", "action", "payload", "signatures"]);
  demand(input.version === "0.4" && input.audience === audience, "wrong_audience", "wrong protocol or audience", 400);
  demand(uuid(input.request_id) && (input.organization_id === null || uuid(input.organization_id)), "invalid", "invalid command IDs", 400);
  exact(input.actor, ["kind", "id", "key_id"]);
  demand(["person", "installation"].includes(input.actor.kind) && uuid(input.actor.id), "invalid", "invalid actor", 400); validKey(input.actor.key_id);
  demand(input.requested_by === null || uuid(input.requested_by), "invalid", "invalid requester", 400);
  demand(typeof input.action === "string" && input.action.length <= 80 && input.payload && typeof input.payload === "object" && !Array.isArray(input.payload), "invalid", "invalid operation", 400);
  const start = instant(input.issued_at), end = instant(input.expires_at);
  demand(start <= now + 30000 && end > now && end > start && end - start <= 300000, "expired", "command expired or outside five-minute window", 401);
  assertNoFloats(input);
}
export async function verifyCommand(c: Command): Promise<Set<string>> {
  demand(Array.isArray(c.signatures) && c.signatures.length > 0 && c.signatures.length <= 16, "invalid", "1-16 signatures required", 400);
  const result = new Set<string>();
  for (const proof of c.signatures) {
    exact(proof, ["key_id", "signature"]); demand(!result.has(proof.key_id), "invalid", "duplicate signature", 400);
    let ok = false; try { ok = await verifyBytes(proof.key_id, commandBytes(c), decodeSignature(proof.signature)); } catch { /* reject */ }
    demand(ok, "signature_invalid", "signature does not verify", 401); result.add(proof.key_id);
  }
  demand(result.has(c.actor.key_id), "signature_invalid", "actor signature required", 401); return result;
}
export async function signCommand(c: Command, keys: KeyPair[]): Promise<Command> {
  const result = structuredClone(c); result.signatures = [];
  for (const key of keys) result.signatures.push({ key_id: key.keyId, signature: encodeSignature(await signBytes(key.secretKey, commandBytes(result))) });
  return result;
}
export function draftCommand(audience: string, person: { id: string; key: KeyPair }, action: string, organization_id: string | null, payload: Record<string, any>, now = Date.now()): Command {
  return { version: "0.4", audience, request_id: crypto.randomUUID(), issued_at: new Date(now).toISOString(), expires_at: new Date(now + 120000).toISOString(),
    organization_id, actor: { kind: "person", id: person.id, key_id: person.key.keyId }, requested_by: person.id, action, payload, signatures: [] };
}
function tokenBytes(body: Record<string, any>) { return canonicalBytes({ domain: "DTP-TOKEN-0.4", body }); }
export async function signToken(body: Record<string, any>, ctx: Context): Promise<SignedToken> {
  demand(body.issuer === ctx.audience, "invalid", "token issuer must be this host", 400);
  return { body: structuredClone(body), key_id: ctx.storeKey.keyId, signature: encodeSignature(await signBytes(ctx.storeKey.secretKey, tokenBytes(body))) };
}
export async function verifyToken(token: SignedToken, ctx: Context, expectedKind: string): Promise<Record<string, any>> {
  exact(token, ["body", "key_id", "signature"]);
  const body = token.body; demand(body && typeof body === "object" && !Array.isArray(body) && body.kind === expectedKind, "invalid_token", "wrong token kind");
  const pinned = body.issuer === ctx.audience ? ctx.storeKey.keyId : ctx.pins[body.issuer];
  demand(pinned && pinned === token.key_id, "untrusted_source", "issuer is not pinned");
  let ok = false; try { ok = await verifyBytes(token.key_id, tokenBytes(body), decodeSignature(token.signature)); } catch { /* reject */ }
  demand(ok, "signature_invalid", "host token signature does not verify", 401);
  demand(instant(body.issued_at) <= ctx.now + 30000 && instant(body.expires_at) > ctx.now && instant(body.expires_at) > instant(body.issued_at), "expired", "host token expired", 401);
  return body;
}
export async function verifyAssessment(token: SignedToken, ctx: Context): Promise<Record<string,any>> {
  demand(token?.body && ctx.assessmentPins?.[token.body.issuer] === token.key_id,"untrusted_assessor","artifact assessment issuer is not explicitly trusted");
  demand(!ctx.revokedAssessments?.includes(await digest(token)),"assessment_revoked","artifact assessment was revoked");
  return verifyToken(token,{...ctx,pins:ctx.assessmentPins??{}},"module-assessment");
}
