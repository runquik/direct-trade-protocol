// PREVIEW ENTRY POINT. Everything re-exported here is unreleased and may change or disappear
// without notice; it is not part of the stable surface in index.ts and carries no
// compatibility promise. It exists so that implementers exercise the candidate and foundation
// layers through one door instead of importing internal file paths.
//
// This entry is portable: nothing it reaches may import a platform module, so it loads in
// browsers and edge runtimes as well as Node and Deno. Pieces that need a database or a
// server live in preview-host.ts. Namespaces keep the layers' overlapping names apart.
//
// KEYS. The one exception to "unreleased" is `keys`: it is the stable key module from
// index.ts, re-exported unchanged (the same function objects), so that whoever signs or
// countersigns through this entry, a wallet or a host holding its own resolver key, needs no
// second import and never an internal file path. The stable entry is equally portable;
// tests/profiles/entrypoints.test.ts holds both entries to that.

export * as keys from "./keys.ts";

export * as decimal from "./profiles/decimal.ts";
export * as inventory from "./profiles/inventory.ts";
export * as invoice from "./profiles/invoice.ts";

export * as datatypes from "./foundation/datatypes.ts";
export * as semantics from "./foundation/semantics.ts";
export * as identity from "./foundation/identity.ts";
export * as authority from "./foundation/authority.ts";
export * as changes from "./foundation/changes.ts";
export * as commitments from "./foundation/commitments.ts";
export * as discovery from "./foundation/discovery.ts";

export * as onboarding from "./onboarding/client.ts";

export * as v04Model from "./v04/model.ts";
export * as v04Wire from "./v04/wire.ts";
export * as v04Permissions from "./v04/permissions.ts";
export * as v04Profiles from "./v04/profiles.ts";
export * as v04Client from "./v04/client.ts";
