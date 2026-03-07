# DTP Finance Layer (v1)

Status: Draft implementation scaffold

DTP v1 finance is intentionally constrained for wholesale trade workflows.

The goal is to support payment terms without introducing marketplace complexity in the first release.

## Scope

DTP finance is currently scoped to **wholesale buyers and wholesale sellers**.

## v1 model

- Escrow remains the base settlement primitive.
- Buyers can select constrained net terms (0/30/45/60/90).
- Financing mode is either:
  - `escrow_only` (no external financer), or
  - `lp_pool` (single protocol LP lane in v1).
- Financing terms are recorded on-chain in intent/listing/offer/contract records.

## Why this shape

This keeps buyer UX simple, keeps seller economics predictable, and lets DTP collect repayment-quality data before opening lender routing and lender marketplaces.

## v2 direction (not in scope yet)

- buyer-selected funding partner
- multiple LP pools
- explicit pool risk tranching
- on-chain reputation scoring for payers and funders
- open funding marketplace
