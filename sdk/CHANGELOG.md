# `@dtp/sdk` changelog

Every change to the behaviour of a packed entry (`@dtp/sdk`, `@dtp/sdk/preview`, `@dtp/sdk/preview/foundation`, or the packed `package.json`) bumps the version in [`package.json`](package.json) and adds an entry here, in the same pull request, saying what behaviour changed. Two artifacts that behave differently therefore never share a version, and `npm pack` never writes two different artifacts under one file name. This follows the owner's decisions on [#73](https://github.com/runquik/direct-trade-protocol/issues/73) of 2026-10-22 (bump on every behaviour change) and 2026-11-04 (the label `0.2.1-dev.N`, with a changelog); see [`docs/decisions.md`](../docs/decisions.md).

Development versions are `0.2.1-dev.N`. `N` starts at 1 and goes up by one with each bump. Under semver every `0.2.1-dev.N` sorts after `0.2.0` and before a later release. The label claims no public release: the first public release target is still the one in [`docs/foundation/gates.json`](../docs/foundation/gates.json), and the package stays private.

Each entry names the kind of each change, as the builder baseline's table does: **additive** (something new; existing callers behave as before), **state shape** (state or snapshots built by an earlier artifact are not interchangeable), **conformance** (an earlier artifact disagrees with the specification or its vectors) or **security**. A change to source that no packed entry exports, such as the reference host behind `@dtp/sdk/preview/host`, needs no bump.

## 0.2.1-dev.1

The first labelled version. Its packed entries behave exactly as a `0.2.0` artifact packed from `main` at `9946c60` (the merge of #151, the newest row of the builder baseline's table, see `0.2.0` below) or at any later commit up to `45045a7`. What changes is the version, the tarball name, `dtp-sdk-0.2.1-dev.1.tgz`, and that the tarball now ships this changelog (**additive**, in the packed `package.json`'s `files`). Against an earlier `0.2.0` artifact, every row of that table applies from its merge on.

## 0.2.0

Packed at many commits under one version, so the version does not tell these artifacts apart; only the commit and the integrity hash do. [Section 1 of the external builder baseline](../docs/EXTERNAL_BUILDER_BASELINE.md#changes-to-the-packed-sdk-since-the-first-pin) lists every merge that changed a packed entry from the first pin, `df13e4c`, to `9946c60`, with its kind. An artifact packed before a row marked conformance or security does not meet the current specification on that point.
