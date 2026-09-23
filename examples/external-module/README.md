# External module example: a read-only inventory exception module

This directory is a module built the way an outside team would build one: in its own package, in plain JavaScript on the pinned Node 22.23.2 runtime, with the packed `@dtp/sdk` as its only dependency and a disposable host it never edits. It is the executable half of [the external builder baseline](../../docs/EXTERNAL_BUILDER_BASELINE.md).

What it proves: from a clean directory, install the packed SDK, connect to the documented host, become an installed module under one company's authority, consume that company's records of two protocol kinds, derive an exception and replenishment assessment that keeps every identifier and every source observation, and be refused another company's records, a tampered command, an expired command and a write. What it does not prove: independent conformance (it imports the SDK), physical truth of any quantity, or anything about a production host.

## Run it

1. Pack the SDK from the protocol repository (the `prepack` hook emits JavaScript and type declarations first):

   ```bash
   cd sdk && npm ci && npm pack
   ```

   This writes `sdk/dtp-sdk-0.2.0.tgz`, which this example's `package.json` depends on by path.

2. Install and prepare the host configuration:

   ```bash
   cd examples/external-module && npm install && node prepare.mjs
   ```

   `prepare.mjs` generates a synthetic assessor key and writes `synthetic/dev-host.json`, the host's operator configuration: the port, a data directory, and the assessor pinned as the only trusted issuer of module assessments. Everything under `synthetic/` is a development secret; it is ignored by git.

3. Start the disposable host from that file (from `sdk`):

   ```bash
   npm run dev:dtp-v04 -- ../examples/external-module/synthetic/dev-host.json
   ```

   The host keeps its key and state in the data directory across restarts. Deleting the directory is the reset.

4. Seed and read:

   ```bash
   node seed.mjs && node read.mjs
   ```

   `seed.mjs` creates two synthetic companies with a product and stock facts each, a sponsoring member of company A, the module's release with a signed assessment, and its installation under one of A's policies: read only, unattended, expiring. `read.mjs` is the module. Its report is one JSON document on stdout.

Set `DTP_AUDIENCE` to point the scripts at a host on another port and `DTP_EXAMPLE_HOME` to keep the synthetic files elsewhere. The repository test `sdk/tests/release/external-package.test.ts` runs exactly these scripts, copied out of the tree, against a host started from the configuration file.

## What the module does, step by step

| Step | Command | Who signs |
|---|---|---|
| Discover the host | `GET /dtp/v0.4/health` | nobody; the audience must match what the module expects |
| Read company A's records of the kinds it understands, page by page | `records.list {after, limit, profile_digests: [], kinds: ["dtp/product@1", "dtp/inventory@2"]}` | the installation key alone, actor kind `installation`, `requested_by: null` (automation mode) |
| Read the host's derived ledger for the product | `inventory.ledger {policy_id, product_id}` | the installation key |
| Derive the assessment | none: local computation in exact thousandths of the base unit | nobody |
| Replay the identical signed read | the retained command bytes | already signed; the host recomputes under current authority |

The assessment names, for every position, the on-hand quantity, the quantity claimed by reservations, the unreserved remainder, and the exact facts that touched the position: record id, host sequence and acceptance time, and the producer's own observation (`source_id`, `sequence`, `occurred_at`). An exception is a position whose unreserved quantity is below the module's own minimum, with the product's root id, revision id, names, base unit and every recorded identifier (GTIN, SKU, supplier code) carried through unchanged. The report says what it is: derived from the producers' recorded facts as the host accepted them, not physical truth, not completeness, not authority to act.

## What the host refuses, and why

| Probe | Response | Rule |
|---|---|---|
| The same installation reading company B | `403 forbidden` | an installation belongs to one company; B never admitted it |
| A signed page request with one payload field changed afterwards | `401 signature_invalid` | the signature covers the canonical bytes of the whole command |
| A command issued ten minutes ago | `401 expired` | commands live at most five minutes |
| A read-only installation appending a record | `403 forbidden` | data access is the intersection of release actions, installation actions and the sponsor's grant |

## Where the pieces come from

- Contract digests for the two kinds are pinned in `common.mjs` from the protocol registry (`spec/profiles/index.json`). A module states exactly what it understands; the host answers `unsupported_profile` for a kind it has not admitted rather than an empty page.
- The product body is the accepted fixture of `dtp/product@1`; the facts follow the `dtp/inventory@2` fixtures: a receipt in packs, a transfer, a reservation, a shipment.
- The module's artifact digest is the SHA-256 of `read.mjs`; the assessment token binds it. The protocol never downloads or runs the artifact: the token means only that the pinned assessor said so.
