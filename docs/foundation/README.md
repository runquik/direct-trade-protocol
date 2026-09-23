# DTP foundation update: implementation map

**Unreleased, under active implementation. Not a replacement public backend yet.** This branch strengthens DTP's reusable business meaning, explicit authority and reliable change propagation. The first public release target remains0.1.0; historical experimental signing formats are unchanged.

## Run the implemented slices

Use the pinned Node22.23.2 runtime, then from `sdk`:

```powershell
npm ci
npm run typecheck
npm run test:foundation
npm run foundation:report
```

The report is expected to exit nonzero until every required package has integrated acceptance and independent review. A passing helper test does not make the release ready. See [the runner contract](runner.md) for source-bound subcheck evidence. Real PostgreSQL tests live separately in `sdk/tests/foundation-postgres/`; they refuse non-loopback or differently named databases. See [local qualification](local-postgres-validation.md) before running them.

## What exists and what it proves

| Slice | Implemented boundary | Still required for package acceptance |
|---|---|---|
| Identity | Owner-approved resolver enrollment, separate recovery authority, transactional control history, lease drainage, exact retry acknowledgments; a separately reviewed person-command authentication adapter; a portable, replayable identity log, owner-signed moves between resolvers, their admission into the authentication adapter's durable checkpoint, adoption evidence for moves, destination refusals and owner push of the log (implementer-tested, not yet independently reviewed) | Complete authenticated host, service sponsorship and explicit legacy migration |
| Authority | Client mandate plus agency staff delegation, narrowing, cumulative ancestor budgets, exact-plan approvals; person consent to an organization genesis or governance transition and a replayable governance history (implementer-tested, not yet independently reviewed) | Verified live principals/approvals/accounting connected atomically to production command acceptance |
| Records | Bounded common identifiers, units, dates, unknown/withheld states and exact provenance references | Complete record/attachment/correction integration and cross-client contract fixtures |
| Semantics | Operator-pinned handlers, closed inputs/effects, exact CAS plans and required output validators | Host profile admission/governance, prerequisite grants and independently interoperable operations |
| Changes | Immutable snapshot plus catch-up, opaque view checkpoints, revocation/resnapshot, replay and honest freshness | Durable authorized outbox projections, host migration, retention/quotas and recovery |
| Discovery | Shared supply/demand contracts, minimums/maximums, exact units/prices, private-aware paging and authority locators | Authenticated feed admission, live provider checks and resolver relocation |
| Commitments | Provider capacity holds/confirmation, quote pins, partial delivery and failure-aware coordinator state | Real authenticated provider interaction, durable execution, consumptive goods semantics and cross-host failure recovery |
| Storage | Independently checked real PostgreSQL transactions for authority, revisions, resource CAS, receipts and an outbox; actual person signatures and SQL commit deadlines with other policy hooks still synthetic | Complete authenticated gateway, origin-policy revocation serialization, operational load/restore, migration and differential tests |

The prototype library hooks are **host implementation requirements**, not permission flags to trust from a submitted request. A signature attributes a statement; it does not prove physical delivery, inventory existence, legal lien priority, a bank balance or debt absence. No real money, payroll or sensitive employee data is used.

The latest frozen-source subcheck run passed280local tests and22separate real PostgreSQL tests, all without skips. These302test executions cover the declared implementation slices, not all acceptance requirements. Full Node typechecking and cached Deno2.9.6 checking of all ten foundation modules also pass. Five historical generators were rerun with no tracked output drift. See the per-check artifacts in `runs/` and the explicitly still-unqualified graph, rather than treating a test total as a readiness score.

## Review and completion

Each source owner has a different reviewer. Reviewers add adversarial tests and findings; the source owner fixes the defect, then the reviewer retests. Reports distinguish helper acceptance from integrated package acceptance. The [execution contract](execution-contract.md), [loop log](loop-log.md) and [approved plan](../DTP_FOUNDATION_UPDATE_PLAN_2026-09-12.md) govern scope.

Source changes invalidate dependent evidence. CI is a test runner, never an independent reviewer or an external builder. Remote CI execution, publication, merge and deployment have not been implied by local passing tests. An unfamiliar external builder must actually complete the published integration exercise; an agent cannot stand in for that person.

Workspaces, marketplaces and modules consume this foundation. None of them owns protocol identity, and none may require participating companies to keep their data on its host.
