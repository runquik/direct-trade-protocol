# DTP v0.4 release loop

Initial status: **pending, not release-ready**. This log does not replace executable evidence.

## Loop 0: acceptance contract and validation setup

- Owner: coordinator, supported by architecture, profile and validation agents.
- Inputs: `docs/DTP_V04_RELEASE_PLAN.md` and the reproduced v0.3 business stress findings.
- Change: established required G00-G10 dependency graph, reproducible source-bound evidence, and independent review gates.
- Evidence: cached Deno2.9.6 hosted entry-point type check and legacy runtime probe succeeded in the capability audit. These earlier results are not automatically imported as candidate evidence.
- Open blockers: implementation and final tests incomplete; real PostgreSQL run pending; independent adversarial/review closure pending.
- Next loop: finish versioned contract and failing acceptance tests, implement connected slices, then record fresh evidence.

## Operating the graph

Run from `sdk/` with pinned Node22.23.2:

```text
node scripts/release-gates.ts validate --structure-only
node scripts/release-gates.ts report
node scripts/release-gates.ts loop --gate G08 --deno <path-to-pinned-deno>
```

`--structure-only` can succeed while release readiness is false. `report` and `validate` return nonzero unless every mandatory gate has fresh passing evidence and there are no unresolved blocking findings. `loop` runs executable checks in graph order only after their prerequisites are green, stops on a failed check, and never records skipped tests as passed. It does not modify product code, merge, deploy or repair infrastructure automatically.

Manual acceptance/review requires a named reviewer and an inspectable artifact:

```text
node scripts/release-gates.ts record --check scope-review --actor coordinator --artifact docs/reviews/dtp-next-validation-capabilities.md --summary "Reviewed scoped baseline; see artifact"
```

A successful `record` may still exit nonzero because the entire release remains not ready. Failed, blocked and skipped manual observations can be recorded using `--status`. A record is an attributable review assertion, not a cryptographic guarantee of reviewer independence or proof that the underlying report is truthful. Independent-review checks reject configured implementer identities; the coordinator still must verify the assigned human/agent actually authored the review.

The initial graph uses explicit pending manual acceptance checks for not-yet-created v0.4 suites. Before G08 closure, replace or supplement these with the real executable test files and runtime checks. Never invent nonexistent paths or turn the previous stress suite's expected GAP results into acceptance passes.

Generated observations are stored in `docs/release/v04-evidence.json`; command logs go under `docs/release/evidence/`. Those output files are excluded from source inputs to avoid self-invalidating evidence. Gate source hashes include its transitive dependency inputs and check definitions. Changing a schema, shared helper, check, or owned source invalidates affected downstream evidence. Changed evidence artifacts also invalidate their observations.

## Findings contract

The evidence document has a `findings` list. Each finding has `id`, `gate`, `severity` (`blocking` or `nonblocking`), `owner`, a concrete `reproducer`, `status` (`open` or `closed`), and `closure_checks`. A blocking finding remains open for release purposes until its closure checks have fresh passing evidence; simply setting `status` to `closed` cannot close it.

Append each real implementation/review cycle below with: source change, exact checks, observed outcome, new/closed findings, reviewer, and next dependency. No attempt limit or green majority terminates the loop.

## Validation loop 1: graph integrity and real HTTP migration

- Owner: validation reviewer.
- Changes: implemented the release graph/evidence runner and isolated validator tests; added real HTTP migration acceptance and real-PostgreSQL v0.4 contention/rollback tests. Executable gate mappings now reference files that exist.
- Executed: `node --test tests/release/release-gates.test.ts` (13 passed); `node --test tests/v04/migration-http.test.ts` (4 passed, zero skips, approximately 14 seconds); current TypeScript check passed; graph structure check passed while explicitly reporting `ready:false`.
- Iteration: the first HTTP run exposed a test expectation written for the earlier full append response. Updated the test to obtain original signed records through authorized `record.get`, matching the now-minimal mutation receipt. The second run passed all four scenarios.
- Migration evidence: genuine signed state larger than 1 MiB; missing/corrupt/out-of-order/duplicate chunks; readiness and cutover retries; durable finalize after two hours; untouched source on stale/expired readiness; partner left on source with fresh authority import; no counterfeit local partner; sensitive export requires steward signatures; destination privacy remains enforced; imported installations are disabled.
- Pending: PostgreSQL tests are authored and type-checked but have not run against a real server locally. Full candidate and independent review gates remain pending. These development results are not automatically inserted as fresh final-candidate evidence.
- Review handoff: another agent must review the release automation and its acceptance tests; authoring these files does not constitute independent signoff on them.

## Implementation and independent review loops

- The team implemented an isolated v0.4 contract, scoped company/person authority, bounded immutable profiles, exact invoice/inventory semantics, recipient-bound evidence, module admission and staged host migration. Existing v0.2/v0.3 wire domains remain distinct; this is not an automatic deployed upgrade.
- Reviewers exercised raw HTTP and separately coded native clients, malformed signed snapshots, private/derived data boundaries, profile dependency substitution, transport capacity and retries. Reproduced failures were fixed and added as regressions. Thirteen tracked findings have executable closure checks in `v04-evidence.json`; a closed label alone is insufficient.
- Independent review found derived-inventory profile leakage, unsupported-profile empty success, evidence/profile dependency weaknesses, migration capacity risks and terminal inventory-revision retry behavior. Different reviewers inspected the profile implementation and the release runner, including a regression preventing a failed runtime preflight from inheriting an earlier pass.

## Native database failure and repair loop

- The initial full CI run on `389bd0f` failed the native PostgreSQL path assertion. Passing memory-store tests did not establish correct PostgreSQL JSONB storage.
- Already serialized state now binds through `$1::text::jsonb`, avoiding the driver's second JSON encoding. Tests inspect native JSONB object type and paths, multi-connection contention, revocation, and exact retry after rollback. The corrected intermediate run passed, followed by complete final-source CI.
- Final source commit `8e5a380ab7f96c1df414500602fd861bff1baa4c` passed both jobs in [run 34531146470](https://github.com/runquik/portable-business-protocol/actions/runs/34531146470): 103 default tests, 116 candidate tests, 37 fuzz tests, 23 historical stress regressions, generation/type/runtime checks and 8 real PostgreSQL tests. These overlapping suites are not a count of unique independent scenarios. No required test was skipped.
- The downloaded PostgreSQL ZIP and exact command log hashes were independently checked against CI provenance. The original CI observation is imported without changing its source fingerprint. See `v04-ci-verification.json` and the preserved CI artifact.

## Final source-bound evidence loop

- A conservative source fingerprint initially differed locally because two preexisting ignored fuzz shrinker scratch files were present only in this worktree. Their exact files were preserved under `output/dtp-preserved-fuzz-scratch/`, outside test inputs and public release scope. The tracked minimized runtime fixtures were untouched.
- Local and CI G08 inputs now match `b9b514e47776ea255e1d68ac60e888ead1de5f216da217f83ffc150fc08cce0d`. All affected local executable checks were rerun successfully against that source, rather than relabeling stale results. The source-bound evaluator reports G00–G08 passed and zero open blockers; independent G09/G10 artifacts provide the final review decisions.
- `.gitattributes` preserves exact bytes under `docs/release/` so Git newline conversion cannot invalidate downloaded/generated evidence hashes on another checkout.
- Delivery is a reviewed release-ready branch only. No merge, deployment, production data processing or financial effect is part of this loop. Future production hardening and workspace/marketplace implementation remain explicitly outside this candidate's certification.
