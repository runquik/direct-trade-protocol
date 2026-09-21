# Foundation baseline capability audit

Date: 2026-09-12. Auditor: `capability_audit`. This is fresh, read-only validation of the experimental baseline, not approval of the new foundation implementation or independent certification of this audit. The testing-strategy skill informed the separation of local unit/HTTP checks, runtime checks, dependency review, and real-database evidence.

## Source and safety boundary

The audit began on `codex/dtp-v04-release` at `5045e5204d7b76f8b875c6debd0707afc6f01d65`. During the audit the coordinator created `codex/dtp-foundation-update` from already-fetched `755adcc86b130dca5fbf5c071de976a3e54f4471`; the execution contract records the same source tree. Results below describe the existing baseline suites, not concurrently added foundation code.

Existing `progress.md` changes and untracked private collaboration context, site files, output and local configuration were preserved. No production code, package lock, historical release evidence, historical stress report or shared database was changed by this audit. No installs, upgrades, deployment, push, publication or workflow dispatch occurred. Both `STORE_URL` and `DTP_TEST_DATABASE_URL` were cleared in each local test process, without printing their former contents. HTTP tests used synthetic local stores. PostgreSQL concurrency was not rerun locally.

## Usable tools

| Capability | Observed result | Consequence |
|---|---|---|
| System Node | `C:/Program Files/nodejs/node.exe`, v25.4.0 | Outside repository engines and now EOL; do not use for acceptance |
| Pinned Node | `C:/Users/runqu/AppData/Local/npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe`, v22.23.2 | Used for every Node result below |
| npm | 11.7.0; CLI at `C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js` | Invoke explicitly with pinned Node; do not rely on PATH Node |
| Cached Deno | `C:/Users/runqu/AppData/Local/npm-cache/_npx/05b6ef7b13673c57/node_modules/deno/deno.exe`, 2.9.6, V8 15.0.245.2-rusty, TypeScript 6.0.3 | Offline cached checks and probe pass |
| Docker | Client 29.1.3; engine named pipe unavailable; config permission warning | Not a usable fresh PostgreSQL environment; no startup or configuration attempted |
| psql | Not on PATH | No independent local PostgreSQL client established |
| GitHub | Read-only connector succeeds | Canonical public repository is now `runquik/direct-trade-protocol`, repository ID 1175633887 |

The Node executable SHA-256 is `0d0f5e39f9f3d9587bc19f73eab3c2c9c4903fd02d6dbf9c853dd81b3d95fad4`, matching the official v22.23.2 Windows x64 executable checksum. Node 22.23.2 is a security release; Node 25 is EOL. Deno 2.9 is an LTS line. These observations do not justify upgrading automatically. Sources: [Node release policy](https://nodejs.org/en/about/previous-releases), [22.23.2 release and checksums](https://nodejs.org/en/blog/release/v22.23.2), [July 2026 security release](https://nodejs.org/en/blog/vulnerability/july-2026-security-releases), [Deno release policy](https://docs.deno.com/runtime/fundamentals/stability_and_releases/), [Deno 2.9.6 release](https://github.com/denoland/deno/releases/tag/v2.9.6).

## Fresh local results

Working directory is `sdk`. In PowerShell, set `$env:STORE_URL=$null; $env:DTP_TEST_DATABASE_URL=$null`, assign the exact Node path above to `$dtpNode`, and run the commands below. Counts are suite counts, not a claim of unique independent security properties.

| Command (after `& $dtpNode`) | Result |
|---|---|
| `--test 'tests/*.test.ts'` | 103 passed; 0 failed/cancelled/skipped/TODO |
| `--test 'tests/v04/*.test.ts' 'tests/profiles/*.test.ts' 'tests/interop/*.test.ts' 'tests/release/*.test.ts'` | 116 passed; 0 failed/cancelled/skipped/TODO |
| `node_modules/typescript/bin/tsc --noEmit` | Exit 0 |
| `tests/fuzz/repro-v8-check.mjs tests/fuzz/v8-repro/polluter.min.json tests/fuzz/v8-repro/target.min.json print` | Fresh and repeated canonical results match; no runtime fault |
| `--test tests/fuzz/fuzz-canonical.test.ts tests/fuzz/fuzz-encodings.test.ts tests/fuzz/fuzz-signing.test.ts tests/fuzz/race-store.test.ts` | 37 passed; 0 failed/cancelled/skipped/TODO |

The fuzz suite reported 5,000 integer cases without divergence and zero runtime parse faults. Its optional `json-canonicalize` comparison excludes 1,144 `toJSON` cases under its declared oracle rules; that is not a skipped required test, but remains an oracle coverage limit. Local race tests use PGlite, not production PostgreSQL.

With the exact Deno path above:

```powershell
& $dtpDeno check --cached-only --config ../supabase/functions/pbp-store/deno.json src/v04/router.ts src/v04/client.ts scripts/dtp-v04-runtime-probe.ts
& $dtpDeno run --cached-only --config ../supabase/functions/pbp-store/deno.json scripts/dtp-v04-runtime-probe.ts
```

Both exited 0. The probe exercised Ed25519, exact command schema, a custom profile, compartment authority, signed record round trip and tamper rejection. This is a local Deno check, not hosted Supabase/edge deployment validation. Generators and package build artifacts were not regenerated in this baseline pass. No old release-loop or evidence-writing script was invoked.

## Real PostgreSQL and CI

The connector independently resolved historical run `34532585099` under the canonical repository and returned successful `local-conformance` job `103056619128` and `postgres-concurrency` job `103056619419`. The old `portable-business-protocol` alias returned an empty job list for that query; this was an alias-resolution issue, not evidence that CI did not exist.

These are historical baseline results, freshly inspected, not new foundation evidence. A new isolated real PostgreSQL execution remains mandatory. The existing workflow uses `postgres:17`, `ubuntu-latest`, and major action tags such as `actions/checkout@v4`, `setup-node@v4` and `upload-artifact@v4`; immutable image/action pinning and a fresh hosted-adapter qualification belong in the foundation release work. PostgreSQL 17 remains supported; the current listed maintenance release is 17.11. See [PostgreSQL version policy](https://www.postgresql.org/support/versioning/) and [release notes](https://www.postgresql.org/docs/release/).

## Historical wire and package inventory

| Generation | Actual signed contract and routes | Preservation requirement |
|---|---|---|
| Experimental v0.2 | `sdk/src/envelope.ts` and `sign.ts`; fixed signing fields canonicalized directly, no domain wrapper; legacy `/health`, `/schemas`, `/companies`, `/modules`, `/records` client routes | Preserve field selection and original verifier; names and NEAR account identifiers are not foundation portable person identity |
| Experimental v0.3 | `PBP-PERSON-0.3`, `PBP-ORGANIZATION-0.3`, `PBP-COMMAND-0.3`; `/pbp-store/health`, `/pbp-store/commands` | Preserve PBP prefixes and exact signing bytes despite current DTP branding |
| Experimental v0.4 | `DTP-PERSON-0.4`, `DTP-ORGANIZATION-0.4`, `DTP-COMMAND-0.4`, `DTP-TOKEN-0.4`; `/dtp/v0.4/health`, `/dtp/v0.4/commands` | Preserve existing vectors and original verifier; not silently relabel to 0.1.0 |

Existing original-vector and independent native-client tests passed. New foundation identity/authority compatibility is not established by those passes.

| Package | Local version | Publication setting |
|---|---|---|
| `sdk`, `@dtp/sdk` | 0.2.0 | `private: true`; engines `>=22.23.2 <23` |
| `sdk/tests/fuzz`, `dtp-fuzz` | No version | `private: true` |
| `mcp-server`, `dtp-mcp-server` | 0.1.0 | No private flag |
| `remote-mcp-server`, `dtp-remote-mcp-server` | 0.2.0 | No private flag |

Read-only npm registry queries returned HTTP 404 for all three named SDK/MCP packages, and the canonical GitHub public releases endpoint returned zero releases; local `git tag --list` returned no tags. Initial sandbox network failures were not interpreted as absence; approved read-only network queries obtained these results. This establishes no currently discoverable public package at those exact npm names, not proof of no prior publication, deleted releases, private registries, alternate names or deployed compatibility obligations. Repository source is already public. Registry account ownership and live deployed routes were not checked. First-public-release 0.1.0 remains an explicit policy decision, not a mechanical rewrite of historical signed versions.

Selected baseline hashes (SHA-256, local bytes):

```text
.node-version                         302d2124066351807cac812a314cbab7426965a5accc0cbef9921502118bb793
sdk/package-lock.json                 819b319bc7e053d9bc4c7989ee22a9a20945df772eb512ade02d93ebe61b8ca7
sdk/tests/fuzz/package-lock.json       0dee047b084be128c4233d405717c607a84e15f48b5ed4bb2ec1fb52e59b1e7b
spec/v0.3/signing-vector.json          aa9dabe44a2ad75839e401c28affa91f0871fdb1c0b34330a9989544d9ca8ddc
spec/v0.4/signing-vector.json          195c9c1e1619abd512e185bfb489967e624b21f6bb887aec60c3c2707539f3d7
```

## Dependency audit and unresolved findings

For each package directory, ran pinned Node with npm CLI and `audit --package-lock-only --ignore-scripts --json --registry=https://registry.npmjs.org`. Network-only escalation was used after the sandbox request failed. No `audit fix`, installation or lock mutation occurred.

| Package | npm affected-package entries | Assessment |
|---|---|---|
| SDK | 0 | Current registry audit clean, not proof against unknown vulnerabilities |
| Fuzz harness | 0 | Same limit |
| Legacy local MCP | 20: 14 low, 3 moderate, 3 high | Unresolved; high entries include fast-uri, hono and ip-address |
| Legacy remote MCP | 24: 13 low, 7 moderate, 4 high | Unresolved; includes the above plus direct drizzle-orm |

These counts include transitive affected-package propagation and are not counts of unique CVEs. Reachability and exploitability in these adapters have not been established. The foundation release must either remediate relevant execution paths with reviewed version updates or explicitly retire/exclude legacy adapters with documented support and deployment boundaries. Do not let the SDK's clean result conceal their status.

Primary advisories inspected include [Drizzle identifier escaping](https://github.com/drizzle-team/drizzle-orm/security/advisories/GHSA-gpj5-g38j-94v9) (affected through 0.45.1, patch 0.45.2; runtime untrusted identifiers/aliases matter), [Hono credentialed wildcard CORS](https://github.com/honojs/hono/security/advisories/GHSA-88fw-hqm2-52qc), and [fast-uri malformed IPv6 normalization](https://github.com/fastify/fast-uri/security/advisories/GHSA-f65p-4m7j-42xc). The npm result also identifies [ip-address leading-zero normalization](https://github.com/advisories/GHSA-mwp4-54f8-5fhr). npm's suggested major-version changes, including near-api-js, must not be accepted blindly; a remote drizzle-kit suggestion is not a safe automatic upgrade plan.

The SDK lock pins TypeScript 5.9.3, postgres 3.4.9, PGlite 0.5.8, JSON schema validator 4.1.1, Supabase CLI 2.116.0 and Node types 26.4.1. Node types are ahead of the runtime; a successful typecheck alone does not establish runtime API availability. Deno advisories were located but a complete CVE-to-runtime mapping was not performed.

## F0 disposition

Usable pinned local Node and cached Deno are established, legacy suites remain green, and important dependency and infrastructure limits are now explicit. This is a baseline observation only. F0 still needs independent review of the audit and foundation graph, frozen version/wire/support policy, concrete required check commands and source coverage. Real PostgreSQL, full build/generation/package qualification, legacy dependency decisions and an actual external cold builder remain unresolved release requirements. No foundation gate approval is supplied by this document.
