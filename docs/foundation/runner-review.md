# Independent foundation test-runner review

Date: 2026-09-12. Reviewer: `capability_audit`. Implementer: `root`.

Scope: `sdk/scripts/foundation-run.ts`, its graph validation dependencies and `docs/foundation/runner.md`. This reviewer added `sdk/tests/foundation/runner-review.test.ts` and no runner or evaluator production fixes. Synthetic fixture repositories are used for all execution tests; real foundation/historical release evidence is untouched.

## Disposition and findings

**Reviewed local test-execution slice passes the independent checks after coordinator fixes.** This is not full F0/F10 acceptance, a security sandbox, proof of actual reviewer identity, or approval to execute real-database checks. The complete package tests and independent approvals remain separate.

1. **Runtime preflight before pending invalidation:** initial code inspected validated Node before writing a new attempt. That could leave an earlier pass latest on a wrong-runtime rerun. Coordinator moved validation after the pending write before the first independent test execution. The regression now passes: the earlier pass is not latest after simulated wrong-version preflight rejection. No executable child runs under the simulated wrong version.
2. **Ambient execution environment:** initial code inherited database targets and Node loader options. Coordinator added a small OS environment allowlist before the first independent test execution. Tests with synthetic `STORE_URL`, `DTP_TEST_DATABASE_URL` and a harmless `NODE_OPTIONS` preload prove these do not reach the child. No real connection or secret is used in the probes.
3. **Node option disguised as test filename:** `--import=./unhashed-preload.test.ts` initially passed the graph's `.test.ts` suffix check. Node interprets it as a preload option, not the source path being hashed. Independent `validate` regression failed, then the coordinator rejected leading `-` in declared test arguments. The regression now passes. Direct argv and `shell:false` are retained.

The third finding was reproduced as an acceptance-validator failure, not as a live exploit or external file execution. All three are closed for the current reviewed implementation.

## Execution evidence

Pinned Node executable:

`C:/Users/runqu/AppData/Local/npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe`

Initial independent runner execution after the first two coordinator fixes: 10 passed, zero skips. Adding the option-path regression produced 10 passed and 1 failed. After the option rejection fix, the combined original graph, independent graph and independent runner run passed **32 tests**, zero failed/cancelled/skipped/TODO. The 32 count does not include the coordinator's separate runner test file.

Latest independent rerun included both runner files and both discovery files: **45 passed**, zero failed/cancelled/skipped/TODO, exit 0. This includes 15 runner tests (4 implementer and 11 independent). These counts remain local implementation-slice evidence, not whole-gate acceptance.

Independent behavioral coverage includes:

- A child observes its own pending attempt before executing an assertion; the final log records exact executable/arguments, runtime, counts and source comparison.
- Failed runtime preflight invalidates prior success; actual test failures, skips and TODOs cannot produce a pass.
- Inherited database targets and arbitrary Node preloads are excluded.
- A real test that changes a source input still finishes failed even when its raw assertions pass.
- A second cooperative run cannot obtain the writer lock; an external evidence edit during a test is preserved rather than overwritten with a new pass.
- A junction/symlink output directory is rejected; the external disposable directory remains empty.
- More than 16 MiB of child output triggers failure while retained stdout/stderr stay bounded.
- Graph validation rejects a Node option masquerading as a test path.

All probes are local, disposable and bounded. The output-limit test does not wait for the two-minute deadline. No shared environment, PostgreSQL, Docker or deployment was used by these runner tests.

## Limits and follow-up obligations

- The runner executes reviewed local code with the process's filesystem/network permissions; an environment allowlist is not a sandbox. A deliberate real-PostgreSQL check will need a separately reviewed explicit disposable-target mechanism, not restoration of all ambient secrets.
- The lock coordinates cooperating evidence writers. A stale lock requires investigation, not blind deletion. The check-before-append detects the tested concurrent edit, but a malicious or noncooperating process replacing files during final filesystem operations is outside this locking guarantee.
- Input hashes before and after execution detect net changes. They do not prove no transient source edit was made and reverted during the run. Final qualification should use a frozen checkout or immutable CI snapshot with no simultaneous source writers, plus reviewed transitive input coverage.
- The timeout and output cap limit ordinary child behavior. Arbitrary untrusted test code or spawned process trees require stronger process isolation than this local helper; no hostile-child termination guarantee was tested.
- Logs prove the recorded bytes and actual runner result, not that test assertions fully cover the approved business contract. Human scope review and the mandatory whole-package test/review checks remain required. Actor rosters are reviewed claims, not external identity authentication.
- Helper checks remain implementation-slice evidence. The runner cannot author independent reviews or satisfy the external cold-builder requirement. No full gate evidence was recorded by this review.
