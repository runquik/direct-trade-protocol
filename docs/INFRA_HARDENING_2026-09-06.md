# Infrastructure hardening: implementation and remaining gates

This is the first implementation batch after the Astra review. It targets the v0.2 reference store, SDK verification tooling, and the current interoperability sprint. It does not deploy or mutate existing stored records.

## Implemented

- A01/A05: visibility applied to company/module spines, private identity replays and supersession target errors. Anonymous requests receive no target details; unreadable and nonexistent targets have the same response.
- A02/A03: exact read predicates precede LIMIT and MAX, including type scopes, expiry, private records and grantee-only grants. Event `latest_cursor` uses the optional company filter too.
- A04/A10 (retry portion): authorized exact replays return 200, including supersedes after later versions and concurrent identity replays. Replays create no extra event and do not remint secrets.
- A06/A07/A09: immutable contract/delivery terms; seller and buyer attestations identify exact signed versions. Buyer evidence and established deductions cannot be silently rewritten. Invoice and advance/offer commercial terms also freeze at their documented points.
- A08: finance movement and trade settlement entities cannot be superseded. Correction/compensating entities preserve history.
- A11: last active root cannot be revoked, removed or demoted. Duplicate key IDs cannot bypass this.
- A12: the HTTP write boundary serializes appends through a transaction-scoped advisory lock and refreshes bearer identity, key role and grants inside it. Revocation ordering and commit-ordered cursor allocation are explicit.
- Finance-specific regressions: borrower cannot rewrite an advance under unchanged status; seller cannot clear or reassign an already-assigned invoice; buyer cannot assign it during acknowledgment; accepting an advance offer cannot alter its price.
- HTTP hardening: streamed UTF-8 byte limit (also in local server), nesting bound, safe integer query parameters, malformed path handling, and generic internal error responses.
- Verification: original unsafe-behavior probes converted to normal rejection/invariant regressions; stale auxiliary expectations repaired; incorrect JSON.stringify-versus-canonical-text diagnostic corrected. Broken examples command removed; transition command now runs real tests. CI checks build drift and adds disposable real-PostgreSQL concurrency tests.

## Runtime qualification

Local application tests pass on Node 25.4.0 and 24.20.0, but both fail the independent minimal JSON round-trip reproducer. Node **22.23.2** passes that reproducer and the corrected 5,000-case canonicalization/round-trip fuzz check; it is pinned in `.node-version` and CI. The system Node installation was not changed. Run `npm run check:runtime` before using another runtime. The earlier fuzz harness overcounted runtime faults by comparing normal JSON.stringify output to canonical text; that diagnostic is now corrected. It does not negate the separate minimal reproducer on Node 24/25.

The actual deployed Deno/Supabase Edge runtime still requires its own qualification. A local Node pass is not a production runtime certificate.

## Verification commands

Use the pinned Node runtime, and unset `STORE_URL` for local-only testing:

```sh
cd sdk
npm ci
npm ci --prefix tests/fuzz
npm run check:runtime
npm run build
npm run typecheck
npm test
npm run test:fuzz
```

Baseline/regression suite: 64 tests after the September 7 review. Auxiliary fuzz/race suite: 37 tests. Real PostgreSQL suite: 2 tests in a separately provisioned disposable local `dtp_test` database; `npm run test:postgres` requires `DTP_TEST_DATABASE_URL` and refuses remote/non-test databases or an existing protocol schema. CI provisions this database, with no deployment credentials. Docker was not running locally, so that suite is validated through CI rather than claimed from PGlite.

## Independent pre-merge review (September 7)

Two review agents independently checked authorization/privacy/concurrency and trade/finance integrity. They identified two gaps, addressed in PR #4:

- Identity lookup failures now normalize hidden and missing identities to the same endpoint error, without leaking a private head record UUID. The A01 regression compares anonymous and unrelated authenticated errors before and after private registration.
- Buyer invoice acknowledgment/dispute transitions now preserve seller-controlled `paid_amount` and `settlement_event_ids`. B09 tests each payment field across all four buyer transitions, permits unchanged buyer actions and legitimate seller accounting updates, and checks that rejected writes leave the head unchanged.

These are local authorization invariants; neither fix certifies referenced payment events or changes the production gates below.

## Compatibility and rollout

This is a **tightening of the pre-release 0.2 rules**, not a signing-format change. Existing fixed signing vectors are unchanged; generated schemas and accountability documentation must travel with the store. Old callers that mutate contract terms or replay unreadable identities will now be rejected. Agree on the same revision with independent builders before the sprint; do not silently update the live store mid-test.

No migration is required for the implemented batch. Previously accepted records are not retroactively repaired or certified. Before live use, audit existing heads for terms/evidence/assignment violations and mark affected data unsuitable for financial decisions; never rewrite signed history to make the audit disappear.

The coarse lock trades throughput for clear behavior. The public HTTP boundary is the supported write ingress; all future write endpoints must join its locking and reauthorization discipline. Request limits are not rate limits. Public enrollment/debug endpoints still require deployment quotas and abuse controls before wider exposure.

## Still required before real operations

1. **Passport recovery:** root proof-of-possession token rotation/recovery with short-lived, single-use, domain-bound challenges. A lost first registration response can still strand token access. Retrying public genesis must never return tokens. This needs a separately reviewed authentication flow, custody handling and abuse controls.
2. **Consumer evidence verifier:** validate the exact signed versions, historical issuer/key/grant authority, chain and reference consistency, both parties' agreement where required, disputes and financial arithmetic. The store intentionally does not perform body referential checks. `active`, `buyer_attested`, `complete`, or a financer signature alone does not certify real-world truth.
3. **Amendments/assignment release:** this batch freezes terms and one invoice chain's assignment. It does not implement renegotiation, assignment consent/release, cross-root duplicate-invoice detection or multi-lender coordination. Do not market the assignment guard as eliminating double financing.
4. **Production qualification:** deployed Deno runtime, actual Supabase connection/pool behavior, existing-data audit, request timeouts/rate quotas and load testing. CI's PostgreSQL service is not the deployment.
5. **Workspace security:** installation/tenant-scoped credentials, operation approvals, spending caps and durable jobs before a general agent can run a company. Company delegate keys remain broad; module keys may cover multiple companies.

The proposed build order and marketplace boundary are in [WORKSPACE_FOUNDATIONS.md](WORKSPACE_FOUNDATIONS.md).
