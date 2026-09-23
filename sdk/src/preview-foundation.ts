// PREVIEW ENTRY POINT, FOUNDATION ONLY. Unreleased, no compatibility promise (see preview.ts).
//
// This is the preview entry without the v0.4 candidate. Everything reachable from here is
// portable AND dependency-free: no platform module and no third-party package, so it bundles for
// an edge runtime or a browser with nothing but this repository's own sources. The v0.4 pieces
// (`v04Model`, `v04Wire`, `v04Permissions`, `v04Profiles`, `v04Client`) pull in a JSON Schema
// validator and therefore live only in preview.ts. tests/profiles/entrypoints.test.ts holds this
// entry to both promises by loading it under a resolver that refuses every bare specifier.
//
// Which entry to use:
//   @dtp/sdk                     stable encodings, canonicalization, keys, envelope signing
//   @dtp/sdk/preview/foundation  identity, identity log, organization, authority, records vocabulary,
//                                profiles and the onboarding client, with no dependency at all
//   @dtp/sdk/preview             the above plus the v0.4 candidate (needs @cfworker/json-schema)
//   @dtp/sdk/preview/host        pieces that need a database, a listener or host keys
//
// The namespaces here are the same module objects as in preview.ts, not copies.

export * as keys from "./keys.ts";
export * as canonical from "./canonical.ts";
export * as safeJson from "./safe-json.ts";

export * as decimal from "./profiles/decimal.ts";
export * as inventory from "./profiles/inventory.ts";
export * as invoice from "./profiles/invoice.ts";
export * as product from "./profiles/product.ts";
export * as inventory2 from "./profiles/inventory2.ts";

export * as datatypes from "./foundation/datatypes.ts";
export * as semantics from "./foundation/semantics.ts";
export * as identity from "./foundation/identity.ts";
export * as identityLog from "./foundation/identity-log.ts";
export * as organization from "./foundation/organization.ts";
export * as authority from "./foundation/authority.ts";
export * as changes from "./foundation/changes.ts";
export * as commitments from "./foundation/commitments.ts";
export * as discovery from "./foundation/discovery.ts";

export * as onboarding from "./onboarding/client.ts";
