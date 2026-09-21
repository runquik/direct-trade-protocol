# Approved DTP foundation execution contract

The user approved the foundation update plan and an agent team on September 12, 2026. Execution is on `codex/dtp-foundation-update`, created from already-fetched main `755adcc`; its source tree matched the reviewed `5045e52` baseline. Main was not fetched or deployed in this run. Existing uncommitted work remains outside implementation ownership.

## Authorization and decisions

- Execute the approved plan through a reviewed release-ready branch. No merge, deployment, package publication, real sensitive data, purchases or production-provider enrollment is implied.
- The user explicitly approved synthetic user-controlled identity recovery using separately enrolled recovery keys and a replaceable trusted resolver, without unilateral reset by any host, resolver or workspace operator. NEAR remains optional and no production custody vendor is selected.
- First public release target: DTP 0.1.0. Historical v0.2/v0.3/v0.4 signed formats stay unchanged; changing a development label does not rename a signed identity.
- Every shared business action must pass the declared operation authority. Generic record append cannot bypass approvals or handler-owned state transitions.
- Trusted, finite semantic implementations may be admitted by a host operator; records and profiles cannot download or execute arbitrary code.

## Team and review ownership

| Work | Implementer | Independent review |
|---|---|---|
| Release graph and core integration | root | capability_audit; architecture review by release_architect where it authored no code |
| Shared datatypes and profiles | profile_contracts | release_architect |
| Architecture review recommendations | release_architect | root checks integration, capability_audit checks claims |
| Baseline validation audit | capability_audit | root cross-checks; audit is not independent certification of its own work |
| Final implementation | recorded per changed file | a reviewer who did not author those files |

An implementer may run tests and fix findings but cannot supply their own approval. Review comments and reproducer tests are not production fixes: if a reviewer implements a fix, that changed scope receives a different reviewer. The final gate needs a separate reviewer outside its listed authors; recruit that review rather than relabel an implementer.

## Graph and evidence

`gates.json` starts every approved work package unqualified. Planned source paths may be absent and must keep their gates pending. Missing implementations, stale dependency evidence, skipped tests and unresolved findings never produce readiness. `evidence.json` deliberately starts empty. No historical candidate green report is imported.

Work package source fingerprints include dependency inputs and the graph/evaluator definitions. Findings require a reproducer and independently reviewed closure. The graph evaluates submitted evidence; it cannot establish the real-world identity or truthfulness of a forged reviewer claim, and review artifacts remain subject to human inspection.

The external cold-builder gate requires explicit external participation and cannot be satisfied by an agent calling itself a third party. This is a remaining external dependency, not a reason to stop safe implementation of preceding packages.

## Current limits

System Node is outside the pinned project engine; validation uses the audited cached Node22.23.2 binary. The user separately authorized Docker startup and repair. Docker now runs after reversible runtime-socket backups. A dedicated loopback-only PostgreSQL17.11 container holds synthetic qualification fixtures, not the existing Supabase database. Real identity-locking/rollback tests have begun; full storage, load, restore and cross-host qualification are not yet certified. Each implementation package requires integrated tests and independent review before its stage is green.

The required development baseline, real-runtime tests, independent review, external integration, load and recovery gates remain open. No completion or production-readiness claim is made.
