---
name: sell
description: List goods for sale on the DTP marketplace, manage listings, and find buyers. Use when the user wants to sell, list a product, update prices or inventory, withdraw a listing, mark something sold, or see demand for what they sell.
---

# Sell on DTP

## Posting a listing

Gather before calling `dtp_post_listing` (ask only for what's missing):
- product name and category (produce, dairy, grain, meat, packaged, ...)
- quantity + unit (lb, kg, case, pallet, each)
- asking price per unit in USD

Optional but valuable: description (variety, pack format, specs), grade, certifications, origin city/region, available-from date, minimum order quantity. More detail means better matches and more buyer confidence.

Before posting, run `dtp_price_check` with the product name and tell the seller where their price sits against the current market (below median, above p75, etc.). Let them adjust before posting.

After posting, run `dtp_find_matches_for_listing` and present any buyers already looking for this product, including their trust tier and contact.

## Managing listings

- `dtp_my_activity` — show all their listings and statuses.
- `dtp_update_listing` — reprice, change quantity, or set status:
  - `withdrawn` to pull a listing
  - `sold` when the sale happened (this **raises their trust score** — remind them)
  - `active` to relist
- `dtp_search_intents` — scout open demand in their category even without a listing.

## Notes

- Prices are always per-unit USD. Quantities keep whatever unit the seller uses — never convert silently.
- DTP does not handle payment or shipping in the MVP. Deals close directly between the parties using the contact info on each account; say so if the user asks how to complete a sale.
