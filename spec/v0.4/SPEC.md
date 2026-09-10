# Direct Trade Protocol 0.4 reference candidate

Status: **bounded reference candidate, not production certification**. This document describes the implemented 0.4 surface, not a universal business schema, a finished workspace or an executable module marketplace. Use synthetic data until the deployment/privacy/security gates for a real service have been independently satisfied.

The objective is portable business meaning and authority across replaceable applications and cooperative, explicitly trusted hosts. The command vocabulary is defined in [command.schema.json](command.schema.json); executable contextual rules live in [the kernel](../../sdk/src/v04/engine.ts). Shape validation alone is insufficient. A discrepancy between specification, schema and kernel is a release defect, not permission to bypass the stricter invariant.

## 1. Version and trust boundaries

Version 0.4 is isolated from the [0.3 authority preview](../v0.3/SPEC.md) and frozen 0.2 envelope. It has distinct command/signing domains, routes and the `dtp_v04` database namespace. No old signed command is renamed or silently reinterpreted. Person and company identifier derivation is also version-separated. There is no automatic 0.3-to-0.4 identity or business-record migration adapter in this candidate; such an adapter must preserve original provenance and establish explicit new authority.

The reference host is trusted to enforce current policy, accepted order, storage completeness and transactions. Host administrators can access its plaintext database. A pinned source host is trusted for original acceptance and completeness during migration/evidence exchange. Signatures and projection checks detect many altered or internally inconsistent artifacts; they do not establish resistance to a malicious pinned host fabricating an incomplete history or claiming physical truth.

The candidate protects API-level company/resource boundaries, signed attribution, expiry/revocation, immutable contract identity, selected business invariants and cooperative cutover. It does not provide decentralized consensus, global discovery, global exactly-once effects, bank settlement, legal identity verification, privacy-law certification, encrypted hostile-host custody or recovery when every authorized recovery credential is lost.

Host pins are explicit `audience -> store public key` configuration. Artifact-assessor pins are a **separate** configuration. Federation trust does not authorize a host to approve executable artifacts. All pins and revocation lists are operator configuration, not self-issued client claims.

## 2. HTTP and signed commands

| Endpoint | Behavior |
|---|---|
| `GET /dtp/v0.4/health` | Unsigned candidate status, exact audience/store key and supported limits/semantics |
| `POST /dtp/v0.4/commands` | One signed UTF-8 JSON command; success `{ "result": ... }`; failure `{ "error": { "code": "...", "message": "..." } }` |

The health response is discovery information, not a trust anchor obtained independently of the connection. Verify a remote store key through the intended trust/enrollment procedure before pinning it. Use TLS for non-local transport. The command `audience` equals the configured host audience, not the complete command endpoint URL.

Every command has exactly these top-level fields:

```json
{
  "version": "0.4",
  "audience": "https://example.invalid",
  "request_id": "00000000-0000-0000-0000-000000000001",
  "issued_at": "2026-09-10T12:00:00.000Z",
  "expires_at": "2026-09-10T12:02:00.000Z",
  "organization_id": null,
  "actor": {
    "kind": "person",
    "id": "00000000-0000-0000-0000-000000000002",
    "key_id": "ed25519:<base58-public-key>"
  },
  "requested_by": "00000000-0000-0000-0000-000000000002",
  "action": "person.register",
  "payload": { "keys": ["ed25519:<base58-public-key>"] },
  "signatures": [{ "key_id": "ed25519:<base58-public-key>", "signature": "ed25519:<base58-signature>" }]
}
```

This is a shape illustration, not a valid signed enrollment. IDs must be derived where specified; replace timestamps and sign actual bytes. All command/action payload objects are closed: unknown or missing fields fail validation.

Signing input is canonical UTF-8 JSON of `{ "domain": "DTP-COMMAND-0.4", "command": <command without signatures> }`. Canonicalization follows the repository's RFC-8785-compatible, **safe-integer-only JSON** profile; money/quantities needing decimal precision are strings. Reject non-finite/floating JSON numbers and invalid canonical strings. Object key order follows canonical UTF-16 ordering, not insertion order. The [fixed signing vector](signing-vector.json) is the interoperability check.

Ed25519 public keys are 32 bytes, signatures 64 bytes, encoded with the `ed25519:` prefix and the repository base58 alphabet. Every supplied signature must verify; signer keys must be distinct, and the actor's key must sign. Quorum counts distinct people with current keys, not signatures from several keys belonging to one person.

Commands live at most five minutes. `issued_at` may be at most 30 seconds ahead of host time; `expires_at` must be strictly after host time and issuance. Instants use real UTC dates with exactly millisecond precision, `YYYY-MM-DDTHH:mm:ss.sssZ`. A historical signature can remain evidence after command expiry; it does not become a newly executable command.

Exact mutation retries reuse the complete signed command and request ID. Changed content under that ID conflicts. Current credentials and operation-specific authority are checked again; retries do not restore revoked access. Read commands recompute authorized results rather than return a stored sensitive response. Record writes return a minimal `{id, seq, duplicate}` receipt; a separate authorized read obtains the record. After command expiry, use a fresh signed read to reconcile state before choosing a new action. This is not a promise of exactly-once external side effects.

Host tokens have `{body,key_id,signature}`. Signing input is canonical `{domain:"DTP-TOKEN-0.4",body}`; every token body binds `kind`, `issuer`, `issued_at`, `expires_at` and kind-specific context. A valid signature of another token kind is not interchangeable authority. Normally pins and current expiry are mandatory; migration/relocation use historical verification only for the explicitly durable proof chain described below.

## 3. People, companies and administration

`person.register`, with null organization context, requires possession proofs for every initial key. Derive the person ID from SHA-256 of canonical `{domain:"DTP-PERSON-0.4",genesis_key:key_id}`: take the first 32 hex characters and format them `8-4-4-4-12`. IDs are self-certifying protocol identities, not evidence of a verified legal person.

`person.rotate` adds possession-proven keys and retires existing keys. Retired keys remain in history and cannot be recycled into a different identity or installation. At least one current key must remain. No password reset, passkey UI, institutional identity proof or lost-all-keys recovery service is supplied here.

`organization.create` derives the company ID similarly from `{domain:"DTP-ORGANIZATION-0.4",founder_id:person_id,nonce:uuid}`. The actor is a founder/controller, all initial controllers consent, and threshold is feasible. Creation starts generation 1. `organization.policy` needs the existing controller quorum and consent from newly added controllers. Creating an organization record is not incorporation or verification of corporate control.

An accepted membership belongs to one organization; the same person can hold several separate memberships. `membership.invite` is not access until the invited person signs `membership.accept`. Invitations cannot outlive or exceed their delegated authorizer. Acceptance rechecks the inviter's current authority. Reinvitation replaces rather than unions membership permissions. Revocation disables the membership and outstanding invitations; controllers are changed through company policy, not membership revocation.

Administration permissions are exactly:

```text
members.manage
policies.create
profiles.publish
releases.publish
installations.manage
authority.manage
```

Controllers have company administration authority, **not implicit business/personnel data read authority**. Fractional roles, team labels and job titles are application templates; they do not create protocol capabilities. `organizations.list` returns only organizations available to the requesting person, including their active/migrated status.

## 4. Resource policies and personnel boundaries

Every business record is bound to one owning organization, one policy and one opaque UUID resource. Policy creation requires `policies.create` and consent from all initial stewards. Policy updates require the prior active steward quorum and consent from newly added stewards, with an exact `expected_revision`. Policy classification is `business` or `personnel` and cannot be changed by updating the policy.

A grant is exactly `{person_id, actions, resource_ids, expires_at}`. Actions are `read`, `write`, `export`; resource scope is a bounded UUID list or `"*"` **within this policy only**. A person must still be an active member/controller, and the grant must still be live when executed. A grant does not create membership, and a non-controller grant cannot outlive that person's membership. Stewardship alone does not implicitly grant ordinary record reads. `policy.get` is restricted to an active steward.

For an installation, authorized data access is the intersection of its declared release profiles, permitted policy IDs/actions, live installation/assessment, and the requesting human's current resource grant. Interactive calls require both installation and human signatures. Autonomous calls require an explicitly installed automation mode and a sponsoring person's live membership/resource grant; removing that authority stops future automation. Module keys cannot administer company authority or create their own policies.

`record.get`, list/workspace views, derived inventory and export enforce these boundaries before returning the complete record, including its original signed payload. `records.export` additionally requires export permission; read permission alone does not authorize that route. An installation declaring one profile does not gain all other records in the same resource policy. Empty data queries do not grant outsiders company metadata access.

The candidate can represent tightly scoped employee-level synthetic records using organization-local resource IDs and private publisher profiles. It does **not** define a native employee registry, automatic employee-self entitlement, team inheritance, payroll computation, medical classifications or anonymous aggregate protection. A builder must explicitly bind an employee/engagement to the appropriate person and grants. Use separate policies/records for compensation, time, medical data and company summaries rather than placing everything in one readable blob. A summary is not automatically anonymous.

Payloads, commands and authorized exports are plaintext within trusted-host custody. There is no field encryption, selective-disclosure cryptography, key-destruction proof, retention/deletion workflow or protection from a database administrator in this candidate. Revocation stops future authorized execution; it cannot recall downloaded evidence. Do not place real personnel/bank/medical data in this preview or call it a compliant HR system.

## 5. Profiles, schemas and module releases

A company publishes a profile without editing the central type registry. Identity is `<publisher_company_id>/<name>@<version>`. Names match `[a-z][a-z0-9._-]{0,79}`; version has three numeric components. The digest is SHA-256 of the canonical exact object `{publisher_id,name,version,schema,semantics,dependencies}`. Publication visibility/readers are separately bound by the signed publishing command. Neither profile version nor its publication metadata is mutable in place.

Dependencies are exact previously admitted profile digests. The publisher must be allowed to read them. Consumers explicitly select accepted digests for record operations; a semantic-version label alone does not imply compatibility. No automatic migration, lossy mapping, standard-field override, network schema lookup or unknown-required-semantics fallback is performed. Retaining a structural custom record is not a claim to understand its business algorithm.

The `dtp.schema/1` bounded dialect supports only:

| Type | Required schema members in addition to `type` |
|---|---|
| object | `properties`, `required`, `additionalProperties:false` |
| array | `items`, `maxItems` |
| string | `maxLength`; optional finite string `enum` |
| integer | `minimum`, `maximum`, both safe integers |
| boolean, null | None |

Unsupported keywords, `$ref`, supplied code, regex validation, arbitrary remote dependencies and open-ended object fields are rejected. Object property names are bounded and dangerous prototype-style names are disallowed. Limits are specified below. Profile semantics are exactly `structural`, `inventory-v1`, `invoice-v1`. Inventory/invoice semantics additionally run the built-in deterministic rules; selecting their label does not allow a publisher to redefine those rules.

Profiles are readable to their publisher, `readers` company IDs or, for `community`, other authorized callers. Community profile visibility is not public company-data access. There is no anonymous catalog/listing endpoint. A private release is available for installation only to its publisher; a community release is available to other companies, subject to all other admission/permission checks.

`release.publish` binds module UUID, publisher, immutable version, exact artifact digest, declared profile digests/data actions, visibility and optional assessment. Its digest covers `{publisher_id,...release.publish payload}`. The module UUID cannot be taken over by another publisher. A release may be registered with `assessment:null`, but cannot be installed until a usable assessed release is published. Since releases are immutable, a changed artifact, assessment or permission contract requires a new version.

An assessment is a signed token of kind `module-assessment`, naming the exact `artifact_digest`, `outcome:"approved"`, issuer and live issuance/expiry. The issuer/key must be in **assessment pins**, and the token digest must not be in the configured revocation list. The check occurs at publication when an assessment is supplied, at installation, and again for every installation command. Expired or revoked approval stops module access; it does not delete business records.

This is an interoperable assessment/admission boundary, **not a scanner, code host or security guarantee**. The protocol never downloads or executes the artifact. Scanning quality, reviewer scope, build provenance, sandboxing, network egress, secrets, runtime isolation, private/community listing UX and moderation remain host products. A signed approval only means the configured assessor made that assertion. Installation separately requires company consent, a fresh installation key possession proof, narrowed policies/actions and an expiry.

## 6. Records, inventory and invoices

`record.append` carries exactly `{id,root_id,supersedes,organization_id,policy_id,resource_id,profile_digest,counterparty_ids,body}`. The command's organization must equal record ownership. The owning company is not its own counterparty. Other parties must have active local authority or a fresh pinned remote authority proof. Listing a counterparty does not itself disclose records to it or authorize it to write for the owner.

For genesis, `id == root_id` and `supersedes == null`. Supersession requires a readable current predecessor and preserves root, owner, policy, resource, exact profile and counterparties. Competing successors are rejected atomically; one record cannot silently rewrite another's compartment or schema. Historical records remain available to authorized history readers. Host sequence/acceptance time is not physical event time or a global cross-host cursor.

The host appends signed attribution and derived metadata: `command`, `seq`, `is_head`, `accepted_at`, `validation`. That metadata is not part of the caller's signed record payload. A structural report explicitly has `business_verified:false`. A signature proves attribution of bytes, not shipment, title, customer approval or payment.

`records.list`, `records.export` and `workspace.view` accept `{after,limit,profile_digests}`. Authorization and accepted profiles filter before pagination. `next_cursor` is the last returned sequence only when another matching page exists; `null` means no next page at that observation. Preserve the greatest processed sequence when polling later; do not reset to zero because the final cursor is null. A replayed read uses current authorization. These are data APIs, not a dashboard, notification system or subscription delivery service.

An unknown or unavailable requested profile is an explicit `unsupported_profile` error, not a successful empty company. An installed module's derived inventory read must declare every exact profile contributing events to that pool; sharing the `inventory-v1` semantic family alone does not authorize other profiles' observations or aggregates.

### Inventory/packaging profile

Create an authorized pool with `inventory.create {policy_id,pool_id,product_id,base_unit}`. Its signed creation travels with migration. An `inventory-v1` record names that pool as `resource_id` and must use the pool's policy. Events use company/source/observation identity, exact expected revision and physical `occurred_at`. Supported operations are packaging revision, receipt, explicit adjustment, reservation, release and fulfillment; [the frozen flow and schema](fixtures/README.md) define the fixture.

The store atomically enforces company-wide `(source_id,observation_id)` deduplication, event-byte meaning, pool revision CAS and resulting stock state. A fresh request ID does not make a duplicate physical observation new stock. Conflicting observation reuse fails. Reordered physical timestamps do not rewind already accepted reservation authority. Inventory corrections are new events, not record supersession.

Packaging pins bind packaging ID, immutable version and digest to a product/base-unit conversion. Conversion cannot retroactively change an earlier event. Pack conversion exceeding three decimal places in the resulting base quantity is rejected instead of rounded. Two reservations cannot exceed declared available stock; fulfillment reduces the named reservation and on-hand balance together. A correction cannot consume stock already reserved. The pool invariant does not verify physical goods, title or exclusive reservations in a different unconnected system.

### Invoice arithmetic/evidence profile

`invoice-v1` checks quantity times price, line subtotal, deductions, total, supported currency/units, dates and declared payment-state consistency using bounded exact decimal arithmetic. Money has at most six decimal places, quantity three, with at most eighteen integer digits. Each nonnegative invoice line rounds half-up to money precision before summing. Supported monetary labels are `USD`, `USDC`; no exchange conversion is implied. This is not a universal tax, credit-note or settlement-allocation engine.

The seller must equal the record owner and the buyer must be a declared counterparty. `validation.valid` means no detected deterministic error; `complete` additionally requires resolved reference observations. Admission intentionally marks references unknown rather than claiming an absent/inaccessible external contract is verified.

Authorized reads may add **`live_validation`**, recomputed from references the current caller can read. The host returns unknown for unavailable or unauthorized references, without revealing which case applies. It also requires explicit operator `referenceProfiles` pins mapping the expected business-reference type to exact accepted profile digests, plus explicit seller/buyer identifiers. A publisher calling a schema `trade.contract` does not make it a recognized contract. With these pins and authority the host can detect local reference-party mismatches. With no pins, references stay unknown. Live validation is not stored/signed record content and can change when authorization or available evidence changes. Remove neither unresolved issues nor original signatures to make a record look approved. No financial commitment or money movement endpoint is supplied by this candidate.

## 7. Remote authority and deliberate evidence exchange

`authority.export` requires `authority.manage` and signs a local active organization's identity, generation, serving audience/key and a 60-second expiry. `authority.import` checks explicit host pins, exact bindings, current expiry and monotonic cached authority; it never constructs a local organization or imports another company's membership directory. An authority proof is a trusted host's assertion, not legal registration or permission to read that company.

After A migrates to B, a third host uses `authority.relocate {token,commit}`: its cached A authority must match the durable source handoff; the embedded B readiness must match company, migration, generation, hash, source and destination; commit must occur within readiness lifetime; the fresh B token must be exactly the next generation. Both source and destination pins/signatures are required. Apply one verified hop at a time. Historical cached authority and handoff may be expired evidence; the destination authority must still be live. Exact successful-token retries do not invent a second relocation.

`evidence.issue` is a separate, intentional disclosure. A person with current read **and export** authority selects 1–20 exact owned record versions, a purpose, and a different organization's pinned remote audience plus destination `policy_id`/`resource_id`. The host signs a maximum-60-second `business-evidence` token containing those records and their complete transitive profile closure, bounded to 32 profiles. Unauthorized redistribution of another publisher's private profile or dependency is denied. Unsupported or oversized dependencies fail rather than trigger remote fetching.

`evidence.inspect` requires the exact recipient company/audience, recipient-compartment read permission, an accepted exact profile set and, for installations, the installed profile intersection. It verifies pinned source issuance, expiry, profile publishing signatures/contracts and original record signatures/content. Recipient validation checks schema and, for invoices, arithmetic with references unknown. An inventory selection is explicitly **not replayed as a complete stock history**. The original host's `seq`, `is_head`, `accepted_at` and validation claims are separated under `issuer_projection`, not relabeled as recipient verification. Inspection does not insert records as locally owned, renew their authority or claim they are the source's current heads. The result explicitly describes exact historical versions and warns that previously disclosed copies cannot be recalled.

Evidence tokens contain **plaintext**. Recipient checks at the inspection API are not encryption and cannot hide a token's body from someone already holding its bytes. Send them only over authorized transport to intended recipients, do not log them or paste them into unrestricted tools, and do not treat expiry as deletion of recipients' copies. Source revocation cannot recall an already issued token; its short inspection lifetime is a bound, not a global revocation protocol. No automatic continuous replication or universal discovery exists here.

## 8. Cooperative migration and recovery

The initiating controller needs current company quorum and, separately, current quorum for **every** owned policy. Full company portability is not a controller shortcut around personnel stewardship. Source chunk reads and commit recheck those approvals. Destination staging commands are bound to the initiating registered person; readiness also checks their exported current controller key. The destination must have explicit source pins; the source must have explicit destination pins.

```text
Source active -> prepare exact manifest -> destination stage/upload/validate
                                                  -> signed ready + reservations
Source current snapshot + approvals + ready -> commit/freeze
                                                  -> destination finalize/activate
Before commit: source cancel -> destination abort/release reservations
After commit: durable receipt + finalize retry; never source rollback
```

1. `migration.prepare {destination:{audience,key_id}}` stores the authorized exact snapshot, manifest and bounded base64 chunks. Migration ID is the prepare command's request ID. The source remains writable; intervening changes make this snapshot stale.
2. The manifest binds source/destination audiences and keys, organization, generation, canonical snapshot hash/byte count, ordered raw-byte chunk hashes and a one-hour expiry. The source-signed manifest token also binds the initiating person.
3. At the destination, `migration.stage {manifest}` verifies the token and reserves the absent company ID. `migration.upload {migration_id,index,data}` accepts only matching, canonical base64, size-bounded chunks. Identical uploads are idempotent; conflicting chunks cannot replace bytes. `migration.status` reports uploaded indices and ready/activated/aborted flags without exporting the payload.
4. `migration.ready` requires every chunk, exact full hash/size, valid snapshot signatures/projections and no conflicting destination or other-ready-stage identities. It reserves imported identities, keys, profile/version/module/installation aliases and record/policy IDs. Sequence capacity must fit all reserved imports and the next authority generation must remain a safe integer. The router additionally reserves 64 KiB of completion headroom per ready, unactivated stage and preserves it across intervening writes. Readiness is returned only after that transaction passes capacity checks. Incomplete, incompatible, corrupt or oversized preparation cannot freeze the source.
5. `migration.commit {migration_id,ready}` verifies current source snapshot, generation, current controller/steward approvals, destination pins/readiness and expiry. Source time must have reached readiness issuance. Only then is a durable source commit saved and ordinary source writes frozen. No unconditional reactivation path exists.
6. `migration.finalize {migration_id,commit}` verifies the exact embedded readiness and source commit chain, revalidates reserved state and atomically installs the company at generation +1. IDs, signed records, published private IP, policies, memberships and inventory survive. Sequences become destination-local. The same transaction removes staged payload/chunks, replacing them with active state rather than retaining a second company copy; manifest/readiness/activation receipts remain for verified retries. All imported installations are disabled; use fresh credentials and explicit authorization. Remote tokens are not silently renewed into live rights.
7. If a response is lost, query destination status, retrieve the durable source `migration.receipt`, and retry finalization with a fresh command. Commit/finalize receipts remain verifiable after their original operational expiry if the source committed within the exact ready window. This is recovery of a completed authorization, not renewed permission to commit late.

Before a particular migration is committed, `migration.cancel` returns a durable source-signed cancellation. `migration.abort {migration_id,cancel}` at the destination verifies it, retains a tombstone, clears staged payload and releases reservations. Ready stages are not automatically abandoned on wall-clock expiry: a valid committed handoff may still arrive later. A losing uncommitted preparation may be cancelled even after the company committed a different preparation. A committed preparation cannot be cancelled or used to roll back the source.

The snapshot includes owned records/history, required personal key histories, policies, inventory creation/events/state, installed releases, all owned published profiles/releases and transitive required definitions. It does not copy foreign-owned records as local ownership or export private installation keys. Snapshot validation preserves signed publication bindings, current heads, authority projections and deterministic profile results; it is not an independent proof of every historical execution-time grant or the source's completeness. Expired memberships/grants remain expired, not refreshed.

If a source/destination loses its durable database, refuses cooperation, loses authorized keys or becomes malicious, stop and use an explicitly reviewed backup/authority recovery procedure. This candidate does not implement disaster recovery, restoration over an existing same-ID organization, automatic host-key replacement, partition consensus or universal in-flight external-job transfer. Never tell an operator to reactivate both stores or delete a committed stage to clear a stuck migration.

## 9. Mandatory candidate bounds and errors

| Surface | Candidate bound |
|---|---|
| Command transport | 1 MiB UTF-8 JSON; nesting ≤48; ≤100,000 traversed JSON nodes |
| Command lifetime / proofs | ≤300 seconds; ≤30 seconds future clock skew; 1–16 distinct signer keys |
| Person/controller/steward keys or IDs | 1–8 as applicable; person retains at least one current key |
| Membership/grant/installation expiry | Future and within 366 days when created; delegated lifetimes additionally bounded |
| Policy grants/resources | ≤256 grants; each exact resource list 1–128 or policy-local `*` |
| Bounded schema | ≤256 schema nodes, depth ≤8, object ≤64 fields, array `maxItems` ≤256, string `maxLength` ≤65,536, enum ≤64 |
| Profiles/releases | Profile ≤8 dependencies, ≤64 reader companies; release 1–16 profiles; installation 1–32 policies |
| Records/pages | ≤16 counterparties; page 1–100 rows, ≤32 accepted profiles |
| Migration | ≤32 MiB canonical snapshot; raw chunk ≤65,536 bytes; ≤512 chunks; manifest/ready lifetime ≤1 hour |
| Authority/evidence | Authority ≤60 seconds; evidence ≤60 seconds, 1–20 records, ≤32 profiles including dependencies, body ≤512 KiB |
| Reference storage | Default serialized state ceiling 128 MiB; configurable `maxStateBytes`; 64 KiB reserved per ready unactivated migration |
| Sequence/generation | Positive safe integers; next sequence plus reserved imported rows ≤`Number.MAX_SAFE_INTEGER`; migration must be able to increment generation safely |

The bounded schema's array limit can be stricter than an underlying helper's standalone numerical limit. A helper accepting 1,000 invoice lines does not override the admitted schema's maximum of 256 array items. Migration size does not guarantee a destination's available capacity; insufficient readiness capacity must reject before the source commits. Operators must not lower configured capacity, discard reservations or consume reserved storage outside the router during cutover.

Capacity reasoning for this implementation: activation replaces the staged snapshot with the same owned entities and removes their base64 chunks (roughly four-thirds of snapshot byte size). Converting entity arrays to keyed tables adds bounded UUID/digest keys; changing a safe-integer sequence adds at most 15 decimal characters per imported row. These overheads are smaller than the removed encoded copy of the fully signed entries. The separate 64 KiB margin covers bounded commit/control/receipt metadata, including exact signed token fields; finalization never caches another full snapshot result. The HTTP capacity fixture tests rejected readiness, intervening pressure to the limit, successful finalization/compaction and retried finalization. This is a serialized reference-store guarantee, not a measurement of process heap, database WAL, disk quota or backup capacity.

Stable machine-readable codes distinguish invalid input/profile, signature/expiry, missing authority, unavailable record, conflict/CAS, staging/relocation, and capacity. Representative HTTP classes: 400 shape/unsupported command, 401 signature or expiry, 403 forbidden/untrusted approval, 404 scoped unavailable, 409 conflict/migrated/reserved, 413 transport/evidence size, 422 profile/body semantics, 507 capacity. Do not infer that every 404/unknown reference means the object does not exist globally. On a transport error, reconcile with the same immutable operation identity or a scoped read rather than minting an unrelated duplicate business event.

## 10. Domain wireframe and release qualification

Implemented grammar: identities, membership, resource authority, immutable declarative profiles, signed records, profile-aware reads/exports, assessed module descriptors, explicit evidence, stock/reservation/packaging semantics, invoice arithmetic and bounded cooperative migration/relocation.

Future optional profiles can describe packaging/material masters, manufacturing genealogy, procurement, freight, retail/B2B orders, accounting, personnel/time/payroll results, facilities, services, disputes and compliance evidence. See the [business-domain map](../../docs/DTP_BUSINESS_DOMAIN_MAP.md). They must supply explicit semantics, scopes, units/time, invariants, fixtures and compatible consumers; they are not supported merely because a JSON record can be stored.

Excluded from core implementation: workspace/Passport login UX, dashboards and notification delivery, executable hosting/scanning, marketplace ranking/billing, payroll/tax/underwriting engines, physical logistics execution, global reputation score, payment rails, lockboxes, legal conclusions, mandatory blockchain/token and automatic global identifier merging. DTP can carry an attributable result without operating the underlying business service.

Runtime/database/CI evidence belongs to the release's [exact tested tree and gate report](../../docs/release/v04-gates.json). The local PGlite server is a synthetic development host, not proof of production PostgreSQL, Deno or another host implementation. A passing test in one runtime does not certify every compatible runtime; distinct target-runtime probes in the report establish only their stated coverage. Before real deployment require independent security/privacy review, key custody/recovery, admission operations, quotas/abuse controls, capacity/load targets, persistent backup/recovery rehearsal and explicit supported-runtime evidence. This candidate does not authorize merging or deployment simply by passing its local suites.
