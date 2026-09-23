# @dtp/sdk — DTP v0.2 SDK, tooling, and conformance tests

Web-standard TypeScript (no Node-only APIs in `src/`), so the same code runs in the pinned Node 22.23.2 (`.node-version`; the `engines` field allows 22.23.2 up to, not including, 23, and newer majors have a JSON member-name parsing fault that breaks some tests), Deno, the Supabase edge runtime, and browsers. Node runs the `.ts` files directly (type stripping); no build step is needed to use it.

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

## Entry points

Import through the package entries, never an internal file path:

| Entry | File | What it is |
|---|---|---|
| `@dtp/sdk` | `src/index.ts` | Stable: encodings, canonicalization, keys, envelope signing, scopes. Portable, dependency-free. |
| `@dtp/sdk/preview/foundation` | `src/preview-foundation.ts` | Unreleased foundation layer (identity, identity log, organization, authority, records vocabulary), profiles and the onboarding client, no compatibility promise. Portable, **dependency-free**. |
| `@dtp/sdk/preview` | `src/preview.ts` | Everything in the foundation entry plus the v0.4 candidate. Portable; needs `@cfworker/json-schema`. |
| `@dtp/sdk/preview/host` | `src/preview-host.ts` | Unreleased pieces that need a database, a listener or host keys. |

"Portable" means nothing reachable imports a platform module, so the entry loads in browsers and edge runtimes as well as Node and Deno; a test enforces it for every portable entry. "Dependency-free" means nothing reachable imports a package either, so the entry bundles with this repository's sources alone; a test loads it in a child process whose resolver refuses every bare specifier. Use the foundation entry unless you need the v0.4 candidate: it is the preview entry minus the `v04*` namespaces, and the namespaces it shares are the same module objects, so code written against one works against the other.

The key helpers (`generateKeyPair`, `keyPairFromSecret`, `signBytes`, `verifyBytes` and the `encode*`/`decode*` functions) belong to the stable entry and are also re-exported unchanged as `keys` from both preview entries, as are `canonical` and `safeJson`, so a wallet or a host that signs identity material with a key it holds needs only one import:

```ts
import { keys, identity } from "@dtp/sdk/preview/foundation";
const resolverKey = await keys.keyPairFromSecret(secretFromCustody);
const { state, proof } = await identity.issueResolution(current, request, resolverKey, now);
```

## Type-check

```bash
npx tsc --noEmit -p tsconfig.json     # covers src/, scripts/, tests/, and the store under supabase/functions/dtp-store
```
