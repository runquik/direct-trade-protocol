// GAP (red team, surface 1 — canonicalization and signing): the Core-1 record digest is not invariant under
// the order of the `signatures` array, and nothing in Core-1 pins a canonical order for that array.
//
// A record is a `Signed<Record>` (spec/core-1/README.md, part 3: { body, signatures }) and the record digest is
// "SHA-256 over the canonical Signed<Record>, signatures included, the digest a log leaf commits to" (part 5).
// `canonicalBytes` sorts object member names but never reorders an array, and the envelope explicitly supports
// several signatures ("Several signatures over the same input express a threshold"). So for a multi-signer
// (threshold) record, two honest parties holding the identical body and the identical valid signatures in a
// different array order verify both, agree on the signer set, yet compute DIFFERENT record digests — the digest
// that `supersedes` names, that a log leaf commits to, and that a receipt (DTP-LOG-HEAD-1) attests. `verifyEnvelope`
// returns only `signers: Set<string>`, discarding the order the digest depends on.
//
// These assertions pin the CURRENT, order-dependent behaviour so CI stays green. Each GAP assertion has the
// EXPECTED post-fix line beside it; they flip once Core-1 fixes a canonical signature order (e.g. the `signatures`
// array sorted by key_id before canonicalization and digest). See the linked red-team finding.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair } from "../src/keys.ts";
import { signEnvelope, verifyEnvelope, type Signed } from "../src/core1/envelope.ts";
import { RecordError, checkSupersession, parseRecord, recordDigest, verifyRecord, type RecordBody } from "../src/core1/record.ts";

function body(sequence: number, supersedes: string | null): RecordBody {
  return {
    issuer: { identity: "11111111-1111-4111-8111-111111111111", head: { sequence: 3, digest: "a".repeat(64) } },
    organization: { id: "22222222-2222-4222-8222-222222222222", head: { sequence: 1, digest: "b".repeat(64) } },
    profile: "c".repeat(64),
    sequence,
    supersedes,
    issued_at: 1730000000000,
    payload: { note: "a threshold-two organisation record" },
  };
}

// The identical body and the identical two valid signatures, assembled in each possible order.
async function bothOrders(): Promise<{ ab: Signed<RecordBody>; ba: Signed<RecordBody> }> {
  const a = await generateKeyPair();
  const b = await generateKeyPair();
  const ab = await signEnvelope("DTP-RECORD-1", body(1, null), [a.secretKey, b.secretKey]);
  const ba: Signed<RecordBody> = { body: ab.body, signatures: [ab.signatures[1], ab.signatures[0]] };
  return { ab, ba };
}

test("GAP: a threshold record's digest depends on the order of the signatures array", async () => {
  const { ab, ba } = await bothOrders();

  // Both orderings verify, and agree on who signed.
  const vAb = await verifyEnvelope("DTP-RECORD-1", ab);
  const vBa = await verifyEnvelope("DTP-RECORD-1", ba);
  assert.equal(vAb.signers.size, 2);
  assert.deepEqual([...vAb.signers].sort(), [...vBa.signers].sort(), "same signer set either way");

  const dAb = await recordDigest(ab);
  const dBa = await recordDigest(ba);

  // GAP: byte-identical signed content, two different record digests.
  assert.notEqual(dAb, dBa, "record digest is order-dependent (the gap)");
  // EXPECTED once a canonical signature order is pinned:
  // assert.equal(dAb, dBa, "a record has one digest regardless of signature order");

  // verifyRecord accepts both and hands back the two divergent digests, no error.
  const rAb = await verifyRecord(ab, { profile: "c".repeat(64) });
  const rBa = await verifyRecord(ba, { profile: "c".repeat(64) });
  assert.notEqual(rAb.digest, rBa.digest, "verifyRecord reports the order-dependent digest (the gap)");
});

test("GAP: supersession breaks across two honest orderings of the same predecessor", async () => {
  const { ab, ba } = await bothOrders();
  const dAb = await recordDigest(ab);
  const dBa = await recordDigest(ba);

  // A successor naming the predecessor's digest as computed from the [A,B] ordering.
  const signedNext = await signEnvelope("DTP-RECORD-1", body(2, dAb), [(await generateKeyPair()).secretKey]);
  // Rebuild the successor body against dAb explicitly (its own signatures are irrelevant to supersession).
  const next = parseRecord({ ...signedNext.body, supersedes: dAb, sequence: 2 });

  // Against the [A,B] copy of the predecessor, supersession holds.
  checkSupersession({ record: parseRecord(ab.body), digest: dAb }, next);

  // GAP: against the [B,A] copy of the SAME predecessor (same body, same signatures, other order) it is refused.
  assert.throws(
    () => checkSupersession({ record: parseRecord(ba.body), digest: dBa }, next),
    (error: unknown) => error instanceof RecordError && error.code === "broken_supersession",
    "a party holding the other signature order cannot follow the supersession chain (the gap)",
  );
  // EXPECTED once a canonical signature order is pinned: both copies share one digest, so both succeed.
});
