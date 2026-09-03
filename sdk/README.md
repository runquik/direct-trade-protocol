# @dtp/sdk — DTP v0.2 SDK, tooling, and conformance tests

Web-standard TypeScript (no Node-only APIs in `src/`), so the same code runs in Node ≥ 23.5, Deno, the Supabase edge runtime, and browsers. Node runs the `.ts` files directly (type stripping); no build step is needed to use it.

```
src/
  base58.ts      Bitcoin-alphabet base58 (NEAR-compatible)
  canonical.ts   RFC 8785 JCS with integer-only numbers; sha256
  keys.ts        Ed25519 via WebCrypto; ed25519:<base58> encodings
  envelope.ts    Envelope types and helpers
  sign.ts        signingInput / signRecord / verifyRecord / payloadHash
  scopes.ts      grant scope matching (shared with the store)
  registry.ts    type registry + JSON Schema validation (@cfworker/json-schema)
  schemas.ts     GENERATED — embedded schemas + registry
  client.ts      DtpStoreClient: fetch wrapper for every store endpoint; draft()
scripts/
  build-schemas.ts   spec/schemas -> src/schemas.ts + spec/generated/*
  make-vectors.ts    regenerate spec/vectors (fixed key)
  keygen.ts          print a key pair
  sign.ts            sign an envelope file for curl users
  seed.ts            load the Sprint 01 fixtures into a store
  dev-server.ts      run the reference store on embedded Postgres (PGlite), no Docker
tests/               node:test conformance suite; runs against STORE_URL or an in-process store
fixtures/dev-keys.json   written by seed (gitignored)
```

## Use

```bash
npm install
npm run build                 # regenerate from spec/schemas
npm test                      # full suite on an embedded store
STORE_URL=https://…/functions/v1/dtp-store npm test    # same suite against a deployment
node scripts/dev-server.ts    # http://127.0.0.1:8787/dtp-store
npm run seed                  # fixtures -> fixtures/dev-keys.json
```

Minimal client usage:

```ts
import { DtpStoreClient, draft } from "./src/client.ts";
import { generateKeyPair } from "./src/keys.ts";

const store = new DtpStoreClient(process.env.STORE_URL!);
const kp = await generateKeyPair();
// ...POST /companies with a signed core.company genesis (see tests/helpers.ts makeCompany)
const me = store.with(token);
await me.sign(draft({ type: "finance.invoice", subject_company_id, counterparty_ids, issuer, body }), kp.secretKey);
```

`tests/helpers.ts` has ready-made builders (`makeCompany`, `makeModule`, `grant`, `makeContract`, `makeFulfillment`, `buyerAttest`) that double as worked examples of every flow.

## Type-check

```bash
npx tsc --noEmit -p tsconfig.json     # covers src/, scripts/, tests/, and the store under supabase/functions/dtp-store
```
