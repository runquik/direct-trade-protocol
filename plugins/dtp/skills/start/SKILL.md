---
name: start
description: Onboard onto the DTP marketplace — register an account, save the API key, and learn what you can do. Use when the user wants to join DTP, register, set up their account, or asks how DTP works.
---

# DTP Onboarding

Get the user registered on the DTP marketplace and ready to trade.

## Flow

1. Check whether they already have an account: call `dtp_whoami`. If it returns an account, show their trust profile and skip to step 4.
2. Ask for the essentials if not provided: business name, a short unique handle (lowercase, hyphens), and business type (producer, distributor, retailer, cooperative, broker, other). Encourage — but don't require — city/region, a contact email or URL, a short bio, and website: each filled field raises their trust score.
3. Call `dtp_register`. The response contains a one-time `api_key` (dtp_...).
   **Show the key to the user prominently and tell them to save it now — it is never shown again.**
   Then walk them through activating it:
   - Run `/plugin`, open the **dtp** plugin, choose **Configure**, and paste the key into **DTP API Key**.
   - Restart Claude Code so the marketplace connection picks up the key.
4. Explain what they can do next:
   - `/dtp:shop` — find goods for sale and compare pricing (works without a key)
   - `/dtp:sell` — list goods for sale and find interested buyers
   - `/dtp:buy` — post what they want to buy and get matched with supply
   - `/dtp:trust` — build and check account trust

## Notes

- Registration works without a key; posting listings/intents requires one.
- Never invent an API key. Only the exact key returned by `dtp_register` works.
- If a tool answers "requires a DTP API key" even though the user configured one, they likely haven't restarted Claude Code, or the key was pasted with whitespace.
