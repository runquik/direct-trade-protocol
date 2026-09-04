# DTP v0.2 fuzz and concurrency findings

Date: 2026-09-03. Scope: `sdk/src/canonical.ts`, `sign.ts`, `keys.ts`, `base58.ts` (Part A) and the protocol store,
local PGlite and the live deployment `https://vsuqtdofphppybkhnijg.supabase.co/functions/v1/dtp-store` (Part B).
Harness: `sdk/tests/fuzz/` (see README.md there). Seed 20260903, 5000 iterations per property unless stated.
Runtime: Node v25.4.0, V8 14.1.146.11. No production code was changed.

Severity legend: **S1** breaks the protocol contract / interop, **S2** wrong behaviour with a workaround or narrow trigger,
**S3** hygiene or informational.

## 1. Canonicalization (SPEC.md 3.2: RFC 8785 with integer-only numbers)

Oracles: `canonicalize@4.0.0` (the RFC author's reference implementation, authoritative) and `json-canonicalize@3.0.0`
(secondary; it has its own bug, see 1.6). Both reproduce all four `spec/vectors/canonicalization.json` cases.

### 1.1 S1 - Keys that look like array indices are emitted first, in numeric order (not RFC 8785)

`sortDeep()` sorts the keys correctly, then inserts them into a fresh plain object and hands it to `JSON.stringify`.
ECMAScript enumerates integer-like own keys (`"0"` ... `"4294967294"`) *first, ascending numerically*, regardless of
insertion order, so the sort is undone for those keys. Minimal reproducers (sdk vs reference):

| input | sdk | RFC 8785 |
|---|---|---|
| `{"10":1,"9":2}` | `{"9":2,"10":1}` | `{"10":1,"9":2}` |
| `{"-1":1,"1":2}` | `{"1":2,"-1":1}` | `{"-1":1,"1":2}` |
| `{"1":0,"01":1}` | `{"1":0,"01":1}` | `{"01":1,"1":0}` |
| `{"a":1," ":2,"0":3}` | `{"0":3," ":2,"a":1}` | `{" ":2,"0":3,"a":1}` |
| `{"1":{}," ":{}}` | `{"1":{}," ":{}}` | `{" ":{},"1":{}}` |
| `{"4294967294":1,"4294967295":2,"A":3}` | agrees (2^32-1 is not an array index) | |

Fuzz result: 2097 / 5000 random integer-only documents diverge from the reference; every one of the 2047 distinct minimal
reproducers is this pattern (the generator draws numeric-string keys ~10% of the time, so the rate is corpus-dependent).
`fuzz-signing.test.ts` shows the same thing at envelope level: 1785 / 5000 signing inputs are not the RFC 8785 form of the
signing object. The live store's `POST /debug/canonicalize` returns `{"9":2,"10":1}` for the first row (same SDK code).

Why it matters:
- The output is stable (it is a property of the object, not of the sort), so the SDK is self-consistent and all current
  tests pass. But any second implementation that follows SPEC.md (Python, Go, Rust, a sorted-map serializer) produces
  different bytes and every signature fails with `signature_invalid` as soon as a body contains such a key.
- Reachable in real records: every strict schema allows free-form `x_*` extension objects (`patternProperties ^x_`),
  and `traceability.coa_anchor` / `traceability.cte` allow additional properties. `validateBody("trade.contract", {...,
  x_meta: {"10":"a","9":"b"}})` is valid today.
- SPEC.md 3.2 says "any implementation with a sorted-keys serializer therefore produces byte-identical output". That is
  false for JavaScript implementations that build an object and stringify it; the naive "sorted-keys JSON.stringify
  replacer" agrees with the SDK on 5000/5000 cases, i.e. it has the identical bug. The spec text should warn about it.
- The fixed vectors contain zero numeric-string keys, so they cannot catch this.

Fix (not applied): serialize directly to a string in `sortDeep`/`canonicalize` (emit `JSON.stringify(key) + ":" + value`
joined with commas in sorted order) instead of building an intermediate object. Add a vector such as
`{"10":1,"9":2,"-1":3,"":4}`.

### 1.2 S2 - Lone surrogates are escaped instead of rejected (RFC 8785 3.2.2.2 MUST)

RFC 8785 3.2.2.2: "occurrences of such data MUST cause a compliant JCS implementation to terminate with an appropriate
error". `canonicalize("\ud800")` returns `"\ud800"` (a lowercase escape) and never throws; the reference throws
`Lone surrogate is not allowed`. Fuzz: 490 / 1000 inputs containing lone surrogates were rejected by the reference and
accepted by the SDK. Impact: a record with invalid Unicode in a string can be signed and stored; a conforming verifier
will refuse to even canonicalize it. Recommend rejecting in `sortDeep` (scan strings for unpaired D800-DFFF) and adding a
`lone_surrogate` issue code, or documenting the deviation in SPEC.md.

### 1.3 S2 - A key named `__proto__` is silently dropped from the signing input

`out[k] = ...` with `k === "__proto__"` sets the intermediate object's prototype instead of creating a property, so the
key vanishes: `canonicalize(JSON.parse('{"__proto__":1,"a":2}'))` is `{"a":2}`; the reference gives
`{"__proto__":1,"a":2}`. Consequences verified in `fuzz-signing.test.ts`: the spec vector record with
`"__proto__":{"polluted":true}` injected into `body` **verifies with the original signature** and has the same
`payload_hash`, while `JSON.stringify(body)` (what the store persists) still contains the key. Two different JSON
documents therefore share one signing input. Floats hidden under `__proto__` are still caught (the walk reaches the
value before the assignment), and the global `Object.prototype` is not polluted. Reachable through `x_*` objects.
The direct-to-string serializer from 1.1 fixes this as well.

### 1.4 Numbers - as specified, no divergence

- Every non-integer, non-finite or unsafe number throws `FloatNotAllowedError` with the correct JSONPath (5000 random
  injections, plus a fixed table: 0.5, 1e-7, 5e-324, 1e16, 1e21, 1e300, 2^53, 2^53+1, 2^53+2, -2^53, MAX_VALUE, NaN,
  +/-Infinity). Note `2^53+1 === 2^53` in a double and `JSON.parse("9007199254740993")` is rejected, so there is no
  silent precision loss; the reference prints `1e21` as `1e+21`, which is exactly why the restriction exists.
- `-0`: accepted (it is an integer) and serialized as `0`, identical to the reference and to JCS Appendix B ("Minus
  zero"). The spec's intent is satisfied: `-0` in JSON text parses to `-0` and canonicalizes to `0` on every side, so
  signer and verifier agree; only the sign is not round-trippable. No change recommended, but SPEC.md could state it.
- `1.0` / `1e2` in JSON text are indistinguishable from `1` / `100` in JavaScript and are accepted. A non-JS
  implementation that distinguishes integer and float tokens must treat them the same (canonicalize to `1`, `100`).

### 1.5 Everything else agrees byte for byte

Key sorting by UTF-16 code units (U+10000 sorts before U+FFFF; NFC/NFD, case, ligature, Angstrom-sign variants are
distinct keys in the right order), string escaping (short escapes, lowercase `\u00XX`, DEL and U+2028/2029 literal),
empty keys, nulls, empty containers, undefined dropped, `undefined` in arrays as `null`, 20000-char strings, deep
nesting (both implementations overflow the stack at depth 5000; 1000 is fine). `bigint` throws `TypeError`. Objects
with `toJSON` (Date) serialize as `{}` in the SDK vs an ISO string in the reference: non-JSON input, not a DTP concern.

### 1.6 Oracle and runtime caveats discovered on the way

- `json-canonicalize@3.0.0` treats any object with a key literally named `"toJSON"` (any non-null value) as
  `toJSON`-able and emits it unsorted (`object.toJSON != null`). Not a DTP bug; the harness skips it for such inputs.
- **V8 `JSON.parse` returns the wrong property key** (Node 25.4.0 / V8 14.1.146.11; also under `--jitless`,
  `--no-opt`, `--no-maglev`, `--no-sparkplug`, so it is in the C++ parser). After parsing `{"":1,"\\":2}`, parsing
  `{"":1,"\u0013":2}` in the same isolate yields an object whose second key is `\` (U+005C), not U+0013. Trigger:
  the previously parsed object's map has, at the same property slot after the same preceding keys, a key whose *raw
  text* starts with a backslash; then any escaped key with the same decoded length at that slot (`\"`, `\/`, `\b`,
  `\n`, `\t`, any BMP `\uXXXX`; also `\u` vs `\u0013u`) is replaced by the expected key. Not triggered for a first
  key, for different preceding keys, for keys that decode to a different length, or for surrogate pairs. Two of 5000
  fuzz cases hit it (seeds 2847348256, 1006720321). Reproducers: `repro-v8-min.mjs` (full documents),
  `repro-v8-shrink.mjs` (delta-debugged to ~80 chars), `repro-v8-variants.mjs` (2-key variants and an escape sweep).
  Relevance to DTP: the store parses every incoming envelope with `JSON.parse`; a mis-decoded key changes the object
  before canonicalization, so verification would fail closed (`signature_invalid`) for a valid record, and a stored
  `envelope` read back via `JSON.parse` could differ from what was signed. Keys beginning with a backslash are rare in
  practice, but the Supabase edge runtime (Deno, also V8) should be checked with `repro-v8-check.mjs`, and the bug should
  be reported upstream to V8/Node.

## 2. Encodings and crypto (`fuzz-encodings.test.ts`, 10/10 pass)

- base58 is byte-identical to `bs58@6` for 5000 random byte strings (lengths 0-90, sprinkled leading zeros), all-0x00
  and all-0xff for lengths 1-80, every single byte and `[0, b]`. Decode rejects `0 O I l`, whitespace, punctuation,
  fullwidth digits, NUL, zero-width space, emoji, anywhere in the string. Encoding of 32-byte keys is a bijection
  (encode(decode(s)) == s); a non-canonical form with an extra leading `1` decodes to 33 bytes and is rejected.
- `decodeKeyId` / `decodeSignature` / `decodeSecretKey`: reject missing, upper-cased, wrong (`secp256k1:`) or
  space-prefixed prefix, prefix only, 0/1/31/33/64-byte keys, 0/32/63/65/128-byte signatures, 32/63/65-byte secrets,
  and bad alphabet characters. Encoders reject wrong sizes. **S3**: `encodeSecretKey` does not validate its inputs; a
  16- or 40-byte seed is silently padded/overwritten into the 64-byte buffer (only > 64 throws `RangeError`).
- NEAR compatibility: the fixed vector's `secret_key` equals `ed25519:` + base58 of tweetnacl's 64-byte secret key
  (seed || public key) and `key_id` equals `ed25519:` + base58 of the public key. For 200 random WebCrypto key pairs the
  pkcs8 tail is the RFC 8032 seed (tweetnacl derives the same public key), signatures are byte-identical both ways,
  each side verifies the other's, and a NEAR-format secret produced by tweetnacl signs through `signBytes`.
- Malleability: an `S + L` signature is rejected by WebCrypto (`verifyBytes` -> false) but **accepted by tweetnacl**
  (`nacl.sign.detached.verify` -> true; tweetnacl does not enforce `S < L`). **S3 / interop note**: the store rejects
  malleated signatures, but any consumer that re-verifies DTP records with tweetnacl (older near-api-js) treats two
  different `signature` strings as valid for one record. The signature is outside `payload_hash` and record identity is
  `record_id`, so this is not a forgery vector; it only matters if anyone ever keys on the signature string. Bit flips,
  all-zero signatures, and all-zero / 0xFF / small-order public keys are rejected (false, no throw).
- **S3**: `protocol.keys.key_id` has `check (key_id ~ '^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$')`. Random keys encode to
  44 (94.4%) or 43 (5.6%) chars. A public key with 5 or more leading zero bytes encodes to 42 chars and would fail the
  constraint with a raw 500 (probability ~2^-40 per key; theoretical, but the regex could be `{32,44}`).

## 3. Signing object (`fuzz-signing.test.ts`, 7/7 pass)

- Field order (top-level and nested) never changes the signing input; unknown top-level fields (random names, `seq`,
  `received_at`, `payload_hash`, `is_head`, `x_*`) and `signature` are excluded (5000 cases); `signingObject` output has
  exactly `SIGNED_FIELDS`; `signRecord` output has exactly `SIGNED_FIELDS + signature` and is deterministic.
- Missing `supersedes` -> `null`; missing `counterparty_ids` -> `[]`; explicit `counterparty_ids: null` -> `[]` as well
  (the envelope schema rejects `null`, so this leniency never reaches a store). Any other missing signed field becomes
  `null` in the signing input (e.g. `"body":null`); the store's envelope schema (`additionalProperties: false`,
  `required`) catches it before verification.
- A record with junk top-level fields verifies (signature covers `SIGNED_FIELDS` only) and is rejected by the schema.
- The `__proto__` consequence in 1.3 is demonstrated here on the spec vector record.

## 4. Concurrency (`race-store.test.ts`)

Both runs used `RACE_N=10`. Local = in-process PGlite via `tests/helpers.ts`; live = the Supabase deployment.
All post-state checks passed in both environments: exactly one head, exactly one persisted successor, exactly one
company with the winner's key, one record per replayed envelope, every event exactly once in seq order.

### 4.1 Race 1: 10 concurrent supersedes of one head (`POST /records`)

| status code | local | live |
|---|---|---|
| 201 ok | 1 | 1 |
| 409 supersedes_conflict | 9 | 4 |
| 500 internal `duplicate key value violates unique constraint "records_one_successor_uidx"` | 0 | **5** |

### 4.2 Race 2: 10 concurrent genesis writes for one company id, different keys (`POST /companies`)

| status code | local | live |
|---|---|---|
| 201 ok | 1 | 1 |
| 409 duplicate_record_id | 9 | 0 |
| 500 internal `duplicate key value violates unique constraint "companies_pkey"` | 0 | **9** |

### 4.3 Race 3: 10 identical replays of one record envelope (`POST /records`)

| status code | local | live |
|---|---|---|
| 201 ok | 1 | 1 |
| 200 ok (replay, `created: false`) | 9 | 9 |
| 500 | 0 | 0 |

### 4.3b Race 3b: 5 identical replays of one genesis envelope (`POST /companies`)

| status code | local | live |
|---|---|---|
| 201 ok | 1 | 1 |
| 409 duplicate_record_id | 4 | 0 |
| 500 internal `companies_pkey` | 0 | **4** |

A sequential identical replay after the race returns `409 duplicate_record_id` in both environments.

### 4.4 Race 4: grant and the dependent module write fired together

| round | grant | write | retry after grant |
|---|---|---|---|
| local 1-5 | 201 | 201 | - |
| live 1 | 201 | 403 grant_missing | 201 |
| live 2 | 201 | 403 grant_missing | 201 |

Both outcomes are consistent states (grant lands; write is authorised only once the grant row is visible). No 500s.

### 4.5 Events: 50 writes in 5 concurrent batches of 10, then paging

Local and live: 50/50 writes 201. `limit=7` from cursor 0 with `company=<subject>`: 8 pages, 51 distinct events (50
contracts + the genesis), 0 duplicates, 0 missing, 0 unexpected, strictly increasing cursors. `limit=17`: 3 pages,
same result.

### 4.6 Analysis

- **S1 - 500 `internal` under contention, leaking constraint names.** `writeRecord` and `createCompany` do their
  head / existence / duplicate checks *outside* the transaction and rely on the DB constraints
  (`records_one_successor_uidx`, `companies_pkey`, `records_pkey`) as the last line of defence, but `router.ts` maps any
  non-`StoreError` to `500 internal` with the raw Postgres message. Data stays consistent (the constraints do their job)
  but clients get the wrong status/code and a schema detail. Race 3 on `/records` happened to be clean live, yet it has
  the same check-then-insert shape (`records_pkey`) and will 500 under a tighter race. Local PGlite executes on one
  connection and masked all of this; only the live run showed it.
- **S2 - Genesis replay is not idempotent.** SPEC.md 3.5 idempotency: an identical envelope returns 200. `POST
  /companies` returns `409 duplicate_record_id` for an identical genesis envelope (before the race check, `companies`
  existence is tested, not `payload_hash`). Clients retrying a timed-out genesis cannot tell "already created by me"
  from "id taken by someone else", and they never get the minted tokens back either way.
- Grant visibility and the event feed behaved correctly under contention.

## 5. Recommendations

1. Rewrite `canonicalize()` to serialize straight to a string in sorted-key order (never build an intermediate object).
   This fixes 1.1 and 1.3 at once. Add spec vectors with numeric-string keys, `__proto__`, and an `x_` object, and amend
   SPEC.md 3.2 to warn that "sorted-keys JSON.stringify" is not sufficient in JavaScript.
2. Reject lone surrogates in `canonicalize()` (RFC 8785 MUST) with a distinct issue code, or document the deviation.
3. Store: map unique-constraint violations to the spec'd codes. Either move the head/duplicate checks inside the
   transaction with `select ... for update` on the head row / an advisory lock on `subject_company_id`, or catch
   SQLSTATE `23505` per constraint (`records_one_successor_uidx` -> `supersedes_conflict`, `records_pkey` ->
   idempotency re-check then `duplicate_record_id`, `companies_pkey` -> `duplicate_record_id`) and never return raw
   database text in `error.message`.
4. Make `POST /companies` idempotent on `payload_hash` (return 200 with the existing record; decide whether tokens are
   re-issued) so genesis retries are safe.
5. Run `repro-v8-check.mjs` on the Supabase edge runtime and report the `JSON.parse` fault upstream; until it is fixed,
   consider rejecting keys that begin with a backslash at the schema level (they are never legitimate field names) so the
   trigger cannot occur in stored envelopes.
6. Hygiene: validate seed length in `encodeSecretKey`; relax the `key_id` check to `{32,44}`; document `-0`, `1.0` and
   the tweetnacl `S < L` gap in SPEC.md for implementers; add a numeric-key case to `05_vectors.test.ts`.
7. Add `race-store.test.ts` (against a real Postgres, not PGlite) to CI for the store.

Aside: `npx tsc --noEmit -p sdk/tsconfig.json` currently fails on `sdk/tests/redteam/rt01_stranger_supersede.test.ts(20,1)`
(a file outside this work), so the fuzz files were verified by execution only.
