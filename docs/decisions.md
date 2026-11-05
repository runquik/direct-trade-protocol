# Owner decisions

Every decision the owner has made on the protocol, the reference implementation and how the teams work, in protocol terms, newest at the bottom of each section. Each entry links the issue or pull request where the owner's decision comment is; that comment is the authority, and this page is the index.

**How to use it.** Before asking the owner anything, look here (see [teams/README.md, When you are blocked](../teams/README.md#when-you-are-blocked)). If an entry answers the question, act on it and cite the entry; do not ask again. A later entry overrides an earlier one on the same point.

**How it grows.** The project lead adds an entry, in a pull request, for every owner answer it carries back, and for every recommendation taken by default after its decision date passed with no answer (marked *default*). Nothing else is added here. An entry that does not match its linked decision is a defect.

Links point to `https://github.com/runquik/direct-trade-protocol/issues/<n>`, which also opens pull requests.

## Signing, canonicalization and wire encoding

- **2026-10-01** · [#44](https://github.com/runquik/direct-trade-protocol/issues/44) · v0.4 signature verification MUST follow RFC 8032 strictly, including the canonical-S check (reject `S >= L`); the specification states the policy on non-canonical point encodings, small-order points and cofactored verification to match the strict reference, and a verifier that accepts what this rejects is non-conforming. Vectors include the `S + L` signature; the reference's strictness is a tested requirement, not a side effect.
- **2026-10-02** · [#45](https://github.com/runquik/direct-trade-protocol/issues/45) · Non-canonical public key encodings are refused at verification (RFC 8032 §5.1.3); the reference follows the specification. Small-order keys still verify, so existing records stay verifiable.
- **2026-10-02** · [#48](https://github.com/runquik/direct-trade-protocol/issues/48) · Small-order and mixed-order public keys are refused at key registration, with vectors; verification of existing signatures is unchanged.
- **2026-10-22** · [#79](https://github.com/runquik/direct-trade-protocol/issues/79) · Canonical JSON sorts member names by UTF-16 code units (RFC 8785), pinned by an astral-key vector and a SPEC clause.
- **2026-10-22** · [#97](https://github.com/runquik/direct-trade-protocol/issues/97) · An integer on the wire is lexical: an optional minus sign and digits only. A fraction or an exponent (`1.0`, `1e0`, `1.0000000000000001`) is refused before parsing, with wire-text vectors in `unsafe-json.json`.
- **2026-11-02** · [#113](https://github.com/runquik/direct-trade-protocol/issues/113) · For that rule: a command is refused `400 non_integer_number` (snapshot import keeps `invalid_snapshot`); it applies to v0.4 only, and the frozen v0.2/v0.3 stores and other parsers keep their behaviour; `-0` is not decided by it.
- **2026-10-22** · [#95](https://github.com/runquik/direct-trade-protocol/issues/95) · A string value containing U+0000 is refused by the kernel with a stable 400 code before any storage is attempted, with a vector.
- **2026-11-02** · [#108](https://github.com/runquik/direct-trade-protocol/issues/108) · That code is `nul_character`, for commands and for snapshot import. Canonicalization does not change: the refusal is a host admission rule, and RFC 8785 output and existing vectors stay as they are.
- **2026-10-22** · [#92](https://github.com/runquik/direct-trade-protocol/issues/92) · Time is integer milliseconds in envelope and identity primitives; business bodies keep ISO-8601 UTC millisecond strings.
- **2026-11-02** · [#124](https://github.com/runquik/direct-trade-protocol/issues/124), [#125](https://github.com/runquik/direct-trade-protocol/issues/125) · Core-1 `verifyEnvelope` keeps its two codes: a body that is not I-JSON is refused `invalid_envelope`, before any signature is checked. Signing is unchanged: a producer cannot sign such a body.
- **2026-11-04** · [#149](https://github.com/runquik/direct-trade-protocol/issues/149) · Core-1 part 1 sets a nesting limit of 48 (the v0.4 bound); a value nested deeper is refused `invalid_envelope` before canonicalization, whatever the verifier's stack size, with vectors.
- **2026-11-04** · [#132](https://github.com/runquik/direct-trade-protocol/issues/132) · `spec/README.md` indexes the Core-1 envelope vectors; nothing normative changes.

## Core-1, the verb layer and data-layer security

- **2026-10-22** · [#92](https://github.com/runquik/direct-trade-protocol/issues/92) · Core-1 is approved. The verb layer is the normative business vocabulary on top of Core-1, not an optional extension. Order: Core-1 steps 1–2 ([#91](https://github.com/runquik/direct-trade-protocol/issues/91), [#93](https://github.com/runquik/direct-trade-protocol/issues/93)), then verb steps 3–4, then Core-1 steps 3–5.
- **2026-10-29**, merged **2026-11-02** · [#129](https://github.com/runquik/direct-trade-protocol/issues/129) · Data-layer security decisions S1–S20, all as recommended: one append-only Merkle log per resource policy, whose host-signed head (`DTP-LOG-HEAD-1`) and inclusion proof form the receipt in Core-1 step 4; a backdating rule and the `stale_head` refusal; heads held by the company's clients, counterparties and optional witnesses; logs continue across migration; a replay auditor; hourly re-signing with RFC 3161 anchoring. Per-policy envelope encryption under organization keys (host-held or company-managed), recipient keys as a registered kind, HPKE-sealed bundles and evidence, salted commitments for personal data, end-to-end encrypted documents; enclave hosting deferred. Hybrid X25519 + ML-KEM-768 for all sealing now; hybrid signatures later, as new domains. The signing-domain measure rises from 8 to 9 (S20).

## Identity, re-homing and wallets

- **2026-10-03** · [#50](https://github.com/runquik/direct-trade-protocol/issues/50) · Fork-point rule: when two histories of one identity fork, a branch supersedes on epoch only if the recovery quorum behind its first divergent recovery-authorized entry is still the current quorum on the other history; otherwise it is a conflict that fails closed, never `superseded`. No new wire data.
- **2026-10-04** · [#53](https://github.com/runquik/direct-trade-protocol/issues/53) · A relying party holding only its pin refuses every conflict with its checkpoint, including a higher-epoch one. A quorum is current only if its keys and threshold both match, compared as a set regardless of key order.
- **2026-10-04** · [#56](https://github.com/runquik/direct-trade-protocol/issues/56) · The reference relying party honours held rehome refusals: a log containing a refused rehome is refused with the normative reason `refused-move`.
- **2026-10-05** · [#62](https://github.com/runquik/direct-trade-protocol/issues/62) · The held-refusal check comes right after `another-identity`; a held refusal that does not verify is ignored; a party already past a refused move fails closed. A refusal is stored only for a genuine rehome of the enrolled identity, stored refusals are capped per person, and they are matched by rehome digest.
- **2026-10-06** · [#64](https://github.com/runquik/direct-trade-protocol/issues/64) · Escape rehome: a log with a refused rehome is admitted if a later rehome, signed by the then-current recovery quorum and adopted by its destination, moves the identity to a destination other than the one that refused. A refusal for a move already admitted is kept as equivocation evidence against that destination.
- **2026-10-22** · [#67](https://github.com/runquik/direct-trade-protocol/issues/67) · The escape destination differs in both `resolver_id` and `resolver_key`; the escape applies at every party; `contradicts_admitted_move` as proposed.
- **2026-10-22** · [#69](https://github.com/runquik/direct-trade-protocol/issues/69); **2026-11-02** · [#112](https://github.com/runquik/direct-trade-protocol/issues/112) · `refused-move` is checked before the pinned-history conflict, with a vector.
- **2026-10-22** · [#83](https://github.com/runquik/direct-trade-protocol/issues/83) · A wallet MUST check the head it signs over (option 1, now). Later, after #67: resolution-only advances at a relying party become provisional (option 2).
- **2026-11-02** · [#106](https://github.com/runquik/direct-trade-protocol/issues/106) · A wallet signs a person operation only over the current head it holds, not an earlier one; the held head is a required argument of `signPersonOperation`.

## Authority, membership and governance

- **2026-10-04** · [#55](https://github.com/runquik/direct-trade-protocol/issues/55) · Requester rules: refusal codes are normative (`forbidden` for person and autonomous refusals, `approval_required` for a missing or unqualified interactive requester, `400 invalid` for `person.register`). A non-null `requested_by` is always an interactive call, allowed in either installation mode.
- **2026-10-22** · [#75](https://github.com/runquik/direct-trade-protocol/issues/75) · An interactive call whose installation sponsor has left is accepted, pinned by a vector.
- **2026-10-22** · [#98](https://github.com/runquik/direct-trade-protocol/issues/98) · `membership.revoke` ends a person's policy grants; a re-invited person has no data access until a steward grants it again.
- **2026-11-02** · [#114](https://github.com/runquik/direct-trade-protocol/issues/114) · How: a grant counts only from a policy revision signed after the person's latest revocation; a revocation is refused `409 conflict` while a later-signed grant to the person is current (a same-instant tie ends the grant); a policy command granting a person revoked at or after it is refused `400 invalid`; any later steward revision listing the grant re-grants it.
- **2026-10-22** · [#88](https://github.com/runquik/direct-trade-protocol/issues/88) · A policy whose non-controller stewards are inactive: document the risk now; then the controller quorum may replace the inactive stewards after a waiting period with notice to the remaining ones, and the replacement gives controllers no data access.
- **2026-11-04** · [#109](https://github.com/runquik/direct-trade-protocol/issues/109) · Part (c) is documented: a policy that loses its active stewards freezes and blocks the company's migration.
- **2026-11-02** · [#127](https://github.com/runquik/direct-trade-protocol/issues/127) · Governance-log replay: document the limit beside the "without trusting the host" guarantee now. A governance pin with fail-closed admission comes as its own proposal. Severity stays medium.
- **2026-11-04** · [#142](https://github.com/runquik/direct-trade-protocol/issues/142) · The docs build of that limit is approved.
- **2026-11-02** · [#130](https://github.com/runquik/direct-trade-protocol/issues/130) · An `inventory@2` ledger opens only under the product's own policy, by a caller holding `write` there; a mismatch is refused `forbidden` before the 409, and snapshot import refuses a mismatched opening `invalid_snapshot`; with a reject vector.
- **2026-11-04** · [#137](https://github.com/runquik/direct-trade-protocol/issues/137) · Migration key collisions: a key that is historical only (a revoked installation key, a member's retired key) no longer blocks import (A1); a forked person who is no longer a controller or member keeps the destination's record, and a current one is refused, naming the person and the remedy (B1); every remaining collision refusal names who collides (C).

## Privacy and error semantics

- **2026-10-22** · [#89](https://github.com/runquik/direct-trade-protocol/issues/89) · Writes leak nothing the reads do not: `record.append`'s error branches collapse as the read paths do.
- **2026-11-02** · [#116](https://github.com/runquik/direct-trade-protocol/issues/116) · How: a refused write answers `404 not_found` unless the caller can read the resource in that policy, and only then `403 forbidden`. It covers `record.append`, `inventory.create`, `inventory.open`, `flow.open`, `flow.ledger.open` and the recipient compartment of `evidence.inspect`. An unreadable or foreign `supersedes` target is refused exactly as an absent one. Object-id existence (`409 … exists`) is a separate open question on #89.
- **2026-10-22** · [#71](https://github.com/runquik/direct-trade-protocol/issues/71) · Records are numbered per organization, not host-wide, and the remaining cross-compartment signal is documented.
- **2026-11-02** · [#118](https://github.com/runquik/direct-trade-protocol/issues/118) · How: a snapshot export numbers its records 1 to n; an import starts the company's own sequence and reserves no host-wide capacity; exhausting a company's sequence is refused `507 capacity`; normative text and a regression test, no new vector.
- **2026-11-02** · [#110](https://github.com/runquik/direct-trade-protocol/issues/110) · "As recommended": option 1, document that a private profile's `readers` list and its signed publishing command are visible to every listed reader and to evidence recipients whose closure includes it (SPEC §5 and §7). A new evidence form that hides the list comes only as a separate proposal.
- **2026-11-04** · [#110](https://github.com/runquik/direct-trade-protocol/issues/110) · Confirmed: option 1, document only. `profile.get` is not minimised; this corrects the "minimise what `profile.get` returns" wording of the 2026-11-02 decision comment.

## Business-fact profiles

- **2026-09-30** · [#38](https://github.com/runquik/direct-trade-protocol/issues/38) · Inventory projection keys are the canonical digest of the identity tuple; snapshot import refuses keys in the old quoted form; the safe JSON parser and its member-name rule are not relaxed.
- **2026-10-22** · [#72](https://github.com/runquik/direct-trade-protocol/issues/72) · A reservation release applies to a reservation that is `held` or `expired`.
- **2026-10-22** · [#76](https://github.com/runquik/direct-trade-protocol/issues/76); **2026-11-02** · [#78](https://github.com/runquik/direct-trade-protocol/issues/78) · `order@1`: a same-status revision is allowed only in `placed`, `acknowledged` and `partially_fulfilled`; `rejected`, `cancelled` and `closed` accept no revision; `fulfilled` to `fulfilled` is refused. `forecast@1` is unchanged.
- **2026-10-22** · [#85](https://github.com/runquik/direct-trade-protocol/issues/85) · Within one fact, releases and fulfils apply first, then legs, then reserves, in `inventory@2` and `flow@1`; no schema change.
- **2026-10-22** · [#99](https://github.com/runquik/direct-trade-protocol/issues/99) · `base_units_per_pack` is matched by decimal value, not spelling (`"12.000"` matches `"12"`); spellings of 0–3 places stay accepted; in `inventory@2` and `flow@1`.
- **2026-10-22** · [#94](https://github.com/runquik/direct-trade-protocol/issues/94); **2026-11-02** · [#115](https://github.com/runquik/direct-trade-protocol/issues/115) · `party@1` `country` is checked for shape only: exactly two upper-case ASCII letters (`ZZ` accepted, `us` refused). Checking assigned ISO 3166-1 codes is host policy, not conformance.
- **2026-11-02** · [#119](https://github.com/runquik/direct-trade-protocol/issues/119) · `flow@1`: a fact's `issued_at` may not precede the `issued_at` of the opening of any ledger it changes. The live write path refuses it (`409 conflict`) as snapshot import already does, so both accept the same books; vectors both ways (earlier refused, equal accepted). A book committed before the change with such a fact still cannot be imported.
- **2026-11-04** · [#143](https://github.com/runquik/direct-trade-protocol/issues/143) · The build of that rule is approved as written: the live path refuses with `409 conflict` and accepts an equal `issued_at`.
- **2026-11-04** · [#144](https://github.com/runquik/direct-trade-protocol/issues/144) · `inventory@2` and `flow@1` observation window: the reference's window stands (with mark M, M−63 … M are inside; an unseen M−64 is refused `stale_observation`). The profile states it as an exact inequality, with boundary fixtures; no behaviour change.
- **2026-11-04** · [#145](https://github.com/runquik/direct-trade-protocol/issues/145) · `inventory@2` and `flow@1`: a `reserve` on an existing `reservation_id` tops up the claim only for the same party; a different party is refused `invalid`; `release` and `fulfill` must name the claim's party, or are refused `invalid`. With fixtures.
- **2026-11-04** · [#135](https://github.com/runquik/direct-trade-protocol/issues/135) · `flow@1`: an offset nets at least two distinct claims; one naming fewer (for example the same claim twice) is refused `invalid`, with a fixture.
- **2026-11-04** · [#136](https://github.com/runquik/direct-trade-protocol/issues/136) · `flow@1`: the `inventory@2` projection of a book sums positions that differ only in their location reference's `record_id`; the book and the contract are unchanged.

## Hosts, snapshots and migration

- **2026-10-01** · [#42](https://github.com/runquik/direct-trade-protocol/issues/42) · Health advertises each protocol kind's contract digest (an additive member beside `protocol_kinds`). Health is for discovery only; a module still verifies the digest it pins.
- **2026-10-05** · [#59](https://github.com/runquik/direct-trade-protocol/issues/59), [#61](https://github.com/runquik/direct-trade-protocol/issues/61) · Snapshot import enforces `unknown_packaging` against the product revision current at that point in the replay, not the latest; the refusal is `invalid_snapshot`.
- **2026-10-06** · [#63](https://github.com/runquik/direct-trade-protocol/issues/63) · Snapshot-import conformance vectors are whole snapshots and normative for v0.4: a conforming host imports the base and reproduces its projections exactly, and refuses every case `invalid_snapshot`.
- **2026-10-22** · [#65](https://github.com/runquik/direct-trade-protocol/issues/65) · The first set keeps its 10 cases and leaves out inventory-v1, invoices and private profiles.
- **2026-11-02** · [#123](https://github.com/runquik/direct-trade-protocol/issues/123) · The cases for `object@1` and `flow@1` are normative for v0.4 too.
- **2026-11-02** · [#107](https://github.com/runquik/direct-trade-protocol/issues/107) · The migration snapshot no longer carries the counterparty-authority cache.
- **2026-11-04** · [#151](https://github.com/runquik/direct-trade-protocol/issues/151) · A snapshot that still carries the counterparty-authority cache is refused `invalid_snapshot`.

## Packaging and releases

- **2026-10-22** · [#73](https://github.com/runquik/direct-trade-protocol/issues/73) · The `@dtp/sdk` version is bumped on every behaviour change, starting with the next release.
- **2026-11-04** · [#73](https://github.com/runquik/direct-trade-protocol/issues/73) · The first bump uses the label `0.2.1-dev.N`, with a changelog entry for each behaviour change.
- **2026-11-04** · [#140](https://github.com/runquik/direct-trade-protocol/issues/140) · The packed SDK pins its one runtime dependency to the exact version the conformance suite runs.
- Standing practice since **2026-10-02** ([#45](https://github.com/runquik/direct-trade-protocol/issues/45), [#53](https://github.com/runquik/direct-trade-protocol/issues/53), [#59](https://github.com/runquik/direct-trade-protocol/issues/59), [#63](https://github.com/runquik/direct-trade-protocol/issues/63)) · The owner re-runs gate evidence after a merge the gates fingerprint; a team adds gate checks but never marks a gate.

## How the teams work

- **2026-10-22** · [#34](https://github.com/runquik/direct-trade-protocol/issues/34) · Example hosts in documentation use reserved names such as `example.test`.
- **2026-11-02** · All 19 decisions then pending were taken as recommended; `owner-approved` replaces `needs-owner` on a decided item and stays on it as the record. Decided pull requests merge through the merge gate.
- **2026-11-04** · [#152](https://github.com/runquik/direct-trade-protocol/issues/152) · All 14 items of the 2026-11-04 decision list were answered as recommended (#110 confirmed as option 1, document only).
