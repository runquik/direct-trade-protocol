# DTP Core-1

**Status: approved by the owner on October 22, 2026, with two amendments (business vocabulary, time in business payloads); not released.** Core-1 is the smallest part of DTP that every implementation must have and that is enough for two parties who have never met to create identities and exchange a signed record each can verify, with no host in the loop. Everything else in DTP becomes an optional, separately versioned extension on top of it.

This document defines what Core-1 is and how today's layers converge on it. Each part lands in its own pull request with conformance vectors; the list at the end says which.

## Why

The default branch carries four generations of protocol (the v0.2 record envelope, v0.3, the v0.4 candidate and the foundation layer), about 190,000 words of documentation, three identity schemes and five ways to sign an object. An implementer cannot tell what they must build, an identity minted under one release number is not the same identity under the next, and two of today's signing formats can only be checked by calling the host that issued them. Core-1 keeps the properties that make DTP worth implementing and drops everything else from the mandatory path.

## The five parts

### 1. JSON

What DTP signs is **I-JSON** ([RFC 7493](https://www.rfc-editor.org/rfc/rfc7493)) with two further rules:

- **Member names need no escape.** A name contains no quotation mark, reverse solidus or control character, so it is never written with an escape sequence. A receiver checks this on the received text **before** parsing, and refuses the whole text (`unsafe_member_name`). Rationale: [docs/security/json-member-names.md](../../docs/security/json-member-names.md).
- **No member is named twice**, at any depth; refused in the same pre-parse check (`duplicate_member_name`).
- **Numbers are integers** within ±(2^53−1). Decimal amounts are strings.

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

The **domain** names what the body is and its format version, such as `DTP-PERSON-GENESIS-1`. Domains are permanent: a domain never changes meaning, and a new format is a new domain. It is never derived from a software release number. A verifier knows from context which domain to expect and never takes it from the message. Several signatures over the same input express a threshold. This is the foundation layer's form today, close to JWS general serialization and COSE_Sign.

The Core-1 domains are those of parts 4 and 5. A verifier implements only those.

### 4. Identity

One identity scheme for people and one for organisations: the foundation layer's, unchanged in substance.

- **Person.** A genesis (`DTP-PERSON-GENESIS-1`) declares separate operational and recovery key sets, each with a threshold, every key proving possession. Transitions (`DTP-IDENTITY-TRANSITION-1`) rotate operational keys under the operational quorum, recover under the recovery quorum, and change recovery policy under the old recovery quorum; each binds the prior digest and the next sequence. Moving to another host is owner-signed (`DTP-IDENTITY-REHOME-1`). The whole history travels as a **portable identity log** anyone can verify from the genesis forward ([docs/foundation/identity-log.md](../../docs/foundation/identity-log.md)).
- **Organisation.** A genesis (`DTP-ORGANIZATION-GENESIS-1`) commits to its founder and its initial governance (controllers and threshold); governance changes (`DTP-ORGANIZATION-TRANSITION-1`) are signed by the current controllers, with each added controller's consent (`DTP-ORGANIZATION-CONSENT-1`). The governance history is a log of the same kind.
- **Fewer options.** A host MUST attest every head it serves (`DTP-IDENTITY-LOG-HEAD-1`). A relying party MUST keep the last log it admitted for an identity and compare a newer one against it; that is how a fork is detected. One log format (`dtp-identity-log-2`); format 1 is withdrawn before release.

An identity is not a verified legal person. It is self-certifying control over keys.

### 5. Signed records and exchange bundles

- **A record** is a `Signed<Record>` under `DTP-RECORD-1`. Its body names its issuer (a person, or a person acting for an organisation), the identity-log head it was signed under, its profile by content digest (what kind of document it is), the record it supersedes if any (by digest, with the next sequence), and its payload. Core-1 checks the structure and the profile digest. What a payload means is the profile's business, not Core-1's.
- **An exchange bundle** carries a record together with everything needed to verify it offline: the issuer's identity log up to and including the head the record names, and for a record issued for an organisation, the organisation's governance log showing the signer was a controller at that head. A recipient verifies the bundle with no network access and no host. A host may still add a short-lived freshness or delivery token, but no host token is needed to know who signed what, and for whom.

**Open question for the bundle pull request: backdating.** A key that has been rotated out could sign a new record naming an older head. A bundle proves who held which keys at each head; it cannot by itself prove when a record was signed. The bundle pull request settles this, with vectors: a recipient's own receipt time against the newest head it has admitted, an optional host head attestation counter-signing the record, or both.

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
- **Measures, tracked in each pull request:** words an implementer must read to pass the vectors (target under 8,000); Core-1 signing domains (target 8 or fewer: the seven above and `DTP-RECORD-1`); exported symbols of the stable SDK (target under 60).

## Order of work

Each item is its own pull request with vectors, labelled `needs-owner`. Sequencing (owner, October 22, 2026): steps 1 and 2 first; then verb-layer build steps 3 and 4 (`assign@1`, `claim@1`), which the flagship's shadow close needs; then steps 3 to 5 here.

1. **JSON** — I-JSON and duplicate names (#91).
2. **Envelope** — one `Signed<T>` sign and verify, the Core-1 domain list, and envelope vectors (`spec/core-1/vectors/envelope.json`).
3. **Identity** — the attestation and log rules above (hosts MUST attest, relying parties MUST keep the last log, format 1 withdrawn), with vectors.
4. **Records and bundles** — `DTP-RECORD-1`, the exchange bundle and its offline verification, settling backdating; vectors for accepted and refused bundles.
5. **v0.4 on Core-1** — v0.4 hosts admit identities from logs and carry commands and tokens in the Core-1 envelope; the retired formats are removed.
6. **Extensions and experimental** — move the optional layers out of the stable path and archive the legacy code; one README entry point.
7. **Independent implementation** of Core-1 in a second language.
