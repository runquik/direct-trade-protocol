# DTP Marketplace plugin

Buy and sell wholesale goods directly from Claude Code.

## Install

```
/plugin marketplace add runquik/direct-trade-protocol
/plugin install dtp@dtp
```

## Use

| Skill | What it does |
|---|---|
| `/dtp:start` | Register an account and set up your API key |
| `/dtp:shop`  | Find goods for sale, compare prices, check market rates (no account needed) |
| `/dtp:sell`  | List goods for sale, manage listings, find buyers |
| `/dtp:buy`   | Post buy intents, get matched with supply |
| `/dtp:trust` | Check and build your trust score, endorse counterparties |

Or just talk: *"what do organic blueberries go for?"*, *"list 500 lb of honeycrisp apples
at $1.90/lb"*, *"I need 200 cases of olive oil delivered to Austin by October"*.

## Account & key

Browsing works anonymously. To post, run `/dtp:start` — registration returns a one-time
API key. Paste it into `/plugin` → **dtp** → **Configure** → *DTP API Key*, restart
Claude Code, and you're live.

## What DTP is (and isn't, yet)

DTP is a two-sided marketplace protocol: sellers post **supply listings**, buyers post
**trade intents**, and a matching engine scores both sides on product, price, quantity,
certifications, and location. Every account carries a **trust score** built from profile
completeness, longevity, marketplace activity, and peer endorsements.

The MVP does not handle payment, escrow, shipping, or provenance — deals close directly
between the parties using the contact info on each account. Those layers (on-chain
settlement on NEAR, FSMA 204 traceability) are specified in the main repo and come later.
