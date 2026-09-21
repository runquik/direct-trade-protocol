# Independent semantic persistence host-library review

Date: 2026-09-12. Reviewer: `capability_audit`. Implementer: `profile_contracts`.

Scope: `sdk/src/foundation/persistence.ts`, its authority/semantic/datatype and `Db` dependencies, `sdk/tests/foundation/persistence.test.ts`, the explicitly synthetic hook fixture and `docs/foundation/persistence.md`. The code-review skill guided correctness, authorization boundaries, recovery and resource-limit inspection. The reviewer added `persistence-review.test.ts`; no production fixes or acceptance observations were made by this reviewer.

## Disposition

**The reviewed host-library slice passes its independent checks; full F9 is not approved.** No new defect was reproduced in the tested current implementation. The API requires trusted host hooks and does not implement authenticated routes or bind those hooks to actual identity, installation, mandate and origin-policy systems. The persistence execution tests in this report use PGlite, not real PostgreSQL server concurrency.

| Dimension | Result |
|---|---|
| Atomic correctness | Actual SQL failures after write stages leave exact authoritative rows unchanged; effects, authority budgets, heads, receipt and outbox converge together |
| Access boundaries | Current live/read/profile checks precede receipt disclosure; origin read refusal prevents private input reaching the handler. The actual authentication/authorization implementation remains external and mandatory |
| Replay/recovery | Fresh instance recovers original receipt without reevaluation/accounting or double charge; exact grant expiry/revocation and immutable revision reuse fail closed |
| Provenance | Native-crypto fixed vector verifies the declared generated-revision domain; original signed requests/imported records remain attributed separately, without pretending the actor signed generated effect bodies |
| Performance/operability | Indexed records/heads/receipts/outbox are useful; same-organization serialization, bounded authority JSON and lack of measured quotas/backup recovery remain pilot limits |
| Maintainability | No generic overwrite endpoint; explicit create-only import and unsupported prerequisites reduce bypass surfaces. Required hooks and omitted integration work are documented |

## Independently executed checks

From `sdk`, with `STORE_URL`, `DTP_TEST_DATABASE_URL` and `DTP_FOUNDATION_TEST_DATABASE_URL` unset:

```powershell
& 'C:/Users/runqu/AppData/Local/npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe' --test tests/foundation/persistence.test.ts tests/foundation/persistence-review.test.ts
```

Fresh combined result: **21 passed** (7 independent plus 14 implementer), zero failed/cancelled/skipped/TODO, exit 0. A separate whole-SDK `tsc --noEmit` completed with exit 0. The owner added three test cases while review was underway but made no production changes; all three were included in the observed 21-test run.

Independent tests cover:

- An actual SQL division-by-zero error **after** each write stage: authority update, immutable revision insertion, resource head update, outbox insertion and business receipt insertion. Every table's full sorted fixture rows, not merely counts, match the pre-transaction state. A fresh store instance then executes successfully once.
- Failure after governance outbox insertion rolls back the proposed revocation, governance history, sequence and authority state; subsequent legitimate execution still succeeds.
- Attempting to reuse an older immutable resource revision ID cannot rewind the head or leave a charged budget, receipt or partial outbox behind.
- Old receipt replay does not invoke the handler or accounting callback. Current read, live authority, profile permission and exact grant expiry still block disclosure without changing rows.
- PostgreSQL-style SQL `jsonb_typeof` checks in PGlite verify physical object storage for bodies, exact references and attribution. The review does not substitute this for an eventual real PostgreSQL run of the persistence component.
- The original request remains unchanged in stored attribution after caller mutation. Fresh-instance retry returns its original receipt; the indexed head and profile agree with the accepted resource revision.
- A hook refusing foreign-origin input prevents the admitted handler from seeing that input; neither the represented company's state nor the foreign company's budget changes.
- Native Node SHA-256 over fixed canonical bytes independently agrees with `DTP-ENTITY-REVISION-1`; floating-point quantities reject. The fixed vector does not reuse SDK hashing/canonicalization for its expected digest.

Complementary implementer cases cover cumulative parent budgets across sibling grants, same-intent approvals invalidated by a changed evaluated plan, post-admission resource CAS failure, current grant revocation, exact cross-company reference retention, import/append bypass refusal and caller/callback mutation during awaited hooks.

## Code-grounded boundaries retained

The represented organization's authority row is locked before authentication and state use. The authority evaluator enforces finite capability chains, scopes, active expiry/revocation, cumulative usage and approval rules; the semantic registry verifies declared exact inputs/effects and unchanged resource profile. The store rechecks declared resource expectations after awaited admission work and again in the SQL head update. Foreign input versions remain under their original organization/entity/revision/digest rather than becoming recipient-owned originals.

Trusted hooks receive detached frozen input and their returned values are copied before later awaits. The original request is copied before any transaction await. Freezing is not a sandbox: a hook has transaction/host privileges and must not perform irreversible external effects. The tested fixture uses named synthetic markers, not cryptographic production authentication. A successful fixture callback proves orchestration and transaction behavior, not real identity verification.

The create-only import path requires controller consent and original verification, checks that the entity does not already exist, and preserves original signed provenance. It is deliberately not migration of a historical version chain. Record append cannot reuse an existing record entity; generic overwrite is not exposed. Unsupported additional operation prerequisites are explicitly refused rather than inferred as granted.

An old receipt is historical evidence, not a new operation or fresh private projection. Replay must still pass current live/read/profile and capability-chain checks and cannot execute the planner/accountant again. Host-produced body digests bind their own exact domain and are not rewrites of historical wire signatures.

## Mandatory gaps before full F9 acceptance

1. **Real PostgreSQL persistence races:** concurrent resource/budget consumption, same-ID retries, revoke-versus-execute orderings, unrelated-organization progress while one row is lock-blocked, and SQL rollback observed on the actual server. The separately reviewed identity-registry PostgreSQL tests do not prove this different store's behavior.
2. **Actual authenticated integration:** signed operation/approval/governance/import verification, current identity and installation/mandate intersection, private profile visibility and origin read authorization. There are no HTTP routes for this store and no automatic binding from existing experimental v0.4 routes.
3. **Revocation serialization:** origin policy, identity and agency changes must serialize with the hooks' current reads. The represented company's lock does not protect a different company's policy or an independent identity registry. Deadlock/serialization retry must preserve the logical operation and not become a fictional business refusal.
4. **Replayable feed integration:** raw outbox sequences and effect event IDs are internal. F5 must produce authorization-filtered checkpoints/events and consistent snapshot boundaries; exposing the raw outbox is not privacy-safe synchronization.
5. **Recovery and migration:** backup/restore, actual crash/kill rehearsal, full-history transfer, outstanding obligations and authority-host replacement require separate evidence. Reconstructing an in-process store object is not a machine crash test.
6. **Measured operational limits:** tenant quotas, history growth, database privileges, deployment/migration controls, lock contention, timeouts, tamper detection, target capacity/latency and CI on frozen inputs remain required. Same-organization JSON authority serialization is an explicit bounded pilot choice, not a scalable network claim.

No source-bound foundation gate was marked green by this review. No production deployment, dependency installation, private data upload, merge or publication occurred.
