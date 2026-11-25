# `@dtp/sdk` changelog

Every change to the behaviour of a packed entry (`@dtp/sdk`, `@dtp/sdk/preview`, `@dtp/sdk/preview/foundation`, or the packed `package.json`) bumps the version in [`package.json`](package.json) and adds an entry here, in the same pull request, saying what behaviour changed. Two artifacts that behave differently therefore never share a version, and `npm pack` never writes two different artifacts under one file name. This follows the owner's decisions on [#73](https://github.com/runquik/direct-trade-protocol/issues/73) of 2026-10-22 (bump on every behaviour change) and 2026-11-04 (the label `0.2.1-dev.N`, with a changelog); see [`docs/decisions.md`](../docs/decisions.md).

Development versions are `0.2.1-dev.N`. `N` starts at 1 and goes up by one with each bump. Under semver every `0.2.1-dev.N` sorts after `0.2.0` and before a later release. The label claims no public release: the first public release target is still the one in [`docs/foundation/gates.json`](../docs/foundation/gates.json), and the package stays private.

Each entry names the kind of each change, as the builder baseline's table does: **additive** (something new; existing callers behave as before), **state shape** (state or snapshots built by an earlier artifact are not interchangeable), **conformance** (an earlier artifact disagrees with the specification or its vectors) or **security**. A change to source that no packed entry exports, such as the reference host behind `@dtp/sdk/preview/host`, needs no bump.

Each development entry records the digest of what its packed entries are built from, on a line `Packed source: \`<sha256>\``; `node scripts/packed-source-digest.ts` prints it. The digest covers the source files the packed entries reach, and the other inputs that decide how the artifact behaves (#212): the packed `package.json` (all of it except `version`, `devDependencies` and the scripts that cannot run while the artifact is packed or installed: every npm lifecycle script of packing and installing is kept, with the `pre` and `post` hooks of each kept script and every script a kept script names), the bytes of each file a kept script names, the installed version and integrity of each runtime dependency and of every package it needs in the lock file, and the compiler options `tsconfig.build.json` resolves to with the installed compiler's version, and [`packed-source.test.ts`](tests/release/packed-source.test.ts) fails when the source no longer matches the current entry. A pull request that changes any of these inputs therefore touches this file: it bumps the version and adds an entry, or, when no packed entry behaves differently (a comment, a refactor), it records the new digest in the current entry with a line naming the pull request and saying so. Because the test runs on `main` after every merge, a version-bump pull request reviewed before another packed-entry change merged cannot land with a stale entry unnoticed (#181).

## 0.2.1-dev.4

Core-1's envelope and identity bounds are fixed by the specification, not by verifier options (#218, **breaking** in `@dtp/sdk/preview` and `@dtp/sdk/preview/foundation`, **conformance**). `core1.verifyEnvelope` no longer takes `{ maxBytes, maxSignatures }`, and `verifyRecord` (`sdk/src/core1/record.ts`) no longer takes `limits`: the bounds are a signing input of at most 65,536 bytes, 1 to 24 signatures and a signature text of at most 128 characters, exported as `MAX_SIGNING_INPUT_BYTES`, `MAX_SIGNATURES` and `MAX_SIGNATURE_TEXT` (**additive**). `signEnvelope` and `signRecord` now refuse a signing input above the bound and more than 24 keys, with `invalid_envelope`; an earlier artifact signed them, and its own verifier then refused them. `signIdentity` refuses more than 24 keys and an identity signing input above 16,384 bytes in the same way; the identity bounds are exported as `IDENTITY_BOUNDS` (**additive**). The values are the ones an earlier artifact's verifier already applied by default, so no envelope that verified before under the default options is refused now. Core-1 parts 3 and 4 state the bounds; `spec/core-1/vectors/envelope.json` gains 2 accepts and 3 rejects, and `spec/vectors/identity-log.json` 2 accepts and 2 rejects, at each bound and one past it.

Stacked on #227 (`dev.3`). #203 (`dev.2`) and its stack #221 (`dev.3`) claim the same numbers from `main`; whichever line merges second is renumbered to the next free `N`.

Packed source: `11bc2028412488a7ce0d1e19a3c91de8890ac1071bd808d4b3a601d465f1279e`

## 0.2.1-dev.3

A Core-1 receiver reads a received text through the new `parseCore1Text` (`core1` in `@dtp/sdk/preview` and `@dtp/sdk/preview/foundation`, **additive**), which refuses, on the raw text before parsing, a number written with a fraction or an exponent (`non_integer_number`, #217, **conformance**), as well as the existing member-name checks. An earlier artifact had no Core-1 text entry point, and a Core-1 text parsed with `parseUntrustedJson` accepted `1.0`, `2.0`, `1.7620001e12` and `1.0000000000000001`, so a relay could re-spell a signed record without a key and an exact-decimal verifier would disagree about it. Core-1 part 1 states the rule; new vectors `spec/core-1/vectors/text.json`; the `numbers` section of `spec/vectors/unsafe-json.json` now covers Core-1 as well as v0.4.

Stacked on #226 (`dev.2`). #203 (`dev.2`) and its stack #221 (`dev.3`) claim the same numbers from `main`; whichever line merges second is renumbered to the next free `N`.

Packed source: `279ddbceda9344d3d32730dba0597c7114350fdf1d0ef2ec48f8b0ee8a15fb5a`

## 0.2.1-dev.2

Removing a person from a company's controllers through `organization.policy` revokes them, as `membership.revoke` revokes a member (#225, **security**). In `@dtp/sdk/preview`, `revokedAt` (`v04Permissions`) now also counts an `organization.policy` that removed the person, so their policy grants stop counting and a later re-admission does not restore them; the engine disables a membership the person held before promotion and their outstanding invitations at removal, and refuses with `409 conflict` a removal signed before a newer revision of a policy that grants them; the snapshot replay applies the same removal, so a company whose removed controller had been a member migrates. An earlier artifact let a removed controller regain every grant they held on any later re-admission, and revived a membership held before promotion, with its administration permissions, at removal. New exports `revocationOrdered` and `endMembership` (`v04Permissions`, **additive**). `spec/vectors/membership-revocation.json` gains six removed-controller scenarios.

#203 (`dev.2`) and its stack #221 (`dev.3`) claim the same numbers from `main`; whichever of the two lines merges second is renumbered to the next free `N`.

Packed source: `9ed33485ef250b1e4512ec460cdbca6aa4c203a92730e6e1e90b410dbb5331eb`

## 0.2.1-dev.1

The first labelled version, set at `3dd0f39` (#167). Its packed entries behave exactly as a `0.2.0` artifact packed from `main` at `cc20088` (the merge of #163, the newest row of the builder baseline's table, see `0.2.0` below) or at any later commit up to `129f917`, the commit before the version was set. What changes is the version, the tarball name, `dtp-sdk-0.2.1-dev.1.tgz`, and that the tarball now ships this changelog (**additive**, in the packed `package.json`'s `files`). Against an earlier `0.2.0` artifact, every row of that table applies from its merge on; against one packed at `9946c60`, the table's two newest rows apply: `2e37251` (#159, `identityLog` refuses identity log format 1) and `cc20088` (#163, an `inventory@2` or `flow@1` reservation is released, fulfilled and topped up only by its claim's party), both **conformance**.

An earlier text of this entry put the boundary at `45045a7` and said nothing that landed later changed a packed entry. That was wrong: #159 and #163 merged after #167 was reviewed and before it merged (#181).

The digest below was recomputed when it began to cover the packed `package.json`, the runtime dependency and the compiler settings as well as the source (#212). Nothing packed changed: the source digest of this version was `f46d0c29f34062bb7fcd6d3dd7474d70bbd5295f5c25d76e560f57bc9c47273a`.

Packed source: `209b84e0045ab4622bf0c34aa918d8ec7ee62594d9725aa4ff5657c6567d2c0d`

## 0.2.0

Packed at many commits under one version, so the version does not tell these artifacts apart; only the commit and the integrity hash do. [Section 1 of the external builder baseline](../docs/EXTERNAL_BUILDER_BASELINE.md#changes-to-the-packed-sdk-since-the-first-pin) lists every merge that changed a packed entry from the first pin, `df13e4c`, to `cc20088`, with its kind. An artifact packed before a row marked conformance or security does not meet the current specification on that point.
