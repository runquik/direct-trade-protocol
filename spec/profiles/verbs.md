# Verb-layer datatypes

Status: **candidate**, step 1 of the [verb-layer build order](../../docs/foundation/verb-layer-proposal.md) (decisions V3, V5 and V18). Every verb kind uses these definitions; no event verb kind exists yet, so the act header is specified and vectored but not yet carried by a registered kind. Reference implementation: `sdk/src/profiles/act.ts`, portable, reachable as `act` from both preview entries. Vectors: [`../vectors/verb-datatypes.json`](../vectors/verb-datatypes.json), regenerated with `node sdk/scripts/build-verb-datatypes.ts` (`--check` verifies).

## Object references

An object is a record root (V5). A reference to one is

| Field | Meaning |
|---|---|
| `minted_by` | The organization id that minted the object, or `null` for the writer's own object. |
| `root` | The object's root, a UUID. |
| `record_id` | An exact revision (an evidence link), or `null` for the entity. |

Rules:

1. **One spelling per object.** A reference to the writer's own object leaves `minted_by` null; a reference whose `minted_by` is the writing organization is refused. A host applies this rule with the owning organization of the record being written, and re-applies it on snapshot import.
2. **Never write under a foreign root.** A company records facts about another company's object by referencing it, never by writing a record whose `root_id` is the other company's root: record ids are unique per host.
3. **A foreign reference is a claim.** `minted_by` is the writer's attributable statement that the object is that organization's; naming it grants nothing and proves nothing. A reader treats a reference it cannot check as unverified.
4. A list of references holds each reference at most once.

## The act header

Every event verb kind's body carries `act`:

| Field | Meaning |
|---|---|
| `verb` | `move`, `transform`, `transfer`, `assign`, `observe` or `value`. `create`, `retire` and `claim` are revisions of state kinds and carry no act. |
| `occurred_at` | Business time, a UTC millisecond instant. The host's acceptance time is not a body member: the writer cannot set it. |
| `observation` | `{source_id, sequence}`: the producing source and its own sequence, deduplicated as `inventory@2` does, per kind, scope and source. |
| `basis` | `asserted` (a person said so), `measured` (an instrument read it) or `inferred` (a model predicted it). There is no `verified`: a writer cannot verify its own statement. |
| `references` | 0 to 16 distinct object references: the claims, contracts, terms and earlier facts the act relates to. |
| `evidence` | 0 to 16 distinct items, each exactly one of `ref` (an object reference) and `document` (`{digest, media_type, description}`: the SHA-256 of a document kept outside the ledger, its lower-case `type/subtype`, and an optional description). |

## Object classes

A class is `<namespace>/<name>`, the name following the kind grammar. The namespace `dtp` is reserved for the classes listed in [`classes.json`](classes.json) (format `dtp-object-classes-1`):

| Class | For |
|---|---|
| `dtp/account` | An account money is held in |
| `dtp/document` | A document tracked as an object (a contract original, a certificate) |
| `dtp/equipment` | A machine, line or tool |
| `dtp/handling-unit` | A pallet, case or tote identified as a unit |
| `dtp/instrument` | A sensor, logger, scale or meter |
| `dtp/location` | A site, dock, bay, trailer interior: anywhere a holding can be |
| `dtp/position` | A role in an organization, held by a person or vacant |
| `dtp/vehicle` | A truck, trailer, van or vessel |

The list is part of the `object-v1` rules; adding a class is a reviewed change to both, and `classes.json` is generated from the reference list. Any other namespace is a publisher organization id, whose classes need no registration.
