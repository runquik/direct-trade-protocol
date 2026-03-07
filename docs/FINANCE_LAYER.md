# DTP Finance Layer (v1)

Status: Draft implementation scaffold

DTP v1 finance is intentionally constrained for wholesale trade workflows.

The goal is to support payment terms without introducing marketplace complexity in the first release.

## Scope

DTP finance is currently scoped to **wholesale buyers and wholesale sellers**.

## v1 model

- Escrow remains the base settlement primitive.
- Buyers are not required to select a term; balances can be repaid at any time.
- Financing mode is either:
  - `escrow_only` (no external financer), or
  - `lp_pool` (single protocol LP lane in v1).
- Financing terms are recorded on-chain in intent/listing/offer/contract records.

## v1 LP finance policy defaults

For financed wholesale trades (`lp_pool`):

- LP yield target is fixed at 30% effective APR.
- Interest compounds daily.
- Buyer can prepay at any time with no prepayment penalty.
- Full payoff (principal + accrued interest + finance fees) is due by day 60.
- PACA-covered produce obligations are due by day 30.

This gives sellers immediate cashflow while keeping lender returns simple and legible. In all cases, maturity is deterministic: day 60 standard maximum, day 30 for PACA-covered produce.

## Why this shape

This keeps buyer UX simple, keeps seller economics predictable, and lets DTP collect repayment-quality data before opening lender routing and lender marketplaces.

## v2 direction (not in scope yet)

- buyer-selected funding partner
- multiple LP pools
- explicit pool risk tranching
- on-chain reputation scoring for payers and funders
- open funding marketplace
