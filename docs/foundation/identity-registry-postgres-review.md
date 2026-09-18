# Independent real-PostgreSQL identity harness review

Date: 2026-09-12. Reviewer: `capability_audit`. Harness author: `release_architect`. Registry/identity production implementation: coordinator, with separate reviews recorded elsewhere.

Scope: `sdk/tests/foundation-postgres/identity-registry.test.ts`, `sdk/src/foundation/identity-registry.ts`, its shared `Db` adapter boundary and foundation PostgreSQL CI wiring. This reviewer did not implement production changes or modify the harness. Two additional assertions were returned to its author rather than self-implemented and self-approved.

## Disposition

**The strengthened harness passed independent reread and real-PostgreSQL execution: 7 tests passed, zero failed/cancelled/skipped/TODO, exit 0.** Full identity and operational acceptance require the remaining foundation integration/release checks; this is not whole-F1/F9 approval.

## Scope and safety controls

The harness permits only a loopback PostgreSQL URL, exactly the `dtp_foundation_tests` database and no URL query/fragment overrides. Its default is the deliberately synthetic test account at loopback port 15439. It checks `version()` and `current_database()` before applying the additive test schema. Every fixture generates fresh synthetic identity/key material; no existing identities are reset, replaced or deleted. The test that freezes an identity targets only its own generated fixture UUID. There is no truncation, drop or live deployment action.

Connection pool, connect timeout, statement timeout and per-test timeouts are explicit. Held-transaction probes release their coordination barriers in `finally` and settle outstanding work; lock-wait polling and waits are bounded. Database connections close in the suite's teardown. A loopback address alone is not universal permission to mutate a database: this review is scoped to the separately approved disposable local container and CI service, not an arbitrary developer database with a similar name.

## Why these are meaningful database tests

- Eight enrollment calls use the actual PostgreSQL registry and verify one identity row and one history entry. Changed enrollment data conflicts rather than overwriting that row. The concurrent enrollment case does not separately prove every call was blocked at precisely the same instant.
- Operational rotation versus recovery has one accepted CAS winner; the persisted head and history identify that winner, not merely the number of returned promises.
- Both lease/transition orderings observe actual PostgreSQL `pg_stat_activity` lock waits using a per-suite application name and per-probe query marker. These are not only sleeps or in-memory queue assertions.
- Lease-first verifies the persisted drain barrier and rejects new resolution before it; after the barrier it verifies a fresh signed proof for the new sequence.
- Transition-first prevents a queued resolver from issuing another old-head lease.
- An unrelated identity resolves while another identity is demonstrably still lock-blocked. This checks row-level isolation rather than accepting global serialization as sufficient.
- A real `select 1/0` database failure is injected after the history insert, not replaced by a stubbed successful transaction. The test checks that both head and history roll back.
- Exact expired transition retry after a subsequent rotation returns the original durable receipt without mutating current head or history. Changed signature-envelope replay and frozen identity reject.

The registry uses parameterized queries, `FOR UPDATE`, revision-checked updates and explicit `::text::jsonb` bindings. Returning a signed resolution awaits the transaction promise rather than publishing it before commit. Schema migration is additive; prior rows without a historical result cannot silently manufacture a successful historical replay.

## Requested test-strengthening checks

1. Query PostgreSQL's `jsonb_typeof` for `identities.body`, `identity_history.body` and non-null `identity_history.result`, asserting `object`. Checking JavaScript objects alone is insufficient because the shared adapter can normalize a double-encoded JSON string and mask its physical database type.
2. After injected rollback, retry the same transition through a freshly constructed registry instance and assert exactly one new head sequence/history entry. This distinguishes durable recovery from dependence on an old registry object's process-local state.

These were test-strengthening requests, not newly demonstrated product defects. The harness author implemented both. Independent reread verified actual SQL `jsonb_typeof` calls, expected non-null result counts, a newly constructed registry after rollback, and exact sequence/revision/history increments. All assertions passed on the independent run.

From `sdk`, the reviewer cleared `STORE_URL`, `DTP_TEST_DATABASE_URL` and `DTP_FOUNDATION_TEST_DATABASE_URL`, then ran the pinned Node v22.23.2 executable with `--test tests/foundation-postgres/identity-registry.test.ts`. This exercised the explicitly guarded synthetic loopback default on port 15439. The run created only fresh synthetic fixture rows and applied the additive idempotent schema; it did not remove existing test fixtures or touch a shared backend. No old release evidence runner was invoked, and no foundation acceptance observation was recorded by this review.

## Limits

This is local PostgreSQL transaction and identity-registry evidence. It does not establish TLS/network access control, resolver public endpoint authentication, custody/key recovery operation, a deployed permission boundary, backup restoration, disaster recovery, or all foundation profiles. The race clock is a controlled synthetic host clock. An in-process recreated registry is not an actual machine crash, even though the tested authoritative data is persisted in real PostgreSQL. Read-only inspection separately verified the CI image digest's installed `PG_VERSION=17.11`; static workflow review is not an actual CI run result.
