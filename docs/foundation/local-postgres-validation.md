# Local PostgreSQL qualification log

## Docker repair, 2026-09-12

The user authorized starting Docker for synthetic tests, then explicitly authorized diagnosing and repairing its startup failure. Docker Desktop4.57.0 crashed before the engine was ready because Windows could not remove stale zero-byte runtime sockets. Local inspection showed reparse-point attributes on the affected sockets.

The repair stopped Docker and renamed only verified runtime directories into recoverable backups. After the initial socket repair exposed a second stale endpoint, both runtime locations were clear before the successful restart. Preserved paths:

- `C:/Users/runqu/AppData/Local/Docker/run.dtp-backup-20260912T150621`
- `C:/Users/runqu/AppData/Local/docker-secrets-engine.dtp-backup-20260912T150906`
- `C:/Users/runqu/AppData/Local/Docker/run.dtp-backup-20260912T151154`

The first folder contained `dockerInference` and `userAnalyticsOtlpHttp.sock`; the second contained only `engine.sock`; the third contained the new stale `dockerInference` created during the intermediate failed restart. No images, volumes, WSL disks or settings were changed or deleted. No diagnostics were uploaded. Docker Desktop reports running; CLI client and server both report29.1.3. Existing Supabase containers resumed, and the existing database container reported healthy. Their data has not been used for these tests.

## Isolated test instance

Container `dtp-foundation-pg-20260912` uses official image `postgres@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73`; the server identifies as PostgreSQL17.11, Alpine x86_64. Its port is bound only to127.0.0.1:15439. Database `dtp_foundation_tests` and its credentials are synthetic. Limits:2CPUs,768MiB RAM,256PIDs,512MiB temporary database filesystem, no host-directory mounts. Stopping this ephemeral instance is not a persistence/restore test.

The first seven real-PostgreSQL identity tests pass: concurrent enrollment, competing controls, both lock orderings of recovery and proof issuance, unrelated identity progress, actual SQL-error rollback, and durable historical acknowledgments. These are narrower than full F9 qualification; the operational harness is independently reviewed before acceptance. Load, backup/restore, cross-host moves, and integrated business-operation contention remain open. CI wiring is source-reviewed only until a fresh remote run is observed.

## Indexed business-store qualification

The separate business-store harness has now passed12tests on the same PostgreSQL17.11 instance and an independent rerun. It covers concurrent sibling-grant budgets, eight simultaneous retries of one business operation, exact all-table rollback after five different SQL write stages, real lock-wait observation with unrelated-company progress, both represented-company revocation orderings, unchanged foreign-source references and physical JSONB objects. See `persistence-postgres-review.md` for scope and evidence.

Those tests use explicitly synthetic policy and authentication hooks. Root's finalization change additionally passed5owned and4independent PGlite tests, including late grant/approval expiry, exact original grant on retry, rollback from the final callback, and no duplicate budget charge. Neither suite alone proves actual person credentials remain valid at SQL COMMIT: the concrete person-authentication adapter's deferred deadline trigger is a separate qualification scope. No actual process-kill, restore, load, origin-policy revocation or full-host portability claim follows from the database results.

## Concrete person-authentication qualification

Three additional independently authored tests now pass on actual PostgreSQL17.11 with real person/resolver signatures: a stalled JavaScript final callback causes SQL COMMIT rejection and exact rollback at the credential deadline; concurrent use of one signed challenge commits once; and two companies serialize on their person's shared durable checkpoint without confusing a legitimate1250ms lock wait with clock skew. The last case first failed, was corrected by the source owner, and was rerun unchanged by the reviewer. The final source-bound run repeats all three successfully.

The corresponding person-authentication owner/reviewer suites pass16PGlite tests. Other business policy, governance and accounting hooks in these fixtures are still synthetic. See `person-authentication-review.md` for trust, clock, finite-capacity and remaining-integration limits. Docker and database readiness do not imply overall protocol release readiness.
