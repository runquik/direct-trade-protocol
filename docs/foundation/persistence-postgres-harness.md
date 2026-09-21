# Real PostgreSQL persistence qualification harness

September 12, 2026. Author: `release_architect`, using `profile_contracts`' actual
`createFoundationStore` and explicitly synthetic `persistenceFixture(Db)`. Another
agent must review this test implementation before accepting its evidence. This
document is not self-approval of the harness or full F9.

`sdk/tests/foundation-postgres/persistence.test.ts` uses the real `postgres` driver
and `postgresJsDb`. It only accepts `127.0.0.1:15439/dtp_foundation_tests`, forbids
connection query overrides, verifies `server_version_num = 170011`, and uses the
coordinator's isolated pinned PostgreSQL 17.11 container. No PGlite fallback or
missing-infrastructure skip exists. An unavailable or different server fails.

The default credential is the documented synthetic local test account, not a live
secret. `DTP_FOUNDATION_TEST_DATABASE_URL` can supply credentials only within that
exact destination restriction. The schema setup is additive. Each fixture creates
new random organization/resource/operation identities; no schema is dropped, no
table truncated and no existing row removed. Fixtures remain for inspection in
the disposable database. Existing Supabase databases and older release evidence
are not touched.

## Twelve implemented checks

1. Two sibling grants concurrently attempt to spend three units each against a
   five-unit parent budget with ample physical stock. Exactly one succeeds, the
   loser specifically reports cumulative-budget refusal, and an authorized final
   two units bring the parent to five without charging the failed child.
2. Eight concurrent identical operation requests yield one receipt, one handler
   and accounting invocation, and one charge/effect/outbox set. After another
   operation changes the resource, a fresh store instance returns the old exact
   receipt without reevaluation or additional database mutation.
3. Five separate cases inject PostgreSQL division-by-zero **after** authority,
   revision, resource-head, outbox or receipt SQL has executed. Every full sorted
   row across all six store tables must match the exact pre-transaction state.
   A fresh store then executes the same request once successfully.
4. A manually held organization authority row genuinely blocks one operation,
   verified through server `pg_stat_activity` lock-wait state. A second organization
   completes before that lock is released, while the first organization's rows
   remain unchanged. A timer alone is not used as proof of lock contention.
5. Foreign input denial prevents handler evaluation; wrong digest and attempted
   recipient rehoming fail exact-reference lookup. Authorized input retains its
   original company/entity/revision/digest in the receipt and original request,
   and the entire source organization's rows remain unchanged.
6. A real SQL failure after governance outbox insertion rolls back revocation,
   history, sequence and authority; a fresh store can still execute legitimately.
7. Both revoke-before-execute and execute-before-revoke are forced through actual
   server lock waits. Revocation-first blocks new effects. Execution-first preserves
   its accepted receipt/obligation but subsequent revoked receipt disclosure fails.

Physical `jsonb_typeof` assertions ensure bodies, references, attribution and
receipts are stored as PostgreSQL JSON objects, not scalar strings hidden by a
driver decoder. Host-generated revision digests are recomputed from their scoped
preimages; imported-original and host-effect attribution remain explicitly separate.

The first author-run result was **12 passed, zero failed/skipped**, followed by
successful whole-SDK TypeScript checking. Run again after any store, authority,
semantic handler, fixture or database-adapter change:

```text
node --test tests/foundation-postgres/persistence.test.ts
```

## Explicit limits

These tests use marker-based synthetic trusted authentication/accounting hooks,
not verified user signatures, current resolver leases, actual module permissions,
cross-company live mandates or production approval evidence. They establish the
bounded store's transaction behavior with that fixture, not the correctness of
future concrete hooks. In particular, represented-company row locking does not
serialize foreign policies, a person's resolver or external authorities by itself.

Fresh-object reconstruction is not a process kill, backup restore or disk crash.
There is no benchmark/load envelope, general resource-level concurrency guarantee,
malicious-database protection, full-history migration, webhook qualification,
HTTP deployment or independent external-builder result here. Same-organization
serialization and bounded authority JSON remain documented implementation limits.
The new source must be independently reviewed and wired into mandatory CI/release
evidence before the coordinator closes even this scoped PostgreSQL subgate.
