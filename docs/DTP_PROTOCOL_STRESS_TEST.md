# DTP protocol stress test: plan and acceptance gates

September 10, 2026. **A first executable A/C/D boundary pass is now complete:** read [the results and all 28 case dispositions](DTP_STRESS_TEST_RESULTS_2026-09-10.md). The broader design below remains a proposed conformance experiment, not an agreed Boris sprint or a fully passed acceptance suite. Existing regression tests are listed separately in [the architecture review](DTP_ARCHITECTURE_REVIEW_2026-09-10.md).

## Purpose

Can an independently built app introduce a useful business capability, share precisely understood data under narrow authority, and survive replacement of its app or host without requiring private instructions from the original developer?

This tests the [whole-business architecture](DTP_BUSINESS_DOMAIN_MAP.md), not a polished workspace. Synthetic data only. No real workers, bank accounts, customer documents, payments, inventory commitments or executable third-party uploads.

## Scope and stages

1. Document current failures/unsupported cases before changing the protocol. A rejection may be correct for today's version and still expose a missing future contract.
2. Agree a written candidate core/profile contract and freeze an exact revision for independent implementation. Discussions are allowed, but semantic clarifications must become shared artifacts rather than private glue.
3. Run consumer/producer and host-replacement trials without reading the other implementation's private database or helper functions.
4. Apply adversarial variations and preserve expected vs observed results, gaps and explicit workarounds.
5. Decide the minimum next protocol revision. The workspace remains step two; no requirement to build a marketplace to pass step one.

Do not prescribe a one-week deadline or assign Boris's code ownership until he agrees. Distinguish collaborators from independent reviewers; two modules importing the same implementation helper do not establish independent conformance.

## Four deliberately different business fixtures

| Fixture | Scenario | Why it matters |
|---|---|---|
| A. Jerky brand inventory tool | Company-owned scanner records two lots, variable weights, cases containing eaches, a pallet split and a count correction; a second app derives authorized stock | Tests bring-your-own-app, units, product/lot/handling-unit identity, offline duplicates and reconstructible state |
| B. Co-packer to buyer | Packaging version and material lot feed a production run; output ships in two deliveries; buyer disputes a shortage; seller issues an invoice and credit | Forces cross-domain references, genealogy, custody/ownership distinctions, partial fulfillment and disputed evidence |
| C. Fractional CFO and workforce | A person belongs to three organizations; a team manager approves time; payroll consumes it; only permitted roles/employee can see compensation and personnel data; finance consumes an aggregate | Tests person vs employee identity, resource-level access, aggregate leakage, revocation and signed approval limits |
| D. Private extension and host exit | Company publishes a private custom scan/inspection schema; two modules use it; company moves from store A to B while a counterparty stays at A | Tests independent extension admission, private schema handling, host independence and continuity of business relationships |

Avoid building full applications. Command-line producers, a minimal independent reader, synthetic documents and deterministic fixtures are enough. Finance can optionally consume B/C's evidence; it must not impose lending-specific requirements on every other domain.

## Acceptance and attack matrix

Every row needs an executable check or an explicit design failure/unsupported result before broad conformance is claimed. The pass conditions below are **targets**, not descriptions of what the current implementation supports.

| ID | Probe | Required outcome |
|---|---|---|
| T01 | Publish a company-owned custom schema without editing the DTP central source tree | Admission/namespace rights are explicit; an authorized independent consumer resolves the pinned contract; no private field-name agreement |
| T02 | Attempt to redefine a standard invoice total or use an unsupported required extension | Reject the affected operation with a stable explanation; optional opaque retention never masquerades as understanding |
| T03 | Change schema bytes under a fixed version; malicious remote reference or recursive/oversized schema | Hash/version mismatch blocked; no arbitrary network fetch or executable validator; bounded resource use |
| T04 | Two consumers read different but declared compatible profile versions | Same defined business result or explicit incompatibility; no silent field loss or changed semantics |
| T05 | Scan duplicate offline events, resend after lost acknowledgement, reorder arrival | One intended effect, attributable attempts, business time preserved; conflicting observations not silently overwritten |
| T06 | Two modules reserve the same last ten cases simultaneously | Defined authoritative reservation boundary prevents double commitment or exposes explicit conflict; not merely two valid JSON writes |
| T07 | Change each/case conversion midway through a PO or repack a lot | Old agreement retains its exact pack version; no global conversion rewriting history; custody/aggregation/transform semantics distinguishable |
| T08 | Partial shipment, shortage, damage, return, credit, disputed quantity | Each assertion remains attributable; usable outstanding balances and inventory follow published rules, not a shared demo helper |
| T09 | Invoice arithmetic wrong, referenced evidence missing, foreign-owned evidence inaccessible | Distinguish shape, arithmetic, authority, reference and evidence failures; inability to inspect evidence is unknown, not validation success |
| T10 | Company changes terms/evidence after a quote or approval | Stale approvals cannot authorize materially changed effects; renewed approval binds the new exact versions |
| T11 | Switch a fractional CFO between organizations while requests are in flight | No stale data/actions/notifications cross context; every interface rechecks actor, company and scope |
| T12 | Employee requests own record, manager requests another team, general admin requests salary/medical detail | Only explicitly authorized compartments returned; company administration is not automatic sensitive-data access |
| T13 | Query dashboards, totals, search, AI context, errors and notifications for restricted HR data | No unauthorized payload or revealing metadata; small-group/inference controls where aggregates are disclosed |
| T14 | Revoke user/module while a job is queued, then retry a previously signed command | Future unauthorized execution blocked; committed effects reported truthfully; no duplicate external effect or false rollback |
| T15 | Turn forecast/LLM extraction/company claim into an asserted buyer attestation | Cannot manufacture counterparty authority; provenance and claim class persist end to end |
| T16 | Restart or remove a module while a request/approval is unfinished | Required shared business state reconstructs from authorized portable records; private keys do not transfer to the replacement |
| T17 | Independently verify a Financial Profile snapshot from published contracts | No dependency on the original module process or hard-coded demo signer; issuer trust, version, freshness and coverage evaluated explicitly |
| T18 | Import/export a company larger than one request; corrupt/drop/reorder chunks | Bounded resumable transport; integrity/completeness checks and an explicit checkpoint; no partial success labeled complete |
| T19 | Move one trading party to another host; leave partner and its records behind | Relationships remain resolvable under explicit cross-host trust/access; no fabricated local partner authority |
| T20 | Interrupt cutover or lose source host; attempt concurrent old-host writes | Defined recovery/cutover states; no silent split-brain or unconditional double activation; cooperative migration and disaster recovery tested separately |
| T21 | Export sensitive records, then revoke or apply a deletion/retention request | Correct authorized export and payload-retention behavior; no claim to erase recipients' copies; minimal audit provenance remains policy-aware |
| T22 | Publish a compatible but unreviewed module; update reviewed code with a new digest | Compatibility is not security approval; no automatic execution or inherited review; new privileges require fresh consent |
| T23 | Keep a module private, then choose community publication | No implicit source/schema/sample/company-data publication; only authorized release metadata changes visibility |
| T24 | Malicious module content instructs an agent to reveal secrets or approve a payment | Data is not authority; constrained operations and independent approval/egress enforcement withstand prompt injection |
| T25 | Run the same signed request through HTTP, optional MCP and a minimal manual client | Same capability and invariant checks; no privileged transport or workspace-only bypass |
| T26 | Forged/replayed usage receipts, retried failed jobs, price changes mid-operation | No automatic charge from a bare usage claim; distinct price agreement, authorization, measurement and settlement/correction |
| T27 | Export supplier/customer records with reused external identifiers | Issuer-scoped ID mapping prevents false merges; ambiguous matches require explicit resolution |
| T28 | Preserve employment dates across DST, currencies/rounding, unknown/withheld quantities | Same defined result across implementations; no timezone shift, implicit currency conversion or missing-as-zero behavior |

## Measurable deliverables

- A frozen input bundle and expected outputs/error codes for each selected case; all data clearly synthetic.
- At least two independently implemented consumers of one shared profile, with no direct source-code coupling.
- One third-party/private extension represented without a central code edit or silent `x_` business dependency.
- One unauthorized-access negative matrix spanning raw records and derived interfaces, including employee-level scopes.
- One host-replacement attempt that reports exactly what survives, what cannot continue, and why; federation/disaster recovery separately classified.
- A gap log with case ID, artifact revision, severity, observed result, workaround and proposed change. A failed test is useful evidence, not a reason to hide the gap.
- A compatibility report that names the supported core and profiles. No single undifferentiated "DTP compliant" badge.

Before claiming production readiness, add independent security review, real PostgreSQL and target-runtime concurrency, numerical load and recovery targets, abuse/quotas, custody/recovery, supply-chain/runtime isolation, applicable privacy review and a release/deployment manifest. Those are not satisfied by the architecture documents or today's local tests.

## Suggested first slice

Start with **A + C + D** as small contract fixtures: they most directly challenge the new requirements that the existing financing demo does not already exercise. Then use B to test multi-party evidence and lifecycle consistency. The first implementation need not complete every matrix row; the first review must assign every row a result or an explicit deferred gate.

The point is not to build a universal ERP. It is to find out whether the language can grow without either losing shared meaning or making DTP's operator the required middleman.
