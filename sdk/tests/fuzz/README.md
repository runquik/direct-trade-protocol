# DTP v0.2 fuzz and concurrency suite

Property-based tests for the cryptographic foundations (`sdk/src/canonical.ts`, `sign.ts`, `keys.ts`, `base58.ts`)
and concurrency tests for the protocol store. Not part of `npm test`; nothing here modifies production code.
Results and analysis: [`FINDINGS-fuzz.md`](FINDINGS-fuzz.md).

## Setup

```sh
cd sdk/tests/fuzz
npm install          # canonicalize (RFC 8785 reference), json-canonicalize, tweetnacl, bs58
```

Node >= 23.5 (runs `.ts` directly; WebCrypto Ed25519 is native). Developed on Node 25.

## Part A: canonicalization, encodings, signing (offline)

```sh
node fuzz-canonical.test.ts     # canonicalize()/assertNoFloats() vs two RFC 8785 implementations
node fuzz-encodings.test.ts     # base58 vs bs58, NEAR format vs tweetnacl, decode rejections, malleability
node fuzz-signing.test.ts       # signingObject()/signRecord()/verifyRecord() properties
npm run fuzz                    # all three
```

Knobs: `FUZZ_SEED` (default `20260903`) and `FUZZ_ITER` (default `5000`). Everything is derived from the seed with
`rng.ts` (mulberry32), so a run is reproducible. Every failure message names the per-case seed; reproduce one case with

```sh
FUZZ_SEED=<seed from the message> FUZZ_ITER=1 node fuzz-canonical.test.ts
```

Divergences from the reference are collected, shrunk to a minimal diverging sub-value, and printed as a summary
(`input / sdk / ref`). Tests whose name starts with `DIVERGENCE:` document known non-conformances and are expected
to fail until the SDK is fixed.

`rng.ts` is pure ASCII: all Unicode test data is built from code points with `u(...)` / `cu(...)` so the corpus is
unambiguous in source control (combining marks, NFC/NFD pairs, astral characters, U+FFFF vs surrogate pairs, controls,
lone surrogates, numeric-string keys, `__proto__`, very long strings, integers across the safe range, -0).

### V8 `JSON.parse` reproducer (`repro-v8-*.mjs`)

The canonical fuzz tripped over a runtime fault: on Node 25.4.0 (V8 14.1.146.11) `JSON.parse` returns the wrong
property key for an escaped key when a previously parsed object had, at the same position, a key whose raw text starts
with a backslash. Plain JavaScript, no SDK involved:

```sh
node repro-v8-save.mjs           # writes v8-repro/polluter.json and target.json from the fuzz seeds
node repro-v8-min.mjs            # shows the fault on the full documents (also under --jitless, --no-opt, ...)
node repro-v8-shrink.mjs         # delta-debugs both to ~80-char documents (v8-repro/*.min.json)
node repro-v8-variants.mjs       # hand-written 2-key variants + a sweep over single-char escapes
node repro-v8-check.mjs v8-repro/polluter.min.json v8-repro/target.min.json print   # exit 1 = fault
```

## Part B: concurrency against a store

```sh
node race-store.test.ts                                    # in-process PGlite store (no Docker), via ../helpers.ts
STORE_URL=http://127.0.0.1:8787/dtp-store node race-store.test.ts     # against `node scripts/dev-server.ts`
STORE_URL=https://<project>.supabase.co/functions/v1/dtp-store node race-store.test.ts   # live (about 130 requests)
```

`RACE_N` (default 10) sets the number of simultaneous requests per race. Company ids are `fz-<random>.dtp`.
The tests print markdown tables of observed `{status, code}` distributions at the end of the run; the assertions
encode the expected outcome (exactly one 201, no 500s, consistent post-state), so a failing test is a finding, not
a harness error.

Races covered: N supersedes of one head, N genesis writes for one company id, N identical replays (records and
genesis), grant + dependent module write fired together, and 50 quick writes followed by paging the event feed.

Note: the in-process PGlite store executes queries on a single connection and masks the races; the live Postgres
deployment does not. Run both.
