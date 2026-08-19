---
name: trust
description: Check and build account-level trust on the DTP marketplace — view trust scores and breakdowns, complete the profile, and endorse counterparties. Use when the user asks about their trust score, reputation, how to look more credible, or wants to vouch for or vet another business.
---

# DTP Trust Layer

Trust is a 0–100 score computed from four components. Tiers: 0–24 unproven, 25–49 emerging, 50–74 established, 75+ trusted.

| Component | Max | How to earn it |
|---|---|---|
| Profile completeness | 30 | contact, city, region, bio, website, legal name (4 pts each); years in business (3); certifications (3) |
| Longevity | 15 | account age up to 180 days (10) + years in business up to 5 (5) |
| Activity | 20 | active listings/intents (2 each, cap 10) + completed trades: listings marked `sold`, intents marked `fulfilled` (2 each, cap 10) |
| Peer endorsements | 35 | 7 per endorsement, capped at 5 endorsements |

## Checking trust

- Own account: `dtp_whoami` returns the full `trust_breakdown`. Point out the cheapest wins — usually unfilled profile fields.
- Others: `dtp_get_account` by handle returns their score, breakdown, and recent endorsements with notes.

## Building trust

1. `dtp_update_profile` — fill every empty field. This is the fastest gain for new accounts.
2. Mark real outcomes: `dtp_update_listing` status `sold` / `dtp_cancel_intent` status `fulfilled`.
3. Ask satisfied counterparties to endorse you; endorse them back with `dtp_endorse` and a concrete note ("Delivered 3 clean orders on time").

## Rules

- One endorsement per account pair, no self-endorsement — don't try to work around either.
- Only suggest endorsing accounts the user has actually dealt with. Trust signals are only worth what they honestly represent.
- MVP trust is self-attested plus peer-attested; there is no KYB verification yet. Say so if a user asks how much weight to put on a score.
