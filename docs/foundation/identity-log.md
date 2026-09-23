# Portable identity log, draft 1

September 21, 2026. Status: unreleased foundation layer, implementer-tested, pending independent review. It adds a format and a verifier. It changes no existing signing domain, no signed document and no rule in `identity.ts`.

## The problem

A control head is `{identity_id, sequence, previous_digest, operational, recovery, effective_at}` and its digest is what transitions chain on and what resolutions carry. Every member comes from documents the owner signed except `effective_at`. A host sets that to its own clock at enrollment, and to `max(now, last_lease_expiry + CLOCK_MARGIN_MS)` at each transition. A verifier holding only the signed genesis and the signed transitions therefore could not reproduce any head digest: it needed the host's clock at each step and its lease history. An identity's history could only be believed, not checked.

## What the log is

The log carries the signed documents plus the one host-asserted value per head, the instant itself. Lease history and acceptance times are not needed: they only ever mattered through the instant they produced, and the rules below bound that instant without them.

```
IdentityLog      { format: "dtp-identity-log-2", genesis: Signed<Genesis>, enrollment: Signed<ResolverEnrollment>, entries: [Entry, ...] }
Entry            { effective_at: integer ms, transition: Signed<Transition> | null, rehome: Signed<Rehome> | null, attestation: Signed<HeadAttestation> | null }
HeadAttestation  { identity_id, resolver_id, resolver_epoch, sequence, head_digest, effective_at }
```

`entries[n]` describes head `n`. Entry 0 carries neither a transition nor a rehome; every later entry carries exactly one of them: the owner-signed transition or the owner-signed [rehome](identity-rehoming-proposal.md) that produced its head. All objects are closed. There are between 1 and 4096 entries. The log holds public keys and signatures only.

Format 1 (`dtp-identity-log-1`) is the same log without the `rehome` member. It remains valid, is verified by the same rules, and cannot express a move.

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

`sdk/src/foundation/identity-log.ts`, portable and dependency-free, reachable as `identityLog` from the preview entries (`@dtp/sdk/preview/foundation` needs no package at all): `verifyIdentityLog`, `compareCheckpoint`, `buildIdentityLog`, `attestHead`, `recoverGenesisInstant`.

The verifier does not restate rule 5. For each entry it constructs a witness timeline, acceptance at `min(expires_at - 1, E[n])` with exactly the lease barrier that yields `E[n]`, and runs `transitionIdentity` itself under it; rule 6 is precisely the condition for that witness to exist. Replay therefore cannot drift from the live rules. The cost is that a second implementation must take rule 5 from the identity contract and the vectors rather than from this file.

Host side: the reference registry gains `exportLog(identity)`, which assembles the log from its stored signed history, verifies it, attests every head and only then returns it. A frozen or transferred identity remains exportable, since leaving must not depend on good standing. The onboarding preview serves it at `POST /api/log`, and the preview wallet's `exportLog()` verifies it against the resolver the wallet pinned before returning it.

The registry previously kept head 0's instant only inside the current-state row, which the first transition overwrites, so an identity that had ever rotated could not have exported a verifiable log. It now records the instant at enrollment (additive column `genesis_effective_at`). For rows enrolled earlier, `recoverGenesisInstant` finds it: it lies in the enrollment window of at most 300,000 ms, and the first transition's owner-signed `expected_digest` identifies it.

Not provided: a transparency log or witnesses, gossip of attestations between relying parties, and an equivalent log for organization governance.

## Moves between resolvers (format 2)

A rehome entry is verified by `rehomeIdentity` under the identity contract: recovery quorum of the previous head, exact `expected_digest` and `sequence`, `from` equal to the binding in force, `to.resolver_epoch` one higher, `to.resolver_key` never a control key of this identity. Its instant `E[n]` satisfies `E[n] >= issued_at`, `E[n] >= E[n-1]`, `E[n-1] < expires_at` and `E[n] < expires_at`: a move has no lease barrier, so the upper bound is the window itself. The resulting head keeps both key sets and has `previous_digest = digest({domain:"DTP-IDENTITY-REHOME-1", body: rehome})`.

The resolver binding is per epoch. Entry 0's enrollment fixes epoch 0; each rehome fixes the next. An attestation must be signed by the resolver key of the epoch its entry belongs to, and the rehome entry belongs to the **new** epoch. A verified log reports every binding it passed through (`resolvers`) and each head's epoch.

**Epoch precedence** (`precedence`): between two valid histories of one identity that diverge, the one whose current binding has the higher epoch supersedes, wherever they fork. Forks at one epoch are a conflict. One history being a prefix of the other is not a fork.

**Admission** (`admitIdentityLog`): a relying party holding a pin `(resolver_id, resolver_key, resolver_epoch, minimum_sequence, minimum_digest)` admits a log only if the log's binding **at the pinned epoch** equals the pin, the log reaches at least the pinned sequence, every move past the pinned epoch is adopted (below), and the pinned digest is either consistent with the log or superseded by a higher epoch. It then stores the log's current binding and head as its new pin, atomically, and refuses the former resolver from then on. A same-epoch conflict is refused. `judgeIdentityLog` is the same procedure as a judgement that never throws for an expected refusal; its reasons are normative: `invalid-log`, `another-identity`, `unknown-identity`, `foreign-lineage`, `behind`, `conflict`, `unadopted-move`.

Vectors for moves, both formats, precedence pairs, admissions, pushes and refusals are in the same file.

### Adoption evidence, refusals and owner push (draft 2)

September 22, 2026. Additive: no identifier, signing domain, signed document or existing log changes. It closes decision D7 of the [re-homing design](identity-rehoming-proposal.md) and specifies the owner push that design named.

**Adoption evidence.** A rehome entry is *adopted* when it carries an attestation, which rule 8 and the per-epoch binding rule require to be signed by the key the rehome names as `to.resolver_key`. A rehome entry without one is *unadopted*: the log still verifies and proves that the owner consented to the move; it does not prove that any destination created the head. A relying party therefore refuses, as `unadopted-move`, a log in which any rehome entry past its pinned epoch is unadopted, **whatever its attestation policy for the other entries**. That policy exists because a former resolver may be gone or hostile and its attestations cannot be required; the destination adopted, so its attestation of the one head it created always can be.

Consequences. An owner whose destination failed, refused or never answered may sign a second rehome from the same head: the first is a dangling consent that no relying party admits, and the two documents are distinct consents to distinct moves. If both destinations adopt, two attested branches exist at one epoch and every fork rule applies: a verifier that sees both fails closed and escalates. **What remains undetectable without witnesses:** a relying party or cold verifier shown only one adopted branch cannot know that the other exists. Nothing here changes that; the transparency layer remains the answer, and this rule is designed so that it can be added without touching any of this.

**Refusal.** A destination that will not adopt MAY sign, under `DTP-IDENTITY-REHOME-REFUSAL-1`,

```
RehomeRefusal { identity_id, rehome_digest, resolver_id, resolver_epoch, refused_at }
```

where `rehome_digest` is the digest of `{domain:"DTP-IDENTITY-REHOME-1", body: rehome}`, the value the head after that rehome commits to, and `resolver_id` and `resolver_epoch` are the rehome's `to` values. A verifier MUST refuse a refusal unless it carries exactly one signature, by `to.resolver_key`, and its body names that rehome. A refusal means *never*: a destination MUST persist what it refused and MUST NOT adopt it later. A refusal and an attestation of the head that rehome produces, from one key, are portable proof that the destination equivocated; `compareRehomeRefusal` answers `unrelated` (the log has no head from that rehome), `consistent` (it has one and nobody attested it) or `equivocation`. A relying party that holds a refusal for a rehome MUST refuse any log whose entry is that rehome and keep both artifacts. Refusals are optional and advisory: no verifier needs one, and a rehome that could never have been adopted may be refused harmlessly.

**Owner push.** After a move a wallet SHOULD send each relying party it knows

```
IdentityLogPush { format: "dtp-identity-log-push-1", log: IdentityLog }
```

and nothing else. The log is self-verifying, so the message carries no signature and the sender is not authenticated. The relying party runs the admission procedure against the pin it holds for the log's identity, stores the resulting pin atomically, and answers

```
IdentityLogPushAck {
  format: "dtp-identity-log-push-ack-1", identity_id: string | null,
  outcome: "unchanged" | "advanced" | "superseded" | "refused",
  reason: null | "invalid-log" | "another-identity" | "unknown-identity" | "foreign-lineage" | "behind" | "conflict" | "unadopted-move",
  binding: { resolver_id, resolver_epoch, sequence, head_digest } | null
}
```

`identity_id` is null only when the log did not verify. `binding` is the pin the party now holds and is null exactly when it refused. The answer is a function of the party's durable pin and the message, so a wallet MAY repeat a push at any time: once admitted, the same log answers `unchanged`; an older log at the party's epoch answers `behind`, and one that ends before the party's epoch answers `foreign-lineage`, because a pin records only its current binding and such a log cannot be tied to it. `conflict` MUST be reported as such, since a same-epoch fork is what the owner and the resolver have to act on. The ack is unsigned; the transport authenticates the party. An ack tells whoever holds a valid log that this party enrolled the identity; a party that treats that relationship as confidential SHOULD accept pushes only over an authenticated channel. The reference HTTP binding is `POST <origin>/api/identity-log` with the message as the body and the ack as the response body.

Reference: `judgeIdentityLog`, `receiveIdentityLogPush`, `parseIdentityLogPushAck`, `refuseRehome`, `verifyRehomeRefusal`, `compareRehomeRefusal` and `rehomeDigest` in `identity-log.ts`; the registry's `refuse`, which persists the refusal and makes `adopt` honor it; the authentication adapter's `receiveIdentityLogPush`, which judges against its durable checkpoint inside the caller's transaction; the wallet's `pushIdentityLog`. The repository's only relying party is that adapter, a library, so no server route is provided.
