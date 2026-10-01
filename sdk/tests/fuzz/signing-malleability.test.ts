// Expected-observation GAP probe: a passing test reproduces a specification gap.
// It does NOT assert a defect in sdk/src — the reference verifier behaves safely.
// It records, executably, that spec/v0.4/SPEC.md does not pin an Ed25519 VERIFICATION
// rule, so two conforming "Ed25519" implementations disagree about the validity of a
// malleated signature. See the linked red-team finding for impact and the fix.
//
// Background. v0.4 signs with Ed25519 (keys.ts, WebCrypto). SPEC.md requires "Every
// supplied signature must verify" but never states which verification equation a
// receiver must use: RFC 8032's canonical-S check (reject S >= L), point canonicality,
// cofactor handling. RFC 8032 section 8.4 ("Signature malleability") and Chalkias et al.,
// "Taming the Many EdDSAs" (2020), show different libraries disagree on exactly these
// edge cases. The reference uses WebCrypto, which is strict (rejects S >= L). A naive or
// NEAR-era (tweetnacl) verifier that omits the S < L check accepts S + L, because
// (S + L)*B = S*B + L*B = S*B (B has order L), so the verification equation is unchanged.
//
// This probe takes a valid reference signature, forms S' = S + L (non-canonical, S' >= L,
// S' ≡ S mod L), and shows:
//   - the reference verifier (WebCrypto) ACCEPTS the original and REJECTS S + L, and
//   - a textbook cofactorless verifier that omits the canonical-S check ACCEPTS BOTH.
// Both assertions pass on current main; the "gap" is the divergence itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { keyPairFromSecret, signBytes, verifyBytes } from "../../src/keys.ts";
import { base58Encode } from "../../src/base58.ts";
import { ed25519 } from "@noble/curves/ed25519";
import { sha512 } from "@noble/hashes/sha512";

const L = ed25519.CURVE.n; // Ed25519 group order
const leToBig = (b: Uint8Array): bigint => {
  let n = 0n;
  for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]);
  return n;
};
const bigToLe32 = (x: bigint): Uint8Array => {
  let n = x;
  const o = new Uint8Array(32);
  for (let i = 0; i < 32; i++) { o[i] = Number(n & 0xffn); n >>= 8n; }
  return o;
};

/** RFC 8032 cofactorless verify WITHOUT the step-1 canonical-S check (what tweetnacl-class libs do). */
function textbookVerifyNoCanonicalS(sig: Uint8Array, msg: Uint8Array, pub: Uint8Array): boolean {
  const R = ed25519.Point.fromHex(sig.slice(0, 32));
  const A = ed25519.Point.fromHex(pub);
  const s = leToBig(sig.slice(32, 64)) % L; // reduce instead of rejecting S >= L
  const k = leToBig(sha512(new Uint8Array([...sig.slice(0, 32), ...pub, ...msg]))) % L;
  const lhs = ed25519.Point.BASE.multiply(s === 0n ? L : s); // s*B
  const rhs = R.add(A.multiply(k === 0n ? L : k)); // R + k*A
  return lhs.equals(rhs);
}

test("GAP: SPEC.md does not pin Ed25519 verification; strict (reference) and non-strict verifiers disagree on a malleated signature", async () => {
  // Public test-only seed (same style as spec/v0.4/signing-vector.json): 32 bytes of 0x07.
  const seed = new Uint8Array(32).fill(7);
  const pub = ed25519.getPublicKey(seed);
  const secret = "ed25519:" + base58Encode(new Uint8Array([...seed, ...pub]));
  const kp = await keyPairFromSecret(secret);
  const msg = new TextEncoder().encode("dtp signing-malleability gap probe");

  const sig = await signBytes(kp.secretKey, msg); // 64 bytes: R (32) || S (32), little-endian
  const R = sig.slice(0, 32);
  const S = leToBig(sig.slice(32, 64));
  const Sprime = S + L; // non-canonical encoding of the same scalar mod L
  const sigPrime = new Uint8Array([...R, ...bigToLe32(Sprime)]);

  // The two encodings are distinct bytes but encode the same scalar mod L.
  assert.ok(S < L, "canonical S is below the group order");
  assert.ok(Sprime >= L, "S + L is a non-canonical encoding (>= L)");
  assert.equal(Sprime % L, S, "S + L reduces to S mod L");

  // Reference verifier (WebCrypto) is strict: accepts canonical, rejects non-canonical S.
  assert.equal(await verifyBytes(kp.keyId, msg, sig), true, "reference accepts the canonical signature");
  assert.equal(await verifyBytes(kp.keyId, msg, sigPrime), false, "reference rejects S + L (RFC 8032 canonical-S)");

  // A conforming-but-non-strict verifier that omits the canonical-S check accepts BOTH.
  // This is the divergence the specification leaves open.
  assert.equal(textbookVerifyNoCanonicalS(sig, msg, pub), true, "non-strict verifier accepts the canonical signature");
  assert.equal(textbookVerifyNoCanonicalS(sigPrime, msg, pub), true, "non-strict verifier ALSO accepts S + L — interop divergence");
});
