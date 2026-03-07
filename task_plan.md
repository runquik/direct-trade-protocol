# DTP Hardening Plan — 2026-03-07

## Goal
Get DTP from strong v1 design to executable confidence by aligning spec↔contract behavior and adding repeatable validation.

## Phases
- [in_progress] Phase 1: Spec ↔ contract parity audit (finance + freight + core flow)
- [pending] Phase 2: Build/test environment recovery (local rust toolchain or container fallback)
- [pending] Phase 3: Add scenario tests for end-to-end v1 paths and edge cases
- [pending] Phase 4: Ship acceptance harness + pass/fail report
- [pending] Phase 5: Final gap list and v1 readiness call

## Deliverables
- `docs/PARITY_AUDIT_2026-03-07.md`
- test artifacts under `contracts/`
- `docs/V1_ACCEPTANCE_CHECKLIST.md`
- commits with hashes per phase

## Risks
- Rust toolchain unavailable on host
- Spec drift due to fast policy iteration
- Placeholder escrow paths giving false confidence

## Success criteria
- Every major v1 policy is tagged enforced-now or future-enforcement
- Contract compiles and tests pass in repeatable environment
- Acceptance checklist can be rerun and produces deterministic outcomes
