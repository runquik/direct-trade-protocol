# Independent PostgreSQL persistence harness review

Date: 2026-09-12. Reviewer: `capability_audit`. Harness author: `release_architect`. Store author: `profile_contracts`; later finalization delta author: `root`.

Reviewed `sdk/tests/foundation-postgres/persistence.test.ts`, `docs/foundation/persistence-postgres-harness.md`, actual store/Db calls and synthetic fixture use. No harness or production code was changed by this reviewer. The code-review skill informed failure-path, race, scope and evidence inspection.

## Disposition and observed result

**The bounded store's real-PostgreSQL harness passes independent inspection and rerun: 12 tests passed**, zero failed/cancelled/skipped/TODO. The independent run used the actual approved isolated PostgreSQL 17.11 server at `127.0.0.1:15439/dtp_foundation_tests`, after unsetting all shared database override variables. It was part of a 21-test run with separately classified finalization tests; it did not invoke a release-evidence writer. Full F9 remains unapproved.

## Why the evidence is meaningful

- Sibling grants compete for one cumulative parent budget while physical stock is sufficient. One loses specifically on budget, no failed-child usage is retained, and the remaining authorized amount reaches the exact parent limit.
- Eight identical requests yield one handler invocation, accounting invocation, budget charge and receipt/effect set. A fresh instance after subsequent resource change returns the historical receipt without new writes or reevaluation.
- Five independent fault cases execute real writes, then cause SQL division-by-zero. Full sorted rows across authority, immutable versions, current heads, business receipts, outbox and governance history remain byte/data-equivalent to before the transaction. Fresh-instance retry then succeeds once.
- A query marked with a per-suite application ID is observed in actual server lock-wait state. An unrelated organization completes while the target is still blocked, so a global mutex cannot masquerade as row isolation.
- Both revoke-before-execute and execute-before-revoke are forced through actual PostgreSQL lock waits. Revocation-first prevents effects; execution-first preserves the previously accepted operation but blocks subsequent receipt disclosure under revoked authority.
- Foreign inputs are checked before handler evaluation. Wrong digest and recipient-rehomed reference fail, while an authorized source reference retains its original identity. The source organization's entire row set remains unchanged.
- Governance outbox failure rolls back revocation/history/authority; later legitimate execution remains possible.
- Physical `jsonb_typeof` checks are nonvacuous across all declared JSON columns. They detect scalar JSON strings even when a driver adapter might deserialize them as JavaScript objects.

The barriers use actual transactions and server observations, not just arbitrary sleep or mocked successful callbacks. Fixture identities, requests and keys are synthetic and unique. No historical fixture rows are removed.

## Safety and scope

The harness rejects every destination except the exact loopback address, port and database, disallows query/fragment overrides and checks `server_version_num=170011`. There is no skip or PGlite fallback if infrastructure is unavailable. Schema setup is additive; tests never drop or truncate tables. Statement, connection and test deadlines are explicit. Held transactions release barriers in `finally`, settle promises and close the connection pool.

Authorization/accounting hooks are deliberately synthetic. The current fixture's explicit `beforeCommit` callback is also a no-op, not a database-backed credential deadline. Therefore these real-server results prove the exercised transaction, idempotency and represented-organization revocation behavior, **not** authentic user signature/lease validation, final credential expiry at COMMIT, origin-policy revocation serialization or production authorization.

There is no actual process kill, backup restoration, disk failure, independent network partition, benchmark/load envelope, full-history migration or external-builder exercise here. Fresh instance construction tests durable reads but is not a machine crash. Same-organization serialization and bounded authority JSON remain explicit pilot limits. Actual authenticated adapters, stronger recovery/measurement evidence and frozen-source CI qualification are still mandatory.

No new harness defect was reproduced. No merge, deployment, package installation, public upload, source-bound gate approval or alteration of old release evidence occurred during this review.
