# DTP next-update validation capabilities

Audit date: 2026-09-10. Scope: local validation and release-ready branch preparation, not merge, deployment, package publication or shared-backend smoke writes.

## Result

Node and Deno validation are available locally without installing anything. The hosted entry point **passed Deno type checking**, and the runtime probe **passed under Deno 2.9.6** using cached dependencies and no network permission. A real PostgreSQL test service is **not available in the inspected local environment**. Existing GitHub Actions can provision one, but the local `gh` credential is invalid; no Actions run was dispatched or observed in this audit.

The database gate must remain pending until real multi-connection PostgreSQL tests run successfully on the final revision. PGlite passes are not a substitute for this gate. Likewise, checking a Deno entry point and exercising the pure engine is not proof that a deployed Supabase gateway/database combination works.

## Observed baseline and preservation

- Starting branch: `codex/passport-browser-demo`; starting HEAD: `e5deb7fcecc07bf6cd2486d36c9d5b3ed24d69c9`.
- The checkout already contained modified tracked files and untracked Passport, Early Pay, Financial Profile, stress-test and documentation work. The audit did not reset, stage, commit or regenerate those files.
- `STORE_URL` and `DTP_TEST_DATABASE_URL` were absent. Only presence was inspected; no credentials were printed.
- `sdk/tests/helpers.ts` supports redirecting legacy tests to `STORE_URL`, including a remote store. Fail a local release gate if that variable is present rather than trusting unique test identifiers to make remote writes safe.
- `docs/dtp-vision` is unrelated public-site work and must not be included accidentally in the protocol release.

## Capability matrix

| Gate | Local capability | Audit evidence / limitation |
|---|---|---|
| Supported Node | Available | Cached Node reports `v22.23.2`; system default reports `v25.4.0` and does not meet `sdk/package.json` engines. |
| SDK tests and TypeScript | Available | Installed dependencies and pinned Node exist. Full final-revision runs belong to the release loop; this audit did not rerun them against concurrently changing code. |
| Deno entry-point check | Passed | `deno check --cached-only` succeeded for `supabase/functions/pbp-store/index.ts`. |
| Deno runtime engine probe | Passed | Runtime Ed25519, schema validation, authority bootstrap, scoped workspace and tamper rejection all passed. |
| Hosted adapter behavior in Node | Available | `tests/09_pbp_edge.test.ts` tests access token, CORS, signature requirement and capacity rollback locally. This is not hosted HTTP integration. |
| Real PostgreSQL concurrency | Blocked locally | Docker CLI exists but daemon pipe is absent; `com.docker.service` is stopped. No `psql`, `pg_ctl` or `C:/Program Files/PostgreSQL` installation found. |
| CI PostgreSQL 17 | Configured, not observed | `.github/workflows/protocol.yml` provisions disposable PostgreSQL 17 and runs both PostgreSQL test files. `gh auth status` failed with invalid credential. |
| Deterministic generation / vectors | Available | Existing generators and conformance tests exist; generation writes working-tree artifacts, so coordinate with their owner. |
| Package consumer distribution | Not currently a published-package gate | SDK is `private: true`; `build` generates schemas and types, not a distributable JavaScript SDK. Do not call this an npm release without a separate packaging/consumer gate. |
| Live development smoke | Deliberately not run | `pbp-hosted-smoke.ts` enrolls synthetic identities and companies on the shared development backend. It requires separate authorization/environment readiness. |

## Exact offline local commands

Run in a PowerShell session from the repository root. Variables below are task-specific and do not overwrite system configuration.

```powershell
$dtpNode = 'C:/Users/runqu/AppData/Local/npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe'
$dtpDeno = 'C:/Users/runqu/AppData/Local/npm-cache/_npx/05b6ef7b13673c57/node_modules/deno/deno.exe'
& $dtpNode --version
& $dtpDeno --version
if ($env:STORE_URL) { throw 'Refusing local release checks with STORE_URL configured' }
Push-Location sdk
try {
  & $dtpNode node_modules/typescript/bin/tsc --noEmit
  if ($LASTEXITCODE) { throw 'TypeScript failed' }
  & $dtpNode --test 'tests/*.test.ts'
  if ($LASTEXITCODE) { throw 'Regression tests failed' }
  & $dtpNode --test --test-reporter=spec tests/fuzz/fuzz-canonical.test.ts tests/fuzz/fuzz-encodings.test.ts tests/fuzz/fuzz-signing.test.ts tests/fuzz/race-store.test.ts
  if ($LASTEXITCODE) { throw 'Auxiliary tests failed' }
  & $dtpNode tests/fuzz/repro-v8-check.mjs tests/fuzz/v8-repro/polluter.min.json tests/fuzz/v8-repro/target.min.json print
  if ($LASTEXITCODE) { throw 'Runtime JSON regression failed' }
  & $dtpNode --test --test-reporter=spec tests/stress/business-boundaries.test.ts
  if ($LASTEXITCODE) { throw 'Business boundary stress tests failed' }
  & $dtpDeno check --cached-only --config ../supabase/functions/pbp-store/deno.json ../supabase/functions/pbp-store/index.ts
  if ($LASTEXITCODE) { throw 'Deno hosted entry-point check failed' }
  & $dtpDeno run --cached-only --config ../supabase/functions/pbp-store/deno.json scripts/pbp-runtime-probe.ts
  if ($LASTEXITCODE) { throw 'Deno runtime probe failed' }
} finally { Pop-Location }
```

Cache paths are workstation-specific. In fresh CI use `actions/setup-node` with `.node-version`, `npm ci`, and the pinned Deno version in the workflow. Do not silently substitute the system Node. If cached Deno dependencies become unavailable, the cached-only commands fail rather than fetching unexpected versions.

### Generated artifact gate

Existing CI runs these from `sdk/`:

```text
npm run build
npm run build:pbp
npm run build:pbp-vectors
npm run build:pbp-migration
git diff --exit-code -- src/schemas.ts ../spec/generated ../spec/v0.3/command.schema.json ../spec/v0.3/signing-vector.json ../supabase/migrations/20260907000000_pbp_v03.sql
```

During implementation a diff against HEAD can legitimately contain intended source-generated changes. Regenerate only after source edits settle, inspect/include the intended generated files, then prove a second generation produces no additional changes. On a clean committed release candidate the CI diff must be empty. Do not regenerate the frozen v0.2 signing vectors as a way to make failing conformance tests pass.

### Real PostgreSQL gate

The existing `tests/postgres/concurrency.test.ts` and `tests/postgres/pbp.test.ts` require `DTP_TEST_DATABASE_URL` to point to a **fresh loopback database named exactly `dtp_test`**. They refuse existing protocol schemas and do not drop or truncate data. The v0.2 and v0.3 suites use distinct schemas so the existing CI job can run both.

Once a disposable local service is explicitly provisioned, run from `sdk/`:

```powershell
& $dtpNode --test 'tests/postgres/*.test.ts'
if ($LASTEXITCODE) { throw 'Real PostgreSQL concurrency gate failed' }
```

Set `DTP_TEST_DATABASE_URL` privately to that disposable service first. Do not reuse a shared development or production URL. Repeated qualification runs need a newly provisioned empty database, not deletion of an unknown existing schema. The already-defined CI service provides this isolation automatically. This audit did not start Docker, install PostgreSQL, create a container or change system services.

Current PostgreSQL tests cover committed event ordering/idempotency and module revocation in v0.2, plus concurrent bootstrap and queued membership revocation in v0.3. New migration/reservation/extension invariants require their own real-database race cases if this update changes those invariants. The shared advisory lock is intentional implementation behavior, not throughput/scalability qualification.

## Release-loop additions needed

1. Run the new business-boundary and release-specific tests in CI, not only `tests/*.test.ts`; nested `tests/stress/` is not included by that glob.
2. Capture test counts, runtime versions, exact revision plus dirty/generated-artifact status, and machine-readable findings. A test asserting a known gap still exists must not count as a green capability.
3. Give every required gate a stable ID and status of passed, failed or blocked. Do not relabel a blocked database/independent-consumer gate as deferred merely to obtain an all-green summary.
4. Rerun impacted checks after each fix; rerun the full required graph once the final code and generated files settle. Evidence from an earlier revision does not close a later regression loop.
5. Treat Deno type checking, pure-engine runtime, hosted adapter unit checks, real PostgreSQL concurrency and deployed gateway smoke as distinct evidence. Release-ready branch scope can explicitly exclude deployment, but must not claim deployment qualification.
6. Obtain an authorized disposable PostgreSQL runtime or restore an authorized CI execution path before marking the database gate green. Existing `gh` authentication is a concrete blocker; do not log in, dispatch workflows or push without the task owner's coordination.

## Audit changes and non-actions

The audit created only this document. It read the testing-strategy and documentation skills, inspected local tools and repository validation configuration, and ran cached Deno checks. No application source was modified, no external backend was contacted, and no credential, installation, service, commit, branch, merge or deployment was changed.

## Follow-up capability checks during implementation

The read-only GitHub connector works independently of the invalid local `gh` credential. Its repository lookup resolves the old `runquik/direct-trade-protocol` URL to the current canonical repository `runquik/portable-business-protocol`. Repository metadata reports access including push/admin, but no mutation was made. The connector can read workflow jobs, logs and artifacts. Its commit-workflow lookup filters to pull-request-triggered runs; an empty result for the starting HEAD therefore does not establish that no push workflow ran.

With coordinator authorization, the already-installed Docker Desktop was launched hidden for isolated local test prerequisites. Desktop/backend processes and the engine pipe appeared, and a read-only WSL check confirmed WSL2 plus the `docker-desktop` distribution. A bounded Docker version API probe still timed out after 15 seconds. No PostgreSQL container, image download or database was created at that point. Local PostgreSQL remains blocked until the engine actually responds; merely starting a process is not infrastructure readiness.
