# Independent release-ready handoff inspection

Reviewer: `capability_audit`. Date: 2026-09-10. Target source commit: `8e5a380ab7f96c1df414500602fd861bff1baa4c`, branch `codex/dtp-v04-release`, repository `runquik/portable-business-protocol`.

## Final disposition

**Approved for G10 release-ready handoff of the bounded reference candidate.** After the coordinator recorded G09, this reviewer independently reran the source-bound evaluator: G00–G09 all passed, each with no reasons; there were no open blockers; only G10 awaited this artifact. HEAD remains the exact source commit above, frozen source/review inputs are unchanged, and the staging index was empty. G10 fingerprint is `f63212249babd915b88163ba057e153799621fcccdb93732eac690dfb5ccc70e`.

The coordinator may record `release-handoff` as passed with actor `capability_audit` and this fixed artifact, then rerun the final report. The artifact is outside source/review input directories, so recording this conclusion does not invalidate its prerequisites. This is a review of the tested candidate, not authorization to merge or deploy.

## Independently verified CI

The GitHub connector returned both jobs in [run 34531146470](https://github.com/runquik/portable-business-protocol/actions/runs/34531146470) as completed/success. This reviewer fetched both job logs, not just the coordinator's summary. Both checkout logs identify the target commit above.

| Job | Observed evidence |
|---|---|
| `103051880091`, local-conformance | Build/generation checks, Node runtime, Deno 2.9.6 adapter/runtime checks, TypeScript, 103 default tests, 116 candidate tests, 23 historical stress tests, demo smoke and 37 fuzz tests passed. Every printed test summary has zero failures, skipped, cancelled and TODO cases. |
| `103051880379`, postgres-concurrency | Real PostgreSQL service reports version 17.11. The pinned Node 22.23.2 `real-postgres` check and evidence upload passed. The downloaded test artifact reports 8 passed, zero failed/skipped/cancelled/TODO, covering legacy and v0.4 contention, revocation and rollback. |

These suites overlap; their counts must not be summed into a claim of distinct independent scenarios. Historical stress GAP observations are regression evidence, not certification of future features.

The GitHub upload log identifies artifact `10173540275` and ZIP SHA-256 `2db0dafa10b1d63064ee6bbd1fa163cf262510d837f43fb78c5f443a0c3dd524`. This reviewer computed the downloaded ZIP hash independently and obtained the same value. The extracted observation's test-log hash is `67a178e9854c7afaf2ec5a4d01a276612c5b6ac16cdaabdbc2c667e3843899eb`; the copied log at its declared repository-relative path independently hashes to the same value. This provides traceable CI provenance without treating an unverified local assertion as a PostgreSQL run.

## Review independence and product boundaries

- Product/kernel/migration/builder contract approval is recorded in `v04-product-approval.md` and its source review. This reviewer independently reproduced the derived-inventory profile bypass and unsupported-profile empty-page defect, then independently reran the fixes. The final PostgreSQL CI evidence above closes the native JSONB-storage runtime condition left pending in that earlier review.
- `v04-independent-review.md` records the profile agent's independent kernel, evidence, snapshot, capacity and release-runner review. The runner's implementer did not self-certify it: a different reviewer authored the failed-runtime/stale-green regressions and inspected the fix.
- `docs/reviews/dtp-next-architecture.md` records independent inspection of the profile/decimal/invoice/inventory implementations and separate consumer, including the terminal safe-integer revision retry defect and its verified 23-test closure. The boundary argument and capacity checks are reviewed engineering reasoning plus bounded tests, not a machine-checked formal proof or universal safety claim.
- The candidate remains an isolated v0.4 reference implementation. Workspace login UX, hosted executable marketplace/security operations, money movement, production personnel data and hostile-host disaster recovery are not certified. Human/company identity is self-certifying protocol identity, not legal registration.

## Scope and preservation

At inspection, HEAD and branch match the target above and the staging index is empty. The commit diff includes protocol implementation, specs, conformance tooling and existing demo dependencies retained for reproducibility. It does not contain the untracked Boris correspondence context, nested vision site, `.codex` local state or uncommitted `progress.md` changes. Those remain outside this release's public scope. The workspace is intentionally not globally clean; unrelated user work is preserved, not reset.

No merge, deployment or production database action is authorized by this handoff. A later evidence-only commit may package the approved artifacts, but source changes require fresh downstream checks.

## Source-bound evidence reconciliation

Initial final-gate inspection found the CI G08 fingerprint differed from the local one despite clean tracked source. Two ignored local scratch files, `sdk/tests/fuzz/v8-repro/cand-polluter.json` and `cand-target.json`, were included by the deliberately conservative directory fingerprint and absent from CI. They are not the tracked `.min.json` runtime fixtures. The coordinator preserved their contents under `output/dtp-preserved-fuzz-scratch`, outside the hashed inputs and public commit scope. This reviewer then independently recomputed G08 and confirmed it equals the original CI value `b9b514e47776ea255e1d68ac60e888ead1de5f216da217f83ffc150fc08cce0d`; the CI observation was not relabeled. Affected local checks are being rerun rather than inheriting the old scratch-inclusive evidence.

**Closed:** this reviewer independently confirmed all G00–G09 green with current source fingerprints and artifact hashes, no open blockers, and unchanged scoped source before approving G10. The final PostgreSQL evidence also closes the runtime-pending condition in the earlier product review; historical review documents remain preserved as historical context.

## Evidence-only packaging conditions

An evidence-only follow-up commit may include this handoff, fixed approval/CI records, the original downloaded PostgreSQL evidence, generated gate observations and declared logs under `docs/release`, and the narrowly scoped `.gitattributes` rule preserving their exact bytes. Updated loop-log bookkeeping and the freshly regenerated synthetic `docs/stress-results/business-boundaries-current.json` are acceptable: the inspected stress-result diff updates execution times, actual source hashes and synthetic request observations, not protocol source. Do not include private/Boris context, nested vision-site work, `.codex`, `progress.md`, preserved scratch output or unrelated changes.

After packaging, confirm the commit changes only those intended evidence/byte-preservation paths and rerun the gate report. It must still show all G00–G10 passed with no open blockers and unchanged source fingerprints. An evidence-only commit will have a different Git commit ID than the tested source; describe that distinction honestly. Any executable/spec/review input change requires new downstream validation and review rather than carrying these observations forward unchanged.

The user selected a reviewed, release-ready branch. Merge, shared-backend deployment, production configuration and real-data use remain outside this approval.
