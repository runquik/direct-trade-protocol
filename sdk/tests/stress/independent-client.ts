// Stress-test client, intentionally independent of SDK canonicalization, keys,
// client, wire, and permission helpers. This is NOT a production SDK.
import { createHash, createPublicKey, generateKeyPairSync, randomUUID, sign, verify } from "node:crypto";
import type { KeyObject } from "node:crypto";

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58(bytes: Uint8Array): string {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`), out = "";
  while (n > 0n) { out = alphabet[Number(n % 58n)] + out; n /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; out = "1" + out; }
  return out;
}
function unbase58(s: string): Buffer {
  if (!s || [...s].some(c => !alphabet.includes(c))) throw new Error("invalid base58");
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(alphabet.indexOf(c));
  let hex = n.toString(16); if (hex.length % 2) hex = "0" + hex;
  return Buffer.concat([Buffer.alloc(s.match(/^1*/)?.[0].length ?? 0), n === 0n ? Buffer.alloc(0) : Buffer.from(hex, "hex")]);
}
export function canonical(value: any): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("integer-only wire format");
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = value.charCodeAt(++i);
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error("unpaired surrogate");
      } else if (c >= 0xdc00 && c <= 0xdfff) throw new Error("unpaired surrogate");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(k => `${canonical(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  throw new Error("unsupported JSON value");
}
export const hash = (value: any) => createHash("sha256").update(canonical(value)).digest("hex");
const uuidHash = (value: any) => {
  const h = hash(value).slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
export type Identity = { id: string; keyId: string; privateKey: KeyObject };
export function identity(): Identity {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keyId = "ed25519:" + base58(publicKey.export({ format: "der", type: "spki" }).subarray(-32));
  return { id: uuidHash({ domain: "PBP-PERSON-0.3", genesis_key: keyId }), keyId, privateKey };
}
export const orgId = (founder: string, nonce: string) => uuidHash({ domain: "PBP-ORGANIZATION-0.3", founder_id: founder, nonce });
export function commandBytes(command: any): Buffer {
  const { signatures: _, ...unsigned } = command;
  return Buffer.from(canonical({ domain: "PBP-COMMAND-0.3", command: unsigned }));
}
export function verifyCommand(command: any): boolean {
  return command.signatures.length > 0 && command.signatures.every((proof: any) => {
    const raw = unbase58(proof.key_id.replace(/^ed25519:/, ""));
    if (raw.length !== 32) return false;
    const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]), format: "der", type: "spki" });
    return verify(null, commandBytes(command), key, unbase58(proof.signature.replace(/^ed25519:/, "")));
  });
}
export function draft(audience: string, actor: Identity, action: string, organization_id: string | null, payload: any,
  options: { kind?: "person" | "installation"; requestedBy?: string | null; signers?: Identity[] } = {}): any {
  const now = Date.now();
  const command = { version: "0.3", audience, request_id: randomUUID(), issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + 120000).toISOString(), organization_id,
    actor: { kind: options.kind ?? "person", id: actor.id, key_id: actor.keyId },
    requested_by: options.requestedBy === undefined ? actor.id : options.requestedBy, action, payload, signatures: [] as any[] };
  return resign(command, options.signers ?? [actor]);
}
export function resign(command: any, signers: Identity[]): any {
  command.signatures = signers.map(p => ({ key_id: p.keyId, signature: "ed25519:" + base58(sign(null, commandBytes(command), p.privateKey)) }));
  return command;
}
export type Response = { status: number; result?: any; error?: any; bytes: number };
export class RawClient {
  audience: string;
  observations: any[] = [];
  constructor(audience: string) { this.audience = audience; }
  async send(command: any): Promise<Response> {
    const body = JSON.stringify(command);
    let response: globalThis.Response;
    try {
      response = await fetch(this.audience + "/pbp-store/commands", { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(30000) });
    } catch (error: any) {
      const result = { status: 0, bytes: Buffer.byteLength(body), error: { code: error.cause?.code ?? error.name, message: String(error), transport_failure: true } };
      this.observations.push({ action: command.action, request_id: command.request_id, organization_id: command.organization_id,
        actor_kind: command.actor.kind, request_hash: hash(command), ...result });
      return result;
    }
    const text = await response.text();
    let parsed: any = {}; try { parsed = JSON.parse(text); } catch { parsed = { error: { message: text } }; }
    const result = { status: response.status, result: parsed.result, error: parsed.error, bytes: Buffer.byteLength(body) };
    // No private keys or record bodies in the exported HTTP journal.
    this.observations.push({ action: command.action, request_id: command.request_id, organization_id: command.organization_id,
      actor_kind: command.actor.kind, request_hash: hash(command), status: result.status, bytes: result.bytes, error: result.error });
    return result;
  }
  act(actor: Identity, action: string, org: string | null, payload: any, options?: Parameters<typeof draft>[5]) {
    return this.send(draft(this.audience, actor, action, org, payload, options));
  }
  async ok(actor: Identity, action: string, org: string | null, payload: any, options?: Parameters<typeof draft>[5]): Promise<any> {
    const r = await this.act(actor, action, org, payload, options);
    if (r.status !== 200) throw new Error(`${action}: HTTP ${r.status}: ${JSON.stringify(r.error)}`);
    return r.result;
  }
}
