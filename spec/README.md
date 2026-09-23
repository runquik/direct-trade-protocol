# spec/ — PBP v0.2 normative artifacts

Direct Trade Protocol (DTP) is the current name; Portable Business Protocol (PBP) was a working name used in September 2026 save points and remains in some document titles. Existing `https://dtp.dev/` schema IDs, `x-dtp-*` keywords, version numbers, and fixed signing vectors are unchanged. See [the naming policy and isolated v0.3 reference preview](../docs/PBP_DIRECTION.md).

The prose specification is [`/SPEC.md`](../SPEC.md). This directory holds what *decides*:

| Path | What it is | Normative? |
|---|---|---|
| `schemas/index.json` | The type registry: every record type, its schema file, supported versions, who may write it, which body field is the subject, default visibility | yes |
| `schemas/core/envelope.schema.json` | The record envelope every record shares | yes |
| `schemas/{core,trade,finance,traceability}/*.schema.json` | One body schema per record type, each carrying `x-dtp-subject`, `x-dtp-roles`, `x-dtp-transitions` | yes |
| `schemas/common/*.schema.json` | Shared sub-objects: ids, `Money`, `Quantity`, `Address`, `Key`, `Attestation`, `CertificationRef`, `KybRef` | yes |
| `profiles/product/1.md`, `profiles/product/1/profile.json`, `profiles/product/1/fixtures.json` | The `dtp/product@1` profile: document, the exact contract (publisher `dtp`, semantics `product-v1`) whose digest the registry will pin, and fixtures a conforming validator must accept and refuse, including supersession continuity; regenerate with `node sdk/scripts/build-product-profile.ts` | yes, for the v0.4 candidate; not yet registered |
| `profiles/inventory/2.md`, `profiles/inventory/2/profile.json`, `profiles/inventory/2/fixtures.json` | The `dtp/inventory@2` profile: document, exact contract (publisher `dtp`, semantics `inventory-v2`) and fixtures: fact streams with the expected outcome of every fact and the exact final ledger, plus the v1 projection; regenerate with `node sdk/scripts/build-inventory-profile.ts` | yes, for the v0.4 candidate; not yet registered |
| `profiles/party/1.md`, `profiles/party/1/profile.json`, `profiles/party/1/fixtures.json` | The `dtp/party@1` profile: document, exact contract (publisher `dtp`, semantics `party-v1`) and fixtures a validator must accept and refuse, including supersession continuity; regenerate with `node sdk/scripts/build-party-profile.ts` | yes, for the v0.4 candidate |
| `profiles/order/1.md`, `profiles/order/1/*` | The `dtp/order@1` profile: a binding commercial commitment (a forecast or a plan is never an order), with genesis, continuity and status-transition fixtures; regenerate with `node sdk/scripts/build-order-profile.ts` | yes, for the v0.4 candidate |
| `profiles/forecast/1.md`, `profiles/forecast/1/*` | The `dtp/forecast@1` profile: a projection that commits nobody, with fixtures; regenerate with `node sdk/scripts/build-forecast-profile.ts` | yes, for the v0.4 candidate |
| `profiles/index.json` | Registry of protocol business-fact kinds (`dtp/<name>@<major>` -> admitted profile digests), format `dtp-profile-kinds-1`; empty until a kind has fixtures and a second implementation; private kinds are namespaced by publisher organization id and need no registration; design in [`docs/foundation/business-fact-profiles-proposal.md`](../docs/foundation/business-fact-profiles-proposal.md) | yes, for the v0.4 candidate |
| `vectors/keys.json` | A fixed Ed25519 key (published on purpose; never use it for anything real) | yes |
| `vectors/canonicalization.json` | Inputs → canonical JSON → SHA-256 | yes |
| `vectors/unsafe-json.json` | JSON texts a receiver must refuse before parsing, and texts it must accept; regenerate with `node sdk/scripts/build-unsafe-json-vectors.mjs` | yes |
| `vectors/organization-identity.json` | Unreleased foundation layer: organization genesis → preimage → digest → id, and genesis objects a receiver must refuse; rules in [`docs/foundation/organization-identity.md`](../docs/foundation/organization-identity.md); regenerate with `node sdk/scripts/build-organization-vectors.ts` | yes, for the foundation layer only |
| `vectors/organization-governance.json` | Unreleased foundation layer: person consents to an organization genesis or governance transition, accepted and refused against the person control head they name; governance logs a verifier must replay to exactly the published heads from the supplied identity logs, and logs it must refuse; rules in [`docs/foundation/organization-identity.md`](../docs/foundation/organization-identity.md); regenerate with `node sdk/scripts/build-organization-governance-vectors.ts` | yes, for the foundation layer only |
| `vectors/identity-log.json` | Unreleased foundation layer: portable identity logs a verifier must accept, with the heads and resolver bindings it must derive, including moves between resolvers and the format 1 encoding; tampered, reordered, truncated, spliced and rule-breaking logs it must refuse; pairs of diverging histories with their epoch precedence; relying-party admissions (pin plus log, with the normative outcome or refusal reason); owner-push messages with the exact acknowledgment; and destination refusals of a rehome, accepted, refused and compared with logs; rules in [`docs/foundation/identity-log.md`](../docs/foundation/identity-log.md); regenerate with `node sdk/scripts/build-identity-log-vectors.ts` | yes, for the foundation layer only |
| `vectors/signatures.json` | A raw-message signature and two fully signed records for the fixed key | yes |
| `generated/ts/types.d.ts` | TypeScript body types, generated from the schemas | derived |
| `generated/accountability.md` | Who may create / transition each type, rendered from `x-dtp-transitions` | derived |

## Rules

- JSON Schema draft 2020-12. `$id` is `https://dtp.dev/schemas/0.2/<path>`; cross-file references are relative `$ref`s.
- Use `pattern`, not `format`, for dates/ids so validators need no format plugins.
- Bodies contain **integers only**. Money and quantities are decimal strings (`common/money`, `common/quantity`).
- Strict types set `additionalProperties: false` and allow `patternProperties: {"^x_": {}}` — the only per-implementation freedom.
- Every record type MUST carry `x-dtp-transitions` (may be `null` for types with no state).
- Never edit `generated/`; edit the schemas and run the build.

## Regenerate

```bash
cd ../sdk
npm install
npm run build          # -> sdk/src/schemas.ts, spec/generated/ts/types.d.ts, spec/generated/accountability.md
node scripts/make-vectors.ts   # only when the signing algorithm changes (it must not, within 0.2)
npm test               # conformance suite against an embedded store
```

The build fails if a schema's `$id` does not match its path, a registered type's file is missing, a strict type is not `additionalProperties: false`, a type lacks `x-dtp-transitions`, or a schema file is not referenced by the registry.

## Adding a type

1. Write `schemas/<namespace>/<name>.schema.json` with `title: "<namespace>.<name>"`, the three `x-dtp-*` keywords, and `additionalProperties: false` + `patternProperties ^x_`.
2. Register it in `index.json`.
3. `npm run build`; add an example write to the tests.
4. Describe it in `SPEC.md` under its namespace and in `docs/PROTOCOL_STORE.md`'s type catalog.
