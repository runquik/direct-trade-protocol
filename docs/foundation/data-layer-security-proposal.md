# Data-layer security: design proposal

October 29, 2026. Status: **decided, not implemented.** The owner took every decision in section 11 (S1 to S20) on October 29, 2026, as recommended. Nothing here is implemented, reserved or normative yet; section 11 is now the decision record and section 12 the build order that follows from it. S1 and S2 are the answer to the backdating question that [Core-1](../../spec/core-1/README.md) left open for its step 4 (records and bundles).

## 1. Where this comes from

On October 29, 2026 the owner asked how firm DTP's stance on security should be at the data layer, given that it holds private company records from the first customer and, at scale, large parts of supply chains. The question was whether each company's ledgers should mimic a blockchain, or be cryptographically protected blockchain ledgers. Application and server hardening is out of scope here; this proposal is about what the records themselves can guarantee when the systems holding them fail.

Three earlier decisions deferred parts of this on purpose, and this proposal picks them up:

- **V14** (verb layer, October 22, 2026): a hash chain per flow ledger, not per company, with "anchoring and Merkle proofs as a later, separate proposal" ([verb-layer proposal](verb-layer-proposal.md) section 10).
- **D9** (re-homing, September 2026): witnesses and transparency "later, additive", accepting that "a hostile former host answers with a truncated log, and a cold verifier with no other source will believe A is current" ([re-homing proposal](identity-rehoming-proposal.md) sections 4.6 and 4.8).
- **Core-1 step 4**: "A bundle proves who held which keys at each head; it cannot by itself prove when a record was signed." The step settles backdating.

The answer this proposal gives: **adopt the shape that makes a blockchain hard to rewrite, without a blockchain.** Every policy's records go into an append-only Merkle log whose heads the host signs; those heads are held by parties other than the host (the company's own clients, its counterparties, witnesses) and periodically anchored to external timestamps. Separately, encrypt what the host stores, under keys the company can take back. Section 4 says why not a blockchain.

**Terms used below.** *Host*: the system that accepts a company's records and runs its reducers. *Log*: one append-only Merkle tree of accepted records (section 5). *Leaf*, *root*, *inclusion proof* and *consistency proof* have their RFC 9162 meaning. *Log head*: a signed statement of a log's size and root. *Receipt*: the log head at the size that first included a record, with the record's inclusion proof. *Witness*: any party that keeps log heads and checks each new one against the last. *Anchor*: an external timestamp over a digest. *Book*, *ledger*, *fact* and *policy* keep their meaning in the [verb-layer proposal](verb-layer-proposal.md) and [`flow@1`](../../spec/profiles/flow/1.md).

## 2. Threat model

The goal is not "unhackable". It is: **compromising any one thing, whether the host, its database, an operator, a backup or one key, can neither silently change a company's history nor expose data that party should not see.** Silently is the operative word: some attacks cannot be prevented, only made detectable and provable.

| # | Adversary | Can today | Wants to |
|---|---|---|---|
| A1 | Database reader: a dump, a stolen backup, SQL injection, the database provider's staff | Read every record in the clear | Read business data |
| A2 | Database writer or host operator, including a compromised host process | Rewrite, drop, reorder or insert rows; recompute every digest; show two readers two histories | Change history without trace |
| A3 | Holder of a member's rotated-out or stolen key | Sign a record naming an older identity head | Backdate a record to when the key was valid |
| A4 | Relay, mailbox or anyone holding a forwarded bundle | Read evidence tokens, which "contain plaintext" ([v0.4](../../spec/v0.4/SPEC.md) section 7) | Read what was disclosed to someone else |
| A5 | A counterparty | See what was disclosed to it, and the shape of what came with it | Learn the size and activity of books it cannot read |
| A6 | A future quantum-capable adversary | Record ciphertext now | Decrypt it later; forge old Ed25519 signatures later |

Out of scope: a compromised client that holds live keys (it can sign anything; a signature proves attribution of bytes, not truth); application and server hardening; denial of service, including a host that refuses to serve (leaving is covered by migration and snapshot export); traffic analysis of the network.

The properties, and where they stand:

| # | Property | Today | After this proposal |
|---|---|---|---|
| P1 | Every entry is attributable to its author | Yes | Unchanged |
| P2 | History is append-only and the same for every reader | Within one flow ledger, only against someone who kept its head; nobody does | Every record under a policy; heads held outside the host; a fork is a portable proof |
| P3 | A record's acceptance time is bounded | No (Core-1 open question) | Signed by the host; bounded below by earlier heads others hold and above by anchors; checked against the issuer's key history |
| P4 | What the host computed is attributable to the host | No; host effects are hashed, not signed | Signed into each leaf and checkable by replay |
| P5 | Stored data is unreadable without keys the database does not hold | No | Per-policy envelope encryption; the company can hold the root key |
| P6 | What travels between companies is readable only by its addressee | No; transport only | Sealed to the recipient |
| P7 | Personal data can be erased without breaking history | No | By commitment and key destruction |
| P8 | The above survive a quantum adversary | No | Encryption hybrid now; signatures by anchor renewal now, by a hybrid domain later |

## 3. How far the repository already is

What exists is strong where it exists:

| Mechanism | Where | What it gives |
|---|---|---|
| Strict Ed25519 under domain separation, one `Signed<T>` envelope, I-JSON with pre-parse refusal of unsafe and duplicate member names | [Core-1](../../spec/core-1/README.md) parts 1 to 3 | P1, and no signature confusion between formats |
| Portable identity logs: digest chains from a genesis, quorum-checked transitions, host head attestations, fork detection by a relying party's pin | [identity-log.md](identity-log.md) | P2 for identities, with D9's stated limit |
| A digest chain per flow ledger: `expected_digest` beside `expected_revision` | [`flow@1`](../../spec/profiles/flow/1.md) rule 5 (V14) | Ordering and compare-and-set per ledger |
| `supersedes` chains on state kinds | v0.4 records | Revision order per entity |
| Snapshot import replays every fact and must reproduce every ledger exactly | v0.4, `flow@1` | A replay audit, if someone runs it |
| Database triggers refusing updates and deletes | `supabase/migrations/20260903000000_protocol_store.sql` (v0.2 store) | Protection from application bugs, not from the database owner |
| Passphrase-encrypted identity files (PBKDF2, AES-GCM) | `sdk/src/onboarding/client.ts` | Client key storage only |

What is missing, and where the repository already says so:

| Missing | Where it is recorded | Where this proposal puts it |
|---|---|---|
| Tamper evidence against the database owner | [persistence.md](persistence.md): "The application database role remains trusted; direct SQL can defeat library invariants. Deployment privileges, schema migration, backup/restore and tamper evidence need their own controls." | Sections 5 and 6 |
| Attribution of host-computed state | persistence.md: host effects under `DTP-ENTITY-REVISION-1` are digests; attribution "does **not** claim the user signed each generated body", and nothing claims the host did | S4 |
| Signed acceptance metadata | v0.4 section 6: `seq`, `is_head` and `accepted_at` are appended by the host and are "not part of the caller's signed record payload" | S1 |
| Backdating | Core-1 section 5, open question | S1, S2 |
| Chaining of event kinds other than flow facts | verb-layer proposal section 10: "the other event kinds are not chained in this proposal" | S3 |
| Witnesses, transparency, anchoring | D9; V14 | Section 6 |
| Encryption of stored records | ONBOARDING_PREVIEW.md: "Database-at-rest encryption … not provided by this prototype" | Section 7 |
| Encryption of disclosed records | v0.4 section 7: "Evidence tokens contain **plaintext**" | S14 |

A hash chain held only by the party that writes it is not tamper evidence. Whoever holds the whole chain can rewrite an entry and recompute every later digest, and the result verifies. A chain detects rewriting only relative to a head someone else kept. Today nobody outside the host keeps a ledger head, so V14's chain gives ordering and conflict detection but not yet the property its name suggests. This is the central gap, and the reason this proposal is mostly about who holds heads.

## 4. Why not a blockchain

A public or permissioned blockchain gives four things: a hash-linked append-only history; agreement among many writers on its order; copies held by many parties; and a timestamp nobody can rewrite. DTP needs the first, third and fourth. It does not need the second, because each log has exactly one legitimate writer: the company, through its host. The problem with one writer is not agreeing on order but stopping that writer from rewriting or equivocating, and that is solved by signed heads held by others (Certificate Transparency's model), not by consensus.

What a blockchain would cost:

- **Disclosure.** Each company keeps its own ledger, and no company's data lives on another's host (V5). A shared chain, even of ciphertext, discloses which parties write, when and how much, and permanently.
- **No erasure.** Data on a chain cannot be removed, which conflicts with erasure duties for personal data (section 7.4).
- **Throughput and cost**, for a property (consensus) with no use here.
- **Nothing for confidentiality.** Blockchains make data public by design; privacy layers on top add exactly the key management this proposal needs anyway. Most losses attributed to blockchains are stolen keys and contract bugs, not rewritten history.

v0.4 already excludes "mandatory blockchain/token" from the core ([v0.4](../../spec/v0.4/SPEC.md) section 10). This proposal keeps that. The one thing a public chain uniquely offers, a timestamp no single party can rewrite, is used optionally and with nothing but a 32-byte digest (S9).

## 5. Logs, receipts and host attribution

### 5.1 One log per policy (S3)

Every record a host accepts under a resource policy is appended to that policy's log. A policy is the read boundary: a fact's readers are exactly its book's readers, and books under one policy share readers. A log per policy therefore discloses nothing to a reader of it that the policy did not already, and V14's two reasons against a company-wide chain still hold:

- **Write serialization.** Appending to a log is done by the host, not by the client, so no client compare-and-sets against the log head. The flow ledgers keep their own `expected_revision` and `expected_digest` for that. A host already serializes writes per organization (persistence.md); a log per policy is a narrower lock than that.
- **Disclosure across policies.** One policy's log contains nothing from another's.

The log's `log_id` is a UUID minted when the policy is created and carried in its signed creation, so it belongs to the company and survives a move to another host (S7). It is not host-scoped.

One residual disclosure: where a policy has record-level permissions, a reader sees leaf counts for records it cannot read. Leaves reveal nothing else (5.2).

### 5.2 Leaves and heads

The tree is RFC 9162's: leaf hash `SHA-256(0x00 ‖ leaf bytes)`, node hash `SHA-256(0x01 ‖ left ‖ right)`, so a leaf can never be passed off as a node. The leaf bytes are canonical:

```
Leaf     = { "record": <SHA-256 of the canonical Signed<Record>>,
             "accepted_at": <integer ms>,
             "effects": [ <digest>, … ] }          // 0..64, S4
LogHead  = { "log_id": <uuid>, "size": <integer>, "root": <hex>, "signed_at": <integer ms> }
Signed<LogHead> under DTP-LOG-HEAD-1, signed by the host's enrolled key
```

`signed_at` is when the host signed the head, not when the last leaf arrived: a host re-signs an unchanged head at every anchor interval (S9), so an idle log still carries a recent time. The leaf commits to the digest of the whole signed record, signatures included, so nobody can confirm a guessed record from its leaf: guessing needs the signature. No salt is needed.

A host signs a head **after every accepted record** (S5). A **receipt** is that head plus the record's inclusion proof: the record is its last leaf. A verifier needs only the RFC 9162 inclusion check and one Ed25519 verification.

Two signed heads with the same `log_id` and `size` and different roots are portable, self-contained proof that the host equivocated, exactly as two differing identity head attestations are ([identity-log.md](identity-log.md)). That is why the head body carries nothing verifier-specific. A party holding two heads of different sizes asks for the RFC 9162 consistency proof between them; a host that cannot produce one has rewritten history, and its refusal is the evidence.

Time only moves forward along a log. `signed_at` is non-decreasing with `size`; a leaf's `accepted_at` is at least the `signed_at` of every head smaller than it and at most that of the head that first includes it. Two heads of the same size and root that differ only in `signed_at` are a re-signing, not a fork. A verifier holding any two of these objects refuses a pair that breaks the order.

### 5.3 Receipts and backdating: Core-1 step 4 (S1, S2)

Core-1 step 4 defines `DTP-RECORD-1` and the exchange bundle and must settle backdating. This proposal answers it with two rules, both to land in that step with vectors:

**S1. A host signs every record it accepts, and the bundle carries the receipt.** When a record was accepted by a host, its exchange bundle includes the receipt (5.2). This replaces the unsigned `seq` and `accepted_at` of v0.4 with signed ones, and is the "optional host head attestation counter-signing the record" Core-1 named, in a form that is also a log head, so that no second receipt format is needed when witnesses arrive.

**S2. A recipient checks a record against the issuer's key history.** Let the record name the issuer's head *n*, and let the recipient hold, from the bundle or its own pin, the issuer's head *n+1* with effective instant `E[n+1]`:

- With a receipt: the receipt's `accepted_at` must be before `E[n+1]`. A record accepted before the key was rotated out is valid however late it arrives.
- Without a receipt (a record exchanged with no host): the recipient refuses it if it had already admitted head *n+1* when the record arrived, and otherwise records its own receipt time as the record's upper bound. A record exchanged without a host must therefore arrive before its issuer rotates, or be signed again.
- For a record issued for an organization, the same rule applies to the governance head the bundle names: a signer removed at governance head *m+1* bounds the receipt the same way.
- Refusal code: `stale_head`.

What this does and does not stop. A thief holding a rotated-out key, alone, cannot get a backdated record accepted: no honest host will accept it after `E[n+1]`, and a recipient without a receipt refuses it. A thief **and** a colluding host can sign a receipt with an early `accepted_at`, but must either append it after a head signed later than that time (refused by the time order in 5.2) or fork the log before that head (a fork any holder of the later head detects, S6). The remaining window is the time since the last head anyone outside the host holds. Because heads are re-signed and anchored every interval (S9), that window is at most one interval.

**Measures.** S1 adds one signing domain, `DTP-LOG-HEAD-1`, and the RFC 9162 inclusion check to Core-1. Core-1's target is eight domains or fewer, and it has eight; S20 raises the target to nine (decided October 29, 2026). The alternative, a per-record receipt domain now and a log head domain later, gives two receipt formats and the same count eventually.

### 5.4 The host signs what it computed (S4)

A host runs reducers and writes effects: new flow ledger heads, resource revisions, record entities. Today their digests (`DTP-ENTITY-REVISION-1`) are stored and nobody signs them, so A2 can change a ledger balance without touching any signed record. Under S4 a leaf's `effects` lists the revision digests the record produced, in the order the reducer wrote them. The host's head signature then covers them.

This turns P4 into a check: replay the log from the start, re-verify every record signature, re-run every admitted reducer, and compare each effect digest with its leaf (S8). Snapshot import already does this replay; S8 makes it a standalone audit anyone with read access can run. A mismatch is proof that the host misapplied a rule or altered state, signed by the host.

A Core-1 record with no reducer has empty `effects`.

## 6. Witnesses and anchoring

### 6.1 Who holds heads (S6)

Heads matter only if they leave the host. Three holders, in order of how soon they exist:

1. **The company's own clients.** Each controller's and member's client keeps the latest head of every log it can read and checks each new one for consistency. This is the most important holder: it catches the company's own host, or someone inside its database, rewriting the company's history. It needs no third party.
2. **Counterparties.** Every exchange bundle carries a receipt, so every recipient holds a head of the sender's log. A recipient keeps the newest head it has seen per log and checks the next one it receives against it. Supply-chain partners become each other's witnesses by trading.
3. **Independent witnesses.** A witness checks consistency with the last head it signed and adds its signature to the same `Signed<LogHead>`. Core-1's envelope already treats several signatures over one input as a threshold, so "require k witness signatures" is relying-party policy, with no new format. Witnesses are a deployment (a DTP-run witness, an auditor, an industry body), not part of the protocol.

The same witnesses serve identity head attestations, which settles D9 with one mechanism instead of two: an identity log head and a policy log head are both small signed bodies that witnesses keep and compare.

### 6.2 Migration (S7)

v0.4 migration makes sequences destination-local. A log does not restart. The source host's final signed head goes into the migration manifest, and the destination continues the same `log_id`: its first head must be consistent with the source's final one, and the consistency proof travels with the activation receipt. A witness that sees a new host key on a known `log_id` accepts it only with that proof and the signed migration. Leaving a host therefore cannot be used to launder history, and history cannot be lost by leaving.

### 6.3 Replay audit (S8)

An auditor function in the reference SDK: given a log, its records and their admitted profiles, it verifies every leaf, signature, reducer effect, monotonic time and the final head, and returns the first discrepancy with its evidence. This is the snapshot-import path made portable, with a second implementation, as every kind already has.

### 6.4 Anchoring (S9)

On a fixed schedule (recommended: hourly), a host re-signs the current head of every log it holds, changed or not, builds a Merkle tree over those heads, across all its companies, and timestamps the root with at least two independent RFC 3161 timestamp authorities. Optionally it also submits the root to OpenTimestamps, which commits it to Bitcoin at no cost and with no token. The anchor receipts and each log head's inclusion path are served beside the log.

- **What it gives.** An upper bound on when a head existed that the host cannot move, which closes the S2 collusion window to one interval and gives P3.
- **What it discloses.** A 32-byte root. An inclusion path reveals the depth of the host's tree, roughly how many logs the host holds in total, and nothing about any company.
- **Long-term evidence (P8).** A record anchored today stays provably older than any future forgery of its Ed25519 signature. RFC 3161 tokens are themselves signed with classical algorithms, so the anchors must be renewed before those weaken, as RFC 4998 (Evidence Record Syntax) specifies; a Bitcoin commitment depends only on SHA-256 and proof of work.

## 7. Confidentiality

A host must see plaintext to run reducers: conservation, "never negative", claim transitions. So this section does not try to hide data from the running host. It makes stored data useless without a key the database does not hold, lets the company take that key back, seals what travels between companies, and gives end-to-end protection where the host never needs to read (documents).

### 7.1 Envelope encryption at rest (S10)

- A data key per (organization, policy), AES-256-GCM, with the record id, organization, policy and log id as associated data so a ciphertext cannot be moved to another row.
- Data keys are stored only wrapped by the organization's key-encryption key, which lives in a key management service or HSM, never in the database or its backups. Data keys rotate for new writes; old rows re-encrypt lazily.
- Disk or database-level encryption (Postgres TDE, encrypted volumes) is not enough: it protects disks, not dumps, SQL access or the provider's staff.
- **What stays in the clear**: what indexing and the log need: ids, organization, policy, log index, record and leaf digests, `accepted_at`. Whether the profile digest (which reveals what kind of record it is) stays in the clear is S11. Searching on business fields (a GTIN, a lot) needs keyed blind indexes; drafted when a kind needs one.

This defeats A1 for everything stored, including backups.

### 7.2 The company holds the root key (S12)

Two modes for the key-encryption key:

- **Host-managed** (default): in the host's KMS.
- **Company-managed**: in a KMS account the company controls, with use granted to the host. Revoking the grant stops service and makes every copy the host stores unreadable once its data-key cache expires (bounded; recommended five minutes). This is leaving, cryptographically, beside leaving by migration: "customers own their ledger and can leave with it" becomes enforceable against a host that will not cooperate.

Plaintext already exported, displayed or cached outside the host cannot be recalled. The documents say so.

### 7.3 Encryption keys and sealed exchange (S13, S14)

**Encryption keys are published, not part of identity (S13).** A person or organization publishes a recipient key as a signed record of a registered kind (`dtp/recipient-key@1`: algorithm, public key, validity window), signed under its current operational keys or controller quorum. This adds no signing domain, leaves Core-1 identity unchanged, and lets keys rotate without an identity transition. A signing key is never used for encryption. An organization's recipient key is held by its host in KMS, since the host is where inbound records are decrypted, verified and stored; a person's is held by their client.

**Bundles and evidence are sealed to the recipient (S14).** An exchange bundle or evidence token is signed, then sealed with HPKE (RFC 9180, base mode) to the recipient's published key, with the recipient organization and purpose as associated data. The sender is authenticated by the signature inside, not by HPKE's authenticated modes. A relay, mailbox or anyone holding a forwarded copy without the recipient's key learns its size and nothing else. This is A4.

### 7.4 Personal data and erasure (S15)

Append-only history and erasure duties conflict only if personal data is inside what is signed and logged. For new kinds carrying personal data (people and positions under personnel policies, V16; contact fields), the rule is **commit, don't contain**: the record carries `SHA-256(salt ‖ canonical value)`, and the value and its random salt are stored separately, encrypted under a per-subject key. Erasure destroys the value, the salt and the key. The record still verifies, its leaf still proves it was accepted, and the commitment reveals nothing.

Existing kinds (`party@1` contacts) are unchanged by this proposal; applying the rule to them is a new major version, decided per kind.

### 7.5 End-to-end documents (S16)

Evidence documents are already outside the ledger, referenced by `{digest, media_type, description}` ([verbs.md](../../spec/profiles/verbs.md)). The host never needs their plaintext. A document is encrypted on the client under a random content key, wrapped to each reader's recipient key; the host stores ciphertext. The record keeps the plaintext digest, so a reader verifies what it decrypted. Receipts, photos, certificates of analysis and contracts are where most of a supply chain's sensitive detail lives, so this protects the most for the least.

### 7.6 Hiding records from the running host (S17)

Running reducers in attested confidential-computing enclaves would protect plaintext from the host operator too. It is a hosting option, not a protocol change, and depends on enclave attestation a relying party can check. Later, a separate proposal.

## 8. Post-quantum (S18, S19)

- **Encryption, now (S18).** Data sealed today may still matter in ten years, and A6 can record it today. HPKE sealing (S14) and the recipient-key kind (S13) use a hybrid X25519 plus ML-KEM-768 (FIPS 203) KEM from the start, pinned when S13 is drafted to the CFRG's published hybrid (X-Wing or its successor). At-rest encryption (S10) is symmetric and already adequate at 256 bits.
- **Signatures, later (S19).** Forging an Ed25519 signature needs the quantum computer at forging time, not today, and anchors (S9) keep existing history provable. Core-1 domains are permanent and a new format is a new domain, so a hybrid Ed25519 plus ML-DSA (FIPS 204) signature arrives as new domains, without touching existing records. Drafted when a migration deadline is in view.

## 9. What this costs

- **Per accepted record:** one Ed25519 signature (tens of microseconds), O(log n) hashes, roughly two hashes of storage per leaf. Within the cost of the existing transaction.
- **Per anchor interval:** one tree over the host's heads and two RFC 3161 requests.
- **Disclosure to counterparties (A5).** A receipt reveals the size of the sender's log for that policy at that moment, and two receipts reveal its activity between them. A company that minds should keep records it shares with a counterparty under a policy whose volume it is willing to disclose. Padding a log with dummy leaves at a fixed rate would hide volume; it is left open (section 13).
- **Core-1 complexity:** one domain and the inclusion check (S1, S20). Consistency proofs, witnesses and anchors are extensions an implementation needs only when it witnesses or audits.
- **Key management:** a KMS dependency for hosts (S10), which a serious host needs regardless.

## 10. How it fits what exists

| Existing | Under this proposal | Changes to it |
|---|---|---|
| `flow@1` per-ledger `expected_revision` and `expected_digest` (V14) | Kept for compare-and-set; the policy log sits beside it | None |
| v0.4 `seq`, `accepted_at` (unsigned) | Superseded by the log index and the signed head | v0.4-on-Core-1 (Core-1 step 5) carries receipts |
| `DTP-ENTITY-REVISION-1` host effects | Listed in the leaf, signed by the head | None to the digest format |
| Identity head attestations, D9 | Witnessed by the same witnesses | None |
| v0.4 migration | Carries the final head and a consistency proof | Manifest and activation receipt gain fields |
| `evidence.issue` tokens (plaintext) | Sealed (S14) | Token is wrapped, not changed |
| v0.2 store (live, `dtp-store`) | Unchanged; it is retired before release | None |
| [SECURITY.md](../../SECURITY.md) | Still: do not protect real data with unreleased software | None |

## 11. Decision record

Every row was decided by the owner on October 29, 2026, as recommended. The recommendation column is kept as the rationale.

| # | Decision | Decided |
|---|---|---|
| S1 | A host signs every record it accepts as a `DTP-LOG-HEAD-1` log head at the size that first included it; the exchange bundle carries that receipt. Lands in Core-1 step 4. | Yes. |
| S2 | Backdating: a receipt's `accepted_at` must precede the issuer's next head's effective instant; without a receipt, a recipient refuses a record naming a head older than one it has already admitted (`stale_head`). Lands in Core-1 step 4. | Yes. |
| S3 | One append-only RFC 9162 Merkle log per resource policy, covering every record kind under it, with a company-owned `log_id` carried in the policy's signed creation. Versus per book, per ledger, or per company. | Per policy. |
| S4 | A leaf lists the digests of the host effects the record produced. | Yes. |
| S5 | A host signs a head after every record, versus per batch with deferred receipts. | Every record; batching is an optimization to measure first. |
| S6 | Heads are held by the company's clients, by counterparties through receipts, and by optional witnesses who co-sign the same head; one witness mechanism for policy logs and identity logs (settles D9). | Yes. |
| S7 | Migration carries the final head and a consistency proof; the destination continues the same log. | Yes. |
| S8 | A replay auditor in the reference SDK with a second implementation. | Yes. |
| S9 | Hourly: re-sign every log head and anchor a host-wide root to at least two RFC 3161 authorities, OpenTimestamps optional, renewal per RFC 4998. | Yes; interval and authorities pinned when built. |
| S10 | Per-(organization, policy) AES-256-GCM data keys, wrapped by a KMS-held organization key; associated data binds row identity. | Yes. |
| S11 | Whether the profile digest stays in the clear at rest. | In the clear for now; revisit with blind indexes. |
| S12 | Company-managed key-encryption keys as a supported mode, with a bounded data-key cache. | Yes; five-minute cache. |
| S13 | Recipient keys as a registered record kind, not an identity change; never reuse signing keys. | Yes. |
| S14 | Bundles and evidence tokens signed, then sealed with HPKE to the recipient. | Yes. |
| S15 | Personal data in new kinds by salted commitment, value under a per-subject key; erasure by destruction. | Yes; existing kinds unchanged. |
| S16 | Evidence documents end-to-end encrypted to readers. | Yes. |
| S17 | Confidential-computing hosts. | Later, separate proposal. |
| S18 | Hybrid X25519 plus ML-KEM-768 for all sealing from the start. | Yes. |
| S19 | Hybrid post-quantum signatures as new domains. | Later. |
| S20 | Raise Core-1's signing-domain target from eight to nine for `DTP-LOG-HEAD-1`. | Yes. |

## 12. Build order

Each step is a separately reviewable change with vectors and a second implementation:

1. **Receipts and backdating** (S1, S2, S20), inside Core-1 step 4: the leaf and head formats, the inclusion check, the two backdating rules, vectors for accepted, refused and equivocating cases.
2. **Policy logs and host effects** (S3, S4, S5) in the reference host, with consistency proofs and the replay auditor (S8).
3. **Client and counterparty witnessing** (S6, items 1 and 2) and migration continuity (S7).
4. **Encryption at rest** (S10, S11, S12) in the reference host, with a KMS adapter and a local development stand-in.
5. **Recipient keys and sealing** (S13, S14, S18).
6. **Anchoring** (S9) and independent witnesses (S6, item 3).
7. **End-to-end documents** (S16), then the personal-data rule (S15) as kinds that need it are drafted.

Steps 1 and 2 are the minimum that makes "the host cannot silently rewrite history" true. Step 4 is the minimum that makes "a database dump reveals nothing" true.

## 13. Still not decided

These arise only while building: cover traffic to hide log volume from counterparties; how long a host must retain tree nodes for old consistency proofs; whether a witness's signature should carry its own time; how a company's clients learn of logs for policies created while they were offline; the blind-index scheme; and whether a counterparty that receives a fork proof should be able to hand it to the company's other counterparties (gossip), which is where Certificate Transparency's deployment proved weakest.

## 14. What this proposal does not do

It does not change any registered kind, vector, signing domain or identity format until its steps land, and Core-1's identity part is untouched. It does not make what was written true: a log proves a record was accepted and not rewritten, not that the goods shipped. It does not protect plaintext from a running host, from a client holding live keys, or from anyone a company chose to disclose to. It does not harden applications, servers or networks, and it does not add a blockchain, token or consensus mechanism to the protocol.

## 15. Prior art

From published texts as understood by the author; check exact sections against the versions the owner pins.

| Source | What was taken | What was not, and why |
|---|---|---|
| Certificate Transparency (RFC 6962, RFC 9162); Trillian | Merkle tree hashing, signed tree heads, inclusion and consistency proofs; equivocation as a portable proof | Public logs of everything; here each log is private to its policy's readers |
| transparency.dev witness network; Sigstore Rekor | Witnesses co-signing a checkpoint after checking consistency | A fixed public witness set; here witnesses are relying-party policy |
| Key Transparency, CONIKS | Users checking their own entries; one mechanism for keys and data | A global key directory; DTP has no global registry (V5) |
| SQL Server ledger tables; Amazon QLDB (discontinued 2025) | A database whose digests are stored outside it, so the database owner cannot rewrite unnoticed | A vendor-bound digest service; here heads are portable signed objects |
| Hyperledger Fabric; IBM Food Trust | Supply-chain records that no single member can rewrite | Consensus among companies and shared channels; each company keeps its own ledger |
| RFC 3161; RFC 4998 Evidence Record Syntax; OpenTimestamps | External timestamps, renewal of long-term evidence, free aggregation into Bitcoin | Putting data or tokens on a chain |
| Envelope encryption in cloud KMS (AWS, Google Cloud, Azure) | Per-tenant data keys wrapped by a key the database never holds; customer-managed keys | Provider-specific formats |
| HPKE (RFC 9180); ML-KEM (FIPS 203); ML-DSA (FIPS 204) | Sealing to a recipient; hybrid post-quantum KEMs; a later signature path | Authenticated HPKE modes, since DTP signatures already authenticate |
| Git | Content-addressed history, a digest chain per history | Trusting whoever serves the repository |
