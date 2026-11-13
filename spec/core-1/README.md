# DTP Core-1

**Status: approved by the owner on October 22, 2026, with two amendments (business vocabulary, time in business payloads) and, on October 29, 2026, a third (backdating and the signing-domain target, from the data-layer security proposal); not released.** Core-1 is the smallest part of DTP that every implementation must have and that is enough for two parties who have never met to create identities and exchange a signed record each can verify, with no host in the loop. Everything else in DTP becomes an optional, separately versioned extension on top of it.

This document defines what Core-1 is and how today's layers converge on it. Each part lands in its own pull request with conformance vectors; the list at the end says which.

## Why

The default branch carries four generations of protocol (the v0.2 record envelope, v0.3, the v0.4 candidate and the foundation layer), about 190,000 words of documentation, three identity schemes and five ways to sign an object. An implementer cannot tell what they must build, an identity minted under one release number is not the same identity under the next, and two of today's signing formats can only be checked by calling the host that issued them. Core-1 keeps the properties that make DTP worth implementing and drops everything else from the mandatory path.

## The five parts

### 1. JSON

What DTP signs is **I-JSON** ([RFC 7493](https://www.rfc-editor.org/rfc/rfc7493)) with two further rules:

- **Member names need no escape.** A name contains no quotation mark, reverse solidus or control character, so it is never written with an escape sequence. A receiver checks this on the received text **before** parsing, and refuses the whole text (`unsafe_member_name`). Rationale: [docs/security/json-member-names.md](../../docs/security/json-member-names.md).
- **No member is named twice**, at any depth; refused in the same pre-parse check (`duplicate_member_name`).
- **Numbers are integers** within ±(2^53−1). Decimal amounts are strings.
- **Nesting is at most 48 levels.** A signed body is level 0, and each array or object adds one level to the values inside it; a value deeper than level 48 is refused. A verifier checks this before canonicalizing, so whether a body is valid depends on its bytes alone, never on the verifier's stack. The bound is v0.4's transport bound, which every v0.4 command already meets (owner decision of 2026-11-04 on #149). An envelope that breaks it is `invalid_envelope` (part 3).

Canonical form is RFC 8785 (JCS) over that JSON. Canonicalization refuses anything a receiver would refuse, so nothing a receiver refuses can be signed. Vectors: `spec/vectors/unsafe-json.json`, `spec/vectors/canonicalization.json` (cases and `refuse`).

### 2. Primitives

| What | Core-1 | Notes |
| --- | --- | --- |
| Hash | SHA-256 | Over canonical UTF-8 bytes. Digests are lower-case hex. |
| Signature | Ed25519, RFC 8032, verified strictly (cofactorless, canonical S, A and R) | A key is refused when it enters control unless it is of prime order (`spec/vectors/key-registration.json`). |
| Key and signature text | `ed25519:` followed by base58 | One encoding for both. |
| Identifiers | An identity's id is the UUID form of the first 128 bits of its genesis digest | The full genesis digest is kept and checked. |
| Time | Integer milliseconds since the Unix epoch, UTC | The one time encoding of Core-1's own bodies: envelopes, identity logs and record metadata. A business payload (a profile's or verb kind's body) carries a UTC instant as an ISO-8601 string with millisecond precision, `YYYY-MM-DDTHH:MM:SS.sssZ`, in exactly that one spelling, as the act header and every registered kind already do and as UBL and EPCIS documents do (amendment, October 22, 2026). |

### 3. One signed envelope

Every signed object in Core-1 has the same shape and the same signing rule:

```
Signed<T> = { "body": T, "signatures": [ { "key_id": "ed25519:…", "signature": "ed25519:…" }, … ] }
signing input = canonical({ "domain": <domain>, "body": <body> })
```

The **domain** names what the body is and its format version, such as `DTP-PERSON-GENESIS-1`. Domains are permanent: a domain never changes meaning, and a new format is a new domain. It is never derived from a software release number. A verifier knows from context which domain to expect and never takes it from the message. Several signatures over the same input express a threshold. A verifier refuses the whole envelope, with one of two codes: `invalid_signature` when a signature is malformed or does not verify, and `invalid_envelope` for anything else, including a body that is not the JSON of part 1 (a number that is not a safe integer, or a lone surrogate in a string), which cannot be canonicalized. This is the foundation layer's form today, close to JWS general serialization and COSE_Sign.

The Core-1 domains are those of parts 4 and 5. A verifier implements only those. Reference: `sdk/src/core1/envelope.ts` (`signEnvelope`, `verifyEnvelope`, `meetsQuorum`, `CORE1_DOMAINS`). Vectors: `spec/core-1/vectors/envelope.json` (regenerate with `node sdk/scripts/build-core1-envelope-vectors.ts`).

### 4. Identity

One identity scheme for people and one for organisations: the foundation layer's, unchanged in substance.

- **Person.** A genesis (`DTP-PERSON-GENESIS-1`) declares separate operational and recovery key sets, each with a threshold, every key proving possession. Transitions (`DTP-IDENTITY-TRANSITION-1`) rotate operational keys under the operational quorum, recover under the recovery quorum, and change recovery policy under the old recovery quorum; each binds the prior digest and the next sequence. Moving to another host is owner-signed (`DTP-IDENTITY-REHOME-1`). The whole history travels as a **portable identity log** anyone can verify from the genesis forward ([docs/foundation/identity-log.md](../../docs/foundation/identity-log.md)).
- **Organisation.** A genesis (`DTP-ORGANIZATION-GENESIS-1`) commits to its founder and its initial governance (controllers and threshold); governance changes (`DTP-ORGANIZATION-TRANSITION-1`) are signed by the current controllers, with each added controller's consent (`DTP-ORGANIZATION-CONSENT-1`). The governance history is a log of the same kind.
- **Fewer options.** A host MUST attest every head it serves (`DTP-IDENTITY-LOG-HEAD-1`). A relying party MUST keep the last log it admitted for an identity and compare a newer one against it; that is how a fork is detected. One log format (`dtp-identity-log-2`); format 1 is withdrawn before release.

An identity is not a verified legal person. It is self-certifying control over keys.

### 5. Signed records and exchange bundles

- **A record** is a `Signed<Record>` under `DTP-RECORD-1`. Its body names its issuer (a person, or a person acting for an organisation), the identity-log head it was signed under, its profile by content digest (what kind of document it is), the record it supersedes if any (by digest, with the next sequence), and its payload. Core-1 checks the structure and the profile digest. What a payload means is the profile's business, not Core-1's.
  **Proposed format** (step 4, first pull request; `needs-owner`). The body has exactly these members:

  ```
  Record = { "issuer":       { "identity": <identity id>, "head": { "sequence": <n>, "digest": <hex> } },
             "organization": null | { "id": <organisation id>, "head": { "sequence": <m>, "digest": <hex> } },
             "profile":      <hex digest of the profile document>,
             "sequence":     <integer ≥ 1>,
             "supersedes":   null | <record digest>,
             "issued_at":    <integer ms>,
             "payload":      <object> }
  ```

  Identifiers are lower-case UUIDs; digests are lower-case SHA-256 hex. A head is named by its sequence and its digest (the identity-log head of part 4, or the organisation's governance head). `supersedes` is null exactly when `sequence` is 1. `issued_at` is the issuer's own claim and bounds nothing; backdating is settled by the receipt and `stale_head` below. The **record digest** is SHA-256 over the canonical `Signed<Record>`, signatures included, the digest a log leaf commits to. A verifier checks, in order: the envelope under `DTP-RECORD-1` (`invalid_envelope`, `invalid_signature`); the body as above (`invalid_record`); the profile digest it expects, when it expects one (`unexpected_profile`); that the heads it holds are the ones the record names (`wrong_head`); that every signer is an operational key at the issuer's head and together they meet its threshold, and, for an organisation, that the issuer is a controller at the named governance head (`unauthorized_signer`). A record supersedes another when it names the other's record digest, takes the next sequence, and keeps the profile and the issuing party, the organisation when there is one and otherwise the person (`broken_supersession`). Reference: `sdk/src/core1/record.ts`. Vectors: `spec/core-1/vectors/record.json` (regenerate with `node sdk/scripts/build-core1-record-vectors.ts`).
- **A host receipt** is a host's signed statement that it accepted a record (S1 of the [data-layer security proposal](../../docs/foundation/data-layer-security-proposal.md)). A host appends one leaf per accepted record to an append-only [RFC 9162](https://www.rfc-editor.org/rfc/rfc9162) Merkle log and signs the new head under `DTP-LOG-HEAD-1` with its own key, after every record.
  **Proposed format** (step 4, receipt pull request; `needs-owner`):

  ```
  Leaf    = { "record": <record digest>, "accepted_at": <integer ms>, "effects": [ <digest>, … ] }   // 0 to 64 effects
  LogHead = { "log_id": <uuid>, "size": <integer ≥ 1>, "root": <hex>, "signed_at": <integer ms> }
  Receipt = { "head": Signed<LogHead>, "leaf": Leaf, "path": [ <hex>, … ] }
  ```

  The leaf hash is SHA-256 over the byte 0x00 followed by the canonical leaf; a node hash is SHA-256 over 0x01, the left hash and the right hash; the root is RFC 9162's tree hash over the leaf hashes in log order. `effects` lists the digests of what the host computed from the record, in the order it wrote them, and is empty for a record with no reducer. The record is the head's **last** leaf: its index is `size − 1`, so the receipt carries no index. A receipt has at most 53 path nodes. A verifier is given the record digest and the host's key, and checks, in order: the receipt, the leaf and the head have exactly these members, as above (`invalid_receipt`); the head's envelope under `DTP-LOG-HEAD-1` (`invalid_envelope`, `invalid_signature`), signed by exactly one key, the host's (`unauthorized_host`); the leaf names the record (`wrong_record`); the path proves the leaf at index `size − 1` under the head's root, by RFC 9162 section 2.1.3.2 (`not_included`); and `accepted_at` is at most `signed_at` (`time_order`). `accepted_at` is the host's signed acceptance time, which the backdating rule below uses.
  Two verified heads of one host compare as: *unrelated* (different `log_id`); *same*; *re-signed* (same size and root, another `signed_at`); *ordered* (different sizes, the larger signed no earlier; whether it extends the smaller is a consistency proof's question, outside Core-1); *equivocation* (same size, different roots: portable proof that the host forked its log); or *time_order* (the larger signed earlier, which no honest host does). Reference: `sdk/src/core1/receipt.ts`. Vectors: `spec/core-1/vectors/receipt.json` (regenerate with `node sdk/scripts/build-core1-receipt-vectors.ts`), which also give the leaf hashes and roots of one five-leaf log.
- **An exchange bundle** carries a record together with everything needed to verify it offline: the issuer's identity log up to and including the head the record names, and for a record issued for an organisation, the organisation's governance log showing the signer was a controller at that head. A recipient verifies the bundle with no network access and no host. A host may still add a short-lived freshness or delivery token, but no host token is needed to know who signed what, and for whom.

**Backdating, settled in the bundle pull request.** A key that has been rotated out could sign a new record naming an older head. A bundle proves who held which keys at each head; it cannot by itself prove when a record was signed. The bundle pull request settles this, with vectors: a recipient's own receipt time against the newest head it has admitted, an optional host head attestation counter-signing the record, or both. Decided by the owner on October 29, 2026: both, as S1 and S2 of the [data-layer security proposal](../../docs/foundation/data-layer-security-proposal.md), with the host's counter-signature as a signed log head (`DTP-LOG-HEAD-1`) carried in the bundle as the record's receipt, and the recipient rule refusing a stale head without one (`stale_head`).

## The business vocabulary on top of Core-1

**Amendment, October 22, 2026.** The [verb layer](../../docs/foundation/verb-layer-proposal.md) is DTP's normative business vocabulary: object references, the act header, the protocol object classes ([`spec/profiles/verbs.md`](../profiles/verbs.md)) and the verb kinds (`dtp/object@1`, `dtp/flow@1`, and `assign`, `claim`, `observe` and `value` as they are registered). It sits on Core-1 records rather than inside Core-1: an implementation that only creates identities and exchanges signed records does not need it. An implementation that reads or writes business records MUST use it, so it is not an optional extension in the sense of the list below. The registered kinds that predate it (`product@1`, `party@1`, `inventory@2`, `order@1`, `forecast@1`) stay registered and are bridged to it.

## What is not Core-1

These stay in the repository as optional extensions, each with its own document, version and vectors, implemented by whoever needs them:

- membership, policies, roles and grants within a company;
- host-issued evidence and authority tokens;
- host migration of live business state (the v0.4 cooperative freeze, as an optimisation on top of the owner-signed rehome);
- module release and admission;
- business profiles beyond the verb layer, including private kinds, as registered kinds with fixtures;
- discovery, commitments, changes and semantics, which no specified flow uses yet. They move to an unexported `experimental/` area until one does.

## Retired before the first release

Nothing here has been released, so these go without a migration: the v0.2 record envelope and its signing (no domain separation), v0.3 identifiers, the v0.4 identity minting (`person.register`, `DTP-PERSON-0.4`, `DTP-ORGANIZATION-0.4`; v0.4 hosts admit identities from their logs instead), the v0.4 command and token signing formats (their bodies travel in the Core-1 envelope), identity log format 1, and inventory@1. Legacy contracts and servers move to a tagged archive.

## How Core-1 is held to this

- **The specification stands alone.** An implementer passes the Core-1 vectors from this document and the documents it links, without reading the reference SDK. Where the SDK and the text disagree, that is a defect.
- **An independent implementation.** Before release, at least one implementation in a language other than TypeScript passes every Core-1 vector.
- **Measures, tracked in each pull request:** words an implementer must read to pass the vectors (target under 8,000); Core-1 signing domains (target 9 or fewer: the seven above, `DTP-RECORD-1` and `DTP-LOG-HEAD-1`; raised from 8 by S20 on October 29, 2026); exported symbols of the stable SDK (target under 60).

## Order of work

Each item is its own pull request with vectors, labelled `needs-owner`. Sequencing (owner, November 5, 2026, [#157](https://github.com/runquik/direct-trade-protocol/issues/157), replacing that of October 22, 2026): steps 1 and 2 first; then steps 3 and 4 here (identity, then records and bundles), because a record names an identity-log head and a bundle carries that log; then verb-layer build steps 3 and 4 (`assign@1`, then `claim@1`); then step 5 onward here.

1. **JSON** — I-JSON and duplicate names (#91).
2. **Envelope** — one `Signed<T>` sign and verify, the Core-1 domain list, and envelope vectors (`spec/core-1/vectors/envelope.json`).
3. **Identity** — the attestation and log rules above (hosts MUST attest, relying parties MUST keep the last log, format 1 withdrawn), with vectors.
4. **Records and bundles** — `DTP-RECORD-1`, the exchange bundle and its offline verification, settling backdating; vectors for accepted and refused bundles. It also carries the host receipt (`DTP-LOG-HEAD-1`) and the `stale_head` rule (S1, S2 and S20 of the [data-layer security proposal](../../docs/foundation/data-layer-security-proposal.md), decided October 29, 2026).
5. **v0.4 on Core-1** — v0.4 hosts admit identities from logs and carry commands and tokens in the Core-1 envelope; the retired formats are removed.
6. **Extensions and experimental** — move the optional layers out of the stable path and archive the legacy code; one README entry point.
7. **Independent implementation** of Core-1 in a second language.
