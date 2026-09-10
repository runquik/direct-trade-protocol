# Independent architecture review: next DTP candidate

September 10, 2026. Review of the executable stress report, domain map, proposed 28-case matrix and current v0.3 authorization/migration implementation. This is an acceptance recommendation, not a green-light report. Scope is a reviewed release-ready branch; no merge, deployment or production certification.

## Release contract

Ship a **bounded modular-business reference candidate**, not a universal ERP, independent-host certification or production HR system. Retain the existing signed identity and company authority foundation. New semantics must have a named revision/profile, discoverable capabilities, documented incompatibilities and exact positive/negative vectors. Historical PBP signing domains and signed commands must not be renamed in place.

Six finding groups need actual desired-invariant tests. An assertion that a defect still reproduces cannot satisfy a release gate. A supported operation must succeed with its semantics intact; an unsupported operation must reject before creating an irreversible or misleading partial success. Product scope exclusions must remain visible, not silently turn an acceptance failure green.

### G1. Safe cooperative host exit

Minimum contract: destination stages and validates the exact snapshot before the source freezes. A signed destination-ready receipt binds company ID, authority generation, snapshot digest, source and destination audiences and keys, compatible profile set, staging ID, byte limits and expiry. Source commit verifies that receipt, current snapshot and controller quorum. Destination activation consumes the matching durable source handoff exactly once. Recovery retrieves durable receipts; no unconditional source reactivation is permitted after handoff.

Transport must be bounded. For large companies use numbered, digest-checked chunks and a complete manifest; retries and out-of-order delivery cannot change assembled bytes. Never activate a partial snapshot. Staging reserves conflicting identities/record IDs or revalidates them atomically at activation; a ready receipt must not ignore destination conflicts that can arise while waiting. A size-only preflight is an immediate safety patch, not successful large-company migration.

Required attacks: bad destination signature, wrong destination/key/company/generation/hash, stale preview, expired readiness, missing/corrupt/duplicate/conflicting chunks, destination restart, lost stage/commit/activation response, repeated activation, write between preview and commit, same company staged twice, and old-source write after activation. Failures before commit leave the source writable. Failures after commit retain a recoverable destination path and a truthful frozen source. Source-loss disaster recovery remains a separate unimplemented capability unless actually tested.

### G2. Cross-host counterparty continuity

Do not solve `all parties must have active local company authority` by manufacturing local partner organizations or importing a partner's private membership directory. A remote party is an authenticated reference, not local write authority.

Use explicit pinned host trust and a signed, bounded remote authority/evidence contract. Bind organization identity, serving host/key, authority generation, subject-owned exact record versions and expiration. State who may issue the proof and how the verifier knows it is current. A mere `known_remote_company_ids` list or an unsigned locator is insufficient. Keep the engine deterministic: clients can relay signed proofs; the core need not fetch arbitrary URLs.

Minimum successful fixture: seller moves A to B; buyer stays A; seller can continue its owned agreement/invoice at B; buyer can obtain an authorized signed new revision through the supported relay; buyer cannot mutate seller-owned state without the existing role rules; old host cannot introduce a competing head. Shared history and current state must be distinguishable. An acceptance-only bypass that leaves the buyer unable to see new records does not close continuity.

Required attacks: forged host identity, untrusted issuer, mismatched organization, stale generation, expired proof, third-company access, replay after relocation/revocation and two purported heads. Where freshness cannot be established, report unavailable/stale rather than verified current. Initial trust-pinned relay support can be narrow and cooperative; do not call it universal federation or partition-safe consensus.

### G3. Sensitive employee authority

Company control must not grant implicit plaintext access. Introduce organization-local subject/compartment identity and independently authorized data stewardship. Gate **the whole signed record**, including `command.payload.body`, before serialization. Separate ordinary governance from read/write/export/disclose rights for a compartment. Employee-self access must bind to an explicit local engagement, not a caller-supplied employee ID. Both human and installation grants must match the resource and operation; automation needs an explicit matching grant.

Required negative matrix: employee A vs employee B; manager vs other team; payroll vs medical; controller with no sensitive grant; CFO switching among three organizations; revoked member/installation; prepared command and replay. Apply each to list, workspace, export, disclosure and migration snapshots/receipts, including audit commands. Counts, IDs, summaries and errors must not leak a salary canary. Filtering only the `records` array of a snapshot fails if audit still contains the payload.

For the initial **v0.4 reference candidate**, the feasible boundary is a trusted host enforcing explicit compartments on whole signed records. That can demonstrate API-level employee authority without inventing production cryptography. It does **not** protect plaintext from a database administrator or compromised host; test data must remain synthetic. At-rest encryption, custodial key management and jurisdiction-specific retention remain deployment gates. Alternatively, a future encrypted/external-payload profile can narrow host visibility, but must separately define who can decrypt, rotate/recover keys and authorize export; encryption is not a substitute for API authorization.

Compartment stewards cannot silently widen historical signed access by changing a role label. Export must state omissions, and migration cannot silently discard protected business state to make its test pass. For this candidate, full-company migration should require explicit current stewardship approval for every protected compartment, failing closed when approval is absent. Deletion/retention and key recovery require a deliberately separate policy; do not claim that revocation erases prior copies.

### G4. Governed extensibility and module descriptors

Company-owned types must be publishable without central source edits. Bind collision-resistant publisher authority, namespace, immutable version/digest, declared subject/party semantics and a bounded schema dialect. Forbid network `$ref` resolution, executable validators, unsupported mandatory keywords and unbounded recursion. Protect standard namespaces. Exact profile/schema references must travel with records and survive migration; a host that cannot enforce required semantics must reject admission.

Required attacks: another publisher's namespace, changing bytes under one version, hash mismatch, standard-field override, unknown required extension, malicious/recursive reference, oversized/deep schema, unrecognized validation keyword and unsupported consumer version. Two separately implemented readers must interpret the frozen fixture identically or explicitly refuse compatibility; two adapters importing one reducer do not count.

An artifact digest, runtime requirements, assessment reference and private/community intent can be descriptors now. They are not executable hosting or security approval. Publishing metadata never grants record access, and installing a new artifact/privilege set requires explicit consent. The candidate must not execute uploaded code. Real module screening remains a future host product gate.

### G5. Inventory and packaging semantics

Implement a narrow published profile, not hidden `x_inventory` conventions: issuer-scoped observation ID, item/lot/location, exact packaging revision, business/observation time, correction linkage and authoritative stock/reservation version. Physical scan identity is separate from signed request identity. The same observation cannot have two effects; conflicting reuse must fail. A stock state revision/CAS or equivalent serialized authoritative reservation primitive must prevent two commitments against the same remaining balance.

Required fixtures: exact retry; fresh command with duplicate observation; conflicting duplicate; late event; concurrent eight-case reservations against ten; cancellation/release; count correction while reserved; stale pack version; explicit repack rather than retroactive conversion. Corrections may reduce stock below existing commitments only with a defined shortage/conflict state, not by inventing available stock. No claim of globally truthful physical stock follows from a local reservation invariant.

### G6. Invoice validation and evidence classes

Use exact decimal arithmetic and a declared rounding rule. Check quantity times unit price, line sums, deductions/taxes and total without binary floating-point drift or implicit currency conversion. Distinguish schema validity, arithmetic validity, reference availability, reference party binding and counterparty attestation. A missing/inaccessible reference can remain ingestible only if its validation result explicitly says unknown/unresolved; it cannot authorize a financing or payment transition that requires verified evidence.

Required vectors: deliberate arithmetic mismatch, mixed currencies, fractional quantities/rounding boundaries, negative/overflow values, missing contract, inaccessible foreign contract, wrong-party reference, stale referenced revision and an extracted claim dressed as counterparty approval. Validation reports are attributable derived judgments, not new signatures by an absent buyer.

## Dependency and evidence graph

```text
Frozen candidate contract + compatibility boundary
  -> scoped authority -> extension admission -> protected profiles
  -> exact schema/profile references -> inventory/invoice semantics
  -> portable sensitive state + pinned definitions -> staged migration
  -> signed relocation + remote party/evidence trust -> continued trade
Each implementation node -> positive vector + adversarial vector
  -> independent review -> regression/runtime qualification -> release manifest
```

Graph nodes should name an owner, spec section, implementation path, test IDs and evidence artifact. Edges represent real dependencies: migration cannot claim complete portability before carrying newly introduced grants, schema definitions and profile state. A test that passes against a stale source hash is not evidence for the final candidate. Changed dependencies invalidate downstream evidence and trigger reruns.

## Review/fix loop and finish condition

1. Freeze the candidate contract and expected results before patching tests.
2. Reproduce baseline failures; implement one dependency slice; run focused positive and adversarial checks.
3. Have a reviewer attack the trust boundary, not merely read passing test output. Record severity, reproduction and disposition.
4. Fix each release-blocking finding; add a regression; rerun affected descendants in the evidence graph.
5. Run all suites and supported runtime/database gates on the final exact tree. Review the release diff and generated evidence for credentials or synthetic-data confusion.
6. Publish a release manifest tying commit/tree identity, runtime, dependency lock, schema digests, supported profiles, test evidence and explicit exclusions together. Only then call the reviewed candidate ready.

Stop condition: all **in-scope required gates** have desired-result evidence, no unresolved P0/P1 or unaccepted P2 affecting promised semantics, independent code/security review is complete, compatibility/migration notes agree with code, and the branch is reproducible without local demo state. No automatic merge/deploy. Missing environment access or independent implementation is a named blocked gate, not a green check. No amount of looping substitutes for external authority or unavailable runtime qualification.

## Current assessment and positive controls

| Dimension | Assessment before the update |
|---|---|
| Security | Hold for expanded scope: type-wide private access and controller exports cannot support sensitive HR; signing, audience binding, membership revocation and installation intersection are valuable retained controls |
| Correctness | Hold: irreversible failed exit, local-only relationship continuity and accepted invoice inconsistency; exact request idempotency and one-head CAS already hold |
| Performance/reliability | Hold for migration scale: bounded request transport is useful but monolithic replicated snapshot and whole-state transactions need explicit candidate limits |
| Maintainability | Improve by separating contracts/profile reducers from the growing engine switch; generated schema/source parity and fixed signing vectors should remain gates |

Code anchors reviewed: `sdk/src/v03/engine.ts` (`readVisible`, `snapshot`, `disclosure.read`, `record.append`, migration cases); `sdk/src/v03/permissions.ts` (controller wildcard and registered-type scopes); `sdk/src/v03/model.ts` (inline signed records/snapshots); `spec/v0.3/SPEC.md` (current trusted-store and 1 MiB preview limitations). These are architectural release gaps relative to the new requirements, not a claim that the old preview promised universal portability or HR support.

## Implementation review follow-through

The candidate now isolates the new contract under `sdk/src/v04/`. This reviewer implemented the cooperative migration and remote-authority helpers and hardened snapshot validation, then received independent review probes from a second agent. The final release report, not this evolving review note, owns the aggregate gate count and final tree identity.

The implementation/review loop closed concrete defects rather than merely adding acceptance labels:

- A future-issued readiness token within generic clock skew could freeze the source before its temporal chain was valid. Source commit now waits until the readiness issuance time; failed attempts remain writable.
- An abandoned ready stage held reservations indefinitely. Source-signed pre-commit cancellation plus destination abort now releases them without source rollback; cancellation after commit is rejected.
- Digest-only reservations missed profile-version, module, installation-ID and public-key aliases. Dedicated alias reservations protect those namespaces through cutover.
- Two different incoming migrations could collide while destination live tables were still empty. Snapshot validation now treats every other ready stage as reserved state.
- Snapshot export omitted private definitions and releases that a publisher had not installed. Owned published definitions/releases and transitive dependencies now travel with the company.
- Snapshot policy/membership/record and inventory projections were initially insufficiently checked. The validator now checks signed history projections, policy stewardship transitions, exact profile/release contracts, record heads, installation attribution and inventory reconstruction from signed pool creation plus ordered events.
- A destination installation UUID collision with a different public key was found independently and closed, with a fixture using legitimate signed setup on both hosts.
- Third-peer relocation originally required a handoff held locally by the source. An explicit relay now lets a third pinned host advance its cached authority by verifying the old source's durable commit, the destination's matching readiness and a fresh destination authority proof. It does not create local company authority, trust an unsigned redirect, or accept arbitrary generation jumps through the relocation operation.

Relevant reproducible suites: `sdk/tests/v04/migration.test.ts`, `migration-snapshot.test.ts`, `snapshot-review.test.ts` and the independently authored HTTP migration tests. A greater-than-1-MiB transfer is covered both by helper probes and actual signed HTTP stores. These use one reference implementation across hosts, not independently authored servers.

Remaining trust boundary: a pinned source is still trusted for completeness, original accepted ordering, and historical delegated data authorization that cannot be replayed exactly from command issuance timestamps alone. Foreign publishers' private authority directories are not copied into every consuming company's export. Historical assessment signatures are preserved, but issuer trust is not transferred and expired approvals are not renewed. Destination installations remain disabled pending explicit admission. These limits must appear in the candidate specification and prevent a hostile-host, production-HR or universal-federation claim.
