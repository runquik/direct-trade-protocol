# Moving an identity to another host: design proposal

September 21, 2026. Status: **proposal for owner review. Nothing here is implemented.** It depends on the [portable identity log](identity-log.md). It asks for one previously ratified decision to be reversed (D1 below), so it should not be implemented on the strength of this document alone.

## 1. The gap

`verifyResolverEnrollment` requires `head.sequence === 0` and `resolver_epoch === 0`. `IdentityState` binds `resolver_id` and `resolver_key` at creation. Nothing advances `resolver_epoch`. There is no defined way for the holder of the recovery keys to bind an identity to a different resolver.

The identity contract says recovery authority is separate from the host and that the resolver is "replaceable". Today that is true of the keys and false of the protocol. A person can rotate and recover keys at the host they enrolled with. They cannot leave it. A host that disappears takes every identity it serves with it, and a host that turns hostile keeps them. The contract currently says so openly: "cooperative resolver transfer only", and "a destroyed resolver cannot be replaced safely by silently promoting recovery keys at a new host". This proposal is about making that replacement safe and not silent.

**Terms.** *Owner*: whoever holds the identity's keys. *A*: the current resolver. *B*: the destination. *Relying party (RP)*: a verifier that has durably pinned `(resolver_id, resolver_key, resolver_epoch)` and a checkpoint `(sequence, head_digest)` for the identity, as the person-authentication adapter does. *Cold verifier*: one with no pin, starting from an identity id.

## 2. Requirements

1. The identity id never changes.
2. The move is authorized by the owner's keys alone. It must work when A is offline, destroyed or hostile.
3. A must not be able to move an identity, block a move, or keep serving it to an RP that has learned of the move.
4. A thief holding operational keys, current or retired, must not be able to move the identity.
5. An RP must be able to verify the move offline from owner-signed material, and must afterwards refuse A.
6. No blockchain, and no new party that must be trusted for integrity.
7. Whatever is added later for fork detection (witnesses, transparency) must not change identifiers or invalidate signed history.

## 3. Prior art

**AT Protocol `did:plc`.** The DID is a hash of the signed genesis operation, so it is self-certifying, as a DTP person id is. Operations are hash-chained through `prev` and signed by one of an ordered list of rotation keys. A central directory orders operations and serves the audit log. Moving between Personal Data Servers is a PLC operation that changes the service endpoint and signing key; a user who holds a rotation key of higher priority than their PDS's can migrate without the old PDS's cooperation. A higher-priority key can also override an operation by a lower-priority key, but only within 72 hours, after which the lower key's operation stands. *Takeaways:* host independence comes from the user holding a key that outranks the host, which DTP's recovery set already is. *Costs:* the directory cannot forge operations, but it is a single party that can withhold, stall or serve different histories, and its authors call the method a placeholder. The 72-hour rule means a thief who goes unnoticed for three days wins permanently.

**KERI.** Identifiers derive from an inception event; a hash-chained key event log records every rotation. *Pre-rotation*: each establishment event commits to a digest of the **next** keys, so stealing the current signing keys does not let a thief rotate. The controller designates *witnesses* in the log; they issue receipts, and a threshold of receipts makes an event accepted. *Watchers* compare logs and detect duplicity, under a first-seen rule. Changing witnesses is itself a rotation event, so the controller can change infrastructure with no ledger. *Takeaways:* the closest model to what DTP has. DTP's separate recovery set serves pre-rotation's purpose for operational keys (a stolen operational key cannot change recovery authority), though without a hash commitment. A DTP resolver is in effect one witness that is also a freshness oracle. *Costs:* real fork *prevention* needs a witness pool and watchers to exist and be run by someone. KERI is also large; adopting it wholesale is a different project from closing this gap.

**`did:web`.** The identifier is a domain name; the document is whatever HTTPS serves there. Control is control of DNS and a certificate. There is no signed history, no verifiable rotation and no portability: a new domain is a new identifier. `did:webvh` (formerly `did:tdw`) exists because of this, adding a self-certifying id, a hash-chained log and optional pre-rotation, witnesses and portability. *Takeaway:* it is the counter-example. An identity whose identifier names its host cannot leave. DTP already avoids this, and should keep host names out of identifiers, including any future handles.

**Certificate Transparency and Key Transparency.** Append-only Merkle logs with inclusion and consistency proofs; monitors and auditors; for KT, a verifiable map from identifier to keys that each user checks for their own entry. They **detect** misissuance and equivocation. They do not prevent it, and detection depends on someone watching and on gossip between observers, which is the least deployed part of CT. *Takeaway:* this is the right shape for DTP's later fork-detection layer, since it needs no consensus, and the head attestation in the identity log was given a verifier-independent body so that it can be logged and compared this way.

**Summary.** DTP already has the three properties the others treat as essential: a self-certifying id, an owner-signed hash chain, and keys that outrank the host. What it lacks is the operation that uses them to change host, and any second observer. This proposal adds the operation now and leaves room for the observers.

## 4. Proposal

### 4.1 A rehome is an owner-signed entry in the one control chain

A new signed document under a new permanent domain, `DTP-IDENTITY-REHOME-1`:

```
Rehome {
  identity_id, expected_digest, sequence,            // extends exactly one head, like a transition
  from: { resolver_id, resolver_epoch },
  to:   { resolver_id, resolver_key, audience, resolver_epoch },
  issued_at, expires_at
}
```

- `sequence` is the current head's sequence plus one, and `expected_digest` is that head's digest. A rehome occupies a slot in the same chain as rotations and recoveries. Host changes and key changes are therefore totally ordered, and one replay verifies both.
- `to.resolver_epoch` MUST equal `from.resolver_epoch + 1`. This is the only thing that advances the epoch.
- `to.resolver_key` MUST NOT be, or ever have been, a control key of the identity.
- `to.resolver_id` MAY equal `from.resolver_id`. That is a resolver **key rotation** at the same host, which is also impossible today, and it gives the owner a general remedy described in 4.6.
- The signed window follows the transition rule (at most 300,000 ms); see D6.

The rehome is the owner's consent to B specifically. It replaces a second enrollment document.

**The resulting head commits to the rehome.** Head `n+1` is

```
{ identity_id, sequence: n+1, previous_digest: digest({domain:"DTP-IDENTITY-REHOME-1", body: rehome}), operational, recovery, effective_at }
```

with both key sets unchanged. For an ordinary transition `previous_digest` remains the digest of the previous head. For a rehome it is the digest of the rehome document, which itself names the previous head through `expected_digest`. The chain is unbroken, the `Control` shape and `verifyResolution` are unchanged, and two different rehomes from the same head produce two different head digests. Without this the head after a move to B and the head after a move to C would be identical, and a fork between them would be invisible.

### 4.2 Who must sign: the recovery quorum, alone

**Necessary.** Choosing a resolver is choosing who may vouch for the identity's current keys. That is at least as powerful as changing recovery policy, which already requires the recovery quorum. If the operational quorum could rehome, a thief with an operational key could move the identity to a host of their choosing and stall the owner there, and owner and thief could move it back and forth indefinitely.

**Sufficient.** The case that matters most is the owner who has lost operational keys, or whose operational keys are stolen, and whose host is gone or hostile. Requiring operational signatures as well, as initial enrollment does, would make exactly that owner unable to leave. Initial enrollment can afford both quorums because at genesis the owner demonstrably holds both.

A rehome does not change keys. An owner who must also replace operational keys does so with an ordinary `recover` at B, as the next entry.

### 4.3 What B does: adopt

B is given an identity log ending at head `n` and a rehome. B MUST:

1. verify the log from genesis (the identity-log rules, extended per 4.7);
2. verify the rehome: recovery quorum of head `n`, exact `expected_digest` and `sequence`, epoch increment, `to` equal to B's own configured id, key and audience, and its own clock inside the signed window;
3. refuse if it already holds this identity with a different history; an exact replay returns the original acknowledgment;
4. store the **entire** log as the identity's history, so that B can itself export a complete log later;
5. create head `n+1` with `effective_at = now`, the new epoch, and `last_lease_expiry = now + LEASE_MS` (see 4.5);
6. attest head `n+1` with its own key.

Older entries keep A's attestations where the owner's export had them. B cannot re-attest A's epoch and must not try. B does not need them: once the rehome exists, head `n`'s instant is committed to by the owner through `expected_digest`, like every other interior instant.

### 4.4 Cooperative and hostile are one path

**B first, always.** The owner signs the rehome, B adopts, and only then is A told.

- *Cooperative A:* the owner, or B, submits the log including the rehome to A. A verifies it exactly as any verifier would, marks the identity `transferred` (the registry schema already has that status), stops issuing resolutions, and from then on answers a resolve or log request with the log that ends in the rehome. That answer needs no signature from A, because the rehome is owner-signed and self-verifying. A's cooperation is a courtesy that shortens the time before RPs learn of the move. It is not an input to the move's validity.
- *Offline, destroyed or hostile A:* nothing further happens at A, and nothing needed to.

The earlier contract asked for A's freeze receipt and B's readiness, in two phases. That ordering has a failure that is worse than the problem it solves: if A releases and B then fails, the identity has no host, and the owner's only way out is a second rehome from the same head, which is an owner-signed fork. B-first has no such state. If B does not adopt, nothing happened.

### 4.5 The lease barrier and `CLOCK_MARGIN_MS`

The barrier exists so that two different key sets are never both valid: new control waits until every lease on the old control has expired, plus the margin. **A rehome does not change key sets**, so the rehome itself creates no such overlap and needs no drain. During the interval in which A does not yet know, or will not admit, that it has been replaced, A and B vouch for identical control.

What B cannot know is when A last issued a lease, and with a hostile A it never will. So B assumes the worst: it starts with `last_lease_expiry = now + LEASE_MS`, as though A had issued a lease at the instant of adoption. The first *key* change at B therefore becomes effective no earlier than `LEASE_MS + CLOCK_MARGIN_MS` (35 s) after adoption, which preserves the invariant against every honest RP. If a cooperative A supplies its true last lease expiry, B may use it, but the rule does not depend on it.

For log verification the rehome entry's instant obeys the same four bounds as any other entry (identity-log rule 6), against the rehome's signed window.

What no barrier can do is bound a **hostile** A, which can go on issuing epoch-`e` leases forever. Those are refused by every RP that has learned of the move and accepted by every RP that has not. See 4.8.

### 4.6 Rollback and fork resistance

| Attack | What stops it |
|---|---|
| A replays or re-issues resolutions after the move | They carry epoch `e`. An RP that has admitted the move pins `e+1` and refuses them ("resolver authority mismatch"), and its sequence checkpoint refuses the older head besides. |
| A presents a divergent history | A cannot forge owner signatures. It can only truncate, which is an availability and freshness attack, not an integrity one (4.8), or collude with a key thief (below). |
| A moves the identity itself, or names a successor | Impossible. Only the recovery quorum can sign a rehome, and the resolver key can never be a control key. |
| A thief with current or retired **operational** keys tries to move it | Impossible. Rehoming needs the recovery quorum. |
| A thief with an operational key that was valid at an old head `m` signs a rival successor of `m`, and hostile A vouches for that branch | The rival branch can never leave epoch `e`, because the thief cannot sign a rehome. **Epoch precedence** (below) makes the owner's branch win. |
| Owner, or a thief holding **recovery** keys, signs two recovery-authorized entries from one head | No protocol answer, by design. Verifiers report a conflict and fail closed. A stolen recovery quorum is total loss, as it already is today through `recovery-policy`. |

**Epoch precedence.** Among valid logs for one identity, the one reaching the higher resolver epoch supersedes the others, wherever they fork. Only the recovery quorum can advance the epoch, and recovery outranks operational keys and hosts by construction. Two valid logs that fork at the **same** epoch are a conflict: fail closed, as `compareCheckpoint` already specifies. This gives the owner a general remedy for any fork made with stolen operational keys, including one a host colludes in: **rehome**, even to the same host under a new resolver key. The epoch bump re-anchors the chain.

Epoch precedence is total and has no time window. `did:plc`'s 72-hour window was considered and rejected: it means an unnoticed thief wins permanently on day four. The cost of having no window is repudiation. An owner can abandon a branch on which they really did act. The proposal's answer is that supersession never erases anything: an RP keeps the acts it accepted, each verified at the time against a lease from the then-pinned resolver, marks them as made under a superseded branch, and leaves what that means to the business layer and, if it comes to it, to a dispute. See D3.

**Witnesses and transparency: later, without changing identifiers.** The guarantees above are against forgery. None of them is against a host *hiding* the truth from someone who has no other source. Preventing or reliably detecting that needs a second observer. It is deferrable because everything such an observer needs already exists as self-contained signed objects: identity ids derive from genesis only; entries are owner-signed; head attestations bind `(identity, resolver, epoch, sequence, head_digest)` with no verifier-specific context. A witness is an additional signer of that same attestation body. A transparency log is a Merkle tree over those attestations. An RP policy can later say "require k witness receipts". None of this touches an identifier, a signing domain or an existing log. What is given up by deferring is stated in 4.8 and should be read as the price of this proposal. Hardening the recovery keys themselves with KERI-style pre-rotation is likewise additive, through `recovery-policy`.

### 4.7 The log gains an entry kind

Format `dtp-identity-log-2`: an entry carries exactly one of `transition` or `rehome` (both `null` only at entry 0). The resolver binding is per epoch: entry 0's enrollment fixes epoch 0, and each rehome fixes the next. A head attestation must be signed by the resolver key of the epoch its entry belongs to, where the rehome entry itself belongs to the new epoch. Format 1 logs stay valid as format 1. The verifier result gains the list of resolver bindings by epoch.

### 4.8 How a relying party learns of the move, and discovery

**Warm path: the owner presents it. This is the normal case and needs no discovery at all.** A person authenticates to an RP by presenting a resolution plus signatures. After a move the wallet presents B's resolution together with the log. The RP, inside the same durable transaction that holds its pin:

1. verifies the log;
2. checks the log's binding **at the RP's pinned epoch** equals its pin. This proves the log continues the lineage the RP enrolled with, not merely some valid log for the same id;
3. compares its checkpoint. *Consistent*: proceed. *Conflict with the log at a higher epoch*: supersede under epoch precedence and record both digests. *Conflict at the same epoch*: fail closed;
4. atomically replaces the pin with `(B, e+1)` and the checkpoint with the log's head;
5. verifies B's resolution under the new pin.

From step 4 on, A's resolutions are refused. This is the "explicit verified admission/migration procedure" that the person-authentication adapter already names as missing and fails closed without.

**Owner push.** In the hostile case step 4 is the *only* thing that revokes A at a given RP. A wallet SHOULD therefore push the log to the RPs it knows, which are the hosts of the organizations the person belongs to, immediately after a move. It should not wait for the next sign-in.

**Cold path: identity id to current host.** There is no global directory, and this proposal does not add one. An identity is referred to as an id plus one or more **hints** (audience origins). Hints are untrusted. A cold verifier fetches the log from a hint and verifies it from genesis; the id makes the log self-certifying. It reads the current resolver from the last rehome and, if that is elsewhere, continues there. A cooperative former host answers with the log ending in the rehome, which is a forwarding address that needs no trust.

The honest limit: **a hostile former host answers with a truncated log, and a cold verifier with no other source will believe A is current.** Nothing in this proposal prevents that. Available now: several hints. Organizations can hold each member's latest binding, kept current by owner push, and mirrors can serve logs. Because logs are self-verifying and ordered by epoch precedence, a mirror needs to be trusted for availability only. The best valid log wins no matter who served it, and a conflict is visible. Later: the witness or transparency layer.

**Handles.** DTP has none. If they are added, a handle must be a mutable pointer *to* an identity id, resolved by whatever naming system, never a component of the id and never evidence of control. A handle naming a domain is a hint and nothing more. This is `did:web`'s lesson.

## 5. What this does not solve

- A hostile former host remains believable to RPs the owner has not reached and to cold verifiers with a single hint, without limit of time, until a second observer exists.
- Loss or theft of the recovery quorum is total, as now.
- The owner must already hold an exported log. An owner whose only copy is on a destroyed A keeps their keys and loses their identity. **Wallets must export the log after every change and keep it with the recovery kit.** This is an operational requirement as serious as backing up the recovery key, and the preview wallet does not yet do it automatically.
- It moves the identity's *control*. A person's memberships and grants live at organization hosts and are unaffected. Moving an organization's records between hosts is separate work.
- A rehome signed for a B that never adopts leaves a dangling signed document. A second rehome from the same head is an owner-signed fork, harmless if no head was ever created under the first, but formally a conflict. See D7.

## 6. Decisions requested

| # | Decision | Recommendation |
|---|---|---|
| D1 | The contract ratified "cooperative resolver transfer only" and says a destroyed resolver cannot be safely replaced by promoting recovery keys at a new host. This proposal reverses that. | Reverse it. The objection was to a *silent* promotion with undrained leases. This one is owner-signed, chain-ordered, epoch-advancing and verifiable, and it needs no drain because key sets do not change. |
| D2 | Quorum for a rehome. | Recovery alone: necessary and sufficient (4.2). |
| D3 | Fork rule. | Total epoch precedence with no time window. Superseded acts are retained and flagged, not erased (4.6). |
| D4 | How the head commits to the move. | `previous_digest` = digest of the rehome document. `Control` shape unchanged (4.1). |
| D5 | Ordering. | B-first single path. A's release is optional courtesy (4.4). |
| D6 | Rehome signed window. | Keep 300,000 ms for uniformity. If offline recovery ceremonies prove to need longer, widen it for rehomes only; it bounds nothing but B's asserted instant. |
| D7 | Abandoned rehome. | Allow B to issue a signed refusal, and let verifiers disregard a rehome under which no head was ever attested. Defer unless review finds it necessary. |
| D8 | Same-host resolver key rotation through the same document. | Yes. It costs nothing and closes a second gap. |
| D9 | Witnesses and transparency. | Later, additive (4.6). Accept and document the 4.8 limit meanwhile. |

## 7. Normative versus reference, if approved

*Normative:* the `Rehome` document and domain; the head rule; the quorum; the epoch rule; log format 2 and its verification rules; the RP admission procedure; epoch precedence; conformance vectors, including divergent branches, stale-epoch resolutions and a rehome signed by the operational quorum. *Reference only:* registry `adopt` and `transferred` handling, the HTTP routes, the wallet's export and push, and the person-authentication pin migration.

Implementation would touch `identity.ts`, `identity-registry.ts` and `person-authentication.ts`, all of which are inputs to foundation gate evidence. That evidence would be invalidated and would need independent re-review. CI is not a reviewer.

## 8. Acceptance: the exit test

To be written as a real test, against two registries on separate databases with separate resolver keys:

1. Create an identity at host A and export its log.
2. Hand recovery authority, by `recovery-policy`, to a key whose private half never reaches A or B. Export again.
3. An RP pins `(A, epoch 0)` and accepts a resolution from A.
4. A becomes hostile: it refuses `transition` and `exportLog`, and keeps issuing resolutions.
5. Using **only** the recovery key and the exported log, sign a rehome to B. B adopts.
6. Replace the operational keys at B with `recover`. They become effective after B's conservative barrier.
7. The RP is shown the log, admits the move, accepts a resolution from B, and from then on **refuses a freshly issued, correctly signed resolution from A**.
8. An operational-key thief's rival branch, vouched for by A, loses to the owner's log by epoch precedence. A rehome signed by the operational quorum is refused by B and by the RP.
9. The identity id is identical at every step.
