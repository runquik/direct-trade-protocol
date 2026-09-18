# Independent foundation evidence-graph review

Date: 2026-09-12. Reviewer: `capability_audit`. Scope: coordinator-authored `sdk/scripts/foundation-gates.ts`, `docs/foundation/gates.json`, original graph tests, and the execution contract. This reviewer did not implement the evaluator or manifest. This is not independent approval of the reviewer's own baseline audit or of the whole F0 package.

Disposition: **FG-01 through FG-05 closed for the reviewed evaluator and current source-input boundary**. The existing nine coordinator tests passed previously, but nine new desired-invariant probes failed on the first independent run. The coordinator fixed those cases, and an independent combined rerun passed all 18. Further import-closure review then found three additional untracked dependencies; the coordinator added the complete profile directory and the independent combined rerun now passes all 21. No evaluator or manifest production fixes were made by this reviewer. The new probes use synthetic temporary graphs and artifacts; they do not write release evidence.

## Findings

### FG-01: unrelated-gate approval closes a finding (high)

An F9 persistence finding marked closed with `F0-tests` and `F0-review` is accepted and returns `ready: true` in an otherwise qualifying synthetic graph. The evaluator tests whether closure IDs passed and whether one is a review, but does not bind those checks to the affected gate. A baseline review cannot close a PostgreSQL isolation defect.

Reproducer: `a finding cannot close using an unrelated gate review and retest`. Required closure: explicitly affected-gate test and independent review evidence, fresh for that gate's source and dependencies. A broader integration review should not substitute silently; if supported, scope must be declared and validated.

### FG-02: closure needs no retest (high)

An F1 finding with only `F1-review` as closure evidence qualifies. Having a generic passed test elsewhere does not establish that this fix was retested. The closure contract requires both scoped retest and independent review.

Reproducer: `a finding requires a scoped retest as well as a scoped independent review`.

### FG-03: executable evidence can name nonexistent tests (high)

A manifest command `--test never-implemented.test.ts` plus a matching claimed observation qualifies even when that file does not exist or belong to the input hash. Exact comparison to the manifest command and a claimed runtime version prevent some accidental mismatches, but not dangling executable inputs.

Reproducer: `an executable check cannot name a missing test file while claiming a pass`. Required closure: concrete eligible test paths must exist as files and be included in the source fingerprint. Reject version-only or arbitrary non-test commands as acceptance tests. A later runner must record attempts and actual runtime/exit/test results; the current evaluator only evaluates submitted claims.

### FG-04: mandatory checks can be replaced by nominal smoke checks (high)

The graph protects gate IDs, dependencies and the existence of some test/review, but accepts replacing `F9-tests` with `F9-smoke` and a `--version` command. A manifest edit then permits a newly matching claim without preserving the minimum acceptance contract.

Reproducer: `mandatory acceptance checks cannot be replaced by a renamed smoke check`. Required closure: preserve mandatory per-gate check identities and eligible commands; additional checks may extend, not silently replace, that floor. The floor still needs human review against the plan: a test named acceptance is not proof it covers real PostgreSQL contention, measured load, restore or cold-builder requirements.

### FG-05: omitted inputs allow stale claims to remain current (high)

Independent synthetic copies of the actual manifest retain identical fingerprints when changing:

- F1's imported `sdk/src/canonical.ts` and `sdk/src/keys.ts`;
- F0's dependency lock `sdk/package-lock.json`;
- F0's runtime pin `.node-version`;
- the substantive `docs/foundation/baseline-audit.md` report.

All five fingerprint probes fail. This is not hypothetical import tracing: the new identity implementation imports canonical and key functions; the datatype implementation imports canonicalization. Hashing a gate's own file and declared graph dependencies is insufficient when common execution dependencies are absent.

Required closure: source-bind the complete reviewed execution boundary, including package/runtime/lock configuration, imported production helpers, test helpers, schemas/vectors, relevant adapters/workflows and the reviewed policy/audit artifacts. Include planned paths before they exist and retain missing-input failure. Avoid private collaboration notes or unrelated site data. Review the final closure, not merely these five sample paths.

## Reproduction and limits

From `sdk`, with both `STORE_URL` and `DTP_TEST_DATABASE_URL` unset:

```powershell
& 'C:/Users/runqu/AppData/Local/npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe' --test tests/foundation/gates-review.test.ts
```

Initial result: 9 tests, 0 passed, 9 failed, 0 cancelled/skipped/TODO; process exit 1. These intentional failures demonstrate gaps in the acceptance mechanism, not nine business-protocol implementation failures. The production manifest has omitted commands and missing planned files, so the actual foundation graph remains pending; no real release was falsely certified during these probes.

The existing implementation correctly attempts to prevent optional mandatory gates, weakened dependencies, self-review under the declared author roster, agents used as external builders, stale tracked inputs/artifacts, skipped tests, and reuse of a pass after a newer pending/failed attempt. These controls remain useful and should retain regressions.

The manifest's author roster and participant kind are assertions, not independently authenticated identities. A coordinator could falsely register an alias as an external person or omit an implementer. Code cannot discover that fact from this JSON alone. Real provenance, reviewer scope and an actual unfamiliar external builder must be checked outside this evaluator and documented. F10 currently lists all four agents as authors and no external participant; it must remain blocked until the required independent parties exist. Do not relabel an agent to manufacture completion.

A matching artifact digest proves which bytes were submitted, not that an asserted test or review actually occurred. A future execution runner must create a pending observation before runtime preflight, capture the actual command/runtime/result, fail closed on interruption or skips, and retain logs. Human review must still assess whether those tests cover the plan. The dependency graph is a coordination mechanism, not a security certificate.

## Closure status

After coordinator remediation, this reviewer reread the evaluator and reran `gates.test.ts` plus `gates-review.test.ts` under pinned Node v22.23.2, with shared database variables unset: **18 passed, zero failed/cancelled/skipped/TODO**.

- FG-01 and FG-02 closed for the reviewed evaluator: closure checks now require the affected gate and include both test and independent review.
- FG-03 closed for the reproduced evaluator path: declared concrete test files must exist, be regular files and belong to the gate's hashed inputs. Actual execution provenance remains a future runner requirement.
- FG-04 closed for the reproduced manifest weakening: mandatory `F*-tests`, `F*-review` and `F10-external` identities are enforced; supplied commands must use concrete `--test` paths. Semantic adequacy of each suite remains a human review responsibility.
- FG-05 partially remediated: original five fingerprint probes now pass. However, `sdk/src/v04/engine.ts` and `snapshot.ts` import `sdk/src/profiles/inventory.ts` and `invoice.ts`, which import `decimal.ts`; none was covered by the updated input manifest at follow-up inspection. Three additional probes reproduce unchanged fingerprints for those files. Follow-up isolated result: **9 passed, 3 failed, zero cancelled/skipped/TODO**. Source-coverage closure remains open until those execution dependencies are included and independently rerun.

These are scoped evaluator review results, not independent approval of the whole F0 package or this reviewer's baseline audit. No foundation gate, external-builder requirement, deployment or production data handling is approved here.

Final FG-05 follow-up: the coordinator added `sdk/src/profiles` to F0 inputs. This includes inventory, invoice and their decimal helper; the remaining external import is canonicalization, already source-bound. An independent rerun of both suites now reports **21 passed, zero failed/cancelled/skipped/TODO**, exit 0. FG-05 is closed for the present reviewed closure. Future production helpers, test runners, runtime configuration and executable adapters must extend the manifest and receive review before their gates qualify; this review does not preapprove future source coverage.

Role boundary: after this graph review, `capability_audit` was assigned implementation of the separate legacy-adapter exclusion. This graph review is not approval of that implementation or of any broader F0 package including it; another reviewer must inspect those changes.

## Independent CI runner-role and PostgreSQL wiring follow-up

Reviewed the coordinator's later `runner` participant kind, the allowed test-executor path in `foundation-run.ts`, and the new `foundation-postgres` job in `.github/workflows/protocol.yml`. Added two independent runner-role probes to `gates-review.test.ts` and two static workflow/source-binding probes in `foundation-ci-review.test.ts`. No evaluator, runner, workflow or database production changes were made by this reviewer.

Fresh combined graph, runner and new CI-wiring execution under Node v22.23.2: **41 passed**, zero failed/cancelled/skipped/TODO, exit 0. Synthetic all-green fixture evidence confirms a registered CI runner can supply tests, but cannot be a gate implementer, independent reviewer or external builder. Changing participant kind also invalidates prior fingerprints. This does not authenticate the real person behind a roster entry; the earlier provenance limits remain.

The new job uses a PostgreSQL image digest, synthetic credentials, the isolated `dtp_foundation_tests` database and port 15439 matching the guarded harness default. Read-only inspection of the locally installed image independently confirmed digest `sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73` and its packaged `PG_VERSION=17.11`. No image was installed, container started/stopped or live deployment changed by this inspection.

CI installs the SDK lockfile, selects `.node-version`, and executes the exact `F1-postgres-tests` declared command as actor `ci` without a skip/continue-on-error condition. The foundation evidence and run logs upload even on failure, with missing files an error. The workflow and concrete database test path are source-bound, and mandatory full `F1-tests` plus `F1-review` remain separate. No CI result for this new delta is claimed by static inspection; a frozen-source rerun and retained actual CI artifacts remain required. These changes invalidate earlier fingerprints and require fresh qualification after the source freeze.
