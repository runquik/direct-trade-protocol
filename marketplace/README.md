# DTP Marketplace — Claude Code MVP

This directory is the **productized MVP** of the Direct Trade Protocol: a live, shared
marketplace accessible from Claude Code through the plugin in [`plugins/dtp`](../plugins/dtp).

**MVP scope** (deliberate): buy/sell intent listing, search, price shopping, and
account-level trust. **Stripped for now**: on-chain settlement, escrow/payment, offers and
contracts, freight/shipping, provenance/FSMA CTE tracking. The NEAR contract and the
original MCP servers remain in the repo as the protocol's longer-term direction.

## Architecture

```
Claude Code (any user)
   │  installs plugin:  /plugin marketplace add runquik/direct-trade-protocol
   │                    /plugin install dtp@dtp
   ▼
plugins/dtp  ──  skills (/dtp:start /dtp:shop /dtp:sell /dtp:buy /dtp:trust)
   │             + remote MCP server declaration (.mcp.json)
   ▼  HTTPS (streamable HTTP MCP, JSON-RPC)
Supabase Edge Function `dtp-mcp`         ← server/dtp-mcp/index.ts
   │  https://qhlgjbzsbrmtvtovrtsd.supabase.co/functions/v1/dtp-mcp
   ▼
Postgres schema `dtp`                    ← migrations/001_mvp_schema.sql
   accounts · listings · intents · endorsements
```

The shared Postgres database is what makes it a marketplace: every plugin install talks to
the same backend, so one user's listing is another user's search result.

## Auth model

- **Anonymous**: search listings, search intents, price check, view accounts/listings/intents, register.
- **API key** (`Authorization: Bearer dtp_...`): post/update listings and intents, endorse, whoami.
- Keys are issued once by `dtp_register` and stored as SHA-256 hashes. Users paste the key
  into the plugin's `DTP API Key` setting (`/plugin` → dtp → Configure).

## Trust layer (v0)

0–100 score, computed live: profile completeness (30) + longevity (15) + activity (20)
+ peer endorsements (35). Tiers: unproven / emerging / established / trusted.
Self-attested + peer-attested only — KYB/credential verification is the next layer.

## Tools (17)

`dtp_register, dtp_whoami, dtp_update_profile, dtp_get_account, dtp_endorse,
dtp_post_listing, dtp_update_listing, dtp_get_listing, dtp_search_listings,
dtp_post_intent, dtp_cancel_intent, dtp_get_intent, dtp_search_intents,
dtp_price_check, dtp_find_matches_for_intent, dtp_find_matches_for_listing,
dtp_my_activity`

## Redeploying the server

The edge function is deployed on the Supabase project `qhlgjbzsbrmtvtovrtsd`
(function name `dtp-mcp`, JWT verification off — the function does its own API-key auth).
After editing `server/dtp-mcp/index.ts`, redeploy with the Supabase CLI:

```bash
supabase functions deploy dtp-mcp --project-ref qhlgjbzsbrmtvtovrtsd --no-verify-jwt
```

(or via the Supabase MCP `deploy_edge_function` tool).
