# Portable identity log, draft 1

September 21, 2026. Status: unreleased foundation layer, implementer-tested, pending independent review. It adds a format and a verifier. It changes no existing signing domain, no signed document and no rule in `identity.ts`.

## The problem

A control head is `{identity_id, sequence, previous_digest, operational, recovery, effective_at}` and its digest is what transitions chain on and what resolutions carry. Every member comes from documents the owner signed except `effective_at`. A host sets that to its own clock at enrollment, and to `max(now, last_lease_expiry + CLOCK_MARGIN_MS)` at each transition. A verifier holding only the signed genesis and the signed transitions therefore could not reproduce any head digest: it needed the host's clock at each step and its lease history. An identity's history could only be believed, not checked.

## What the log is

The log carries the signed documents plus the one host-asserted value per head, the instant itself. Lease history and acceptance times are not needed: they only ever mattered through the instant they produced, and the rules below bound that instant without them.

```
IdentityLog      { format: "dtp-identity-log-1", genesis: Signed<Genesis>, enrollment: Signed<ResolverEnrollment>, entries: [Entry, ...] }
Entry            { effective_at: integer ms, transition: Signed<Transition> | null, attestation: Signed<HeadAttestation> | null }
HeadAttestation  { identity_id, resolver_id, resolver_epoch, sequence, head_digest, effective_at }
```

`entries[n]` describes head `n`. `entries[0].transition` is `null`; every later entry carries the owner-signed transition that produced its head. All objects are closed. There are between 1 and 4096 entries. The log holds public keys and signatures only.

## Normative: verification

A verifier MUST refuse the log unless all of the following hold. It needs no clock and no network.

1. **Shape.** The format string is exactly `dtp-identity-log-1`; objects have exactly the members above; instants are non-negative safe integers.
2. **Genesis.** The genesis verifies under `DTP-PERSON-GENESIS-1` with possession by every genesis key, as the identity contract requires. The identity id is derived from it.
3. **Enrollment.** The enrollment verifies under `DTP-IDENTITY-ENROLLMENT-1` with both the operational and the recovery quorum of the genesis, and names this identity and genesis digest. It fixes the resolver id, resolver key and audience for the whole log, at resolver epoch 0.
4. **Head 0** is `{identity_id, 0, null, genesis.operational, genesis.recovery, entries[0].effective_at}`, and `enrollment.issued_at <= entries[0].effective_at < enrollment.expires_at`.
5. **Each transition** `n >= 1`, against head `n-1`, satisfies every rule of the identity contract that does not depend on the verifier's clock: exact `expected_digest` and `sequence`, the quorum its `kind` requires, possession by every added key, operational and recovery sets disjoint, no retired key reinstated, the resolver key never in a control set, recovery unchanged by `rotate`/`recover` and operational unchanged by `recovery-policy`, and a signed window `issued_at < expires_at <= issued_at + 300000`.
6. **Each instant** `E[n]`, `n >= 1`, with the transition's signed window `[issued_at, expires_at)`:
   - `E[n] >= issued_at`
   - `E[n] >= E[n-1]`
   - `E[n-1] < expires_at`
   - `E[n] <= expires_at - 1 + LEASE_MS + CLOCK_MARGIN_MS`

   These are exactly the instants some honest host timeline could have produced: acceptance inside the window and after the previous head took effect, then at most one full lease plus the margin.
7. **Head `n`** is `{identity_id, n, digest(head n-1), transition.operational, transition.recovery, E[n]}`. A digest is SHA-256 over canonical JSON.
8. **Attestations.** Every attestation present is signed under `DTP-IDENTITY-LOG-HEAD-1` by exactly the enrolled resolver key, and its body equals the head it sits beside, member for member. The verifier's caller MUST state whether heads without an attestation are acceptable. There is no default.

Conformance vectors, including tampered, reordered, truncated and spliced logs: [`spec/vectors/identity-log.json`](../../spec/vectors/identity-log.json).

## What a verified log proves, and what it does not

**Proves.** This identity id belongs to this genesis. The owner bound it to this resolver. Each change of keys was authorized by the quorum that was entitled to authorize it, in this order. Every instant **except the last** is committed to by the owner: transition `n+1` signs `expected_digest = digest(head n)`, and that digest covers `E[n]`, so moving an interior instant by one millisecond breaks the owner's next signature.

**Does not prove.**

- **That the log is complete or current.** A log that stops early verifies. Freshness comes only from a current resolution by the pinned resolver. A verifier that has both checks them against each other: if the resolution's head digest equals the log's digest at that sequence, it holds the resolver's fresh statement *and* that head's entire owner-signed lineage, which is the independent lineage check the identity review left open.
- **The last instant.** Nothing the owner signed covers `E[last]` until the next transition exists. Within the bounds of rule 6 it is whatever the host says.
- **That no other branch exists.** The log is one history. An owner, or a thief holding old keys, can sign two transitions from the same head, and a host can show different parties different branches.

### Should host-asserted instants be attested? Yes, but attestation is evidence, not truth

An attestation does not make an instant correct, because the host can sign any instant rule 6 allows. What it changes is accountability. Without one, a host that gives two parties two different last instants, or that later rewrites the instant it once served, leaves no trace. With one, each version carries the enrolled resolver key's signature over `(identity, resolver, epoch, sequence, head_digest)`, and **two attestations that differ for the same sequence are portable, self-contained proof that the resolver equivocated**. That is why the body names the sequence and digest and no verifier-specific context: anyone can compare two of them.

Attestations are issued at export time from what the host stored, so a host can attest history it accepted before this format existed. Hosts SHOULD attest every head. A relying party SHOULD require attestation unless it is deliberately verifying a log whose host is gone or hostile, which is the situation re-homing must handle.

### What a verifier concludes when it cannot reproduce a digest

The digest it cannot reproduce comes from somewhere else, a checkpoint it pinned or a resolution it just verified, and is compared by sequence:

| Comparison | Conclusion |
|---|---|
| The log has that sequence and the digests are equal | **Consistent.** The log proves that head's lineage. |
| The log ends before that sequence | **Log behind.** The log is stale or truncated. This is not a failure of the log and not evidence for the other digest. Obtain a longer log before relying on lineage. |
| The log has that sequence and the digests differ | **Conflict.** Two histories exist for one identity. Either an instant was altered, or the owner's keys signed two successors, or the resolver served a head it did not store. The verifier MUST NOT choose between them silently and MUST NOT let the log override a pinned checkpoint or the reverse. It stops treating the identity's control as established, keeps both artifacts as evidence, and escalates to the owner and the resolver. If both sides are resolver-attested, the pair is proof of resolver equivocation. |

A log that fails verification outright proves nothing about the identity in either direction. It is only a bad log.

## Reference implementation

`sdk/src/foundation/identity-log.ts`, portable, reachable as `identityLog` from the preview entry: `verifyIdentityLog`, `compareCheckpoint`, `buildIdentityLog`, `attestHead`, `recoverGenesisInstant`.

The verifier does not restate rule 5. For each entry it constructs a witness timeline, acceptance at `min(expires_at - 1, E[n])` with exactly the lease barrier that yields `E[n]`, and runs `transitionIdentity` itself under it; rule 6 is precisely the condition for that witness to exist. Replay therefore cannot drift from the live rules. The cost is that a second implementation must take rule 5 from the identity contract and the vectors rather than from this file.

Host side: the reference registry gains `exportLog(identity)`, which assembles the log from its stored signed history, verifies it, attests every head and only then returns it. A frozen or transferred identity remains exportable, since leaving must not depend on good standing. The onboarding preview serves it at `POST /api/log`, and the preview wallet's `exportLog()` verifies it against the resolver the wallet pinned before returning it.

The registry previously kept head 0's instant only inside the current-state row, which the first transition overwrites, so an identity that had ever rotated could not have exported a verifiable log. It now records the instant at enrollment (additive column `genesis_effective_at`). For rows enrolled earlier, `recoverGenesisInstant` finds it: it lies in the enrollment window of at most 300,000 ms, and the first transition's owner-signed `expected_digest` identifies it.

Not provided: a transparency log or witnesses, gossip of attestations between relying parties, any entry type for a change of resolver (reserved for the re-homing design, which will extend this format under a new format string if an entry kind is needed), and an equivalent log for organization governance.
