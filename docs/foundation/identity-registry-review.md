# Independent identity enrollment and registry review

September 12, 2026. Scope: root-authored identity enrollment additions,
`identity-registry.ts`, schema, original four registry tests and identity contract.
The reviewer authored seven independent tests in `identity-registry-review.test.ts`
and did not implement the production corrections.

## Findings and correction evidence

Initial registry run: **11 tests, eight passed, three failed**. These were
desired-invariant failures using real signatures and PGlite, not crypto stubs.

1. **P1, verified control changed across asynchronous verification.** Calling
   `transitionIdentity` with a correctly signed operational threshold of one, then
   changing the caller-owned command to threshold zero before awaiting its result,
   produced accepted control with threshold zero. Validation/signature bytes and
   the subsequently accepted body differed. The implementation now detaches bounded,
   descriptor-safe inputs before asynchronous work in identity entry points.
2. **P1, signed audit evidence changed after verification.** A database-await hook
   changing caller genesis/enrollment bodies after verification caused history to
   store the changed bodies with the original signatures. The registry now takes
   its own detached request copies before any await, independently of helper copies,
   and persists those verified copies.
3. **P2, resolver enrollment audience was not retained as authority.** A new registry
   instance using the same resolver ID/key but a different configured audience could
   resolve an identity enrolled for the original audience. The schema now retains
   `resolver_audience`; locked-row access checks it alongside resolver ID and key.

These are library signed-data consistency defects, not claims of an exposed public
route exploit. The reviewer read the corrections and independently reran the four
identity/registry original and review suites: **27 passed, zero failed, zero skipped**.
All three deterministic reproducers now pass their desired assertions.

## Positive probes

- Exact initial enrollment replay after a control change returns the same minimal
  receipt, not current keys, and does not duplicate history.
- Simultaneous identical and competing enrollments retain one identity and initial
  history; a conflicting enrollment does not silently replace authority.
- A synthetic full-genesis-digest conflict against an existing UUID row rejects
  without mutation. This tests the collision guard, not a discovered SHA collision.
- Resolver signing configuration is detached from later caller changes. The
  implementation additionally copies seed/public-key buffers.
- Original adapter probes establish lease persistence across adapter recreation,
  the recovery barrier, frozen/foreign resolver rejection and transaction rollback
  when lease persistence or signed-history insertion fails.

## Disposition and limits

Scoped acceptance of this library/database-adapter slice after the fixes, **not F1
completion**. PGlite serializes these tests; this is not independent PostgreSQL
multi-connection contention, disk crash recovery or production deployment evidence.
Database rows/configuration are trusted host state, not client-controlled objects.
The bounded data copier is not a JavaScript Proxy sandbox or public-request limiter.

No public resolver route, custody UI, one-time challenge consumption at business
execution, cooperative resolver transfer or old-identity migration is supplied by
this slice. At the initial review, transition retry after an uncertain successful
response failed stale rather than returning a durable identical receipt; the
subsequent correction is reviewed below. Existing outstanding leases may remain usable until their
30-second expiry and the five-second control barrier; no instantaneous global
revocation or resolver-equivocation protection is implied.

The new schema is a fresh pilot schema, not an upgrade migration for an already
deployed pre-audience registry. Any persisted earlier pilot database needs an
explicit owner-binding-preserving schema migration before reuse.

## Subsequent durable-transition-retry review

The implementation lead added nullable `identity_history.result` and an additive
`ADD COLUMN IF NOT EXISTS` migration. New transitions persist their minimal accepted
receipt in the same transaction as the signed command and control change. Exact
canonical signed-envelope replay returns that historical receipt before evaluating
current-head CAS or submission expiry. A changed signature envelope with the same
body digest conflicts; frozen/transferred or foreign resolver bindings still fail
before lookup. No current key state or new authorization lease is returned.

The reviewer read this root-authored delta and reran all 12 original/independent
PGlite registry tests successfully. A new real PostgreSQL probe also passed: after
the first transition expires and a later transition advances control, replay returns
the original receipt with byte-equivalent rows/history and no revision increment;
changed signature ordering conflicts, and freezing the exact identity blocks replay.
The historical retry slice has scoped acceptance. It is not a current-controller
proof or a bypass for issuing a new transition with retired credentials.

The reviewer additionally authored seven real PostgreSQL qualification tests in
`sdk/tests/foundation-postgres/identity-registry.test.ts`. All seven passed against
the isolated loopback database: eight simultaneous enrollments, competing rotation
and recovery, both lease/transition lock orders, unrelated identity progress while
another is genuinely blocked, real SQL rollback after history insertion, and durable
retry. Server lock waits are observed through `pg_stat_activity`, not inferred from
timer delay alone. Only additive schema operations and unique synthetic identities
are used; no existing schema is dropped or truncated.

Those tests are new **test implementation**, not self-approved qualification evidence.
Another agent must review the harness and rerun it before the coordinator marks the
real-PostgreSQL gate passed. They do not establish restore-after-crash, production
latency, a public resolver route or complete F1/F9 readiness.
