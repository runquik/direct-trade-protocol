# Independent G09 review closure

Reviewer: `capability_audit`. Approved 2026-09-10 for the bounded DTP v0.4 reference candidate, not production deployment or external security certification.

Exact reviewed source: `8e5a380ab7f96c1df414500602fd861bff1baa4c` on `codex/dtp-v04-release`. G09 source/dependency fingerprint: `303398adb09e045fc6d89366c901ff19c8a1bdd35171457741a939c0a94b2d04`.

## Independent disposition

After the final executable rerun finished and evidence writers stopped, this reviewer independently executed the release report. **G00 through G08 passed, each with no reasons; no open blockers remained.** G09 was pending this review and G10 was appropriately blocked on final handoff. The evaluator validated current input fingerprints, exact command/runtime metadata, zero required skips and artifact hashes. This review does not weaken those requirements or equate a green CI badge with complete release readiness.

The product/kernel/permissions/migration review in `v04-product-approval.md` is approved. This reviewer did not implement those components. Its independently reproduced inventory aggregate/profile-scope and unsupported-profile/empty-dataset defects were fixed by the implementation owner and independently rerun: 12 focused tests passed with zero skipped cases.

The separate `v04-independent-review.md` records the profile agent's review of other agents' kernel, signed evidence, snapshot and capacity code. It also supplies the independent review of this reviewer's release-runner implementation. Its independently authored regressions ensure failed runtime preflight supersedes prior successful evidence and successful executable observations require a pinned runtime and explicit zero skipped tests. The initial attempt is persisted before launching a runtime, so interrupted execution cannot retain a former green result.

The architecture review's final section, `docs/reviews/dtp-next-architecture.md`, independently examines the profile/decimal/invoice/inventory implementation and separate consumer. It records the final safe-integer revision retry defect, owner fix and independently rerun 23-test closure. No unresolved release blocker remains from that review. The stated limits remain: these are bounded code reviews and executable tests, not machine-checked formal verification, physical-stock proof or universal invoice/settlement semantics.

## Final CI and PostgreSQL closure

This reviewer independently fetched jobs and logs for [GitHub run 34531146470](https://github.com/runquik/portable-business-protocol/actions/runs/34531146470). Both jobs completed successfully and checked out the exact source commit above:

- `103051880091`: builds/generation parity, Node runtime, Deno adapter/runtime checks, TypeScript, 103 default tests, 116 candidate tests, 23 historical stress tests, demo smoke and 37 fuzz tests. Printed summaries show zero failures/skips/cancelled/TODO.
- `103051880379`: disposable PostgreSQL 17.11, pinned Node 22.23.2; eight real multi-connection tests passed with zero skipped cases, including native JSONB type/path checks, concurrent reservation/supersession, committed revocation visibility and post-update rollback. This closes the JSON-scalar storage defect left runtime-pending in the earlier product review.

The fetched GitHub upload log's ZIP SHA-256 matches the independently hashed downloaded artifact: `2db0dafa10b1d63064ee6bbd1fa163cf262510d837f43fb78c5f443a0c3dd524`, artifact ID `10173540275`. The preserved test log hashes to `67a178e9854c7afaf2ec5a4d01a276612c5b6ac16cdaabdbc2c667e3843899eb`, matching the original extracted observation. The original PostgreSQL observation was imported unchanged; its G08 fingerprint equals the independently recomputed local value `b9b514e47776ea255e1d68ac60e888ead1de5f216da217f83ffc150fc08cce0d`.

An initial fingerprint mismatch was correctly treated as a blocker, traced to two ignored old local shrinker scratch files, and resolved by preserving those files outside hashed inputs. Local checks were rerun against the resulting source rather than relabeling observations. The tracked runtime fixtures and source were not changed to manufacture a match.

## Approval scope

G09 may be recorded as passed for this exact fingerprint using reviewer `capability_audit` and this fixed artifact. G10 remains a separate final inspection. Source changes invalidate this approval through the graph; evidence-only packaging does not authorize broader changes.

No merge or deployment is approved. Private correspondence/Boris context, nested vision-site work, `.codex`, unrelated `progress.md` edits and preserved scratch data remain outside the release commit scope. Production key custody, backup/disaster recovery, real personnel-data governance, hosted executable security, marketplace operation, financial rails and deployment approval remain separate work.
