# Sprint 01: Protocol Interop Test

**Participants:** George Milton, Boris Korsunsky
**Duration:** ~1 week (5 working days + kickoff)
**Status:** Ready for kickoff — store and spec v0.2 are built; see §3
**Repo:** `runquik/direct-trade-protocol` (protocol spec in [`SPEC.md`](../SPEC.md); this sprint runs off-chain)

---

## 1. Purpose

Test DTP's core claim — that **independently built apps can share company and trade state through protocol objects, with the spec as the only coordination channel** — and produce a concrete list of what the protocol is missing.

This is not a product sprint. The demo matters, but **the primary deliverable is the gap list**: every field, semantic, permission, or state the protocol lacks, discovered by two people building against it without talking to each other about data shapes.

### The hypothesis chain being tested

1. A company can onboard once (a minimal "spine") and then enter any number of apps at near-zero cost.
2. Data written by one module is readable and *actionable* by a module built by someone else, with no bilateral coordination.
3. The accreted protocol state is rich enough that a high-trust action (financing a receivable) can be taken instantly by a module that has never met the company.
4. The v0.2 schema (`core.*` spine/keys/grants, `trade.*`, a minimal `finance.*`) was shaped from prior-art research before the sprint; the remaining gaps probably cluster in evidence/documents, scoping edge cases, private data, and cross-record consistency — but we want the *empirical* list, not the predicted one.

## 2. Ground rules

These make the test valid. Breaking them invalidates the result.

1. **The spec is the only coordination channel.** No Slack/text/call about what a field means, what an object contains, or how a flow works. If it isn't answerable from the written spec, that's a finding.
2. **Log every gap; work around it visibly.** When a module needs something the protocol doesn't define, open an issue in the gap log (format below) and implement a clearly-marked local workaround (`x_` prefix on any nonstandard field). Do not silently extend the protocol.
3. **Each module is built by one person only.** George does not read Boris's code during the sprint, and vice versa. Interop happens through protocol state or not at all.
4. **Fake everything except the schema.** Made-up companies, fake KYB, mock funds. The schema and state machines are real; nothing else needs to be.
5. **Timebox to the week.** An unfinished module with a good gap log beats a polished module with none.

## 3. Sprint architecture

**Off-chain by design.** We're testing schema, semantics, and permissioning — not chain mechanics. Chain integration is a later, separate validation.

- **Protocol store:** the v0.2 reference store (`supabase/functions/dtp-store`) — a thin HTTP API over Postgres exposing signed, typed records with per-module grants and an event feed. It does validation, signature verification, authorization, and nothing else. **No business logic lives in the store**; if a module needs the store to do something more, that's a gap-log entry. Read [`docs/PROTOCOL_STORE.md`](PROTOCOL_STORE.md) first — it's the cold-read quickstart — then [`SPEC.md`](../SPEC.md).
- **Identity:** each company has Ed25519 keys (NEAR-compatible encoding); each module has its own keys and needs a `core.grant` from a company to act for it. Callers authenticate with a bearer token per key; every write is also signed. How scoping *should* work is itself under test — log what's wrong with it.
- **Objects:** the v0.2 record types in [`spec/schemas/`](../spec/schemas) (`core.*`, `trade.*`, `finance.*`, `traceability.*`). New objects only via the gap log, provisionally as `x_` fields.
- **Running it:** no Docker needed — `cd sdk && npm install && node scripts/dev-server.ts` starts an embedded-Postgres store; `npm run seed` loads the fixtures below; `npm test` runs the conformance suite against any `STORE_URL`. The shared hosted instance is on the existing Supabase project.
- **Fixtures (seeded):** `acme-sauce.dtp` (brand), `bluestem-dist.dtp` (distributor), `demo-fin.dtp` (financer) with module `demo-financing` already granted `trade read` + `finance write` by Acme; one `trade.contract` and a `trade.fulfillment` attested by both sides — an attested receivable exists on day 0.

## 4. The modules

Three modules. Each does a small set of things really well — a workflow, not an app.

### M1 — Passport (spine/onboarding) — *George*

Creates a company's protocol spine and proves the "onboard once" claim.

- Create company: legal entity info, locations, keypair, mock-KYB flag, delegated agent keys. Target: **under 5 minutes** of user effort.
- Grant/revoke a module's access to the company's data (the crude v1 of scoping).
- View "my protocol state": everything on-protocol about this company, by namespace — this view is also our accretion instrument (watch it fill up as M2/M3 run).

### M2 — Trade Ledger — *George*

Runs a trade between two spine-holding companies through the existing DTP state machine.

- Create a trade (as either a direct Contract or Intent→Offer→Contract, whichever the spec makes cheaper — note which).
- Advance it: accepted → fulfilled, with a **delivery attestation** recorded by the buyer side.
- Show trade state, readable by any authorized module.

### M3 — Invoice + Financing — *Boris*

Built with zero knowledge of M1/M2 internals. This is the interop test and the wedge test in one.

- Reads trades it did not create, for companies that authorized it.
- Issues an **invoice** against a fulfilled trade (`finance.invoice` exists in v0.2 but was written *without* a financing module's input — anything it lacks is a gap-log entry).
- The aha moment: for an attested receivable, offer an **instant advance** — one click, no intake forms — priced off protocol state alone (trade value, attestation, counterparty history, spine data). Mock the money; make the decision logic real enough to show *why* protocol state suffices where a factor needs a lockbox.
- Writes the advance and final settlement as protocol events that M1/M2 can display.

### Deferred (explicitly out of this sprint)

- **Deductions/dispute module** — the CPG-corridor killer demo (a short-pay as a protocol dispute object with evidence + a clock), but dispute machinery deserves design, not a sprint week.
- **Aging-inventory secondary market** — needs inventory objects; strong v2.
- Matching engine, escrow on chain, real KYB, FSMA CTEs, freight.

## 5. Demo narrative (the 90-second version)

> **Acme Sauce Co.** onboards via Passport in five minutes. It trades a pallet order with **Bluestem Distribution** in Trade Ledger; delivery is attested. Boris's Financing module — which has never met Acme, and whose builder never spoke to Trade Ledger's builder — sees the attested receivable and offers an advance in one click. Acme accepts. Both apps now show the same settlement state, and Acme's Passport view shows a company record that accreted from use, not from a form.

## 6. Success criteria

| # | Criterion | Verdict method |
|---|---|---|
| 1 | Spine onboarding ≤ 5 min; second-module entry ≤ 1 min | timed live |
| 2 | M3 reads and acts on M2's trades with zero out-of-band coordination | ground rule 1 held; gap log tells the story |
| 3 | Financing decision made from protocol state alone (no intake) | demo |
| 4 | Settlement event written by M3 renders correctly in M1 and M2 | demo |
| 5 | Gap log has ≥ 1 entry per predicted cluster (documents, scoping, private data) or documents why the cluster is empty | review |
| 6 | Every workaround is `x_`-prefixed and traceable to a gap entry | code review after sprint |

## 7. Gap log format

One markdown file in the repo (`docs/SPRINT_01_GAP_LOG.md`), append-only during the sprint:

```
## GAP-NN: <one-line title>
- Found by: <module> while <doing what>
- What's missing: <field / object / semantic / permission / state>
- Workaround used: <x_-field or local hack>
- Proposed fix: <schema addition, spec clarification, or "needs design">
- Severity: blocker | friction | cosmetic
```

Expected clusters (to be confirmed or refuted): generalized documents (invoice, BOL, credit memo), module authorization scopes (who may read Acme's invoices?), private-vs-shared data (the Phase 3 vault shows up the moment two apps share one company), event/webhook semantics (how does M3 learn a trade was fulfilled?), and state-ownership/accountability (when the invoice is disputed, which module owes the answer?).

## 8. Schedule

| Day | George | Boris |
|---|---|---|
| 0 (kickoff, ~1h) | Agree scope, hand over spec + store URL + fixture keys. Last free-talk day. | Same |
| 1 | Protocol store live with existing types; Passport started | Read spec cold; design M3 against it; log first gaps |
| 2 | Passport done; Trade Ledger started | M3: trade reading + invoice issuance |
| 3 | Trade Ledger through attestation | M3: financing decision + settlement writeback |
| 4 | Integration day — run the narrative end-to-end; fix only protocol-store bugs, not module bugs | Same |
| 5 | Record demo; consolidate gap log; each writes a 1-page "what the protocol needs" memo *before* comparing notes | Same |
| +1 (retro, ~1h) | Compare memos; agree spec changes; decide what's next | Same |

## 9. Deliverables

1. Working demo of the narrative in §5 (recorded).
2. `SPRINT_01_GAP_LOG.md` — the real output.
3. Two independent 1-page memos: "what the protocol needs to support modules," written before the retro.
4. A decision at retro: which gaps become SPEC.md changes, and what Sprint 02 is (candidates: deductions/dispute machinery, on-chain validation, third-party module test).

## 10. Open questions for kickoff

1. Fixture stack for the protocol store — Supabase (existing DTP infra) vs. something Boris prefers to hit?
2. Does M3 talk to the store via raw HTTP or an MCP server wrapper? (MCP wrapper is more agent-native and closer to production intent, but adds a day; raw HTTP is fine for the test.)
3. Naming of the fake companies and the trade scenario — CPG-flavored (brand ↔ distributor) or produce-flavored (grower ↔ buyer)? This quietly picks which corridor's semantics get stress-tested first.
4. Where does Boris file gap entries — PR to the repo, or shared doc mirrored in afterward?
