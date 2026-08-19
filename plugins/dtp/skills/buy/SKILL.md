---
name: buy
description: Post buy intents on the DTP marketplace and get matched with sellers. Use when the user wants to buy or source goods, declare what they need, set a price ceiling, or check matches on an existing intent.
---

# Buy on DTP

## Two ways to buy — pick based on urgency

1. **Search now** (`dtp_search_listings`, see /dtp:shop): if suitable supply is already listed, just show it.
2. **Post an intent** (`dtp_post_intent`): a standing declaration of demand that sellers discover. Post one when nothing suitable is listed yet, or the user wants ongoing sourcing.

Do both by default: search first, and if results are thin, offer to post an intent.

## Posting an intent

Gather (ask only for what's missing): product name, category, quantity + unit. Optional: ceiling price per unit USD, required certifications, delivery city/region, needed-by date. A ceiling price makes match scoring much more useful — nudge for it.

After posting, run `dtp_find_matches_for_intent` and present ranked matches with each score's reasons, the seller's trust tier, and contact info.

## Managing intents

- `dtp_my_activity` — show open intents.
- `dtp_find_matches_for_intent` — re-check supply any time; new listings appear continuously.
- `dtp_cancel_intent` — cancel, or set status `fulfilled` when the purchase happened (this **raises their trust score**).

## Presenting matches

Sort by score, but flag the trust tier of every seller. A cheaper offer from an `unproven` account is worth mentioning differently than one from a `trusted` account. Surface the reasons array — it says exactly why something matched or fell short (price over ceiling, missing certification, unit mismatch).
