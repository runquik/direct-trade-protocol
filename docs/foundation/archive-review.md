# Independent historical-adapter boundary review

September 12, 2026. Reviewed capability_audit's archive guards, package changes,
Docker/Railway changes, reference recipes, boundary/remediation documents and
`legacy-exclusion.test.ts`. This reviewer did not implement those controls.
Independent probes are in `sdk/tests/foundation/archive-review.test.ts`.

## Result

**14 tests passed, zero failed, zero skipped** on Node 22.23.2: eight implementer
checks and six independent checks. Scoped acceptance for preventing accidental
fresh execution through the documented ordinary repository entry points. This is
an exclusion disposition, **not vulnerability remediation or a production audit**.

Independent tests execute each full transpiled entry with its static dependencies
replaced by valid export-compatible canary modules. The archive guard throws before
any canary dependency evaluates, including when HTTP transport and an apparent
archive-enable environment variable are supplied. Actual legacy dependencies,
database migrations, RPC calls and credential loaders are never run by this probe.
This verifies ESM evaluation order, not network isolation of malicious dependencies.
ESM still resolves/links dependencies before evaluation; a missing dependency can
fail module linking before the archive message without starting the adapter.

Both package-directory entry points refuse. All current package scripts route to
the dependency-free guard; no `bin`, `exports`, `module` or `browser` alternate entry
is present. Private manifests and `prepack` add ordinary publication friction, not
an anti-copy mechanism. The source entry files, after removing only the new guard,
match LF-normalized hashes independently checked against Git HEAD. Original
dependency graphs and exact reference recipe bytes pass implementer preservation
checks. The reviewed Git diff changes no historical business handler or wire format.

The default Dockerfile has only comments and no build stage. Railway selects that
Dockerfile and also names the refusing startup script. No Docker build or remote
deployment was performed. The preserved `.reference` files remain historical source;
explicitly choosing them is not a supported deployment route.

## Limits and release obligations

- Existing compiled files, installed packages, images and running services are not
  disabled. The operator must separately inventory and decide their disposition.
- Direct internal imports, lifecycle bypasses, patched source and manual reference
  builds remain possible. This is accidental-entry prevention, not a sandbox or
  proof that untrusted code cannot execute.
- Known vulnerable lock entries, the OAuth stub and historical custody/session
  weaknesses remain. The remediation-options document is the earlier investigation;
  the boundary document describes the subsequently implemented archive choice.
- Current supported source/package/CI separation is checked for direct imports and
  configured execution references. This is not arbitrary dynamic dataflow analysis
  or proof about future generated package contents.
- At review time the existing `protocol.yml` workflow and default SDK test command
  do **not** execute `tests/foundation/*.test.ts`. The foundation release coordinator
  must wire both archive suites into mandatory CI/release evidence before claiming
  ongoing enforcement. The current local checks alone do not establish that gate.

No production-code correction was required for the scoped archive entry boundary.
Release CI wiring and any live deployment inventory remain separately open; this
review does not waive them or claim zero repository-wide dependency findings.

### Subsequent CI wiring recheck

The implementation lead added `test:foundation` and `foundation:report` scripts and
an unconditional `npm run test:foundation` step in the existing local-conformance
workflow. Two new independent checks in `ci-wiring-review.test.ts` pass: the command
includes all direct foundation implementation/review suites, and the CI step has
no conditional or continue-on-error bypass. The CI-wiring obligation above is now
closed at source level for these suites. This is not evidence that GitHub has run
the changed workflow, nor does it cover the separate real-PostgreSQL foundation
suite until that suite receives its own mandatory database job.
