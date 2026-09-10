// Independent interoperability test client. Imports only native Node primitives;
// no SDK wire, schema, canonicalization, key codec or signing implementation.
// Not a production client and not an independent third-party implementation claim.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, verify } from "node:crypto";
import type { KeyObject } from "node:crypto";

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58(bytes: Uint8Array): string {
  let number = 0n;
  for (const byte of bytes) number = number * 256n + BigInt(byte);
  let text = "";
  while (number > 0n) { text = alphabet[Number(number % 58n)] + text; number /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; text = "1" + text; }
  return text;
}
export function unbase58(text: string): Buffer {
  if (typeof text !== "string" || !text.length || text.length > 100 || [...text].some(c => !alphabet.includes(c))) throw new Error("invalid bounded base58");
  let number = 0n;
  for (const char of text) number = number * 58n + BigInt(alphabet.indexOf(char));
  const bytes: number[] = [];
  while (number > 0n) { bytes.unshift(Number(number % 256n)); number /= 256n; }
  const zeros = text.match(/^1*/)?.[0].length ?? 0;
  const result = Buffer.from([...Array(zeros).fill(0), ...bytes]);
  if (base58(result) !== text) throw new Error("noncanonical base58");
  return result;
}
export function canonical(value: unknown): string {
  const visiting = new Set<object>();
  function encode(item: any, depth: number): string {
    if (depth > 64) throw new Error("canonical nesting bound");
    if (item === null) return "null";
    if (typeof item === "boolean") return item ? "true" : "false";
    if (typeof item === "number") { if (!Number.isSafeInteger(item)) throw new Error("only safe integers belong on the wire"); return JSON.stringify(item); }
    if (typeof item === "string") {
      for (let i = 0; i < item.length; i++) {
        const point = item.charCodeAt(i);
        if (point >= 0xd800 && point <= 0xdbff) { const next = item.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error("unpaired Unicode surrogate"); }
        else if (point >= 0xdc00 && point <= 0xdfff) throw new Error("unpaired Unicode surrogate");
      }
      return JSON.stringify(item);
    }
    if (typeof item !== "object" || visiting.has(item)) throw new Error("unsupported or cyclic JSON value");
    visiting.add(item);
    try {
      if (Array.isArray(item)) {
        const parts: string[] = [];
        for (let i = 0; i < item.length; i++) { if (!Object.hasOwn(item, i)) throw new Error("sparse array"); parts.push(encode(item[i], depth + 1)); }
        return "[" + parts.join(",") + "]";
      }
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new Error("only plain JSON objects");
      return "{" + Object.keys(item).sort().map(key => encode(key, depth + 1) + ":" + encode(item[key], depth + 1)).join(",") + "}";
    } finally { visiting.delete(item); }
  }
  return encode(value, 0);
}
export const hash = (value: unknown) => createHash("sha256").update(canonical(value), "utf8").digest("hex");
function uuidHash(value: unknown) { const h = hash(value).slice(0, 32); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`; }
export const personId = (keyId: string) => uuidHash({ domain: "DTP-PERSON-0.4", genesis_key: keyId });
export const organizationId = (founder: string, nonce: string) => uuidHash({ domain: "DTP-ORGANIZATION-0.4", founder_id: founder, nonce });
export interface NativeIdentity { id: string; keyId: string; privateKey: KeyObject }
export function identity(seed?: Uint8Array): NativeIdentity {
  if (seed && seed.length !== 32) throw new Error("Ed25519 seed must be exactly 32 bytes");
  const privateKey = seed ? createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" }) : generateKeyPairSync("ed25519").privateKey;
  const publicBytes = createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(-32);
  const keyId = "ed25519:" + base58(publicBytes);
  return { id: personId(keyId), keyId, privateKey };
}
export interface NativeCommand {
  version: string; audience: string; request_id: string; issued_at: string; expires_at: string; organization_id: string | null;
  actor: { kind: "person" | "installation"; id: string; key_id: string }; requested_by: string | null;
  action: string; payload: Record<string, any>; signatures: { key_id: string; signature: string }[];
}
export function commandBytes(command: NativeCommand): Buffer {
  const { signatures: _, ...unsigned } = command;
  return Buffer.from(canonical({ domain: "DTP-COMMAND-0.4", command: unsigned }), "utf8");
}
export function resign(command: NativeCommand, signers: NativeIdentity[]): NativeCommand {
  const result = structuredClone(command); result.signatures = [];
  result.signatures = signers.map(signer => ({ key_id: signer.keyId, signature: "ed25519:" + base58(sign(null, commandBytes(result), signer.privateKey)) }));
  return result;
}
export function draft(audience: string, actor: NativeIdentity, action: string, organization_id: string | null, payload: Record<string, any>, now = Date.now()): NativeCommand {
  return resign({ version: "0.4", audience, request_id: randomUUID(), issued_at: new Date(now).toISOString(), expires_at: new Date(now + 120000).toISOString(),
    organization_id, actor: { kind: "person", id: actor.id, key_id: actor.keyId }, requested_by: actor.id, action, payload, signatures: [] }, [actor]);
}
export function verifyCommand(command: NativeCommand): boolean {
  try {
    if (!Array.isArray(command.signatures) || !command.signatures.length || command.signatures.length > 16) return false;
    const keys = new Set<string>();
    for (const proof of command.signatures) {
      if (!proof.key_id.startsWith("ed25519:") || !proof.signature.startsWith("ed25519:") || keys.has(proof.key_id)) return false;
      const key = unbase58(proof.key_id.slice(8)), signature = unbase58(proof.signature.slice(8));
      if (key.length !== 32 || signature.length !== 64) return false;
      const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key]), format: "der", type: "spki" });
      if (!verify(null, commandBytes(command), publicKey, signature)) return false;
      keys.add(proof.key_id);
    }
    return keys.has(command.actor.key_id);
  } catch { return false; }
}
export class NativeClient {
  readonly audience: string;
  constructor(audience: string) { this.audience = audience; }
  async send(command: NativeCommand): Promise<{ status: number; result?: any; error?: any }> {
    const response = await fetch(this.audience + "/dtp/v0.4/commands", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command), signal: AbortSignal.timeout(30000) });
    return { status: response.status, ...await response.json() };
  }
  act(actor: NativeIdentity, action: string, org: string | null, payload: Record<string, any>) { return this.send(draft(this.audience, actor, action, org, payload)); }
  async ok(actor: NativeIdentity, action: string, org: string | null, payload: Record<string, any>) {
    const response = await this.act(actor, action, org, payload);
    if (response.status !== 200) throw new Error(`${action}: HTTP ${response.status} ${JSON.stringify(response.error)}`);
    return response.result;
  }
}
