# Portable Business Protocol 0.3 — identity and authority reference preview

Status: **implemented experimental profile, pending independent review**. September 7, 2026.

This is a separate protocol surface from [the frozen v0.2 company-record specification](../../SPEC.md). It implements portable personal/company identity, memberships, explicit capabilities, installation-scoped module authority, signed attribution, controller quorum, retained-key recovery and bounded trusted-store migration. It is not a production certification, a completed workspace UI, or a replacement for all business evidence verification.

## 1. Artifacts and compatibility

- Wire shape: [command.schema.json](command.schema.json), generated from `sdk/src/v03/schema.ts` with `npm run build:pbp`.
- Signing fixture: [signing-vector.json](signing-vector.json), using a deliberately public test key from `../vectors/keys.json`. `npm run build:pbp-vectors` reproduces it without changing v0.2 vectors.
- Implementation: `sdk/src/v03/{wire,permissions,engine,client}.ts` and `supabase/functions/pbp-store/router.ts`.
- Local persistence: [store.sql](store.sql), isolated `pbp_v03` schema, never applied by the v0.2 service. No existing data is deleted or upgraded in place.
- Business bodies: registered non-core v0.2 types retain their body schemas, subject/role binding, state transitions and integrity guards. A 0.3 signed command, not a v0.2 envelope, authenticates their submission. Do not advertise a 0.3 record as a v0.2 signing vector.

Schemas define message shape; this document defines contextual authorization and state rules. A discrepancy is a conformance defect. Historical DTP package names, schema IDs, environment variables and endpoints remain unchanged on the v0.2 path.

## 2. Identities and trust

**Person:** self-certifying identifier plus active and retired public keys and signed key history. No global public name/email directory. Possession proves control of credentials, not human identity, employment or real-world company ownership.

Person ID is the first 32 lowercase hex characters of SHA-256 of the canonical JSON object `{domain:"PBP-PERSON-0.3", genesis_key:<key ID>}`, formatted in UUID-style 8-4-4-4-12 groups. It is not a randomly generated UUID and does not change on key rotation. The published vector gives an exact example.

**Organization:** a store-independent identifier, display name, controller policy, accepted memberships and installation authority. Its ID is derived identically from `{domain:"PBP-ORGANIZATION-0.3", founder_id:<person ID>, nonce:<UUID>}`. The founder signs genesis; every initial controller consents by signing the same command. Company IDs remain compatible with the non-core v0.2 body identifier grammar; a display-name collision has no authority significance.

**Module:** a software identity with a publisher organization and immutable versioned manifests. Module IDs are UUIDs in this profile. A manifest describes a display name and maximum requested permissions, not executable code or automatic consent. Publication requires the publisher's `modules.publish` capability.

**Installation:** a unique module instance for one organization, pinned manifest version, distinct possession-proved key, explicit permissions, expiry and interactive/automation mode. One installation key cannot be reused by another person/installation, even after revocation. Publisher identity and installation execution credentials are not interchangeable.

The reference service is trusted to enforce accepted order and current state. Database administration, server signing-key custody and backups are a security boundary. Personal/company histories and record signatures are verifiable; the profile does not provide decentralized consensus, resistance to a malicious store presenting an old valid history, or automatic global identity discovery. Exported private metadata must be handled as confidential company data.

## 3. Signed command envelope

All business and authority access is through `POST /pbp-store/commands`. Only `GET /pbp-store/health` is unsigned. There is no shared root bearer token, no unsigned company-switch parameter, and no server-side API that impersonates a member by substituting a company key.

Fields are `version`, `audience`, `request_id`, `issued_at`, `expires_at`, `organization_id`, `actor`, `requested_by`, `action`, `payload`, `signatures`. Unknown fields are rejected. `actor` identifies the person or installation and its signing key. A personal request's `requested_by` equals that person; an interactive installation names its requesting person. An autonomous installation may use null.

Signing input is UTF-8 canonical JSON (the same integer-only RFC 8785 implementation as v0.2) of:

```json
{"domain":"PBP-COMMAND-0.3","command":{ "...": "all command fields except signatures" }}
```

The example above is explanatory, not a literal signable command. Use the complete fixed vector for exact bytes. Ed25519 signatures use the existing base58 encoding. Every listed signature must verify; the actor key must sign. Additional signatures are approvals of the **exact same action, inputs, organization, audience and expiry**, not reusable general permission tokens. Duplicate signature keys are rejected. Controller quorum counts distinct people, not keys.

Audience is an explicitly configured store identifier, never inferred from client Host/forwarded headers. Commands live for at most five minutes, permit at most 30 seconds future issue-clock skew, and have a fresh UUID request ID. Timestamps use UTC with milliseconds. The server evaluates authorization and expiry after acquiring its serialized transaction lock.

Exact mutation retries use the same complete signed command and return the prior result after current authorization checks. Changed content under the same request ID conflicts. Read retries recompute visibility rather than returning stale authorized data. Expired commands are rejected; a client must create/sign a fresh request. No one-time bearer secret can be lost in the first registration response. Replay entries expire with their commands; signed mutation history and migration receipts persist separately.

## 4. Authority and capabilities

Company controllers have ultimate company authority, but `organization.policy`, full-company export and migration require the current policy's controller quorum. Changing controller lists requires prior-policy quorum and signature consent from newly added controllers. Controller removal is not a membership-revocation shortcut. Existing policies retain at least one controller and a feasible threshold.

Accepted memberships contain concrete capabilities, expiry and the authorizing person. Role labels such as CFO or Production Manager are workspace templates, not protocol privileges. There is no generic member `*` grant and no broad v0.2 delegate fallback.

Supported capabilities:

| Capability | Meaning |
|---|---|
| `members.manage` | Invite/revoke non-controller members within the actor's delegable capabilities |
| `installations.manage` | Create/revoke installation authority within the actor's capabilities |
| `modules.publish` | Publish a module manifest for the selected publisher organization |
| `records.read:<type>` | Read a specific registered non-core business type subject to organization/visibility rules |
| `records.write:<type>` | Write that type subject to company-party, role, transition and integrity rules |
| `records.export` | Use the paginated scoped export surface; does not expand read visibility |
| `finance.accept_offer` | Additional permission to accept an advance offer |
| `finance.fund` | Additional permission for advance records and advance-funding events |

Read and write capabilities are separate in 0.3. Superseding a record requires access to its prior version. This differs from v0.2's write-implies-read module scope. No operation here moves actual money or approves a price/budget beyond the literal signed command; spending limits, rails, evidence verification and broader domain-action permissions need further profiles/review.

Invitation is not membership. The target must sign `membership.accept`; the invitation must remain live, unconsumed, targeted to that person, and supported by its author's current delegation rights/expiry. Only the latest invitation for that person can be accepted. Reinvitation/acceptance replaces, never unions, their permissions. Revocation invalidates pending invitations and the accepted membership. Delegates cannot grant more rights or a longer lifetime than their own. Controller policy remains separate.

Once accepted, a membership or explicitly authorized autonomous installation is company authority, not a permanent dependency on the inviter's employment. Removing the inviter does not silently remove everyone they previously onboarded. Controllers can revoke those grants explicitly. A pending invitation still requires its authorizer's authority at acceptance.

Interactive module authority is the intersection of live installation permission and the named person's live company membership/controller authority. Both must sign. Autonomous installations must be explicitly marked automation; accepting finance offers or writing funding/advance records still needs an exact human signature and that person's capabilities. Installations cannot administer people, company control, or other installations. Manifest upgrades do not change an existing installation's pinned version or access.

## 5. Actions

All successful commands return HTTP 200 with `{result: ...}`. Errors return `{error:{code,message}}` and a 4xx/5xx status. Payload schemas are in the generated artifact.

| Action | Organization context | Payload / result |
|---|---|---|
| `person.register` | null | `keys`; all initial keys prove possession; returns person ID |
| `person.rotate` | null | `add`, `revoke`; current key plus added-key proofs, retain 1–8 active keys |
| `organization.create` | derived new ID | `name`, `nonce`, `controllers`, `threshold`; returns company ID |
| `organization.policy` | existing ID | new `controllers`, `threshold`; current quorum and new-controller consent |
| `organizations.list` | null | empty; only caller's active memberships/controllers, with company name/status |
| `membership.invite` | existing ID | `invitation_id`, `person_id`, `permissions`, `expires_at` |
| `membership.accept` | invited ID | `invitation_id`; only target person |
| `membership.revoke` | existing ID | `person_id`; no controller shortcut |
| `module.publish` | publisher ID | `module_id`, `manifest:{version,name,permissions}`; immutable version |
| `installation.create` | installing ID | `installation_id`, `module_id`, `manifest_version`, `key_id`, `permissions`, `mode`, `expires_at` |
| `installation.revoke` | installing ID | `installation_id`; future execution/reads denied |
| `workspace.view` | selected ID | empty; scoped records, company metadata, permissions, connected modules; no member directory |
| `record.append` | acting company ID | typed record fields; signed command is durable actor/approval attribution |
| `records.list`, `records.export` | selected ID | `after`, `limit` (1–100); visible records/history and last-processed next cursor |
| `organization.export`, `migration.preview` | controlled ID | empty; company snapshot and its hash, controller quorum required |
| `migration.commit` | controlled ID | `destination:{audience,key_id}`, `snapshot_hash`; quorum-approved handoff freezes source |
| `migration.receipt` | migrated source ID | empty; retrieve durable handoff after lost response without reminting credentials |
| `migration.import` | null | `transfer`; importer is an exported controller with matching locally registered person keys |

Membership and installation expiries must be in the next year in this preview. Removing every personal key is forbidden; revoked keys cannot reactivate. Retained/backup-key proof restores access in a fresh client. If every personal key is lost, there is no provider override; another authorized controller can change company control under quorum, but cannot impersonate the lost person. Consumer custody/backup UX is not implemented by the signing library.

## 6. Business records and isolation

A business record carries `record_id`, `root_id`, `supersedes`, `type`, `subject_company_id`, `counterparty_ids`, `visibility`, `body`. Its stored view adds the signed command, acceptance time, head marker and local cursor. Type/body semantics come from the frozen non-core v0.2 profile, with the hardened immutable terms, payment-field authority, exact attestation bindings and append-only settlement rules.

The acting organization must be a party to the existing chain, not merely the new payload. All parties must currently have active authority at this store; cross-store live business writes are not implemented. Genesis root equals record ID. Supersession requires a current readable head and immutable type, subject, root, parties and visibility. Business schemas and prior-head roles control who can transition state. A permitted write is not evidence that a physical delivery or payment occurred.

Every read is company-scoped and capability-filtered before pagination. People may read their company's private records only for their permitted types. Installations cannot read private records; use granted/counterparties where needed. Counterparty access requires both a declared sharing relationship/visibility and the caller's type permission. This preview has no anonymous public-record listing or cross-company global search. Workspace and record views do not disclose another organization's membership directory.

Person, organization and module public identifiers are not secret authorization credentials. Global person IDs in shared signed records can be correlated; pairwise subject identifiers and disclosure minimization need a later privacy profile. Deleting access does not erase information a party previously received.

## 7. Migration and offline verification

1. Controller quorum requests a snapshot of the company's owned records, private authority state, relevant person key histories and installed module manifests.
2. Controllers sign a commit binding the exact snapshot hash and destination **audience and store public key**. Any intervening relevant state change invalidates the preview hash.
3. In one transaction the source marks company authority migrated and persists a signed transfer receipt. Ordinary source record access/writes stop; workspace entry returns migrated metadata without records. Authorized controllers can retrieve the prior handoff receipt after a lost response.
4. Destination import requires an explicitly trusted/pinned source public key, a valid store receipt, exact destination binding, signed person history, signed organization genesis/policy chain, record-content/signature consistency and controller quorum over the snapshot. Importer's current identity keys must agree; differing rotations are never silently overwritten.
5. Destination preserves organization/record IDs, signed commands and history, assigns destination-local cursors, increments authority generation, and disables all imported vendor installations. Install fresh keys and explicitly reauthorize modules; no vendor private key is exported.

`verifyTransfer` and `verifyPerson` run without private user-database access. They do not prove that a source omitted no record, that its accepted head is globally latest, or that business evidence/arithmetic is true. Source key trust is an explicit completeness/order assumption, not decentralized consensus. Source enrollment metadata contains no verified legal title.

Scope limits: the JSON transfer must fit the 1 MiB HTTP bound; there is no streaming large-company migration. Records owned by counterparties are not copied as if owned by this company. Other companies and live cross-store writes require their own authority/discovery/import arrangements. Personal key reconciliation across already divergent stores is explicit, not automatic federation. A migrated company cannot be re-imported over an existing organization at the destination. Further multi-hop/fork recovery and transactional external-job transfer require design/review; do not advertise zero switching cost for every live workflow.

## 8. Reference persistence, verification and deployment gates

The preview uses one JSON state row under a PostgreSQL advisory lock plus row lock, with transactional commit/rollback. Revocation and expiry are checked inside that lock. Signed authority/business history is retained in state; database RLS denies public access, but this is not an independently append-only database journal. A privileged database/service compromise is outside this reference's guarantees. Replace the whole-state projection with indexed records and an append-only journal before scale; preserve authorization/order behavior.

Local commands (qualified Node version in `.node-version`):

```sh
cd sdk
npm ci
npm run typecheck
npm run test:pbp
npm run demo:passport
npm run dev:pbp
```

Local configuration: `PBP_PORT` (default 8788), optional `PBP_DATA`, required stable `PBP_STORE_SECRET` when persistent, and comma-separated pinned source public keys in `PBP_TRUSTED_SOURCES`. The dev server binds loopback only. Secret material must not be put in chat, source control, logs or module/MCP responses. Do not use the published fixture key for real data.

CI includes the old v0.2 suite, new v0.3 integration tests, generated-artifact drift checks, Passport CLI walkthrough, auxiliary fuzz/race suite and two isolated real-PostgreSQL authority tests in addition to v0.2's two PostgreSQL tests. No tests require live credentials or company data.

Before real deployment: independent authorization review, production runtime qualification, request deadlines/rate/identity quotas, storage limits and encrypted custody/backups, identity recovery UX, privacy review, complete historical evidence verification, financial-operation policy and large/federated migration design. This cut does not implement the browser dashboard, an unrestricted AI agent, a general durable job runner, actual money movement or marketplace billing.
