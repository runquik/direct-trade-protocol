# DTP Getting Started Guide

**Direct Trade Protocol** lets businesses buy and sell physical goods directly through Claude, with on-chain settlement on NEAR Protocol. No dashboards, no portals — just tell Claude what you need.

## Connect to DTP

1. Go to [claude.ai](https://claude.ai)
2. Open **Settings > Integrations** (or click the integrations icon in the sidebar)
3. Click **Add more integrations** then **Add custom MCP server**
4. Enter the URL: `https://humble-luck-production-97d1.up.railway.app/mcp`
5. Click **Add**, then authorize when prompted

You now have 29 trade tools available in any Claude conversation.

## Step 1: Create Your Organization

Every business on DTP needs an organization. This creates a NEAR testnet account and registers your company on-chain.

> **You:** Create a DTP organization called "Sunrise Produce" as a producer in the US.

Claude will call `dtp_create_org` and you'll get back your org name, NEAR account ID, and admin status.

### Check your identity anytime

> **You:** Who am I on DTP?

## Step 2: Post a Supply Listing (Sellers)

If you have goods to sell, post a listing:

> **You:** Post a DTP listing for 500 lb of Organic IQF Blueberries, USDA Fancy grade, packed in 30 lb cases. Price at $2.80/lb. Available from April 15 through May 15, delivering to Portland, OR 97201.

Claude will ask for any missing details and create the listing on-chain.

## Step 3: Post a Trade Intent (Buyers)

If you need to buy something, post an intent:

> **You:** I need 200 lb of organic blueberries, any grade A or better, delivered to Seattle, WA 98101 by May 1st. My ceiling price is $3.25/lb.

## Step 4: Find Matches

DTP's on-chain matching engine scores listings against intents by category, quantity, location, price, and delivery window.

> **You:** Find matches for my blueberry intent.

Or from the seller side:

> **You:** Are there any buyers looking for blueberries?

## Step 5: Make an Offer

Once you've found a match, submit an offer:

> **You:** Submit an offer to that buyer's intent — 200 lb of Organic IQF Blueberries at $3.00/lb, delivered by April 28.

## Step 6: Accept an Offer

The counterparty reviews and accepts:

> **You:** Show me my pending offers. Accept the one from Sunrise Produce.

Accepting locks escrow on-chain. A trade contract is now active.

## Step 7: Get Shipping Quotes

Once a contract is formed, get freight quotes:

> **You:** Get shipping quotes for my blueberry contract.

DTP queries Shippo for parcel rates. You can then book a label:

> **You:** Book the USPS Priority Mail rate.

You'll receive a tracking number and label URL.

## Step 8: Deliver and Settle

**Seller attests delivery:**

> **You:** Attest that I've delivered 200 lb for contract C-001.

**Buyer confirms receipt:**

> **You:** Confirm I received the blueberries for fulfillment F-001.

Buyer confirmation triggers automatic settlement — escrow is released to the seller.

---

## Team Members

Admins can invite team members who trade on behalf of the organization:

> **You:** Generate a DTP invite code.

Share the 8-character code. Your teammate connects the same integration and joins:

> **You:** Join DTP organization with invite code `A3F8K2M1`.

### Trade Limits

Admins can set guardrails:

> **You:** Set trade limits to $5,000 per trade and $20,000 per day.

## KYB (Know Your Business)

For verified trading, submit your business identity:

> **You:** Submit KYB for "Sunrise Produce LLC", EIN 12-3456789, jurisdiction US.

---

## Complete Trade Flow

```
Seller                              Buyer
  |                                   |
  |  1. dtp_create_org                |  1. dtp_create_org
  |  2. dtp_post_listing              |  2. dtp_post_intent
  |                                   |  3. dtp_find_matches_for_intent
  |                                   |  4. dtp_submit_offer
  |  5. dtp_accept_offer              |
  |     (escrow locked)               |
  |  6. dtp_get_freight_quotes        |
  |  7. dtp_book_shipment             |
  |  8. dtp_seller_attest_delivery    |
  |                                   |  9. dtp_buyer_attest_delivery
  |                                   |     (settlement auto-triggered)
  |  $$ released from escrow $$       |
```

## All Tools

| Tool | Who | What it does |
|------|-----|--------------|
| `dtp_create_org` | Anyone | Create an organization (NEAR account + on-chain Party) |
| `dtp_join_org` | Anyone | Join an org with an invite code |
| `dtp_whoami` | Member | Show your identity, org, and role |
| `dtp_org_info` | Member | View org details, members, limits |
| `dtp_invite_member` | Admin | Generate an 8-char invite code |
| `dtp_remove_member` | Admin | Remove a team member |
| `dtp_set_trade_limits` | Admin | Set per-trade and daily dollar limits |
| `dtp_submit_kyb` | Admin | Submit legal business identity |
| `dtp_upload_business_docs` | Admin | Upload formation documents |
| `dtp_post_listing` | Seller | List goods for sale |
| `dtp_withdraw_listing` | Seller | Remove a listing |
| `dtp_get_listing` | Anyone | View listing details |
| `dtp_post_intent` | Buyer | Declare intent to purchase |
| `dtp_cancel_intent` | Buyer | Cancel an intent |
| `dtp_get_intent` | Anyone | View intent details |
| `dtp_find_matches_for_intent` | Buyer | Find listings matching an intent |
| `dtp_find_matches_for_listing` | Seller | Find intents matching a listing |
| `dtp_check_match` | Anyone | Score a specific intent/listing pair |
| `dtp_submit_offer` | Either | Make an offer on an intent or listing |
| `dtp_retract_offer` | Offerer | Withdraw an offer |
| `dtp_get_offer` | Anyone | View offer details |
| `dtp_accept_offer` | Counterparty | Accept offer, lock escrow, form contract |
| `dtp_get_contract` | Anyone | View contract details |
| `dtp_get_freight_quotes` | Either | Get Shippo shipping rates |
| `dtp_book_shipment` | Either | Purchase a shipping label |
| `dtp_seller_attest_delivery` | Seller | Attest goods have been shipped |
| `dtp_buyer_attest_delivery` | Buyer | Confirm receipt, trigger settlement |
| `dtp_get_fulfillment` | Anyone | View delivery record |
| `dtp_get_settlement` | Anyone | View settlement details |
| `dtp_register_party` | Member | Register as on-chain trading party |
| `dtp_get_party` | Anyone | View party registration |
| `dtp_get_account_summary` | Anyone | Full on-chain account summary |

## Notes

- This is running on **NEAR testnet** — no real money is involved.
- Each organization gets its own NEAR sub-account under `direct-trade-protocol.testnet`.
- Prices are in US dollars. On-chain storage uses microdollars (1 dollar = 1,000,000 microdollars).
- Shipping labels are from Shippo's test environment — watermarked, not real.
- Two companies trade by each connecting the same DTP integration and interacting through Claude. The NEAR blockchain is the shared state — no direct connection between the two Claude sessions is needed.
