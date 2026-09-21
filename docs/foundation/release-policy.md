# DTP release, wire compatibility and fixture policy

Internal foundation draft, September 12, 2026. Author: `release_architect`.
The coordinator must independently review this policy and its new compatibility
tests. This document does not publish a release, change runtime routing or mark F0
complete by itself.

The first intended public product release is **Direct Trade Protocol 0.1.0**. The
experimental numbers already present in this repository describe earlier wire
contracts and implementations; they are not a public release sequence to rename
retroactively. Repository source is already public. “First public release” means
the planned explicitly supported release artifact and its declared contract, not
that nobody has previously been able to read or run this repository.

## Four separate identities

| Layer | Meaning and change rule |
|---|---|
| Public release | User-facing supported release target `0.1.0`, with exact scope, requirements and qualification evidence. A release cannot claim capabilities merely because a directory exists. |
| Wire contract/signing domain | Exact bytes and interpretation used by a particular verifier. Existing v0.2/v0.3/v0.4 contracts remain immutable. A new release number does not rewrite their domain, identity derivation or fields. |
| Profile/operation contract | Immutable publisher/definition/dependency/descriptor/handler identity and exact digest pins. A display name or version alias does not authorize silently substituting different meaning. |
| Software package/build | The implementation artifact and its dependency lock, independently versioned from the protocol. Private development labels are not proof of publication or wire compatibility. |

Foundation domains such as `DTP-PERSON-GENESIS-1`, `DTP-IDENTITY-TRANSITION-1`,
`DTP-IDENTITY-ENROLLMENT-1`, `DTP-IDENTITY-RESOLUTION-1`,
`DTP-PERSON-OPERATION-1` and `DTP-ENTITY-REVISION-1` identify particular contracts,
not “DTP public version 1.” They do not change every time package or product
numbering changes. This draft does not promise that unqualified foundation
interfaces are already a frozen supported public endpoint.

## Historical wire preservation

| Experimental contract | Original verifier and bytes | Policy |
|---|---|---|
| v0.2 record envelopes | `sdk/src/sign.ts`/`envelope.ts`: canonical selected signed fields without a domain wrapper | Preserve the original field selection, issuer identifiers, signature and canonicalization. Signature verification alone is not schema, permission or endpoint admission. |
| v0.3 people, organizations and commands | `sdk/src/v03/wire.ts`: `PBP-PERSON-0.3`, `PBP-ORGANIZATION-0.3`, `PBP-COMMAND-0.3` | The PBP spelling is part of signed history. DTP branding must not rename it. Original command admission remains `/pbp-store/commands`. |
| v0.4 people, organizations, commands and host tokens | `sdk/src/v04/wire.ts`: `DTP-PERSON-0.4`, `DTP-ORGANIZATION-0.4`, `DTP-COMMAND-0.4`, `DTP-TOKEN-0.4` | Keep exact domains, current vectors and v0.4 admission at `/dtp/v0.4/commands`. Do not accept a v0.3 or public-0.1.0 label as an alias. |

Old specifications, schemas, canonical signing vectors and verifiers remain
available under their original paths. New code may add a strictly identified
adapter or verifier, not reinterpret an old payload as if it had always used the
new rules. Fixes to a verifier require focused compatibility and security review;
preservation is not permission to retain a vulnerable supported execution path.
Unsupported historical MCP adapters have the separately tested
[reference-only archive boundary](legacy-adapter-boundary.md), not runnable support.

Historical signatures can be checked today for attribution without reviving a
command's expired execution window. The regression tests validate old commands at
their recorded issuance instants solely to test their old admission contract, and
also prove expiry at the recorded deadline. That test clock is not a production
escape hatch.

One subtle v0.2 behavior remains explicit: its signing helper intentionally selects
only the original signed fields. Adding an unsignificant `version` property does
not necessarily break that old signature. It also does not convert the record to
a v0.3/v0.4 command. Newer routes must reject the wrong shape and generation rather
than guessing a format from convenient metadata or whether some signature verifies.

## Package labels and publication discipline

The current SDK manifest remains `@dtp/sdk` version `0.2.0`, private. Historical
local/remote MCP manifests retain `0.1.0`/`0.2.0` and are now private archives.
This policy pass changes no manifest, lockfile, import path or installed artifact.
Future unpublished development artifacts may use a reviewed label such as
`0.1.0-dev.N` under an appropriate package identity. That is an explicit packaging
decision, not a mass replacement of every `0.2`, `0.3`, `0.4` or PBP string.

The [baseline audit](baseline-audit.md) records dated npm queries returning 404 at
the exact package names and no discovered public releases/tags. Those observations
do not prove no prior/private/deleted publication, alternate package identity or
deployed compatibility obligation. Before publication, the release owner must verify
registry ownership, current package/tag history and intended artifact contents.
Never overwrite a published version or reuse its number for different bytes.
Publishing, merging and deploying remain separately authorized actions.

## Current runnable path versus foundation work

For an existing executable protocol reference, the established explicit command is
`npm run dev:dtp-v04` from `sdk`, with the pinned Node runtime. Its default local
adapter listens at `http://127.0.0.1:8790/dtp/v0.4/health` and uses a disposable
PGlite store. It is the **experimental v0.4 reference**, not the foundation release
or a production host. The existing Passport/Trade Ledger/Early Pay demos still use
their declared v0.3 demo path and fictional personas.

Foundation identity, operation authority, semantic handlers, persistence and change
views are libraries/fixtures under integration. A new helper or person-authentication
adapter does not silently upgrade the existing v0.4 HTTP routes. Use
`npm run test:foundation` for the current local helper/integration suites and
`npm run foundation:report` for graph status; neither creates a supported network
endpoint or converts old demo state.

The root README still contains mixed historical getting-started headings. This
policy does not rewrite it or change routing. A final release owner must reconcile
that documentation into one genuinely qualified getting-started path after the
foundation runtime boundary is implemented and reviewed. Until then, do not tell
builders the foundation public endpoint is ready or silently redirect old commands.

## Fresh synthetic fixtures

Fresh test and demo runs may create new fictional people, organizations, resources,
grants and records in explicitly disposable local stores. A new identity is really
new even when the display name remains “Alex,” “Acme,” or “Harbor.” Seed keys in
published vectors are test-only and must never control real people, organizations
or funds. Fixture labels are not legal identity evidence.

Pure helper/PGlite fixtures can start with empty transient state. The local v0.4
server and Passport demo have their existing documented disposable lifecycles.
Real PostgreSQL foundation tests use only the dedicated loopback
`dtp_foundation_tests` database, additive schemas and new random fixture IDs. They
must not delete or reset a prior shared database to obtain a green result. Any
actual cleanup is a separately scoped operator action with explicit targets.

Reseeding a fictional demo is not importing company history. It must never be
presented as continuity of control, past repayment performance, an existing grant,
an accepted commercial obligation or a real person's reputation.

## Existing signed records and missing adapters

For real or intentionally retained historical data, an import must preserve:

1. The original signed envelope/command bytes, exact source generation and original
   verifier result. Verify before admitting, and retain attribution separately
   from any new host-generated projection.
2. Exact source-scoped company/entity/revision identity and digest. Names, emails,
   reused keys, SKUs and matching record numbers are not automatic equivalence.
3. Original visibility/authority restrictions, private definitions/dependencies and
   explicit consent to the destination's capability/privacy model.
4. Relevant histories, pending obligations and dependency continuity. A snapshot
   of selected current records is not a full historical migration.
5. An explicit mapping/relationship when a new foundation identity or wrapper is
   introduced. The old signed identity does not become that new identity by fiat.

The foundation store's privileged `importRevision` is create-only and requires a
trusted original-record verifier and import-authority hook. Its presence is not a
generic legacy-v0.2/v0.3/v0.4-to-foundation adapter, full history transfer, identity
upgrade or current authority proof. The synthetic fixture verifier is only a test
stub and must not be used to admit real historical records.

Where a reviewed verifier, identity bridge, policy mapping, schema/semantic handler
or history migration adapter is missing, the supported outcome is an explicit
unsupported/unavailable rejection **before effects**. Preserve the original data
outside active execution until its requirements are met. Do not strip fields,
re-sign an old body under a new identity, copy restricted employee data into a
broader company compartment, renew an expired grant, turn unknown evidence into
verified evidence or reset an obligation to make a demo proceed.

Cooperative host moves within the old v0.4 contract continue to mean exactly what
that contract and its capabilities support. They do not automatically migrate new
foundation authority, operation receipts, feeds or coordinator state. Foundation
host transfer and complete backup/restore remain explicit implementation gates.

## Read-only regression evidence and release gate

`sdk/tests/foundation/release-policy.test.ts` reads existing vectors and calls their
original verifiers. It does not execute generators, rewrite fixtures, open a store,
read deployment credentials or invoke an evidence-writing release command.

The seven checks cover v0.2 canonical fields/hash/signature preservation, original
v0.3 and v0.4 identity/signing vectors, fixed full-request hashes, wrong-generation
shape and signature refusal, PBP-to-DTP domain tampering, identity domain separation,
legacy unsigned metadata confusion and rejection of historical commands as new
foundation person genesis. Original record bodies and signature domains remain
unchanged. For v0.3/v0.4, `request_hash` hashes the complete signed command; it is
distinct from the bytes signed by an individual proof.

Author-run result: seven passed, zero failed/skipped, and TypeScript checking
passed. This is new test implementation, pending coordinator review, not self-issued
compatibility approval. Final qualification must additionally run the full legacy
suites, generated-artifact drift checks, intended runtimes and current dependency
audit, then independently review fresh source-bound foundation evidence. No prior
candidate's green report qualifies the new foundation by inheritance.
