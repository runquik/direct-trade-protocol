# External builder baseline

September 23, 2026. The maintainers' answer to a module team that will build small business modules in its own repositories against this protocol's documented contracts, starting with a read-oriented inventory exception and replenishment module. It names one supported combination, how to obtain it, what it can prove today, and what it cannot. It is a development baseline, not production certification, and nothing in it depends on any particular workspace, marketplace or deployment provider.

Everything below was verified on the tree that carries this document, on the pinned Node 22.23.2, by the same author who implemented it. Independent review and an unfamiliar external builder completing the exercise remain open, as for every unreleased slice.

## 1. The supported baseline

Pin the merge commit of this document on `main` (the state it was built on is `bb2ef80`, the merge of the business-fact profiles). Everything in one row of the table is meant to be used together; nothing across previews is meant to be combined by assumption.

| Surface | Supported for this experiment | Where |
|---|---|---|
| Specification | The 0.4 reference candidate: signed commands, people and companies, policies and grants, profiles and module releases, records and reads, bounds and error classes | [`spec/v0.4/SPEC.md`](../spec/v0.4/SPEC.md) sections 2 to 6 and 9; the command vocabulary in [`command.schema.json`](../spec/v0.4/command.schema.json) |
| Wire conformance | Canonical JSON, safe-integer numbers, member-name rule, Ed25519 keys and signatures, the fixed signing vector | [`signing-vector.json`](../spec/v0.4/signing-vector.json), [`spec/vectors/canonicalization.json`](../spec/vectors/canonicalization.json), [`spec/vectors/unsafe-json.json`](../spec/vectors/unsafe-json.json), [`docs/security/json-member-names.md`](security/json-member-names.md) |
| Domain contract | The registered protocol kinds `dtp/product@1` and `dtp/inventory@2` (and, registered but outside the first slice, `dtp/party@1`, `dtp/order@1`, `dtp/forecast@1`) | [`spec/profiles/index.json`](../spec/profiles/index.json) pins the exact contract digests; documents and fixtures under [`spec/profiles/`](../spec/profiles/) |
| SDK | `@dtp/sdk` 0.2.0, packed from this commit; entries `@dtp/sdk`, `@dtp/sdk/preview/foundation`, `@dtp/sdk/preview` | section 2 |
| Runtime | Node 22.23.2 ([`.node-version`](../.node-version)); the package's `engines` allows 22.23.2 up to, not including, 23 | |
| Reference host | The disposable candidate host on embedded Postgres, configured from a file | [`sdk/scripts/dtp-v04-dev-server.ts`](../sdk/scripts/dtp-v04-dev-server.ts); section 3 |
| Executable example | A module in its own package against the packed SDK and the configured host | [`examples/external-module/`](../examples/external-module/README.md) |

**How the candidate and the foundation relate.** The 0.4 candidate is the served surface: the host, the command vocabulary, the records and the reads a module uses. The foundation layer ([`docs/foundation/README.md`](foundation/README.md)) is a set of portable libraries with published vectors: identity control and identity logs, organization genesis and governance, authority delegation, record datatypes, replayable change views, discovery and commitments. They are reachable from `@dtp/sdk/preview/foundation` and tested against their vectors, but **the 0.4 host does not serve them**: it does not authenticate with foundation identities, does not publish change views and does not accept foundation datatypes in payloads. Person and company identifiers in the two layers derive from different domains and are not the same identities. For this experiment a module uses the candidate only; foundation modules are experimental and must not be mixed in on the assumption that the host understands them. The frozen 0.2 store, the 0.3 authority preview and the onboarding preview host are separate systems and are not part of this baseline.

**Supported versus experimental, in one line each.** Supported: the candidate command surface, the five registered kinds, the three package entries, the file-configured host. Experimental: every foundation module, the `preview/host` entry, the remote authority, evidence and migration commands (implemented and tested, but the first slice does not need them and the portability claim in section 9 is bounded on purpose).

## 2. The SDK as a consumable artifact

Until this change, the package's entries pointed at TypeScript sources, which Node refuses to load from a consumer's `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`); the SDK could be used inside this repository and nowhere else. The package now emits JavaScript and type declarations for its three portable entries when it is packed:

```bash
cd sdk && npm ci && npm pack
```

`npm pack` runs the `prepack` hook, which builds `dist/` with [`tsconfig.build.json`](../sdk/tsconfig.build.json) and produces `dtp-sdk-0.2.0.tgz`. Record the integrity hash npm prints beside the commit; that pair is the version of the artifact. A consumer installs it by path (`npm install ../path/to/dtp-sdk-0.2.0.tgz`), which also installs the one runtime dependency of the `preview` entry, `@cfworker/json-schema`.

| Entry | Needs | Contents |
|---|---|---|
| `@dtp/sdk` | nothing | canonical JSON and SHA-256, Ed25519 keys and encodings, envelope signing, the safe JSON parser |
| `@dtp/sdk/preview/foundation` | nothing | the above as namespaces, plus the profile validators and reducers (`product`, `inventory2`, `party`, `order`, `forecast`), the foundation libraries, the onboarding client |
| `@dtp/sdk/preview` | `@cfworker/json-schema` | the above plus the 0.4 candidate client side: `v04Wire` (id derivation, drafting, signing, digests), `v04Client` (`DtpClient`, `DtpResponseError`), `v04Profiles`, `v04Model`, `v04Permissions` |
| `@dtp/sdk/preview/host` | a database, the repository | the host side; source only, not packed for consumers |

Portable means nothing reachable imports a platform module, so the entries also load in Deno, browsers and edge runtimes; a test enforces it. The repository test [`sdk/tests/release/external-package.test.ts`](../sdk/tests/release/external-package.test.ts) builds the package, installs it into a temporary `node_modules`, imports every entry by bare specifier, and runs the example from outside the tree. A module that imports the SDK has integration coverage of the SDK; it is not independent evidence about the wire specification. The independent crypto-only client in [`sdk/tests/v04/independent-client.ts`](../sdk/tests/v04/independent-client.ts) shows what a second implementation must reproduce.

## 3. The reference environment

Start the host from a configuration file so that nothing about pins, assessors, capacity or persistence is a source edit:

```bash
cd sdk && npm run dev:dtp-v04 -- path/to/dev-host.json
```

The file is a closed JSON object; an unknown member is refused. Members, all optional:

| Member | Meaning |
|---|---|
| `port` | listening port on `127.0.0.1` (default 8790) |
| `data_dir` | directory for the embedded Postgres files and the host key; without it the host is in memory and forgets everything on exit |
| `pins` | trusted remote host keys, issuer origin to key id (remote authority and evidence; not needed for the first slice) |
| `assessment_pins` | trusted module assessors, issuer to key id; without one, no module can be installed |
| `revoked_assessments` | digests of assessment tokens to refuse |
| `reference_profiles` | invoice reference pins (not needed for the first slice) |
| `max_state_bytes` | serialized state ceiling (default 128 MiB) |

Enrollment: the host prints its audience and key id on start and advertises both at `GET /dtp/v0.4/health`. On loopback that is the trust procedure. Anywhere else, obtain the key through a path you trust; a health response is discovery, not a trust anchor.

Persistence and reset: with `data_dir`, the host key and all state survive restarts; the audience stays the same, so a module's pinned host key stays valid. Deleting the directory is the reset, and the test above checks that a deleted directory is a new host that knows nobody. There is no backup, no multi-process access and no production durability claim; the ceiling is the configured `max_state_bytes`, and every other bound is in [SPEC section 9](../spec/v0.4/SPEC.md#9-mandatory-candidate-bounds-and-errors).

Synthetic companies, principals and credentials: [`examples/external-module/seed.mjs`](../examples/external-module/seed.mjs) creates them over the signed API and writes every generated secret to a gitignored file. There are no built-in accounts; a fresh host is empty by design. Nothing in the example touches the host's storage or source.

## 4. A complete authority example

The example is the worked case; each step maps to the specification.

| Step | Command | Who signs | Specification |
|---|---|---|---|
| A person exists | `person.register {keys}` | the person's key (possession proof) | §3 |
| A company exists | `organization.create {name, nonce, controllers, threshold}` | the founding controller | §3 |
| The company has a policy with grants | `policy.create {policy_id, expected_revision, classification, stewards, threshold, grants}` | the steward quorum | §4 |
| The company understands the protocol kinds | `profile.admit {digest}` per registered contract | a member with `profiles.publish` (a controller has it) | §5 |
| A sponsoring member exists | `membership.invite {..., permissions: ["installations.manage"]}` then `membership.accept` | inviter, then the invited person | §3 |
| The sponsor may read | `policy.update` adding a `read` grant for the sponsor | the steward quorum, with the exact `expected_revision` | §4 |
| The module is described | `release.publish {module_id, version, artifact_digest, profiles, actions, visibility, assessment}` | a member with `releases.publish` | §5 |
| Someone the host trusts approved the artifact | the `module-assessment` token inside the release | the assessor's key, pinned in `assessment_pins` | §5 |
| The company installs the module | `installation.create {installation_id, release_digest, key_id, policy_ids, actions, mode, expires_at}` | the sponsor, cosigned by the installation key (possession proof) | §4, §5 |
| The module reads, unattended | `records.list`, `record.get`, `inventory.ledger`, `profile.get` with actor kind `installation` and `requested_by: null` | the installation key alone | §4 |
| The module reads on a person's behalf | the same, with `requested_by` set and that person cosigning | installation key and the person's key | §4 |

Identity of a module: an installation id and an Ed25519 key that the module holds; nobody discloses a person's private key to it. Attribution: the host appends the accepted command (actor, `requested_by`, signatures) to every record, so an automated action is attributed to the installation and its sponsor, and a person-requested one to that person as well. Scope: data access is the intersection of the release's declared profiles and actions, the installation's policies and actions, the live assessment, and the sponsor's or requesting person's current grant; the example's installation is read only and the report shows its write refused. Expiry: memberships, grants, installations and assessments all carry an `expires_at`; commands live at most five minutes. Revocation: `installation.revoke`, `membership.revoke`, a grant removed by `policy.update`, an assessment listed in `revoked_assessments` or expired; each stops the next command, including a replay of a previously accepted one. Revocation does not recall data already read.

## 5. The first workflow's domain contract

Read, in this order: [`dtp/product@1`](../spec/profiles/product/1.md), then [`dtp/inventory@2`](../spec/profiles/inventory/2.md). The contract digests in the registry are the exact objects a module accepts; the example pins both.

- **Products and external identifiers.** The product is the record root; identifiers are `{scheme, value}` claims namespaced by scheme, with `gs1.gtin` check-digit validated and `sku` at most once. Two identifiers on one product are a claim by the writer, not proof of identity.
- **Units and quantities.** `base_unit` is a UCUM code, syntax only; a quantity is a positive three-place decimal string in the base unit or in a published packaging revision with an exact whole-thousandths conversion. Nothing is ever rounded or converted between units. The example computes in thousandths with big integers; floats never touch a quantity.
- **Locations and lots.** Keys inside a company's ledger, not entities: a location or lot exists once a fact touches it. The four virtual locations are fixed. There is no location or facility master kind yet (see section 7).
- **Observations and movements.** A fact is one producer's observation `(source_id, sequence)` with a physical `occurred_at`, the ledger revision it expects, and legs between positions. Facts are immutable and never superseded.
- **Derived availability.** The host's `inventory.ledger` gives positions (on hand) and reservations (claims on a position); unreserved availability is the difference, which the module computes and the example reports per position.
- **Reservations, fulfilment, corrections and transformations** are write semantics in the same kind and are outside a read-only slice; the fixtures cover them.

The specific questions:

- *Physical events, imported observations, computed assessments.* Every `inventory@2` fact is an attributed statement by a source; the ledger is the host's deterministic reduction of those statements. The protocol does not mark a fact as physical versus imported; the `source_id` is the only distinction, and a module must keep it (the example does). A computed assessment is not an inventory fact and must not be written as one; it is a record of the module's own kind (section 7).
- *Ownership versus custody.* Out of scope of `inventory@2` by decision; a position says where stock is and in what status, not who owns it.
- *Unknown versus zero.* A position that no fact has touched does not exist in the ledger; a zero quantity is dropped. Absence is not a zero balance, and a module must not report an untouched location as empty. The `inventory-v1` fixtures test unknown-versus-zero explicitly; the foundation `Knowledge` datatype models `unknown` and `withheld` but is not accepted by the host.
- *Corrections.* Further facts through `~adjustment` with a reason; a correction cannot consume stock already reserved, and the ledger revision moves forward. Derived balances are recomputed from the facts; nothing is rewritten.
- *A signed statement attributes its source; it does not establish physical truth or completeness.* Agreed, and the ledger document says so in its last line.

## 6. Read/write and synchronization contracts

| Concern | Contract |
|---|---|
| Operations | `records.list`, `workspace.view`, `records.export` (`{after, limit, profile_digests, kinds}`), `record.get {id, profile_digest}`, `inventory.ledger {policy_id, product_id}`, `profile.get {digest}`; writes are `record.append` and the inventory openings. Reads recompute; nothing sensitive is cached in a stored response. |
| Errors | Stable codes and HTTP classes in [SPEC section 9](../spec/v0.4/SPEC.md#9-mandatory-candidate-bounds-and-errors); the example exercises `forbidden`, `signature_invalid`, `expired`, `unsupported_profile` (by construction of the kind selector). |
| Authority-filtered pagination | Authorization and accepted profiles filter before pagination; a page is 1 to 100 rows; `next_cursor` is the last returned sequence only when another page exists, `null` otherwise. Keep the greatest processed sequence; never reset to zero. |
| Revision conflicts | Inventory facts carry `expected_revision`; a mismatch is `revision_conflict`, and the answer is to reload and decide again. Record supersession has the same shape for state kinds. |
| Idempotent retries | Resend the identical signed command with the same `request_id`; changed content under the same id conflicts. A fresh id is a new business assertion. |
| Source deduplication | Per-source high-water mark with a window of 64 sequences: same digest is a duplicate (accepted, no effect), different digest is `observation_conflict`, below the window is `stale_observation`. |
| Ordering | Host `seq` is arrival order; `occurred_at` is physical time; keep both, derive with intent. |
| Snapshot and catch-up | Poll `records.list` from the greatest processed sequence. There is no push, subscription or change feed served by the host; the foundation change-view library exists as a pure oracle and is not served. |
| Replay | A previously accepted read replayed later is recomputed under current authorization (the example shows it). |
| Corrections | New facts, never rewrites. |
| Deletion and withholding | Not in the candidate: records are never deleted; withholding is a matter of what a policy grants. Revocation stops future reads and cannot recall copies. |
| Revocation during synchronization | The next page fails with `403`; a module must treat that as loss of authority, not as an empty tail. |

## 7. Extension and compatibility path

A company publishes a profile with `profile.publish` in the bounded `dtp.schema/1` dialect (closed objects, bounded strings and arrays, optional `nullable`), with `structural` semantics unless it is one of the built-in labels, and a kind name `<publisher organization id>/<name>@<major>`. Its digest is the contract; consumers accept digests explicitly and select by kind; an unknown required version is an explicit `unsupported_profile`, never silent field loss. Dependencies are exact digests of profiles the publisher may read. Visibility is `private` or `community`; readers are named. The publisher owns the meaning of a private profile. Minor versions within a kind must be additive.

For this module: an installation cannot publish profiles (installation actions are data actions only), so the company that runs the module publishes the assessment profile, for example `<company>/inventory-assessment@1`, and grants the installation `write` on the resource it may write to. An assessment record should carry the product root, the ledger revision and the exact facts it derived from, as the example's report does, so that a second consumer can check it.

Two concepts the first slice will meet that have no protocol kind yet: a location or facility master, and a distinction between a physical event and an imported observation beyond `source_id`. Both belong in the process of [the business-fact profiles proposal](foundation/business-fact-profiles-proposal.md): a document, an exact contract with fixtures, a reference validator, a second separately coded implementation, then a registry entry. Until then a private profile is the documented extension; an undocumented field convention is not interoperability.

## 8. The conformance pack

Run from `sdk` on Node 22.23.2 after `npm ci`:

| Command | What it establishes |
|---|---|
| `npm run build:dtp-v04 && git diff --exit-code -- ../spec/v0.4` | the signing vector and command schema regenerate byte-identically |
| `node --test tests/v04/independent-conformance.test.ts` | the crypto-only client against the host: the signing vector, altered bytes, expired commands |
| `node --test tests/v04/inventory2-profile.test.ts` | duplicate observations, stale sequences and revision conflicts over HTTP |
| `node --test tests/v04/review-probes.test.ts tests/v04/profile-admission.test.ts` | unauthorized access, installation scope, profile admission and unsupported-profile refusals |
| `node --test tests/interop/*.test.ts` | each profile's fixtures accepted and refused by the reference implementation and by a separately coded reader |
| `node scripts/build-product-profile.ts --check` (and the inventory, party, order, forecast generators) | the published contracts and fixtures match the generators |
| `node --test tests/release/external-package.test.ts` | the packed SDK, the configured host and the example from outside the tree |
| `npm run test:dtp-v04` | the whole candidate suite |

Separate clearly: the interop readers and the example are the same author's separately coded consumer agreement; the independent client is crypto-only but also this repository's; none of it is independent conformance by an unfamiliar builder. A second implementation of the signing vector and of the profile fixtures, written without reading the SDK, is the evidence that would count.

## 9. A bounded portability test

What a company's snapshot carries is stated in [SPEC section 8](../spec/v0.4/SPEC.md#8-cooperative-migration-and-recovery): owned records and history, key histories, policies, inventory openings and facts, releases, installed releases and published profiles. The rehearsal is two disposable hosts and synthetic records, with the sequence in [the builder guide](DTP_V04_BUILDER_GUIDE.md#rehearse-leaving-a-host-before-depending-on-it) and the HTTP fixture in [`sdk/tests/v04/migration-http.test.ts`](../sdk/tests/v04/migration-http.test.ts).

What is not guaranteed and must not be claimed: sequences are renumbered at the destination, so a module's cursor is not portable; every installation is disabled at the destination and must be reinstalled with fresh credentials and authorization; the module's own in-flight state (its cursor, its retained commands, its derived assessments) is the module's to carry; `records.export` is an authorized read, not a migration, and an export file is not proof of a migration. Provenance survives because records carry their original commands and signatures; a second consumer at the destination can verify them, which is the portability check that matters.

## 10. Change and feedback process

- Minimal reproductions go to this repository as an issue or a pull request: the fixture or command that was sent, the expected and observed result, and the versions from the table in section 1. A reproduction that fits in a test file under `sdk/tests` is best.
- A contract clarification lands as a change to the specification or profile document, its fixtures and, where the wire is affected, a vector, in one reviewed pull request; the merge commit is the new pinned baseline.
- The repository owner decides; the readers' and implementers' reports are inputs. Decisions on new kinds follow the proposal document's process.
- Breaking changes to a kind are a new major; the candidate itself carries no compatibility promise before its first release, and every change to a served surface is recorded in [`progress.md`](../progress.md) with its pull request.

## 11. What this experiment cannot establish

Independent conformance to the wire specification (the module imports the SDK); anything about physical stock, ownership or completeness; production behaviour of any host (the reference host is embedded Postgres on loopback, in one process); durability, backup or recovery; live change delivery (none is served); deletion or withholding semantics (none exist in the candidate); portability of a module's own state; a release gate that requires an unfamiliar external builder, which agent-assisted work in this repository does not satisfy.

## 12. Status of each request

| # | Request | Status | Owner | Next deliverable |
|---|---|---|---|---|
| 1 | One supported baseline | supported now | maintainers | pin the merge commit of this document |
| 2 | A consumable client SDK | supported now (this change) | maintainers | a version bump and changelog when the served surface changes |
| 3 | A reference environment | supported now (file configuration, persistence, reset, seed) | maintainers and module team | the module team's own seed once its slice is fixed |
| 4 | A complete authority example | supported now (example and section 4) | maintainers | none until the slice needs interactive mode or write delegation |
| 5 | The first workflow's domain contract | supported now for products, observations, movements and derived availability; needs clarification for locations and for physical-versus-imported | maintainers with the module team | a location or facility kind proposal, and a decision on marking observation origin |
| 6 | Read/write and synchronization contracts | supported now for polling reads, retries, dedup and conflicts; blocked for live change delivery, deletion and withholding | maintainers | serve the change-view contract from the host, or state that polling is the contract for the candidate |
| 7 | An extension and compatibility path | supported now | maintainers | none |
| 8 | An executable conformance pack | supported now, with the independence caveat stated | maintainers | an independently authored second implementation of the signing vector and fixtures |
| 9 | A bounded portability test | supported now as bounded in section 9 | maintainers | none for a read-only slice |
| 10 | A change and feedback process | supported now | repository owner | none |

Findings from assembling this baseline, recorded rather than hidden: the packed SDK could not be consumed outside the repository at all (fixed here); the disposable host had no operator configuration path, so no module could be installed without editing its source (fixed here); the specification index still described the first two kinds as unregistered (fixed here); the health endpoint lists kind names but not the digests behind them, so a module pins digests from the registry (documented; whether health should advertise digests is the owner's decision); a location master and an observation-origin marker are absent (section 7); the host serves no change feed (section 6).
