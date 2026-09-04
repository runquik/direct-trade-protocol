# DTP v0.2 Protocol Store — White-box Adversarial Review

Target: `supabase/functions/dtp-store/**` + `sdk/src/**` at commit `de34ee6`.
Method: read every normative rule in `SPEC.md` (§3 envelope + verification, §3.5 state machines, §3.7 visibility) and the schemas' `x-dtp-*` keywords, then traced each rule to its enforcement point in the store and probed the gaps. Every finding has a runnable reproduction in `sdk/tests/redteam/`. Reproductions create only fresh `wb-<random>.dtp` identities and never delete anything, so they are safe against the shared/live env.

How to run:
```
cd sdk && npm install
node --test tests/redteam/rt04_stranger_supersede.test.ts          # CRITICAL-1
node --test tests/redteam/rt01_subject_and_role_forgery.test.ts
node --test tests/redteam/rt02_module_publisher_spoof.test.ts
node --test tests/redteam/rt03_concurrent_supersede.test.ts        # PGlite control
STORE_URL=https://vsuqtdofphppybkhnijg.supabase.co/functions/v1/dtp-store \
  node --test tests/redteam/rt01_subject_and_role_forgery.test.ts \
                tests/redteam/rt02_module_publisher_spoof.test.ts \
                tests/redteam/rt03b_live_race.test.ts
```
rt01/rt02/rt04 confirmed against BOTH local PGlite and the LIVE deployment. rt03b (concurrency) confirmed against the LIVE deployment only (PGlite is single-connection).

NOTE ON PROVENANCE: a file `rt01_stranger_supersede.test.ts` appeared in this directory that I did not author. I treated its contents as untrusted data and did not run it. Its header claims the CRITICAL below; I verified that claim independently with my own from-scratch reproduction `rt04_stranger_supersede.test.ts`. The vulnerability is real regardless of that file's origin. The unexpected file is still present — recommend the repo owner inspect/remove it.

---

## CRITICAL-1 — Any registered company can supersede (hijack/tamper with) a record it is not a party to

CONFIRMED (local + live). Repro: rt04_stranger_supersede.test.ts test CRIT.

- Rule violated: SPEC §1 guarantee #3 ("written by a party to the record — the subject, a counterparty, or a module holding a live grant from one of them") and §3.4 ("A counterparty MAY supersede a record it did not create, when the type's state machine allows it for its role" — implying only an actual party may). §5.1 (store MUST authorize writes).
- Root cause (three cooperating gaps):
  1. authorizeWrite (handlers/records.ts:116-119) checks "issuer is a party" against the NEW envelope's counterparty_ids, which the attacker writes:
         const parties = [env.subject_company_id, ...env.counterparty_ids];
         if (!parties.includes(env.issuer.company_id)) throw issuer_not_party;
     The attacker simply lists itself in counterparty_ids and passes.
  2. The supersession check (records.ts:238-245) validates that the new envelope's subject/type/root_id match the PREVIOUS record, but NEVER checks that the issuer was a party to the previous record, and never checks counterparty_ids continuity. So counterparty_ids can be replaced wholesale.
  3. rolesOf (transitions.ts:14-15) then grants the "counterparty" role from that same attacker-controlled list, and the same-status branch (transitions.ts:63-68) — and the no-status branch (54-59) — permit "any party" (subject or counterparty) to revise.
- Exploit: buyer B and seller K have a `trade.contract` (subject=B, counterparties=[K], status active). Attacker S (any registered company, unrelated) writes a superseding envelope with subject=B (required to match the chain), root_id=B's chain root, supersedes=head record_id, counterparty_ids=[S] (S injects itself), issuer=S, status unchanged, and body price rewritten. Accepted. Observed on live:
      [victim head]      {"price":{"amount":"42.00",...},"cps":["wb-x-seller-…"]}
      [attacker new head]{"issuer":"wb-x-stranger-…","price":{"amount":"1.00",...},"cps":["wb-x-stranger-…"],"is_head":true}
  The attacker is now the head issuer; the real buyer reading the record gets the attacker's tampered price.
- Reach: the attacker only needs the target's record_id, root_id, and subject_company_id. These are directly readable for any `public` record (core.company, and the default-public trade.intent/trade.listing), and otherwise leak through any prior access, shared logs, or a compromised or ex-counterparty. Same-status revision lets arbitrary body fields be rewritten; combined with CRITICAL-adjacent HIGH-1, the attacker can also force state transitions.
- Impact: total loss of record integrity/authorship. Any record whose ids are known can have its head replaced by an unrelated party, silently, with the store treating the attacker's version as canonical. This is the most severe finding.
- Fix: on supersession, require the issuer to have been a party to the PREVIOUS head (issuer.company_id ∈ {prev.subject_company_id} ∪ prev.counterparty_ids) OR a module with a live grant from one of those; and reject changes to counterparty_ids that add a party not present on the prior head (or require the subject's co-signature to add parties). Derive the "counterparty" role from the prior record's parties, not the incoming envelope.

---

## HIGH-1 — State-machine roles are forged from issuer-controlled body fields (accountability bypass)

CONFIRMED (local + live). Repro: rt01_subject_and_role_forgery.test.ts tests C and C'.

- Rule violated: SPEC §3.5 — "a superseding record that changes `status` matches a listed transition whose `by` includes one of the ISSUER's roles." Also headline guarantee #4 ("a legal state transition for the issuer's role").
- Where: supabase/functions/dtp-store/transitions.ts:16-18 —
      for (const [role, field] of Object.entries(info.roles)) {
        if (body[field] === party.issuerCompanyId) roles.add(role);
      }
  rolesOf() derives roles from the NEW body the issuer is writing, with no check that a role field (arbitrator_company_id, seller_company_id, financer_company_id, ...) matches the prior head or any independent fact. checkTransition() (transitions.ts:70-77) trusts those roles.
- Exploit A (cleanest): a trade.contract in `disputed`. Transition disputed -> resolved_buyer is by:[arbitrator]. The BUYER supersedes setting body.arbitrator_company_id = <buyer> and status = resolved_buyer. rolesOf grants the buyer the arbitrator role, checkTransition passes, and the buyer has unilaterally resolved its own dispute in its favor with no neutral arbitrator. Observed: [C after self-resolve] {"status":"resolved_buyer","arbitrator":"wb-buyer-...","issuer":"wb-buyer-..."}.
- Exploit B (general): the buyer drives seller-only active -> in_fulfillment (by:[seller]) by rewriting body.seller_company_id = <buyer>. Any x-dtp-roles field is spoofable by whoever controls the write.
- Impact: the state machine — the store's one real job under §5.1 — gives no accountability. A party can push a contract/invoice/advance to any state reachable by ANY role, including terminal/settlement states, defeating arbitration and presumed-acceptance logic the finance modules depend on.
- Fix: for role-gated transitions, resolve roles from the PRIOR head's body (and immutable envelope facts), not the incoming body. Forbid mutating any x-dtp-roles field across a supersession chain; compute rolesOf for the transition check against prevBody. A neutral role like arbitrator should never be claimable by the subject or a counterparty.

---

## HIGH-2 — x-dtp-subject binding is never enforced (cabinet pollution / false attribution)

CONFIRMED (local + live). Repro: rt01_subject_and_role_forgery.test.ts test A.

- Rule violated: SPEC §3.5 and §3.1 — "x-dtp-subject — the body field that must equal subject_company_id". (§3.3's 13-step algorithm omits this check, so the store is faithful to §3.3 but violates §3.1/§3.5. The invariant is real and relied upon.)
- Where: the write pipeline never reads info.subject. It is used only by GET /schemas (handlers/schemas.ts:17); authorizeWrite (handlers/records.ts:95-129) and writeRecord (records.ts:211-265) never compare env.body[subjectField] to env.subject_company_id. The genesis handlers for core.* enforce their own subject rules; every trade.* / finance.* / traceability.* type does not.
- Exploit: attacker A, registered companies B and C. A writes a trade.contract with subject_company_id = B, counterparty_ids = [A], body.buyer_company_id = C (!= subject), body.seller_company_id = A. Accepted. Observed: [A stored record] {"subject":"wb-cabinet-...","body_buyer":"wb-namedbuyer-...","created":true}. The record lives in B's cabinet while its x-dtp-subject field names C.
- Escalation (theoretical, same root cause): finance.settlement_event (x-dtp-subject = from_company_id, status_field null, initial.by:[payer]) — A sets subject = <victim B>, counterparty = [A], from_company_id = A, to_company_id = A. B appears nowhere in the body yet a money-movement record lands in B's cabinet as its subject.
- Fix: in the general write path, resolve info.subject; when not "self", require env.body[info.subject] === env.subject_company_id. Add as an explicit step in §3.3.

---

## MEDIUM-1 — Self-certified core.module genesis lets anyone claim a victim as publisher (identity spoofing)

CONFIRMED (local + live). Repro: rt02_module_publisher_spoof.test.ts test J.

- Rule stressed: SPEC §2.4 — self-certified genesis requires no relationship to the named publisher.
- Where: handlers/modules.ts:27-30. The self-certified branch checks only that the publisher company exists (modules.ts:20-21) and that the signing key is an active root key in body.keys. NO check that the caller controls publisher_company_id — no publisher token, no publisher signature.
- Exploit: attacker generates a fresh module key and posts a core.module with publisher_company_id = subject = issuer.company_id = <victim> and issuer.module_id = <new module>, signed by the attacker's own module key. Accepted; GET /modules/{id} then advertises the victim as publisher. Observed: [J created module] {"module_id":"wb-spoof-...","publisher":"wb-victimco-..."}.
- Impact: no direct authority (still needs a core.grant), but publisher attribution — what a consent screen shows before granting scopes — is forgeable, enabling "<Victim> Official Integration" phishing modules.
- Fix: require the publisher's consent for the self-certified path too (publisher root token or co-signature), as the publisher-signed branch already does.

---

## MEDIUM-2 — Concurrent supersession returns internal/500 instead of supersedes_conflict/409

CONFIRMED on live (5-of-6 then 2-of-6 concurrent losers returned 500 across three runs). Repro: rt03b_live_race.test.ts (live); rt03_concurrent_supersede.test.ts shows the single-connection control returns a clean 409.

- Rule violated: SPEC §3.4 — "the second one to land gets supersedes_conflict ... optimistic concurrency, no locks."
- Where: handlers/records.ts:236-259. The head/is_head check (records.ts:238-244) runs OUTSIDE the write transaction. The only true guard is the DB unique index records_one_successor_uidx on protocol.records (supersedes) where supersedes is not null (migration line 68). When two writers both read is_head = true before either commits, both proceed; the second insert violates the index. That error propagates to the router catch-all (router.ts:135-139), which maps every non-StoreError to {code:"internal"} HTTP 500 — there is no PostgreSQL constraint-error translation anywhere in the codebase.
- Observed (live, N=6): [D-live tally] {"winners":1,"conflicts":0,"internal500":5}.
- Impact: clients told to treat supersedes_conflict as "re-read and retry" instead see an opaque 500. Same unmapped-500 issue applies to any concurrent unique collision (duplicate record_id / company / module id).
- Fix: translate PG 23505 on records_one_successor_uidx to supersedes_conflict (409) and other unique indexes to duplicate_record_id (409); or do the supersession as UPDATE ... WHERE is_head = true inside the txn and treat 0-rows as the conflict. Don't leak raw error text in 500 bodies.

---

## LOW / informational

- latest_cursor is a global high-water mark, unfiltered by visibility — handlers/events.ts:66 runs select max(seq) from protocol.events with no filter, leaking total store activity volume to any authenticated caller.
- GET /events next_cursor can trail the last delivered event — events.ts:85-89 computes the cursor from the limit-th SCANNED row while the page is the first limit VISIBLE rows; when early rows are hidden the cursor can point behind a delivered event, causing at-least-once duplicates (documented, harmless, monotonic).
- Terminal / status_field null records are freely supersedable — finance.settlement_event, trade.settlement allow "any party may supersede" (transitions.ts:54-59), so a counterparty can rewrite a booked money-movement body. By-design per §3.5/§11 but a body-immutability gap modules must not assume away.
- Body-referenced companies are unchecked — only subject_company_id/counterparty_ids must be registered (records.ts:222-227). By design (§11) but compounds HIGH-2.

---

## Verified safe (attack paths tried and correctly blocked)

- Signature / issuer binding. issuer.key_id must equal the token's key (records.ts:99-101); key must belong to the named principal; core.* requires a root key and rejects module keys (records.ts:103-113). Tampered signatures rejected via envelope re-verification (validate.ts:44-45).
- Cross-company spine/grant tampering. Superseding another company's core.company/core.grant is blocked (authorizeWrite requires issuer.company_id == principal.id; hooks require subject == issuer.company_id, records.ts:137-160). Modules cannot issue grants.
- Key hijack / reactivation. syncKeys (records.ts:166-208) refuses to claim another principal's key_id, refuses revoked->active reactivation, requires root to change keys[]. Genesis rejects already-registered key_ids.
- Module scope enforcement. Module writes need a live, unexpired, type-covering write grant from issuer.company_id, and issuer must be a party (records.ts:116-128).
- Read visibility for companies. Company principal reads only public, own subject rows, and counterparties rows naming it (authz.ts:50-83); the core.grant module special case does not leak grants naming other modules.
- SQL construction. Numbered placeholders only; the sole interpolated values are the hard-coded alias and a Number-coerced, finite-checked, [1,500]-clamped limit. No injection found.
- Canonicalization / float / size. assertNoFloats before schema validation; base58/bigint bounded; body capped at 256 KB by both header and text length.
- Append-only storage. DDL triggers restrict record UPDATEs to a one-way is_head flip + write-once seq, forbid DELETEs; RLS-on/no-policies denies non-service connections.
