# DTP — save point (2026-09-04)

*Read this first when picking the project back up. It replaces the March 2026 contract-era `task_plan.md` / `findings.md`.*

## Where we are

**The protocol is v0.2 — a company record protocol — and it is running.**

- `SPEC.md` v0.2: a company's signed, append-only record store; modules read/write under grants; namespaces `core`, `trade`, `finance`, `traceability`. A company has **no role** — roles (buyer, seller, financer, arbitrator…) are per record. `business_types` is optional, plural, descriptive only.
- Normative artifacts: `spec/schemas/**` (33 schemas, 16 record types), `spec/schemas/index.json`, `spec/vectors/**`. Generated: `spec/generated/`.
- Reference store: `supabase/functions/dtp-store` (Deno edge function; handlers are HTTP-agnostic and also run in Node). Schema `protocol` via `supabase/migrations/20260903000000_protocol_store.sql`.
- SDK + tooling + tests: `sdk/` (`npm test` = 43 tests; `node scripts/dev-server.ts` = no-Docker local store on PGlite; `npm run seed`; `scripts/keygen.ts`, `scripts/sign.ts`).
- **Live**: `https://vsuqtdofphppybkhnijg.supabase.co/functions/v1/dtp-store` on Supabase project ref `vsuqtdofphppybkhnijg` (being renamed from `dtp-marketplace` to `dtp` in the dashboard). 43/43 tests pass against it. Seeded fixtures: `acme-sauce.dtp`, `bluestem-dist.dtp`, `demo-fin.dtp`, module `demo-financing`, one contract + a fulfillment attested by both sides. Keys/tokens in gitignored `sdk/fixtures/dev-keys.json` (re-run `STORE_URL=… npm run seed -- --prefix <x>` if lost).
- Red-teamed (2026-09-04): cold black-box, white-box, and fuzz agents. All findings closed and covered by `sdk/tests/06_redteam.test.ts`; harnesses kept in `sdk/tests/redteam/` and `sdk/tests/fuzz/` (excluded from `npm test`). Details: `sdk/tests/redteam/FINDINGS-whitebox.md`, `sdk/tests/fuzz/FINDINGS-fuzz.md`.
- Docs for an outside builder: `docs/PROTOCOL_STORE.md` (quickstart), `docs/SPRINT_01_PROTOCOL_INTEROP.md` (sprint brief), `docs/SPRINT_01_GAP_LOG.md` (empty, append-only).
- Prior-art research that drove all of this: `research/` (8 dossiers + `SYNTHESIS.md` + `TIMELINE.md`).

## Sprint 01 with Boris (Gearkit)

Four candidate modules; each builder picks two. Success = sign up once / a stranger's module works without a conversation / a money decision from records alone / everyone sees the same truth / nobody saw or did what they weren't allowed to / a gap list, not just a demo. See the sprint brief §4–6.

| Module | What it does |
|---|---|
| **Passport** | onboard a company once; manage keys; grant/revoke module access; "my protocol state" view |
| **Trade Ledger** | buyer orders, seller ships and attests, buyer attests receipt |
| **Early Pay** | watches for attested deliveries, issues invoice, offers an advance from records alone, records payout/payoff |
| **Books** | read-only: who owes whom, paid/overdue, full history — assembled from others' records |

Hit list after: Inventory (with manufacturing = lot transformation), Reputation (derived, cannot self-grade), then Demand Plan, aging-stock marketplace.

## NEXT: build Passport (George's module #1)

Agreed shape for every module — **core library + MCP surface + minimal web page**:

1. `modules/passport/` — a small TypeScript package using `sdk/` (`DtpStoreClient`, `draft`, `signRecord`, `generateKeyPair`). Pure functions, no UI deps:
   - `onboardCompany({display_name, jurisdiction, locations, business_types?})` → generates root key, signs genesis `core.company`, `POST /companies`, returns ids + secret key + token (caller stores them).
   - `addKey` / `revokeKey` (supersede the spine with a root key; delegate keys for agents/NEAR sub-accounts).
   - `grantModule(company, module_id, scopes, expires_at?)` / `revokeGrant` (supersede the `core.grant` chain).
   - `myState(company)` → everything visible about the company, grouped by namespace + head/version counts, from `GET /records?subject=…` and `?counterparty=…` plus `GET /companies/{id}` and `/grants`.
   - Key custody for the sprint: a local encrypted-at-rest JSON file per company (mock KYB); note as a gap-log item.
2. **MCP server** exposing those as tools (`passport_onboard_company`, `passport_add_key`, `passport_grant_module`, `passport_revoke_grant`, `passport_my_state`, `passport_list_modules`) — reuse the stateless MCP-over-HTTP shim from `marketplace/server/dtp-mcp/index.ts:829-904` or `@modelcontextprotocol/sdk` stdio for Claude Code.
3. **Minimal web page** (plain HTML + fetch, no framework): the "my protocol state" view that fills up as other modules write; grant/revoke buttons.
4. Tests against the dev store (`storeUnderTest()` pattern from `sdk/tests/helpers.ts`); the demo narrative: onboard Acme in < 5 min → grant `demo-financing` → watch the drawer accrete.

Then **Trade Ledger** the same way. Start each module by reading `docs/PROTOCOL_STORE.md` cold and logging anything unclear in the gap log — George's builds count as gap-log input too.

## Phase 2 leftovers (none block the sprint)

- `spec/examples/**` + `sdk/scripts/check-examples.ts` / `check-transitions.ts`.
- Optional MCP surface over the store itself (`supabase/functions/dtp-store-mcp`).
- Report the V8 `JSON.parse` key bug found by the fuzzer upstream (`sdk/tests/fuzz/repro-v8-*.mjs`).
- Refresh the sprint one-pager artifact if it's going to be shared.
- Design `trade.dispute` (arbitrator as subject) — currently a documented gap in SPEC §3.5.

## Operational notes

- Deploy: `./sdk/node_modules/.bin/supabase functions deploy dtp-store --no-verify-jwt --use-api` (from repo root). **Check `supabase projects list` shows `vsuqtdofphppybkhnijg` first** — George has a second Supabase account and a login on the wrong one yields 403s.
- Migrations: `supabase db push`. Secrets already set (`SUPABASE_DB_URL`); the function derives the pooler URL from it.
- Always run `STORE_URL=<prod> npm test` after deploying; the local PGlite store cannot reproduce connection-pool or driver-format issues.
- Docker Desktop cannot be launched from Claude's sandbox; not needed (PGlite covers local dev).
