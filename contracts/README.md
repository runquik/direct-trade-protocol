# contracts/ — DTP v0.1 on-chain reference (NEAR, Rust)

> **Status: v0.1, not v0.2-conformant.** Implements the v0.1 marketplace-pipeline objects (intents, listings, offers, contracts, fulfillment, settlement, lots, FSMA CTEs) and an audit-event log. Escrow lock/release are placeholders. Not deployed to mainnet.
>
> The current protocol is v0.2 ([`/SPEC.md`](../SPEC.md)); this contract is the starting point for the planned **on-chain store profile**. The field-level mapping between its types and v0.2 records is in [`docs/RUST_MAPPING.md`](../docs/RUST_MAPPING.md).

Build/test: `cargo test` (or `scripts/run_acceptance.sh` via Docker). Deploy script: `scripts/deploy-testnet.sh`.
