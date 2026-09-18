# Indexed atomic semantic persistence

This host-library adapter connects the foundation's admitted semantic planner to its operation-authority evaluator and the existing `Db` transaction interface. It has no HTTP route, authentication default, code downloader or payment integration. It does not make the experimental v0.4 routes operate on these tables. There is deliberately no generic record-write method that can bypass semantic execution.

## Interface and scope

`createFoundationStore(db, { semantics, now, hooks })` provides:

- `bootstrap(organizationId, governance, originalSignedRequest)`: authenticated controller enrollment, create-only.
- `govern(organizationId, grantOrRevocation, originalSignedRequest)`: verified controller/delegator action, current governance and atomic history/outbox.
- `importRevision(organizationId, originalRevision, originalSignedRequest)`: privileged verified create-only admission. It preserves the exact original entity scope, revision, digest, body, profile and original signed record. It cannot append to or overwrite an existing entity. This is not a history migration implementation.
- `execute(organizationId, originalSignedRequest)`: verified business intent, exact indexed inputs/current snapshots, admitted evaluation, verified approvals/accounting and one atomic commit.

`FOUNDATION_STORE_SCHEMA` declares organization authority rows, immutable-by-library entity revisions, indexed resource heads, organization-scoped operation receipts, transactional outbox and governance history. The application database role remains trusted; direct SQL can defeat library invariants. Deployment privileges, schema migration, backup/restore and tamper evidence need their own controls.

The current execution path requires resources to have been admitted already. A new resource/profile needs the explicit verified import/admission contract; clients cannot supply a fake `null` snapshot to create a resource. Record append creates a new record entity. Its planned `record_id` is both its initial entity ID and initial revision ID, with distinct typed roles. Subsequent record lifecycle operations require a future explicit semantic contract; append cannot reuse an existing record entity under another revision.

Exact source references remain source-scoped. An authorized foreign-company input in the same database is read by its original organization/entity/revision/digest, without copying or rehoming the record. Mutable resource scope and all effect writes remain inside the represented organization. Missing external-host inputs fail unavailable; this library has no external resolver or network fallback. A recipient-owned evidence wrapper may supplement, but never replace, the source reference.

## Required trusted hooks

Every hook is mandatory and receives detached frozen bounded data. Functions execute locally with host privileges; freezing is not a JavaScript or database sandbox.

| Hook | Required host responsibility |
|---|---|
| `authenticateOperation` | Verify original request signatures, exact intent binding, represented organization, current identity keys, audience, expiry and signer/controller authority. Return a verified person/service and grant ID, not client booleans. |
| `authorizeLive` | Recheck current actor, service sponsor, agency/employment mandate and module-installation liveness inside the transaction, including retries. |
| `authorizeRead` | Current policy and module intersection for every exact input, every current resource snapshot and any old receipt/output references. Foreign sources require their own origin authorization. |
| `authorizeProfiles` | Current publication/dependency visibility and module use of exact input/output profiles and operation descriptor. |
| `approveUsage` | Derive bounded metrics from the actual evaluated plan and verify approval signatures binding exact intent AND exact plan digest. A caller's declared amount or approval object is not sufficient. |
| `authenticateGovernance` | Verify action/proposal-bound consents and resolve current organization/agency controller governance. No stale copied agency membership. |
| `beforeCommit` | Final request-bound credential check at a fresh host time. Enforce the earlier of credential and supplied authority deadlines at SQL commit, and keep all relevant authorization reads serialized through commit. No default implementation. |
| `verifyImport` | Verify the original signed record's exact reference/body/profile binding, accepted provenance, origin authority, import permission and admitted profile schema. A controller's permission to import does not prove the imported data. |

The library rechecks the finite capability chain, operation/profile/resource scope, expiry, revocation, cumulative budgets, approval thresholds and separation of duties through `authorizeAndCharge`. Descriptor prerequisites with names other than the operation itself currently fail unsupported. They are never silently treated as granted. A future prerequisite integration must not charge the same usage multiple times.

Current governance returned by the trusted governance resolver may include agency organizations for a delegation decision. Only the represented organization's own governance, grants and receipts are persisted in its authority row. Every grant/receipt must stay organization-scoped. Governance liveness for an agency executing later remains a required live hook, not a historical grant-copy assumption.

## Transaction and concurrency boundary

The adapter locks the represented organization's authority row with `FOR UPDATE`. It then authenticates, checks live/read/profile authority, loads exact input versions and indexed resource heads, evaluates the admitted handler, and verifies measured usage and exact-plan approvals. All declared resource expectations are compared again, including read dependencies not written by a plan. Each resource update also uses SQL compare-and-set on its exact prior revision ID and digest.

Authority counters, effect versions, resource heads, the immutable business receipt and effect outbox rows commit or roll back together. A write-stage exception returns no success receipt. No separate global singleton/advisory lock is taken; different organizations use different authority rows. Same-organization serialization and bounded authority JSON (4096 grants/receipts) are explicit pilot limits, not a network-scale storage claim. The indexed record and resource tables remove business data from that authority snapshot, but authority counters are not yet individually normalized.

Hooks must serialize their current authorization reads with corresponding revocation/control updates. The represented organization's lock does not automatically protect a foreign organization's policies or a global identity registry. Foreign-origin authorization may require additional locks; integrations must handle database deadlock/serialization errors by retrying the same logical operation, never treating a transport error as business refusal. Local trusted hooks must not perform irreversible external effects inside this transaction.

Exact retries authenticate again and require current live/read/profile permission plus the same original grant with an active capability chain covering the original execution scope. They return the original receipt and do not re-evaluate the handler, reuse fresh mutable snapshots, request new accounting, or charge a second time. A changed intent, actor or grant under the same organization/business-operation ID conflicts. IDs are scoped by organization. A receipt without its matching authority receipt, or the converse, fails as an invariant violation.

Immediately before the transaction callback returns, the library checks a fresh non-regressing host time and re-evaluates authority against the original locked row. For a new operation this rechecks approval expiry without persisting another charge; historical retries do not reuse expired approvals to create any new effect. The last trusted callback receives the original request and a deadline bounded by every ancestor grant and, for new operations, every supplied approval. A plain JavaScript time check cannot protect a process paused before SQL COMMIT: the concrete host adapter must enforce the credential/authority deadline in the database as well. The synthetic persistence fixture deliberately has a no-op final callback and does not qualify that authentication boundary.

The original request is copied before the first await. Hook arguments are detached/frozen, and hook results are copied before subsequent awaits. Returned receipts are detached minimal attribution/reference summaries, not original record bodies. Outbox sequences are per organization and contain exact references and profile pins, not private business bodies. Raw outbox sequence exposure is not a privacy-safe filtered feed; F5 must supply authorized checkpoints, invalidation and catch-up semantics.

## Host-generated revisions and original provenance

New semantic effects use SHA-256 over the canonical JSON preimage:

```json
{"domain":"DTP-ENTITY-REVISION-1","entity":{"kind":"resource","id":"11111111-1111-1111-1111-111111111111","organization_id":"22222222-2222-2222-2222-222222222222"},"revision_id":"33333333-3333-3333-3333-333333333333","profile_digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","body":{"quantity":10}}
```

Canonical key ordering yields digest `e5fa7cf9eaac9cdf96fbf4a1172f7a975a524fca326ac8af51807ea5f39aca59`. The test pins the exact canonical string and digest. Both resource and record effects use this domain. Entity scope, revision ID, profile and body are all included. This is not a replacement signing format for historical records.

Attribution separately stores `kind: host_effect`, the original signed request unchanged, the authenticated actor, intent digest and evaluated-plan digest. It does **not** claim the user signed each generated body. Imported originals retain their original digest/signing format and `kind: imported_original`; the import verifier must use the appropriate original verifier, not rehash an old format into this new domain.

## Evidence and exclusions

`sdk/tests/foundation/persistence.test.ts` covers atomic success, original attribution, restart/retry, permission revocation, faults at each write stage, concurrent allocation/retries, foreign-input authorization and source identity, organization separation, unsupported prerequisites, import/append bypass attempts, bounded malformed data and callback/caller mutation. The reusable `persistenceFixture(Db)` supplies explicitly synthetic trusted hooks for PGlite or PostgreSQL tests, not a production authentication implementation.

PGlite tests exercise SQL transactions but do not prove PostgreSQL process concurrency, lock isolation between organizations, crash recovery or production performance. Independent review, actual PostgreSQL gates, the authenticated host adapter, authorized synchronization, full-history migration and deployment readiness remain separate requirements. No self-approval or whole-F9 completion is claimed by these tests.
