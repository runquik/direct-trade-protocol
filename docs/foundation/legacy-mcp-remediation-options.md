# Legacy MCP dependency disposition options

Date: 2026-09-12. Author: `capability_audit`. Read-only investigation; no dependency, source, startup, deployment or wire-format change was implemented.

## Recommendation

Keep the two superseded v0.1 NEAR clients as historical source, and **enforce their existing reference-only status** for the foundation release. Their own READMEs already say frozen and not maintained. Reviving them would add an authentication, custody and operational product to this protocol update, not merely patch several packages.

This recommendation is not permission to delete source or disable a running service. Deployment inventory remains unverified; stopping an existing external service requires an explicit operator decision. The code can remain available for inspection without being included in foundation install/build/start/package/deployment paths. A scope decision and verification of that separation are required before calling the dependency disposition resolved.

## Exact locked paths and remediation candidates

The paths below were read from both package locks; `node_modules/...` denotes lock entries, not a claim that code was executed. The remote lock was queried again with read-only `npm audit --package-lock-only --ignore-scripts --json`. All version candidates were checked against public npm metadata on this date. They are investigation targets, not tested compatibility approvals.

| Locked dependency path | Candidate if continued execution is required | Risk / scope |
|---|---|---|
| Both: `@modelcontextprotocol/sdk@1.29.0 -> ajv@8.18.0 -> fast-uri@3.1.0` | `fast-uri@3.1.6` or a subsequently audited compatible 3.x patch | Ajv requests `^3.0.1`; no need to jump to latest fast-uri 4.1.4. Covers the current audit's malformed authority/IPv6 normalization ranges |
| Both: `@modelcontextprotocol/sdk@1.29.0 -> hono@4.12.12` | `hono@4.13.7` | Within SDK's `^4.11.4`. Do not stop at 4.12.25: later advisories affect versions below 4.13.5 |
| Both: `@modelcontextprotocol/sdk@1.29.0 -> @hono/node-server@1.19.13` | `@hono/node-server@1.19.15` | Compatible patched 1.x exists; no need for latest 2.1.1 solely for this finding |
| Both: `@modelcontextprotocol/sdk@1.29.0 -> express-rate-limit@8.3.2 -> ip-address@10.1.0` | `express-rate-limit@8.7.0`, resolving `ip-address@10.7.0` | Old parent pins 10.1.0 exactly, so updating only the lock's child cannot satisfy that old parent's requirement without an override. New parent uses `^10.2.0` |
| Both: SDK `-> express@5.2.1 -> body-parser@2.2.2 -> qs@6.15.1`; Express also directly depends on qs | `body-parser@2.3.0`, `qs@6.16.0` | Compatible with Express ranges, but recheck URL-encoded/body limits and OAuth routes. Remote Express is also a direct dependency |
| Both: `near-api-js@5.1.1 -> @near-js/crypto@1.4.2 -> secp256k1@5.0.1 -> elliptic@6.6.1` (many other NEAR packages transitively reach crypto) | Separate reviewed migration to `near-api-js@7.3.1`, if retaining NEAR execution | No patched elliptic version fixes this current audit range. Major NEAR API migration, not a blind override or audit-fix. v7.3.1 consolidates dependencies and its metadata no longer lists this secp256k1/elliptic chain |
| Remote direct: `drizzle-orm@0.44.7` | `drizzle-orm@0.45.2` | Outside `^0.44.2`; explicit manifest change and database/query regression review required |
| Remote dev: `drizzle-kit@0.31.10 -> @esbuild-kit/esm-loader@2.6.5 -> @esbuild-kit/core-utils@3.3.2 -> esbuild@0.18.20` | Retire unused legacy migration CLI, or separately replace/review that toolchain | Current stable drizzle-kit is already 0.31.10 and retains this chain. Do not accept npm's suggested downgrade to 0.18.1 or force an unsupported esbuild major into `~0.18.20` |
| Local dev: `tsx -> esbuild@0.27.7`; remote dev has `tsx/node_modules/esbuild@0.27.7` | `tsx@4.23.13`, resolving `esbuild@0.28.2` | tsx's new `~0.28.0` range permits patched >=0.28.1. Remote additionally has safe-range top-level esbuild 0.25.12, which does not eliminate the vulnerable nested copies |

The SDK itself is not outdated at its original manifest floor: although both manifests say `^1.12.1`, their locks already resolve 1.29.0. Metadata lists 1.30.0 as the current v1 release; a reviewed update could remain on that maintained major, but it does not remove the need to inspect transitive resolutions. “Install latest” would unnecessarily cross majors for some other dependencies.

The NEAR path is live application integration, not just tooling. Both `mcp-server/src/near-client.ts` and `remote-mcp-server/src/near/client.ts` use `connect`, `keyStores.InMemoryKeyStore`, `KeyPair`, `Near`, `Account`, `functionCall`, `viewFunction` and `createAccount`. Any v7 migration needs signed transaction/key encoding fixtures, return/error compatibility and mocked RPC validation. v7.3.1 requires Node >=22.22.2; the remote Dockerfile still uses `node:20-slim` in both stages. Do not change the legacy business contract, NEAR account identifiers, transaction arguments or historical DTP signature domains as a side effect.

## Reachability triage: do not equate package counts with exploits

- The local client uses stdio. Its Hono/Express packages arrive through the SDK dependency graph; a vulnerable HTTP helper being installed does not prove that helper is reached by the local transport.
- The remote client directly runs Express and the SDK OAuth router. It explicitly trusts one reverse proxy and exposes OAuth and MCP endpoints. Rate-limit/IP behavior and body-parser boundaries therefore need runtime review if this adapter is revived.
- Remote CORS is hand-written Express middleware, not an observed Hono CORS call. Hono's credentialed-wildcard advisory does not by itself prove this particular route vulnerable. Its installed package still requires patching or a recorded reachability disposition.
- Drizzle schemas use static `pgTable` names in `src/db/schema.ts`. A targeted search found no application `sql.identifier`, `sql.raw`, dynamic `.as()` or alias call. That reduces evidence for the specific identifier-injection path; it is not a complete dynamic dataflow proof. The [maintainer advisory](https://github.com/drizzle-team/drizzle-orm/security/advisories/GHSA-gpj5-g38j-94v9) explicitly distinguishes attacker-controlled identifiers from static schemas.
- esbuild advisories target development serving behavior. These manifests use tsx execution and TypeScript builds; no direct esbuild serve use was observed. Nested dev dependencies are not copied as production dependencies by the Docker runtime's `npm ci --production`, but they remain installed in the build stage. This is not equivalent to eliminating them from the supply chain. See [esbuild's development-server advisory](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99).

Current audit totals remain 20 affected-package entries for local MCP (14 low, 3 moderate, 3 high) and 24 for remote MCP (13 low, 7 moderate, 4 high). These include propagation, not unique CVE counts. They must stay visible even if archived components are outside the foundation's supported runtime.

## Why dependency-only repair is insufficient

The remote README explicitly describes an auto-approve OAuth stub. `src/transport/http.ts` starts migrations before listening, and `src/db/client.ts` creates tables against `DATABASE_URL`; it stores organization private keys and OAuth tokens as text. The identity resolver uses a global current-request variable rather than an actual AsyncLocalStorage context. These are code observations requiring a separate trust-boundary review before any real multi-tenant use, not newly demonstrated exploits in this audit.

The repo still contains an active-looking `Dockerfile`, `railway.toml`, start/dev scripts and HTTP mode even though its README says not maintained. A warning alone cannot prove it is absent from a deployment or that a user will not run it. The lowest-risk foundation disposition is a tested separation between historical source and runnable supported components.

## Two explicit choices

### A. Reference-only archive boundary (recommended)

After the coordinator/operator makes the scope decision:

1. Keep original source and historical wire definitions recoverable; do not rewrite experimental contracts.
2. Document these clients as unsupported and excluded from the 0.1.0 foundation package/install/runtime/deployment graph. Mark local package publication private and introduce an explicit guard or otherwise quarantine runnable entry points if approved; do not silently break an existing operator's deployment.
3. Add automated checks proving supported packages, Docker/CI entry points and generated artifacts do not import, package or start these adapters. Preserve a visible legacy dependency-risk inventory instead of claiming zero repo-wide findings.
4. Identify whether Railway or any operator still runs them. No deployment state was checked here. If active, request a separate retire/migrate/patch decision before changing it.

This route preserves historical examples while avoiding an unnecessary NEAR client and OAuth product migration in the foundation build. It is a scope exclusion with evidence, not a claim that the old code is fixed.

### B. Retain executable support

Requires a separate maintenance commitment. Start with compatible lock-level transitive updates; independently review Drizzle 0.45.2, NEAR v7 and a supported Node container; retire or replace the legacy migration dev tool deliberately. Before any acceptance claim, require clean-install reproducibility, typecheck/build, stdio MCP initialize/list/call/error snapshots, OAuth/session subject-binding and cross-tenant concurrency tests, proxy/IP/body-size tests, dummy-key signing and RPC fixtures, and disposable PostgreSQL migrations/rollback. No real network funds, production database or live credentials may be used for those tests.

Do not run `npm audit fix --force`. A staged reviewed manifest/lock change is needed, followed by a fresh full and production-only audit. A dependency scan cannot approve the OAuth stub, key custody or identity isolation design.

## Source verification

Versions and dependency ranges above come from local lock entries plus read-only npm registry metadata, queried through explicit pinned Node/npm or HTTPS GET; no package tarballs were installed. Runtime package candidates were checked against the current audit ranges. Primary context: [Hono's later 4.13.5 patch boundary](https://github.com/honojs/hono/security/advisories/GHSA-g6gw-c38x-mqfc), [NEAR releases](https://github.com/near/near-api-js/releases), [NEAR v7 repository and migration guidance](https://github.com/near/near-api-js), and the maintainer advisories linked above. Full exploitability and upgraded compatibility remain untested.
