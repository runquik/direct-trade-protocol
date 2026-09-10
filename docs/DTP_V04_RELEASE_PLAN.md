# DTP v0.4 release plan and closed-loop acceptance contract

September 10, 2026. Status is computed from the [release graph and evidence](release/v04-gates.json), not from this plan's prose. Run `npm run release:report` in `sdk`. This plan is the acceptance contract, not an approval certificate.

## Finish line

Deliver a reviewed, reproducible **release-ready branch**, not a merge or deployment. The user explicitly selected that boundary. Existing uncommitted work belongs to the user and must be preserved. No live HR records, financial commitments, public module uploads or production credentials enter the experiment.

The candidate adds explicit business profiles, scoped sensitive records and cooperative distributed-host continuity. It is an isolated v0.4 reference implementation, not a silent reinterpretation of v0.2/v0.3 signed history. A separately tested v0.3 guard prevents known oversized cutovers. The old demonstration remains functional.

“All green” means all mandatory candidate gates below have fresh passing evidence against the exact candidate inputs, no unresolved blocking review findings, and review of changes made after the last review. A test skipped for missing infrastructure is **blocked**, never green. Reproducing an old gap is not closing it. Production certification, a full module-hosting marketplace, real payroll/financing and independently authored third-party implementations are outside this release's claims, not obligations to be hidden as successful tests.

## Dependency graph

```text
G00 scope + capability baseline + preserved worktree
  └─G01 versioned contract / threat model / negative vectors
      ├─G02 bounded schema/profile admission + pinned negotiation
      │   ├─G03 sensitive compartments + derived/export boundaries
      │   └─G04 deterministic inventory + invoice/reference semantics
      └─G05 signed remote authority + recipient-bound evidence
          └─G06 staged large migration + ready/cutover/recovery
G02+G03+G04+G05+G06 → G07 independent-client adversarial scenarios
G00+G07 → G08 Node + Deno + real PostgreSQL + legacy regressions
G01…G08 → G09 independent security/form/function review
G09 → fixes → affected regressions + G07/G08 → independent re-review
G00…G09 → G10 exact-revision release evidence and handoff
```

The accompanying machine-readable release graph will map each requirement to owned files, executable checks and evidence. Every discovered defect becomes a node with severity, reproducer, owner and closure evidence. Changing a shared dependency invalidates downstream evidence until it is rerun. No arbitrary attempt count, token/time exhaustion, or green majority ends the loop.

## Work packages and acceptance gates

| Gate | Deliverable | Required positive and negative evidence |
|---|---|---|
| G00 | Worktree/branch baseline, exact tools and capability inventory | User changes preserved; no deployment; pinned runtimes; validation blockers explicit |
| G01 | v0.4 schema/spec, signing vectors, capabilities and compatibility declaration | Cross-domain command replay rejected; historical vectors unchanged; unknown action/critical profile rejected |
| G02 | Publisher-owned immutable profile contracts | Custom type without central edit; exact digest/version binding; no external schema fetch/eval; bounded depth/size; private definitions not implicitly public; two separate consumer implementations |
| G03 | Steward-controlled whole-record policies | Employee self/resource scopes; CFO across three orgs; human/module intersection; controller cannot read by governance alone; revoked/replayed reads fail; signed payload/audit/export do not bypass policy |
| G04 | Optional inventory and invoicing profiles | Scoped physical-event retry; conflicting observation ID; atomic last-stock reservations; pinned pack revision; partial fulfill/release; bad arithmetic rejected; missing/inaccessible reference explicit; late event not mistaken for allocation authority |
| G05 | Signed pinned remote-party authority and evidence | Partner remains on source; no fabricated local organization; wrong issuer/recipient/generation/destination/expired evidence rejected; unsupported or stale authority fails closed |
| G06 | Destination staging before irreversible source cutover | Transfer larger than request bound; duplicate/missing/corrupt/reordered chunks; destination ready only after validation; stale/expired readiness leaves source writable; source freezes once; activation retry safe; imported installations disabled; sensitive snapshot needs stewards |
| G07 | Adversarial business scenario suite | Required outcomes asserted (not preserved GAP successes); cross-company/compartment leakage probes; wrong audience/signature/context; replacement consumers reconstruct declared business meaning |
| G08 | Reproducible multi-runtime validation | TypeScript, schema/vector parity, default/fuzz suites, v0.4 scenarios, real PostgreSQL contention/rollback, Deno runtime checks, bounded local resource/large-transfer checks; no required skip |
| G09 | Independent review and fix loop | Security/correctness/operability and builder UX reviewed by agents other than implementer; blocking findings fixed and re-reviewed with evidence |
| G10 | Release-ready exact-revision handoff | Clean scoped commit/branch, all required graph evidence current, no unresolved blockers, support/limits/runbooks, explicit no merge/deploy |

## Agent ownership and loops

- Coordinator: core integration, specification/graph, authority boundaries, release decisions; never self-certifies independent review.
- Architecture reviewer: independent threat model, then bounded migration/federation helper implementation; its implementation must be reviewed by another agent.
- Business-profile implementer: pure exact-math and inventory/profile contracts and test fixtures; storage integration stays with coordinator.
- Validation reviewer: runtime/CI capability checks, release automation, then independent integration/adversarial review.

Use short vertical loops: **freeze contract → write failing acceptance → implement → run → adversarial review → reproduce/fix → rerun → record evidence**. Broad integration loops follow each connected component. Keep a human-readable loop log with changes, tests, findings and next blocked dependency. Escalate a real missing permission or design choice, rather than redefining the acceptance goal.

## Important design boundaries

1. v0.4 sensitive authorization is enforced by a trusted reference host over whole signed records. It does not claim secrecy from a malicious database administrator. At-rest custody and jurisdiction-specific privacy/retention review remain prerequisites for real employees.
2. Company governance and data stewardship are different. Creating/moving an organization does not grant plaintext export of its protected compartments. Full snapshots require explicit relevant stewardship approval and must include or fail, never silently omit operational state.
3. Generic extensions use a deliberately bounded declarative schema vocabulary and pinned dependencies. Unknown required semantics fail; known structural validation is not a claim of inventory correctness. No uploaded executable validators or network `$ref` resolution.
4. Remote authority relies on explicitly configured host pins and bounded freshness. It is not permission to impersonate a buyer, a global ledger or global exactly-once settlement.
5. Cooperative migration stages and validates at the destination before source freeze. Lost acknowledgement recovery must not reactivate both sides. Uncooperative-host disaster recovery is not silently equated with migration.
6. Private/community release metadata and security-assessment identity are protocol contracts; the actual scanner, executable sandbox, marketplace UI and billing engine remain later products.

## Initial evidence and open risks

- [Stress findings](DTP_STRESS_TEST_RESULTS_2026-09-10.md) are the input, not release evidence.
- [Independent architecture review](reviews/dtp-next-architecture.md) defines concrete pitfalls.
- [Validation capability audit](reviews/dtp-next-validation-capabilities.md): cached Node 22.23.2 and Deno 2.9.6 available; PostgreSQL must be proven through a disposable local instance or branch CI. No shared-backend smoke is authorized here.
- [Business profile API](reviews/dtp-next-profile-contract.md) separates pure validators from transactional enforcement.

Mandatory gates start **not green**. Only a fresh successful graph report, backed by inspectable execution logs and independent closure reviews, establishes candidate readiness. It does not grant merge, deployment or production approval.
