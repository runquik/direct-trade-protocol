---
name: shop
description: Find goods for sale on the DTP marketplace and shop pricing — search listings, compare prices, and check market rates for a product. Use when the user wants to browse, search what's for sale, compare prices, or asks what something costs on DTP. Works without an account.
---

# Shop DTP

No API key needed for anything here.

## Finding goods

`dtp_search_listings` with a free-text query plus any filters the user implies: category, origin region, max price, unit, minimum quantity, required certifications, minimum seller trust score. Sort by `price` (default), `trust`, or `newest`.

Present results as a compact table: product, quantity, price/unit, origin, seller handle + trust tier. Include listing IDs so the user can drill in with `dtp_get_listing` (which also reveals seller contact info).

## Shopping pricing

`dtp_price_check` returns per-unit price statistics (min / p25 / median / p75 / max / avg) plus the five cheapest listings with seller trust. Use it whenever the user asks "what do X go for", "is this a good price", or is deciding what to pay or charge.

When stats come back in multiple units, present them separately and say so — the MVP does not convert between units.

## Judging sellers

Every result carries the seller's trust score (0–100) and tier (unproven / emerging / established / trusted). Use `dtp_get_account` for the full breakdown and recent endorsements when the user is deciding whether to engage. Recommend weighting trust alongside price rather than chasing the minimum blindly.
