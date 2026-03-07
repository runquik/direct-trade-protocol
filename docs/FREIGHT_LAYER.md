# DTP Freight Layer (v1)

Status: Draft implementation scaffold

## Goal

Prevent landed-cost surprises and keep contract pricing executable for wholesale trades.

## v1 defaults

- Freight payer defaults to buyer.
- Project44 is the default live quote source.
- Freight can be booked at contract formation to lock delivered pricing and ship date.

## Landed-cost enforcement

For buyer-intent flows, acceptance checks use landed cost rather than FOB goods price alone.

`landed_total = goods_total + max(estimated_freight - freight_allowance, 0)` (when buyer pays freight)

Offer acceptance must fail if landed total exceeds buyer ceiling total.

## Data model

`FreightTerms` captures:

- payer
- estimated freight
- freight allowance
- quote source
- quote ref
- quoted timestamp and expiry
- booked-at-contract flag

## Why this shape

- Keeps v1 simple with one external quote source.
- Handles common distributor allowance patterns without building a separate freight marketplace.
- Gives a clean path to v2 where freight providers can participate as marketplace actors.
