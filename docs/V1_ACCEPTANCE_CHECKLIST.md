# DTP v1 Acceptance Checklist

## Objective
Provide a repeatable, artifact-based confidence pass for DTP v1 core behavior.

## Required checks

1. Contract compiles for NEAR target
- Command: `cargo check --target wasm32-unknown-unknown`
- Pass criteria: exit code 0

2. Unit validations pass
- Command: `cargo test`
- Pass criteria: all tests pass
- Must include finance/freight validation tests

3. Policy parity is documented
- File must exist: `docs/PARITY_AUDIT_2026-03-07.md`
- Must clearly separate enforced-now vs future-enforcement

4. Core v1 policy coverage
- Finance: `net_days <= 60` enforced
- PACA: `paca_covered => net_days <= 30` enforced
- Freight: allowance cannot exceed estimate
- Landed-cost guardrail blocks buyer-ceiling overflow on intent path

5. Known placeholders are explicit
- Escrow placeholder documented
- Settlement release placeholder documented
- Freight booking integration deferred but documented

## Runbook
Use `scripts/run_acceptance.sh` to execute checks and produce a one-file report.
