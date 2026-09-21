# Historical MCP adapters: reference-only boundary

Date: 2026-09-12. Implementer: `capability_audit`. Independent review is required; this document is implementation documentation, not an approval.

`mcp-server/` and `remote-mcp-server/` are the frozen v0.1 NEAR clients described in their pre-existing READMEs. They are **unsupported historical source**, not part of the runnable foundation release. Their local package version numbers (0.1.0 and 0.2.0) are preserved; they do not redefine the foundation's first public release target or any historical signed format.

## Local enforcement

- Both packages are private. Their package main, normal build/dev/start and prepack commands refuse through a dependency-free script. The remote database-migration command also refuses.
- Both source entry points first import a refusal module. A fresh manual compilation therefore retains a guard ahead of adapter initialization even if someone bypasses npm scripts. There is no environment-variable opt-in to a frozen OAuth stub.
- The remote automatic Dockerfile deliberately contains no build stages, so a normal Docker build fails before executing an image or installing dependencies. Railway's ordinary startup command also points to the refusal script.
- Original Docker and Railway recipes are preserved byte-for-byte as `Dockerfile.reference` and `railway.toml.reference`. Git attributes preserve their original CRLF bytes. They are historical evidence, not alternative deployment instructions.
- Supported SDK/runtime source and current CI are checked for direct legacy-adapter import/execution dependencies. Publication/build owners must retain this exclusion as new package or deployment entry points are added.

No existing installed copy, already compiled `dist/`, previously built image, hosted service, registry publication, database, key or live deployment was changed or disabled. The repository is not a remote kill switch. Before deploying this branch into any existing service, its operator must make an explicit retire/migrate/patch decision; these guards would intentionally refuse a fresh archive startup.

These controls prevent accidental use through ordinary repository entry points. They are not DRM or a security sandbox: someone controlling source can remove guards, invoke deeper implementation files, use a `.reference` recipe, or bypass lifecycle hooks. Such activity is outside the supported release, not an approved opt-in. Revival requires a separate reviewed maintenance and compatibility task.

## Vulnerabilities remain visible

The historical lockfiles and all dependency versions are unchanged. The fresh audit recorded 20 affected-package entries for the local adapter (14 low, 3 moderate, 3 high) and 24 for the remote adapter (13 low, 7 moderate, 4 high). These include transitive propagation and are not unique CVE counts. No claim of zero repository-wide vulnerabilities is made.

The remote client additionally retains its documented auto-approve OAuth stub, plaintext historical custody model and unqualified multi-tenant identity handling. It must not receive real company records, employee data, private keys or funds. The Foundation SDK's clean dependency scan cannot approve those old paths.

See [the baseline audit](baseline-audit.md) and [exact remediation choices](legacy-mcp-remediation-options.md) for the locked dependency paths and candidate updates. If executable support is ever needed, it requires dependency and Node upgrades, authentication/session isolation, key-custody review, dummy-key wire compatibility tests, disposable database validation, and a fresh deployment review. No such revival is implemented here.

## Preservation and validation

The reference recipe SHA-256 values match their original local bytes:

```text
Dockerfile.reference   a7a4cf97bd34e700728967978b3590a2f62c0b20091916ffae755661e12043d1
railway.toml.reference 7d81ebe34060020b05d6ed42721aa7ac008200f5fd9a6ebc03ab37dc8207dba5
```

Local lockfile bytes are unchanged. The regression tests use LF-normalized hashes for lock content so a normal cross-platform checkout does not produce a false change; the references use exact byte hashes. Dependency/dev-dependency maps, package names and versions must still agree with each lock's root metadata.

`sdk/tests/foundation/legacy-exclusion.test.ts` tests dependency-free child-process refusal, package/script configuration, direct-entry guard placement and compiled guard behavior, recipe preservation, lock immutability, and current supported source/CI separation. It does not contact a database, NEAR RPC or hosted service, install dependencies, perform a Docker build or claim a full adapter runtime audit. These are implementer checks; another reviewer must inspect them and their scope before acceptance.
