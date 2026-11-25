# `@dtp/sdk` changelog

Every change to the behaviour of a packed entry (`@dtp/sdk`, `@dtp/sdk/preview`, `@dtp/sdk/preview/foundation`, or the packed `package.json`) bumps the version in [`package.json`](package.json) and adds an entry here, in the same pull request, saying what behaviour changed. Two artifacts that behave differently therefore never share a version, and `npm pack` never writes two different artifacts under one file name. This follows the owner's decisions on [#73](https://github.com/runquik/direct-trade-protocol/issues/73) of 2026-10-22 (bump on every behaviour change) and 2026-11-04 (the label `0.2.1-dev.N`, with a changelog); see [`docs/decisions.md`](../docs/decisions.md).

Development versions are `0.2.1-dev.N`. `N` starts at 1 and goes up by one with each bump. Under semver every `0.2.1-dev.N` sorts after `0.2.0` and before a later release. The label claims no public release: the first public release target is still the one in [`docs/foundation/gates.json`](../docs/foundation/gates.json), and the package stays private.

Each entry names the kind of each change, as the builder baseline's table does: **additive** (something new; existing callers behave as before), **state shape** (state or snapshots built by an earlier artifact are not interchangeable), **conformance** (an earlier artifact disagrees with the specification or its vectors) or **security**. A change to source that no packed entry exports, such as the reference host behind `@dtp/sdk/preview/host`, needs no bump.

Each development entry records the digest of what its packed entries are built from, on a line `Packed source: \`<sha256>\``; `node scripts/packed-source-digest.ts` prints it. The digest covers the source files the packed entries reach, and the other inputs that decide how the artifact behaves (#212): the packed `package.json` (all of it except `version`, `devDependencies` and the scripts that cannot run while the artifact is packed or installed: every npm lifecycle script of packing and installing is kept, with the `pre` and `post` hooks of each kept script and every script a kept script names), the bytes of each file a kept script names, the installed version and integrity of each runtime dependency and of every package it needs in the lock file, and the compiler options `tsconfig.build.json` resolves to with the installed compiler's version, and [`packed-source.test.ts`](tests/release/packed-source.test.ts) fails when the source no longer matches the current entry. A pull request that changes any of these inputs therefore touches this file: it bumps the version and adds an entry, or, when no packed entry behaves differently (a comment, a refactor), it records the new digest in the current entry with a line naming the pull request and saying so. Because the test runs on `main` after every merge, a version-bump pull request reviewed before another packed-entry change merged cannot land with a stale entry unnoticed (#181).

## 0.2.1-dev.3

An `order@1` revision that leaves `placed` (to `acknowledged`, `rejected` or `cancelled`) carries the lines and terms of the `placed` head unchanged (#230, **conformance**). In `@dtp/sdk/preview`, `order.checkOrderContinuity` freezes lines and terms on every revision except `placed` to `placed`; an earlier artifact let the acknowledging, rejecting or cancelling revision rewrite every line, price and term. The host refuses such a revision `invalid_order`, and snapshot import re-checks it. A seller's counter-offer is a `placed` revision, then acknowledged. The continuity fixtures gain one accept and three rejects; the contract digest is unchanged.

Stacked on #232 (`dev.2`); renumbered with it if that line merges after another `dev.2`.

Packed source: `10c8c92b87529feeceac36256e902b4655d4b4ae0afcfd14ce03ab2a06420d81`

## 0.2.1-dev.2

An `order@1` line quantity and a `forecast@1` quantity in a packaging revision must convert to a whole number of thousandths of the base unit, as an `inventory@2` quantity must (#229, **conformance**). In `@dtp/sdk/preview`, `order.validateOrder` and `forecast.validateForecast` now refuse, for example, `0.001` of a pack of `2.5` (0.0025 base units), which an earlier artifact accepted although `inventory@2` refuses it; the host refuses such a record `invalid_order` or `invalid_forecast`, and snapshot import re-checks it. The product-lookup rules of the `inventory@2` unit object are not adopted. New export `order.convertsExactly` (**additive**). The fixtures of both profiles gain one accept and one reject; their contract digests are unchanged.

#203 (`dev.2`, stack #221 `dev.3`) and #226 (`dev.2`, stack #227 `dev.3`, #228 `dev.4`) claim the same numbers from `main`; whichever lines merge after the first are renumbered to the next free `N`.

Packed source: `48f4ebfe28b7e6e976dd071503c20772335b97148652054fa6cc79da8b140969`

## 0.2.1-dev.1

The first labelled version, set at `3dd0f39` (#167). Its packed entries behave exactly as a `0.2.0` artifact packed from `main` at `cc20088` (the merge of #163, the newest row of the builder baseline's table, see `0.2.0` below) or at any later commit up to `129f917`, the commit before the version was set. What changes is the version, the tarball name, `dtp-sdk-0.2.1-dev.1.tgz`, and that the tarball now ships this changelog (**additive**, in the packed `package.json`'s `files`). Against an earlier `0.2.0` artifact, every row of that table applies from its merge on; against one packed at `9946c60`, the table's two newest rows apply: `2e37251` (#159, `identityLog` refuses identity log format 1) and `cc20088` (#163, an `inventory@2` or `flow@1` reservation is released, fulfilled and topped up only by its claim's party), both **conformance**.

An earlier text of this entry put the boundary at `45045a7` and said nothing that landed later changed a packed entry. That was wrong: #159 and #163 merged after #167 was reviewed and before it merged (#181).

The digest below was recomputed when it began to cover the packed `package.json`, the runtime dependency and the compiler settings as well as the source (#212). Nothing packed changed: the source digest of this version was `f46d0c29f34062bb7fcd6d3dd7474d70bbd5295f5c25d76e560f57bc9c47273a`.

Packed source: `209b84e0045ab4622bf0c34aa918d8ec7ee62594d9725aa4ff5657c6567d2c0d`

## 0.2.0

Packed at many commits under one version, so the version does not tell these artifacts apart; only the commit and the integrity hash do. [Section 1 of the external builder baseline](../docs/EXTERNAL_BUILDER_BASELINE.md#changes-to-the-packed-sdk-since-the-first-pin) lists every merge that changed a packed entry from the first pin, `df13e4c`, to `cc20088`, with its kind. An artifact packed before a row marked conformance or security does not meet the current specification on that point.
