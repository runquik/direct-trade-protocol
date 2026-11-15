// Regression (was a red-team gap test, #189, for finding #188 — surface 1, canonicalization and signing):
// the Core-1 record digest is invariant under the order of the `signatures` array.
//
// A record is a `Signed<Record>` (spec/core-1/README.md, part 3: { body, signatures }) and the record digest is
// SHA-256 over the canonical Signed<Record>, signatures included (part 5). The envelope supports several
// signatures (a threshold). Before #190, two honest parties holding the identical body and the identical valid
// signatures in a different array order computed different record digests, so `supersedes`, log leaves and
// receipts diverged. #190 (option A, pending the owner) takes `signatures` in ascending `key_id` order for the
// digest, and accepts any wire order. The GAP assertions below are now their EXPECTED lines.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair } from "../src/keys.ts";
import { signEnvelope, verifyEnvelope, type Signed } from "../src/core1/envelope.ts";
import { checkSupersession, parseRecord, recordDigest, verifyRecord, type RecordBody } from "../src/core1/record.ts";

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

test("a threshold record's digest does not depend on the order of the signatures array", async () => {
  const { ab, ba } = await bothOrders();

  // Both orderings verify, and agree on who signed.
  const vAb = await verifyEnvelope("DTP-RECORD-1", ab);
  const vBa = await verifyEnvelope("DTP-RECORD-1", ba);
  assert.equal(vAb.signers.size, 2);
  assert.deepEqual([...vAb.signers].sort(), [...vBa.signers].sort(), "same signer set either way");

  const dAb = await recordDigest(ab);
  const dBa = await recordDigest(ba);

  // Byte-identical signed content, one record digest.
  assert.equal(dAb, dBa, "a record has one digest regardless of signature order");

  // verifyRecord accepts both and hands back the same digest.
  const rAb = await verifyRecord(ab, { profile: "c".repeat(64) });
  const rBa = await verifyRecord(ba, { profile: "c".repeat(64) });
  assert.equal(rAb.digest, rBa.digest, "verifyRecord reports one digest for either order");
});

test("supersession holds across two honest orderings of the same predecessor", async () => {
  const { ab, ba } = await bothOrders();
  const dAb = await recordDigest(ab);
  const dBa = await recordDigest(ba);

  // A successor naming the predecessor's digest as computed from the [A,B] ordering.
  const signedNext = await signEnvelope("DTP-RECORD-1", body(2, dAb), [(await generateKeyPair()).secretKey]);
  // Rebuild the successor body against dAb explicitly (its own signatures are irrelevant to supersession).
  const next = parseRecord({ ...signedNext.body, supersedes: dAb, sequence: 2 });

  // Against the [A,B] copy of the predecessor, supersession holds.
  checkSupersession({ record: parseRecord(ab.body), digest: dAb }, next);

  // Against the [B,A] copy of the SAME predecessor (same body, same signatures, other order) it holds too.
  checkSupersession({ record: parseRecord(ba.body), digest: dBa }, next);
});
