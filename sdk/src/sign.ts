import { canonicalBytes, sha256Hex } from "./canonical.ts";
import { decodeSignature, encodeSignature, signBytes, verifyBytes } from "./keys.ts";
import { SIGNED_FIELDS, type Envelope, type UnsignedEnvelope } from "./envelope.ts";

/** Pick exactly the signed fields (drops `signature` and any unknown keys). */
export function signingObject(env: UnsignedEnvelope | Envelope): UnsignedEnvelope {
  const src = env as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of SIGNED_FIELDS) out[f] = src[f] === undefined ? null : src[f];
  if (out.counterparty_ids === null) out.counterparty_ids = [];
  return out as unknown as UnsignedEnvelope;
}

/** Canonical bytes that get signed: JCS(envelope minus signature). */
export function signingInput(env: UnsignedEnvelope | Envelope): Uint8Array {
  return canonicalBytes(signingObject(env));
}

export async function payloadHash(env: UnsignedEnvelope | Envelope): Promise<string> {
  return sha256Hex(signingInput(env));
}

export async function signRecord<T>(env: UnsignedEnvelope<T>, secretKey: string): Promise<Envelope<T>> {
  const base = signingObject(env as unknown as UnsignedEnvelope) as unknown as UnsignedEnvelope<T>;
  const sig = await signBytes(secretKey, canonicalBytes(base));
  return { ...base, signature: encodeSignature(sig) };
}

export interface VerifyResult {
  ok: boolean;
  payload_hash: string;
  key_id: string;
  error?: string;
}

/** Verify `env.signature` against `env.issuer.key_id` over the canonical signing input. */
export async function verifyRecord(env: Envelope): Promise<VerifyResult> {
  const input = signingInput(env);
  const payload_hash = await sha256Hex(input);
  const key_id = env.issuer?.key_id ?? "";
  try {
    const ok = await verifyBytes(key_id, input, decodeSignature(env.signature));
    return { ok, payload_hash, key_id, error: ok ? undefined : "signature does not verify" };
  } catch (e) {
    return { ok: false, payload_hash, key_id, error: (e as Error).message };
  }
}
