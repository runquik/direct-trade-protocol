# Astra first pass, health check, and recommended fixes

> Historical baseline. The September 6 implementation status and remaining gaps are in [INFRA_HARDENING_2026-09-06.md](INFRA_HARDENING_2026-09-06.md). The diagnostic probes referenced below have been converted to secure-behavior regressions in `sdk/tests/07_infra.test.ts`. Also, the old fuzz suite's bulk JSON.parse-fault count was inflated by comparing JSON.stringify ordering to canonical ordering; that diagnostic is corrected. The separate minimal Node 24/25 round-trip reproducer remains independently reproducible.

Reviewed 2026-09-04 against commit `9187eb5`. This is the second review in the Codex conversation, requested after switching to Astra. Scope: v0.2 schemas, SDK, reference store, protocol guarantees, and readiness for Passport / Trade Ledger / Early Pay / Books. Legacy v0.1 contracts and MCP servers were not re-audited.

## Assessment

The v0.2 separation of signed records, company identity, module grants, and independent applications is coherent. Cryptographic validation, immutable stored versions, parameterized SQL, atomic record/event writes, and single-successor constraints are useful foundations. The standard suite passes.

The store is operational, but a passing conformance suite is not yet enough to trust every visible head as agreed commercial truth. The main additional finding is a **gap between authorship and agreement**: a signature proves who wrote one version; permissive subsequent revisions can retain an attested status while changing the terms that were attested. Early Pay and Books need explicit evidence-validation rules before they depend on these states.

| Dimension | Assessment |
|---|---|
| Security | Needs fixes: private identity reads and write-error metadata disclose information; module cursors use incomplete authorization. No new signature forgery demonstrated. |
| Correctness | Needs fixes: supersede retries, filtered pagination, and payment correction semantics; financial agreement semantics need specification work. |
| Performance / reliability | Adequate local baseline; request bounds and real multi-connection PostgreSQL behavior need further validation. No load test performed. |
| Maintainability | Strong shared schema/runtime structure, but auxiliary tests, status docs, and Codex's legacy MCP configuration have drifted. |

## Health results

All write-producing checks used fresh, local, in-memory PGlite stores. The retained Astra probes explicitly ignore `STORE_URL`. Live checks were three anonymous GETs only, on the URL documented in `progress.md`.

| Check | Result |
|---|---|
| Local `npm test` | 43/43 pass |
| SDK `tsc --noEmit` | Pass |
| `npm run build` | Pass; 33 schemas and 16 record types; no tracked content diff after regeneration |
| Live `/health` | HTTP 200; service 0.2.0 / protocol 0.2; server timestamp `2026-09-04T22:32:48.735Z` |
| Live `/schemas` | HTTP 200; expected 16 record types |
| Live `/companies/acme-sauce.dtp` | HTTP 200; current `core.company` head with one active key; confirms a database-backed read |
| Existing fuzz + race files, run independently via `node --test` | 33/37 pass; four failures explained below |
| New Astra diagnostic probes | 12/12 reproduce the behaviors described below; these are NOT 12 security passes |
| `check:examples`, `check:transitions` | Both fail because the referenced scripts are absent |
| Existing minimal JSON parser reproducer | Fault reproduced on Node v25.4.0: identical JSON parses to different property names after a preceding parse |

The existing auxiliary failures are three stale expectations about already-changed canonicalization/signing behavior (lone surrogates, BigInt error class, and `__proto__` tampering), plus a real genesis replay HTTP-status defect. The 5,000-case integer canonicalization comparison reported zero divergences on the inputs it compared, while separately reporting parser round-trip faults; it does not clear the runtime issue.

No authenticated live conformance suite, live adversarial writes, load test, deployment, dependency vulnerability scan, or real multi-connection PostgreSQL race test was performed. HTTP health alone would not prove database readiness, which is why the public company read was included. No production behavior was changed.

## Recommended fix order

P1 means fix before a dependent module is trusted with real company data or consequential decisions. P2 means important sprint reliability / hardening work. These are project priorities, not CVSS scores.

| Order | Priority | Work package | Evidence / boundary | Completion criterion |
|---|---|---|---|---|
| 1 | P1 | Apply visibility consistently to identity reads and write errors | A01, A05: confirmed disclosure | Anonymous and unrelated principals cannot read private company/module heads or learn counterparties, visibility, or successor IDs through rejected writes. |
| 2 | P1 | Make filtered pagination complete; authorize cursor metadata | A02, A03: confirmed | A narrow-scope module reaches every permitted record across pages, including after runs of hidden records; `latest_cursor` never points to a record outside its visibility. |
| 3 | P1 before Early Pay | Define immutable agreed terms and exact attestation evidence | A06, A07, A09: confirmed behavior, protocol design gap | Changing an attested quantity, contract, price, or evidence requires a fresh approval; consumers validate the precise signed evidence, not just head status. |
| 4 | P1 before Books | Enforce correction-only payment/settlement records | A08: confirmed semantic contradiction | `finance.settlement_event` cannot be superseded; corrections use new compensating records. Apply and test the corresponding rule for `trade.settlement`. |
| 5 | P2 | Fix exact-replay handling across all write endpoints | A04, A10: confirmed | Retrying an identical accepted genesis or supersede returns the existing record with 200 and creates no extra event, including after further supersession. |
| 6 | P2 before Passport custody | Add recoverable onboarding and last-root safeguards | A10, A11: confirmed operational gaps | A lost first response does not permanently strand a company whose private key is retained; ordinary key rotation cannot remove all active roots. |
| 7 | P2 | Specify and implement revocation/write ordering | A12: confirmed in-flight timing; policy-dependent | Define the acceptance point. If revocation must exclude later commits, synchronize authorization and revocation in the same transaction/locking protocol and test both orderings. |
| 8 | P2 | Qualify the supported Node and Deno runtimes | Existing minimal parser probe reproduces locally | Pin a tested runtime that passes the parser reproducer, vectors, and relevant fuzz tests; separately exercise the actual Deno deployment runtime. |
| 9 | P2 | Make verification and onboarding instructions dependable | Four auxiliary failures, absent scripts, stale docs/config | Auxiliary tests assert the intended secure behavior, referenced scripts exist or are removed, generated artifacts remain reproducible, and CI checks these paths. |
| 10 | P2 before wider exposure | Bound requests and validate PostgreSQL concurrency | Source review; no load or real-PG reproduction in this pass | Streaming byte/depth limits, safe errors and quotas appropriate to the service; multi-connection tests cover revocation, duplicate writes, and event consumption during concurrent commits. |

### 1. Privacy at every entry point — A01, A05

Sources: `supabase/functions/dtp-store/handlers/companies.ts:75`, `handlers/modules.ts:82`, `handlers/records.ts:242`, and `SPEC.md` §§3.3 / 3.7.

Both identity endpoints directly return their head without checking `canRead`. A01 creates private company and module records, verifies anonymous `GET /records/{id}` returns 404, then retrieves those same records anonymously through their identity endpoints. Default visibility is a recommendation, not an enforced public-only restriction. Preferred fix: reuse the common read-authorization path. Making spines always public would instead require explicit schema/API changes and migration treatment for already-private records.

A05 demonstrates a second route: an anonymous caller with its own valid signing key, knowledge of a private record ID/root/subject, and an intentionally wrong counterparty list receives the true counterparty list in `supersedes_conflict.details`. Continuity checks run before caller authorization. This is a targeted disclosure, not arbitrary UUID enumeration. Authenticate and authorize access before returning target-derived details; unknown and unreadable targets should be indistinguishable. Amend the mandated verification order in SPEC §3.3 as well, since it currently instructs the implementation to expose continuity errors first.

### 2. Pagination and event metadata — A02, A03

Sources: `supabase/functions/dtp-store/authz.ts:70`, `handlers/records.ts:378`, `handlers/events.ts:42`.

The SQL prefilter includes every namespace for a granted company and all `core.grant` rows; `canRead` applies the narrower type, expiry, private-visibility, and grantee rules afterward. A02 places hidden contracts before a public contract. Pagination terminates with no cursor before reaching the public contract, although direct GET succeeds. A03 shows `latest_cursor` naming a hidden contract after the same event has correctly been removed from the feed.

Prefer an exact, parameterized authorization predicate before `LIMIT` and `MAX`. Alternatively, scan until a full visible page or exhaustion, with rigorously specified cursor semantics. Test expired and revoked grants, private records, other modules' grants, an entirely invisible initial page, and several hidden pages. Define whether `latest_cursor` respects the optional company filter; it currently does not. Global numeric cursors also reveal sequence gaps, so do not promise complete traffic-volume confidentiality merely by fixing `MAX`.

### 3. Authorship is not agreement — A06, A07, A09

Sources: `supabase/functions/dtp-store/transitions.ts:101`, `spec/schemas/trade/fulfillment.schema.json:23`, `spec/schemas/common/attestation.schema.json:5`.

- A06: after a real buyer attestation, the seller supersedes the fulfillment, changes `contract_id` and `quantity_delivered`, preserves `buyer_attestation`, and keeps `status: buyer_attested`.
- A07: the seller moves a contract from `active` to `in_fulfillment` while also changing `total_value` from 5040 to 999999.
- A09: the buyer transitions a fulfillment to `buyer_attested` while leaving `buyer_attestation: null`.

The original signed versions remain intact and the later issuer is recorded correctly. These probes do not forge a buyer signature. They show that status and role-continuity rules do not freeze commercial terms or ensure that embedded attestations correspond to the current terms. Much of this follows the current permissive spec, so changing only the store would introduce a conformance mismatch.

Recommended design: define per-type immutable fields and transition-specific allowed changes, explicit amendment/reapproval flows, and structural conditions for attested statuses. Preserve each attestation's exact signed version. Supply a shared verifier for modules that checks signer ownership/authority, the attestation's claimed party, matching contract/quantity/terms, and required approvals. The store intentionally performs no body referential checks under SPEC §1; keep that boundary explicit, with richer verification in modules unless the protocol deliberately expands its guarantees. An Early Pay consumer must not advance money from `status` alone. A buyer-written transition with no inner attestation can still be cryptographic evidence of that transition, but the promised structured evidence contract is inconsistent.

### 4. Payment corrections — A08

Sources: `spec/schemas/finance/settlement_event.schema.json:5`, `supabase/functions/dtp-store/transitions.ts:96`, SPEC §§6.7 / 7.5.

`finance.settlement_event` describes an immutable movement corrected using `reverses`, but the generic no-status rule permits subject supersession. A08 replaces a 100-dollar mock payment with a 1-dollar version under the same root. Both historic versions remain, but a heads-only accounting reader sees the replacement amount.

Add explicit append-only-entity metadata and enforce it in the write pipeline; distinguish this from every *version* being immutable. Audit `trade.settlement` for the same issue. A ledger should process unique immutable movement IDs and compensating records exactly once, not infer movements from arbitrary latest heads.

### 5. Replay semantics — A04, A10

Sources: `supabase/functions/dtp-store/handlers/records.ts:242`, `handlers/records.ts:269`, `router.ts:89`.

A successful supersede makes its predecessor non-head. Reposting that exact envelope then fails at the head check before reaching idempotency. This makes a routine retry after a lost acknowledgment look like a competing write. Separately, identity handlers return `created: false` on a replay but the router always sends 201.

After signature/caller validation, recognize an already-stored identical payload before enforcing conditions that apply only to a new write. Preserve authorization and privacy for replay responses; never move an unauthenticated record-return shortcut ahead of access control. Specify behavior for retries after key/grant revocation. Correct both identity routes to select 200/201 from `created`.

### 6. Custody and recovery — A10, A11

Sources: `supabase/functions/dtp-store/handlers/companies.ts:28`, `handlers/records.ts:179`, `router.ts`.

The store hashes bearer tokens and returns them once. If the genesis transaction commits but its response is lost, a replay returns no token; the retained root private key has no challenge-based token recovery endpoint. A11 also confirms that a company can revoke its sole root, leaving no active credential. These are operational safety gaps, not unauthorized account takeovers.

For Passport, persist the private key before sending genesis, support proof-of-possession token rotation with short-lived, single-use, domain-bound challenges, and reject accidental removal/demotion of the last active root. Do not solve recovery by returning bearer tokens to anyone replaying a public genesis. If intentional company closure is needed, give it a separate explicit flow. Also clarify that delegate company keys currently have broad company authority outside `core.*`; they are not per-agent grant scopes.

### 7. Revocation semantics — A12

Sources: `supabase/functions/dtp-store/auth.ts:40`, `handlers/records.ts:109`, `handlers/records.ts:286`.

A12 uses real PGlite state and a wrapper that pauses only at the transaction boundary: authorize a module write, pause, commit grant revocation, resume the write. It succeeds after revocation. No stale rows or fabricated authorization result are injected. This verifies the interleaving the first review had only inferred.

This is not proof that a fresh request started after revocation is accepted. In-flight overlap can be legitimate if the documented linearization point is authorization. Decide that policy first. If the product promises that a completed revocation prevents subsequent commits, perform fresh authorization within a transaction and hold appropriate locks shared by revocation; merely moving a query inside a default transaction is insufficient. Cover key status, root-role demotion, grant expiry, revocation, and grant narrowing on real PostgreSQL too.

### 8–10. Runtime, test discipline, and deployment hardening

The minimal local parser reproducer changes a key from a control character to a backslash when parsing identical JSON after a specific preceding object. Treat this as a runtime qualification issue; it does not establish a signature bypass and was not reproduced on the deployed Deno runtime. Do not select a replacement Node version by assumption: run the reproducer on it. Existing fuzz output includes obsolete labels, so use assertions and raw reproducer output rather than its narrative claims.

Repair auxiliary expectations without weakening the actual canonicalization protections. Promote fixed security invariants into the normal suite; keep diagnostic probes clearly separate until converted. Add working examples/transition checks or remove the advertised dead scripts. Add a read-only CI build-drift check and actual PostgreSQL integration coverage. In particular, the current race test polls only after concurrent writers finish, so it does not establish that a consumer polling *during* commits cannot skip events; verify cursor ordering against commit visibility.

`router.ts:33` reads the entire request before its fallback size check, and compares string length rather than UTF-8 bytes. Bound the input stream before buffering/parsing and consider a nesting bound for recursive canonicalization. Reject invalid/fractional pagination arguments cleanly, handle malformed URI decoding inside the error boundary, and return generic client-facing internal errors. Choose rate limits/quotas for anonymous company registration and canonicalization based on the intended deployment. The prior review's resource-exhaustion claim is best treated as untested hardening work, not a reproduced denial of service.

Refresh README status to match the deployed store and 43-test baseline. Add concise repository guidance identifying v0.2 as authoritative. The existing untracked `.codex/config.toml` points at the frozen v0.1 NEAR MCP server; explicitly label or disconnect that legacy integration and add the intended v0.2 Passport surface when it exists. No configuration was changed in this review.

## Retained reproduction and handoff

The new local-only diagnostic file is [`sdk/tests/redteam/astra-pass.test.ts`](../sdk/tests/redteam/astra-pass.test.ts). Run from `sdk/`:

```sh
node --test tests/redteam/astra-pass.test.ts
```

Its 12 passing assertions demonstrate current behavior, including unsafe behavior. It is excluded from the normal suite and must be converted to rejection/invariant tests as fixes land. Existing auxiliary checks can be run together without shell short-circuiting:

```sh
cd tests/fuzz
node --test fuzz-canonical.test.ts fuzz-encodings.test.ts fuzz-signing.test.ts race-store.test.ts
node repro-v8-check.mjs v8-repro/polluter.min.json v8-repro/target.min.json print
```

Recommended implementation sequence: privacy and pagination; replay and Passport recovery; agreement/evidence and immutable payment rules; documented revocation ordering; test/runtime/operational follow-through. Passport implementation can proceed after its privacy, read-completeness, and custody prerequisites; Early Pay should wait for the evidence and accounting guarantees.
