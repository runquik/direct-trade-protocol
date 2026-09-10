# Candidate acceptance scope and findings ledger

This is the coordinator's acceptance rationale, not an independently issued security certification. The machine-readable `v04-evidence.json` and `npm run release:report` determine whether the exact source inputs have fresh passing evidence. A source change invalidates downstream results. No merge or deployment is authorized.

## What is being accepted

| Gate | Reviewed acceptance boundary | Evidence required |
|---|---|---|
| G00 | `codex/dtp-v04-release`; existing implementation/demo dependencies preserved; private correspondence, local `.codex`, `progress.md` changes and nested vision site excluded from public commit | Git diff/status, plan, capability review |
| G01 | Explicit 0.4 wire domain, closed command shapes, bounded declarative profiles, threat model and compatibility boundaries | Spec/schema/vector parity, native crypto client, Deno/Node checks |
| G02 | Publisher-owned immutable profile identity; finite structural dialect; required semantics and dependencies cannot silently disappear | Profile/consumer tests, independent product review |
| G03 | Active person + company membership + whole-record resource policy + module authority intersection; governance alone is not data access | HTTP privacy, export/evidence, replay, derived-view and compartment probes |
| G04 | Exact invoice arithmetic and explicit unknown references; stock reservation/packaging/event invariants and retries | Pure property-style scenarios, two separately coded consumers, HTTP and PostgreSQL contention |
| G05 | Pinned short-lived host authority; one-hop-at-a-time relocation; deliberate recipient-bound historical evidence | Forged/stale/wrong-context negatives, third-host/multi-hop tests, evidence review |
| G06 | Stage/validate/reserve before source freeze; exact transfer recovery; private IP/policies/inventory preserved; installations disabled | Large HTTP transfer, corrupt/reordered chunks, collisions, capacity pressure, durable retry |
| G07 | Independently authored wire client and adversarial tests against reference implementation | Native crypto/raw HTTP, independent product/security probes |
| G08 | Pinned Node 22.23.2, Deno 2.9.6, real PostgreSQL 17, existing demos/regressions, generation parity and bounded resources | Executed logs with zero required skips; PostgreSQL CI artifact tied to source fingerprint |
| G09 | Reviewers did not approve only their own implementation; substantive findings reproduced/fixed/reviewed | Architecture, profile/security, validation/product and independent release-runner review artifacts |
| G10 | Reproducible candidate branch and inspectable evidence, no unexplained release-scope modifications | Independent handoff review and final graph report |

## Fix loop, with retained reproducers

| Finding | Resolution | Closure checks |
|---|---|---|
| Legacy source froze before a transfer could fit destination transport | Reject oversized v0.3 transfer before status change; use staged v0.4 path for larger state | historical-stress-regression, migration-http-tests |
| Inconsistent invoice arithmetic admitted | Exact-decimal validation on new v0.3 and v0.4 writes, without rewriting old signatures | historical-stress-regression, business-profile-tests |
| Private company metadata and write-replay disclosure | Membership-first metadata checks; minimal write receipts; current authority on replay | v04-core-http, independent-review-probes |
| Module could use an undeclared profile or wrong pool policy | Enforce exact release/profile/policy intersection, including all contributors to an inventory aggregate | independent-review-probes |
| General host trust could stand in for artifact assessor trust | Separate pins; exact artifact, live assessment and revocation checked on every module command | independent-review-probes |
| Migration lost uninstalled private IP, trusted unsigned projections or allowed namespace collisions | Complete signed snapshot contents, deterministic replay and reserved identities/aliases | migration-snapshot-tests, snapshot-adversarial-review |
| Destination ready did not reserve capacity for activation | Reserve completion/sequence capacity across writes; atomically replace staging with active state | migration-capacity-tests, migration-snapshot-tests, migration-helper-tests |
| Evidence omitted profile dependencies or relabeled issuer projections as validation | Bounded transitive definition closure; signed publication/schema checks; recipient recomputation and separate issuer projection | evidence-adversarial-review |
| Publisher-chosen reference name could imply understood business meaning | Explicit exact-profile reference pins; unreadable/missing stays unknown; contradictory parties remain errors | evidence-adversarial-review |
| PostgreSQL driver double-encoded serialized state | Bind serialized JSON as text before JSONB cast in both authority stores; assert native JSON object type and rollback | real-postgres |
| Failed runtime startup could leave an earlier release pass intact | Persist pending attempt before preflight; failed startup and invalid runtime/skip metadata fail closed | release-graph-tests |
| Unknown list profile looked like an empty company | Explicit unsupported-profile result, not a misleading empty success | independent-review-probes |
| Final safe inventory revision prevented a no-op retry | Check existing observation before rejecting exhausted capacity for a new effect | business-profile-tests |

The first PostgreSQL CI run, `34530098040`, intentionally remains a failed historical run. It exposed the JSONB storage defect. The subsequent `34530387940` PostgreSQL job passed after the binding fix. Later source changes require fresh CI and cannot inherit those runs as final evidence.

## Deliberate limits, not secretly green future features

This candidate does not deliver a deployed Passport workspace, hosted executable modules, a marketplace UI, malware screening service, billing, real-money financing, payroll computation or lockboxes. Those remain separately scoped products. It provides their shared authority/interchange boundaries.

People and companies are self-certifying protocol identities, not verified legal entities. The host and configured source peers remain trusted for custody, completeness and historical acceptance. No hostile-host consensus, global reservation/financing exclusivity, legal/compliance conclusion, all-keys-lost recovery, automatic 0.3-to-0.4 migration, high-throughput SLA or disaster-recovery qualification is asserted.

The two inventory consumer implementations are different code but share an author. The raw wire client has independent signing/canonicalization code and a different reviewer from the kernel implementer. Neither replaces a future cold integration by an external builder. The 28-case original stress proposal includes future UI/AI/executable-hosting work; a legacy GAP observation is not a passed candidate requirement.

HR/payroll payloads must remain synthetic. Whole-record policies are not encryption against the database operator or a retention/deletion implementation. Evidence is plaintext historical disclosure; expiry and revocation cannot retract downloaded bytes. Keep original signatures, unresolved evidence and issuer assertions visibly distinct in any future UI.

Existing local demo source is retained for reproducibility and regression testing; its previously reviewed UX is not rebuilt or newly production-qualified by this protocol release.
