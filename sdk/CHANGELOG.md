# `@dtp/sdk` changelog

Every change to the behaviour of a packed entry (`@dtp/sdk`, `@dtp/sdk/preview`, `@dtp/sdk/preview/foundation`, or the packed `package.json`) bumps the version in [`package.json`](package.json) and adds an entry here, in the same pull request, saying what behaviour changed. Two artifacts that behave differently therefore never share a version, and `npm pack` never writes two different artifacts under one file name. This follows the owner's decisions on [#73](https://github.com/runquik/direct-trade-protocol/issues/73) of 2026-10-22 (bump on every behaviour change) and 2026-11-04 (the label `0.2.1-dev.N`, with a changelog); see [`docs/decisions.md`](../docs/decisions.md).

Development versions are `0.2.1-dev.N`. `N` starts at 1 and goes up by one with each bump. Under semver every `0.2.1-dev.N` sorts after `0.2.0` and before a later release. The label claims no public release: the first public release target is still the one in [`docs/foundation/gates.json`](../docs/foundation/gates.json), and the package stays private.

Each entry names the kind of each change, as the builder baseline's table does: **additive** (something new; existing callers behave as before), **state shape** (state or snapshots built by an earlier artifact are not interchangeable), **conformance** (an earlier artifact disagrees with the specification or its vectors) or **security**. A change to source that no packed entry exports, such as the reference host behind `@dtp/sdk/preview/host`, needs no bump.

Each development entry records the digest of the source its packed entries are built from, on a line `Packed source: \`<sha256>\``; `node scripts/packed-source-digest.ts` prints it, and [`packed-source.test.ts`](tests/release/packed-source.test.ts) fails when the source no longer matches the current entry. A pull request that changes that source therefore touches this file: it bumps the version and adds an entry, or, when no packed entry behaves differently (a comment, a refactor), it records the new digest in the current entry with a line naming the pull request and saying so. Because the test runs on `main` after every merge, a version-bump pull request reviewed before another packed-entry change merged cannot land with a stale entry unnoticed (#181).

## 0.2.1-dev.1

The first labelled version, set at `3dd0f39` (#167). Its packed entries behave exactly as a `0.2.0` artifact packed from `main` at `cc20088` (the merge of #163, the newest row of the builder baseline's table, see `0.2.0` below) or at any later commit up to `129f917`, the commit before the version was set. What changes is the version, the tarball name, `dtp-sdk-0.2.1-dev.1.tgz`, and that the tarball now ships this changelog (**additive**, in the packed `package.json`'s `files`). Against an earlier `0.2.0` artifact, every row of that table applies from its merge on; against one packed at `9946c60`, the table's two newest rows apply: `2e37251` (#159, `identityLog` refuses identity log format 1) and `cc20088` (#163, an `inventory@2` or `flow@1` reservation is released, fulfilled and topped up only by its claim's party), both **conformance**.

An earlier text of this entry put the boundary at `45045a7` and said nothing that landed later changed a packed entry. That was wrong: #159 and #163 merged after #167 was reviewed and before it merged (#181).

Packed source: `f46d0c29f34062bb7fcd6d3dd7474d70bbd5295f5c25d76e560f57bc9c47273a`

## 0.2.0

Packed at many commits under one version, so the version does not tell these artifacts apart; only the commit and the integrity hash do. [Section 1 of the external builder baseline](../docs/EXTERNAL_BUILDER_BASELINE.md#changes-to-the-packed-sdk-since-the-first-pin) lists every merge that changed a packed entry from the first pin, `df13e4c`, to `cc20088`, with its kind. An artifact packed before a row marked conformance or security does not meet the current specification on that point.
