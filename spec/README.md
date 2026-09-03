# spec/ — DTP v0.2 normative artifacts

The prose specification is [`/SPEC.md`](../SPEC.md). This directory holds what *decides*:

| Path | What it is | Normative? |
|---|---|---|
| `schemas/index.json` | The type registry: every record type, its schema file, supported versions, who may write it, which body field is the subject, default visibility | yes |
| `schemas/core/envelope.schema.json` | The record envelope every record shares | yes |
| `schemas/{core,trade,finance,traceability}/*.schema.json` | One body schema per record type, each carrying `x-dtp-subject`, `x-dtp-roles`, `x-dtp-transitions` | yes |
| `schemas/common/*.schema.json` | Shared sub-objects: ids, `Money`, `Quantity`, `Address`, `Key`, `Attestation`, `CertificationRef`, `KybRef` | yes |
| `vectors/keys.json` | A fixed Ed25519 key (published on purpose; never use it for anything real) | yes |
| `vectors/canonicalization.json` | Inputs → canonical JSON → SHA-256 | yes |
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
