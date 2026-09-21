# Independent person-authentication review

Reviewer: `capability_audit`. Production author: `profile_contracts`; persistence finalization integration author: `coordinator`. Date: 2026-09-12.

Disposition: the bounded transaction-bound person-authentication adapter is acceptable within its documented trust model. The independently reproduced `F9-auth-lock-clock` defect is corrected and its unchanged real PostgreSQL reproducer now passes. This document is not whole-F9 acceptance, a claim of production host readiness, or evidence that the foundation release graph is green. Source-bound observations must be recorded separately after the coordinator freezes the relevant graph inputs.

## Scope and method

Read `sdk/src/foundation/person-authentication.ts`, its owner tests and fixture, `docs/foundation/person-authentication.md`, the persistence hook integration, and the applicable identity-resolution contract. Wrote separate reviewer fixtures/tests without changing production code:

- `sdk/tests/foundation/person-authentication-review-fixture.ts`: real person/resolver Ed25519 signatures and concrete authentication hooks, explicitly synthetic business/governance policies.
- `sdk/tests/foundation/person-authentication-review.test.ts`: six independent bounded signature, transaction, retry and clock probes.
- `sdk/tests/foundation-postgres/person-authentication-review.test.ts`: three actual PostgreSQL commit/locking probes, with no PGlite fallback.

Also extended `foundation-ci-review.test.ts` to require the exact unconditional source-bound F1, F9 persistence and F9 person-authentication PostgreSQL commands, their graph mappings, and the pinned Deno 2.9.6 check over all foundation source modules. These are static CI-contract assertions, not proof that GitHub Actions has executed.

## Finding and closure

### F9-auth-lock-clock: elapsed lock wait was misclassified as clock skew

The original authentication hook compared the persistence layer's immutable admission timestamp with a database clock reading obtained after waiting for the shared person checkpoint. A real, server-observed 1250 ms wait caused a valid request for a second organization to fail with `host/database clock skew exceeds bound`. Its resolver proof still had ample remaining life. This was a genuine availability failure in the intended multi-organization identity flow, not a disagreement between clocks.

The owner now samples the trusted host clock around each database clock query after the locks. The database reading must fall within that sample interval plus the unchanged 1000 ms consistency allowance. A separate 1000 ms query-roundtrip bound rejects ambiguous slow measurements. Admission timestamps cannot be in the future; host and database regressions are checked. Existing challenge/proof deadlines and the 5000 ms commit reserve are not extended by queue time.

Independently reread the implementation and documentation. The unchanged PostgreSQL test observes actual `pg_stat_activity` lock contention, holds it for 1250 ms, releases it, and verifies a committed business receipt for the second organization with one shared person checkpoint. It passes after the correction. Additional independent controls reject both +10-second and -10-second host/database disagreement, clock regression, and an overlong sample interval without consuming the nonce; the original request subsequently succeeds under the correct clock.

The interval is a bounded consistency measurement, not proof of exact clock synchronization. The documentation correctly retains operator clock-health responsibilities and does not pretend that the remote resolver clock is measured by this query.

## Verified invariants

- Changed organization, person, audience, grant, intent or resolver-proof bytes fail before nonce consumption. A genuinely resolver-signed wrong-audience, wrong-epoch or expired proof is also rejected.
- Recovery keys, duplicated signatures, insufficient operational quorum and signatures over another domain cannot authenticate a business operation. Two current operational keys satisfy the two-key fixture.
- A later real SQL error rolls back the challenge, checkpoint and business effects. The same still-valid signed request can then succeed; after a successful commit, replaying that challenge fails.
- A historical business retry uses a fresh challenge, proof and signatures, returns the original receipt and does not re-evaluate or recharge. The owner suite separately checks changed intent and original-grant binding.
- Finalization requires the exact consumed request in the same database transaction. A correct request from a later transaction is not sufficient.
- Actual PostgreSQL concurrent submission of the same signed request yields one success, one consumed-challenge rejection, one business receipt and one budget charge.
- Actual PostgreSQL rejects COMMIT after the JavaScript final callback returns past the stored deadline. The test first uses the real finalization hook to lower the deadline, waits 6500 ms, proves the callback returned, and observes the deferred SQL error. All six business tables compare exactly with their prior rows, and both checkpoint and nonce consumption roll back. The same signed request remains usable while its original credentials remain valid.
- The owner suite's higher-control checkpoint prevents old resolved control from being reused across organizations. The independent PostgreSQL test verifies actual shared checkpoint locking during a second organization's business operation, rather than relying on a simulated callback barrier alone.

## Commands and observed results

Used the verified local Node 22.23.2 executable at `C:/Users/runqu/AppData/Local/npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe`, from `sdk`. Cleared `STORE_URL`, `DTP_TEST_DATABASE_URL` and `DTP_FOUNDATION_TEST_DATABASE_URL` in the child shell without printing their previous values.

```text
node --test tests/foundation/person-authentication.test.ts tests/foundation/person-authentication-review.test.ts tests/foundation-postgres/person-authentication-review.test.ts tests/foundation/foundation-ci-review.test.ts
```

Observed 22 passed, 0 failed, 0 skipped, 0 cancelled, 0 todo: 10 owner authentication tests, six independent authentication tests, three real PostgreSQL tests and three CI-contract tests. The unfiltered run completed in approximately 12.5 seconds. `node node_modules/typescript/bin/tsc --noEmit` also completed successfully.

The PostgreSQL harness requires exact loopback `127.0.0.1:15439/dtp_foundation_tests`, no URL query/fragment, and server version `170011`. It uses disposable synthetic rows and no production connection. It installs its declared test schemas, including replacing only its own named deadline trigger; it does not drop/truncate a database or erase another fixture's business rows. Local real PostgreSQL execution is not hosted CI evidence.

## Explicit limits and remaining gates

The database role/operator, trusted local clock source, explicit resolver pins and host hook composition remain trusted. Arbitrary SQL access or disabling/changing the trigger after finalization is outside this boundary. The deferred trigger checks authorization at its database commit-time execution with a safety reserve; it is not an exact disk-flush timestamp or payment guarantee.

This adapter verifies leased resolver proofs. It does not independently discover a current freeze or make an already-issued valid proof instantly revocable. Resolver lease/freeze discipline remains part of the separate identity authority contract. It does not protect against a deliberately dishonest enrolled resolver issuing fraudulent heads.

The business policy, company governance, agency, module admission, read/profile authorization and accounting approval hooks in these fixtures remain synthetic. No public login/challenge endpoint, service authentication lifecycle, complete production host, public abuse protection, backup/recovery qualification, global checkpoint federation, external builder acceptance or full foundation release is approved by this review. Finite challenge capacity and explicit unsupported behavior remain documented.

Reviewer-authored tests are evidence probes, not an independent approval of their own harness implementation. Additional package-level review and fresh source-bound execution remain required by the graph.
