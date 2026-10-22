# The verb layer: design proposal

October 22, 2026. Status: **decided, not implemented.** The owner took every decision in section 12 (V1 to V20) on October 22, 2026, as recommended. Nothing here is implemented, reserved or normative yet; section 12 is now the decision record and section 14 the build order that follows from it.

## 1. Where this comes from

On October 21, 2026 the owner worked through the shape of DTP in a voice session and wrote the result up in a document held outside the repository. This section is the repository's record of what it proposed:

- DTP is a general open language for physical and data objects, their relationships and the actions taken on them, no longer a transaction and escrow protocol; settlement rails (ACH, wire, card, stablecoin) are evidence on a transfer, and NEAR Intents is not part of the core. A commercial engine runs on the language; a consumer-goods brand running end to end on it is the flagship. Customers own their ledger and can leave with it.
- Model it like an entity-component-system game engine: **entities** are bare global ids, **components** are data attached as needed, **systems** (recall, costing, payroll) run over anything carrying the right components.
- Nine verbs describe everything that happens: `create`, `retire`, `transform`, `move`, `transfer`, `assign`, `observe`, `value`, `claim`.
- Facts (what happened, with evidence and a confidence) are distinct from claims (obligations with a lifecycle); transfers settle claims; conservation on every event gives double entry for goods and money alike; cost is quantities times prices under a named allocation rule.
- Every event has one envelope (id, verb, actor and signature, `occurred_at` and `recorded_at`, previous-event hash, spec version), a verb-specific body, references and evidence. A hash chain, signatures, optional anchoring and Merkle proofs make it tamper-evident. AI output is an assertion by an actor, never a fact.
- Worked examples: a co-packer batch run, a retailer deduction split between promotion and damage, and a refrigerated load that loses a pallet and its temperature record.

This proposal asks what that means for the repository as it stands, and answers: **adopt the verbs as the organizing vocabulary for business meaning, and build each one with the method the business-fact profiles already use** (a protocol kind with a closed schema, deterministic rules with normative refusal codes, fixtures and a second implementation). Nothing merged is removed or rewritten.

**Terms used below.** *Object*: anything with an identity: a product, a lot, a location, a party, a claim, a document. *Component*: a state kind that describes an object; its head is the current description. *Verb kind*: one of the six kinds in section 4 that carry the verbs. *Book*: a set of flow ledgers under one resource policy that one fact may touch together (section 5). *Holding*: a quantity of one asset in one position. *Act header*: the members every event verb kind's body carries (section 4). *Kind*, *profile*, *fact*, *position*, *producer* and *subscriber* keep the meaning given in the [business-fact profiles proposal](business-fact-profiles-proposal.md).

## 2. How far the repository already is

The voice-session model touches one of the repository's three layers:

| Layer | What exists | What the voice model says | Consequence |
|---|---|---|---|
| Trust and authority: person and organization identity, governance, rehoming, keys, resource policies and grants, module releases and installations, migration, evidence exchange | Most of the foundation work and its test suite; red-teamed | "Every actor signs its own events"; privacy and access control listed as not yet discussed | Unchanged. The verb layer runs on it. |
| Records: signed, append-only record chains owned by one organization under one policy and one resource, typed by an exact profile digest | v0.4 `record.append`, supersession, kinds and `profile.admit` | Pure event sourcing: state is always replayed | Kept. Both natures (event, state) stay (V4). |
| Business meaning | Five registered kinds (`product@1`, `party@1`, `inventory@2`, `order@1`, `forecast@1`), plus the `inventory-v1` and `invoice-v1` semantics | Nine verbs plus components | Reorganized around verbs (this proposal). |

Much of the voice model already exists, built one domain at a time:

| Voice-session idea | Where it already is |
|---|---|
| Conservation, double entry | `inventory@2` rule 1: every leg moves a quantity between two positions, with `~supplier`, `~customer`, `~adjustment` and `~production` as the counterparts; rule 2: stock is never negative and never reserved twice. |
| `move`, `transform`, `create` and `retire` of fungible goods | `inventory@2` legs: real to real; to or from `~production` with `transformation_id`; from `~supplier` or `~adjustment`; to `~adjustment` with a reason. |
| Facts vs claims | `order@1`: "a forecast or a plan is never an order" and there is no commitment flag (P10). |
| `occurred_at` vs `recorded_at` | `occurred_at` in every inventory fact; the host's `accepted_at`; domain-map distinction 5. |
| Duplicate observations | `(source_id, sequence)` with a per-source high-water mark and a 64-sequence window (P7). |
| Events point, they don't copy | Entity links (root) versus evidence links (exact `record_id`), SPEC.md §3.1. |
| Actors, including software and AI | Every command is signed; installations with `requested_by` (v0.4 §2). |
| AI output is an assertion | Stricter already, for every writer: "a signature proves attribution of bytes, not shipment, title, customer approval or payment" (v0.4 §6); domain-map distinction 7, "authorized statement vs verified truth". |
| Global ids mapped to GS1 | Issuer-namespaced external identifiers; check-digit-validated GTINs and GLNs in `product@1` and `party@1`. |

And the voice model supplies what the repository itself lists as missing:

| Missing today | Where it is recorded | Where this proposal puts it |
|---|---|---|
| Ownership versus custody | `inventory@2` "Not in scope"; domain-map distinction 2 | `transfer` (section 6) |
| Valuation and cost | `inventory@2` "Not in scope"; domain map "no general ledger" | `value` (section 9) |
| Typed relationships with effective dates | `party@1` roles are descriptive only | `assign` (section 8) |
| Disputes, partial settlement, offsets, deductions | `trade.dispute` documented gap; domain map "no full dispute or return profile" | `claim` (section 7) |
| Atomic multi-product transformation | `inventory@2` is one ledger per product; a transform is several facts linked by `transformation_id`, not atomic | `transform` (section 5) |
| An object's identity across companies | multi-company ledgers out of scope; a party is "as this company knows it" | section 3.2 |
| Retirement of discrete objects | none | `retire` (section 3.3) |
| Hash chain over business records | only the identity log is chained | section 10 |

## 3. Objects and components

### 3.1 An object is a record root

The voice model wants bare entity ids with components attached. The repository already has the right id: a record chain's `root_id`, a UUID fixed at genesis that every revision keeps. The proposal makes that the object id:

- An object that has a defining description is the root of that description's chain: a product is the root of its `product@1` record, a party the root of its `party@1` record, an order the root of its `order@1` record. Existing roots are already object ids; nothing is re-keyed.
- An object without a natural description (a location, a trailer, a sensor, a position in an org chart) gets one minimal component, `dtp/object@1` (section 3.3), whose root is its id.
- A **component** is a state kind whose body names its object in a `subject` member. A component of the object's own defining kind omits it. Two components of one object are two record chains, each under its own policy: a product's cost can sit under a different policy from its description.
- `subject` is an object reference: `{ minted_by: organization_id, root }` (section 3.2). A reference to the writer's own object may omit `minted_by`.

Systems, in the game-engine sense, are subscribers that select by kind (P2) and join on `subject`. A recall system selects every holding of a lot and every `transform` that consumed it, whatever the product is: the voice model's "anything with a lot number and a location", expressed through the existing `kinds` selector.

### 3.2 Identity across companies

The voice model says that when a retailer receives a case, its id continues in the retailer's ledger. Read literally, that needs one ledger shared by two companies, which the protocol refuses on purpose. Read as identity, it fits, with one guard:

- An object is minted once, by the first company to record it. Another company that records facts about the same object names it as a **foreign reference**, `{ minted_by: <minting organization id>, root }`, in `subject` and in references. It never writes a record whose own `root_id` is the foreign root: record ids are unique per host (`record.append` refuses an existing id with `conflict`), so writing under another company's root would succeed or fail depending on which host each company uses, and would collide when two companies later share a host.
- A foreign reference is an attributable claim that two records are about one thing (distinction 4). Anyone can name any root they have learned; naming it grants nothing and proves nothing, and a reader treats a reference whose `minted_by` it cannot check as unverified.
- An id is learned through an existing channel: `evidence.issue`, or an external identifier both sides already hold. GS1 identifiers stay external identifiers on the object's component; a receiver that scans an SSCC finds the object by that identifier, not by a UUID printed on a label. Most objects (a call, a promotion agreement, a sensor reading) have no GS1 identifier, which is why the identifier is not the id.
- Sharing an id discloses nothing about the history behind it.

### 3.3 `create` and `retire` of discrete objects

`dtp/object@1`, a **state** kind, the minimal component for objects without another defining kind:

```
body: {
  class: string,                        // "<namespace>/<name>": a protocol class (dtp/location, dtp/trailer, ...) or a private one
  identifiers: [ ExternalIdentifier ],  // SSCC, serial, VIN, asset tag: issuer-namespaced
  status: "active" | "retired",
  retired: { reason: "scrapped" | "lost" | "consumed" | "ended" | "other", note: string | null } | null
}
```

`create` is its genesis: "entered the ledger", not "came into existence". `retire` is a revision to `retired` with a reason; finding something lost is a revision back to `active` that cites the observation that found it. Nothing is deleted. A sale is not a retire (it is a `transfer`), and a `transform` output is not created separately.

Fungible things (goods by the case, money) are not created or retired one by one: a holding enters from a virtual counterpart and leaves to one, as `inventory@2` already does. Serialized units stay what `inventory@2` makes them, free-string `serial_ids` inside a holding; they are not object roots and cannot be a `subject` without a change to that kind (section 15).

## 4. The six verb kinds and the act header

| Kind | Nature | Verbs | Section |
|---|---|---|---|
| `dtp/object@1` | state | `create`, `retire` | 3.3 |
| `dtp/flow@1` | event, with a reduced state per book | `move`, `transform`, `transfer` | 5, 6 |
| `dtp/claim@1` | state | `claim` | 7 |
| `dtp/assign@1` | event, with a reduced state per company | `assign` | 8.1 |
| `dtp/observe@1` | event | `observe` | 8.2 |
| `dtp/value@1` | event | `value` | 9 |

Every **event** verb kind's body starts with the same members, defined once in the protocol's datatypes, so that a subscriber reading two verbs finds time, deduplication and evidence in the same places:

```
act: {
  verb: "move" | "transform" | "transfer" | "assign" | "observe" | "value",
  occurred_at,                              // business time, UTC
  observation: { source_id, sequence },     // P7 semantics
  basis: "asserted" | "measured" | "inferred",   // section 8.2
  references: [ Ref ],                      // claims, contracts, terms, earlier facts this act relates to
  evidence: [ Ref | DocumentRef ]           // what supports it: a proof of delivery, a photo, a sensor summary
}
```

`recorded_at` is not a body member: it is the host's `accepted_at`, which the writer cannot set (v0.4 §6). The actor and signature are the command's. A `Ref` is an object reference (section 3.1) with an optional exact `record_id`. The state kinds carry no `act`: their revisions record a standing, and a claim names what it rests on in its own `grounds` (section 7). Describing an object is never a verb (V4).

The P7 high-water mark is per **(kind, scope, source)**: the scope is the book for `flow@1` and the owning organization for the other event kinds. A source numbers its observations within each scope it writes to.

Every verb kind's profile document states the sections of the profiles proposal's section 2, and after *Semantics* two more:

| Section | Content |
|---|---|
| Conservation | What the reducer keeps balanced and against which counterparts, or "none" (`observe@1` conserves nothing). |
| Rights | Which of title and custody the verb can change, or "none". |

## 5. `move` and `transform`: the flow ledger

### 5.1 From `inventory@2` to `dtp/flow@1`

`inventory@2` is the reference implementation for these verbs and stays registered. `dtp/flow@1` keeps its positions, statuses, reservations, serials, units, packaging pins and refusal codes, and generalizes it in four ways:

1. **Assets, not only products.** An asset is a product root (as today) or a currency. A goods ledger is keyed by product, as today. A **money ledger is keyed by currency and account**, an account being a location object, so that payments on different accounts never contend for one compare-and-set. An account opened with `balance: "signed"` may go negative (a credit line, payables); every other position keeps rule 2 (never negative). A payment is then a leg, and goods and money are conserved by one reducer: the voice doc's double entry, per asset. Exchanging one asset for another is a `transform` (goods) or a pair of legs in two currencies in one fact (an exchange), never an implicit conversion.
2. **Locations are objects.** `location_id` becomes an object reference to a location's `object@1` (or a `party@1` unit), where `inventory@2` has a free string. Custody is then derivable (section 6.1).
3. **Owner on the position.** A position becomes `{ lot_id, location, status, owner }`, `owner` a party reference or `null` for the company itself. Consigned stock and goods held for a customer become ordinary positions.
4. **Books and multi-ledger facts.** A fact's `resource_id` is a **book**, opened under one policy (`flow.open {policy_id, book_id}`), and the fact may touch up to 16 ledgers in that book atomically. Ledgers in different books never share a fact, so a fact's readers are exactly the book's readers, and no fact discloses another policy's ledgers. Peppers, vinegar and bottles into sauce is one `transform` fact if the four products share a book. A company chooses its books (a plant, an operating account); a fact that needs two books is two facts and is not atomic.

```
body: {
  act: Act,
  ledgers: [ { key, expected_revision, expected_digest } ],   // 1..16; key = SHA-256 of the canonical ledger tuple, as in #38
  legs: [ { from: Position, to: Position, quantity, serial_ids, reason, links } ],   // 0..16, as inventory@2
  reservations: [ ... ],                     // 0..16, as inventory@2
  transform: Transform | null,               // 5.2
  rights: [ "title" | "custody" ] | null,    // 6.1; required when act.verb is "transfer"
  settles: [ Settlement ]                    // 0..16, 6.2
}
```

A fact carries at least one leg, reservation operation or settlement. Ledger keys are digests (no escaped member names), and every ledger a leg touches must be listed with its expected revision and digest.

### 5.2 Transform

A `transform` fact has input legs to `~production` and output legs from it, all in one fact:

```
Transform: { recipe: Ref | null, yield_loss: [ { asset, quantity, reason } ], equipment: [ Ref ] }
```

The reducer does not check a recipe (that is a system's job). It checks that every `~production` leg is in this fact and that every `yield_loss` asset appears among the inputs; the amount of a loss is informative. Lot genealogy is then exact. The voice doc's rule stays: if it is still the same thing afterwards, it is not a transform. Repacking between packaging revisions of one product changes no position and needs no fact, unless it consumes packaging material, which makes it a transform; a promotion of a person is an `assign` and a `value`.

A transform discloses its inputs and proportions to anyone who can read the book, and `evidence.issue` of it discloses them to the recipient. A recipe that must stay restricted means its production runs in a restricted book.

### 5.3 Containment

The voice doc says a truck's move carries its pallets and cases. `flow@1` does not do that implicitly; aggregation stays deferred (P9) to a later `logistics` kind. In practice the cost is smaller than it looks, because a holding is a quantity: twenty pallets of one lot in one position are one holding of 20 in the product's pallet packaging, moved by one leg.

## 6. `transfer`: rights, not location

### 6.1 Title, custody and risk

Distinction 2 separates ownership, custody, possession and rights to disclose. The flow ledger records two of them:

| Right | Meaning | How it is recorded |
|---|---|---|
| title | Who owns it | The position's `owner` |
| custody | Who is responsible for holding it | Derived: the party with the open `operates` assignment (section 8.1) for the position's location at `occurred_at` |

A transfer of title is a leg between two positions that differ only in `owner`, the way a status change is a leg between positions that differ only in status. A transfer of custody is a leg to a location another party operates. A `flow@1` fact with `act.verb: "transfer"` states in `rights` which it intends; the reducer checks that its legs change exactly those and nothing else (V8). Possession and rights to disclose are not ledger state.

**Risk of loss is not recorded and not derived by the reducer.** Who bears a loss depends on the terms, on whether goods conformed, and on law. A **risk system** (a module, named and versioned, like an allocation rule) may compute it over a closed terms vocabulary: an Incoterm 2020 rule or a UCC shipment or destination term, read from the references. Its output is limited to what the terms alone decide ("under a destination term, risk had not passed at the time of loss") and carries its method and inputs (distinction 9). It never concludes who owes whom; that is a claim, made by a party.

### 6.2 Settlement

A flow fact settles claims by `settles: [ { claim: Ref, amount | quantity, kind: "payment" | "offset" | "reversal" } ]`, many to many: one payment can settle parts of three invoices, one invoice can be settled by three payments.

- A **payment** settlement accompanies cash legs in the same fact.
- An **offset** needs no leg: it nets a claim the company owes against a claim owed to it, both named in `settles`, in equal amounts. A deduction is an offset: the voice doc's "a deduction is just an offset" becomes a rule a reducer checks (equal amounts, opposite directions, both claims the company's own records).
- A **reversal** cancels an earlier settlement (a payment that bounced) by naming it.

Only the company's own flow facts settle its own claims. A counterparty's statement that it paid is evidence received through `evidence.issue`; it is not stored as the company's record, its token expires in 60 seconds, and snapshot replay could not reproduce a standing that depended on it. A settlement is therefore checked, not proven: the company asserts that cash arrived by writing the leg, and the claim's standing follows from its own assertions (distinction 7).

### 6.3 Across companies

A transfer between companies is two sets of facts, one in each ledger, each naming the other's objects by foreign reference. Until the receiver acknowledges, the sender's ledger shows the goods with `owner` set to the receiver at a location the receiver operates, which is the honest state, "sent, not acknowledged". When the receiver's acknowledgment arrives as evidence, the sender writes a leg to `~customer`, citing it, and the goods leave the sender's ledger. Disagreement is not a ledger error; it is a claim (section 7).

## 7. `claim`: obligations with a lifecycle

### 7.1 Nature and payload

`dtp/claim@1` is a **state** kind: a claim is an object whose head is its current standing, as an order's is. Asserting a claim is its genesis.

```
body: {
  obligor: PartyRef, obligee: PartyRef,          // exactly one is the company itself
  subject: { kind: "money", amount, currency } | { kind: "quantity", asset: Ref, quantity } | { kind: "performance", description },
  grounds: [ Ref ],                              // the contract, order, promotion agreement or facts it rests on; may be empty
  condition: { kind: "none" | "on_event" | "on_date", ... },
  recurrence: { every: duration, until: date | null } | null,
  status: "offered" | "accepted" | "disputed" | "partially_settled" | "settled" | "cancelled" | "written_off",
  settled: { amount | quantity },                // the sum of the company's own settlements naming this claim
  dispute: { reason, citing: [ Ref ] } | null
}
```

Either party may offer a claim: an invoice is offered by the obligee, a purchase commitment by the obligor, a damage allegation by the party that says it is owed.

| From | To | Whose act it records |
|---|---|---|
| `offered` | `accepted`, `disputed` | the party that did not offer it |
| `offered`, `accepted`, `disputed` | `cancelled` | the party that offered it |
| `accepted`, `partially_settled` | `disputed` | either party |
| `disputed` | `accepted` | either party, citing the agreement or decision that resolved it |
| `accepted`, `partially_settled` | `partially_settled`, `settled` | the company, only as its settlements (6.2) require |
| `partially_settled`, `settled` | `accepted`, `partially_settled` | the company, only after a settlement reversal |
| `accepted`, `partially_settled`, `disputed` | `written_off` | the obligee, with a reason |

The writer writes the status, as with every state kind. The host **checks** it: `settled` must equal the sum of the company's settlements naming the claim, and `partially_settled` or `settled` must agree with it. A writer cannot mark an invoice paid without a settlement it recorded. Most claims are never disputed, and the table lets them go from `offered` to `settled` without ceremony. A write-off's accounting entry is a `value` fact (section 9) once that kind exists; until then the reason is the record.

### 7.2 What becomes a claim

- `order@1` is a claim with commercial lines. It stays registered as it is; a later `order@2` would carry its lines as a component of a `claim@1` (V10). No order is rewritten.
- `invoice-v1`'s arithmetic becomes a component of a money claim: the invoice says how much and why; the claim says who owes it and where it stands.
- A quote is an `offered` claim. A sales opportunity is not a claim: it commits nobody, and a probability on a claim invites treating a guess as a commitment (P10's reasoning). `forecast@1` has no money member, so pipeline opportunities need their own projection kind, decided when a CRM module needs one (section 15).
- A damage allegation is a claim whose `grounds` name the facts it rests on (section 13). A claim with empty grounds is valid; it simply cannot be checked, and the other party may dispute it for that reason. A future schedule is an `offered` performance claim on a person's time that is matched by an `assign` when they clock in.

## 8. `assign` and `observe`

### 8.1 `assign`: typed relationships

`dtp/assign@1`, an **event** kind whose reducer keeps the open relationships per company:

```
body: {
  act: Act,
  relationship: string,              // a protocol type (below) or "<org id>/<name>"
  from: Ref, to: Ref,
  starts_at, ends_at: instant | null,
  ends: record_id | null,            // set when this fact ends an earlier assignment
  weight_bp: integer | null          // basis points; bodies carry integers only
}
```

Ending a relationship is a second fact naming the first. Physical containment is never an assign (it is a location); a logical link always is: driver to truck, person to position, gasket to line, lot to order line, rep to territory. Each relationship type states its cardinality, which the reducer enforces at `starts_at`: a position held by one person at a time refuses a second open holder. `weight_bp` expresses split roles and feeds cost allocation. A backdated assignment carries both times: `starts_at` in the body, `accepted_at` from the host.

Proposed core types (V11): `operates` (a party operates a location, which is what custody reads), `holds_position`, `part_of`, `covers` (a warranty or insurance covering an object), `allocated_to`, `represents`, `reports_to`. A person in any of them is personal data and is written under a personnel policy (V16).

### 8.2 `observe`: the junk-drawer guard

`dtp/observe@1`, an **event** kind:

```
body: {
  act: Act,
  subject: Ref,
  measure: string,                   // a protocol measure ("temperature", "count", "ph", "fill_weight", "missing", ...) or "<org id>/<name>"
  value: { amount, unit } | { code: string } | null,
  instrument: { object: Ref | null, owner: PartyRef | null },
  window: { from, to } | null,
  summary_of: { digest, count } | null,
  model: { publisher, release_digest, confidence_bp } | null   // required when basis is "inferred"
}
```

The voice doc's concerns become rules:

- **Basis.** `act.basis` is `measured` (an instrument read it), `asserted` (a person said so: a receiver's handwritten note) or `inferred` (a model predicted it). No rule in any protocol kind accepts an `inferred` observation where a `measured` one is required.
- **No "verified".** The voice doc proposed a confidence scale from asserted to verified. A writer cannot verify its own statement (distinction 7). Corroboration is a derived view (distinction 9): two `measured` observations of one subject and window from instruments with different owners agree or not, and a system says so with its method and coverage.
- **Instrument owner.** Every `measured` observation names the instrument's owner, so a carrier's temperature logger is visibly the carrier's.
- **Summaries, not streams.** High-frequency data stays outside the ledger; an observation carries the summary, the window and `summary_of`, the digest and count of the raw readings.
- **Missing.** `measure: "missing"` with a `window` records that an expected observation did not arrive.
- **Appraisals** go to `value`, not `observe`.

## 9. `value`: cost from physical facts

`dtp/value@1`, an **event** kind with a conservation rule. The voice doc's three layers become three things a reader can recompute:

| Layer | Where it lives |
|---|---|
| Quantities | Holdings and legs in `flow@1` |
| Prices | `value` facts with `layer: "price"`: a market fact with its source |
| Allocation rules | Named, versioned rule identifiers (`fifo`, `standard`, `overhead.<name>`) cited by every derived valuation |

```
body: {
  act: Act,
  layer: "price" | "valuation",
  subject: Ref,                       // a holding's ledger and position, or an object
  book: "book" | "tax" | "management" | "<org id>/<name>",
  amount, currency,
  rule: string | null,                // required for a valuation
  inputs: [ Ref ]                     // the prices and facts it was computed from
}
```

Valuation books are separate, so several valuations of one thing coexist. Conservation applies within a book: a write-down moves value from the asset to an expense account as a two-leg money fact in that book's currency ledgers, cited as an input, so the book always balances. Direct cost is quantities times recorded prices; indirect cost is labelled as an allocation under a named rule; both cite their inputs, so anyone with read access can recompute them. Exact decimal rules are `invoice-v1`'s.

This kind is the largest of the six and the least proven. Recommendation (V13): draft it last, after a costing system has been written against `flow@1` and `claim@1` facts.

## 10. Tamper evidence

What exists: every command is signed by its actor (strict RFC 8032 verification, prime-order keys); a host orders records by `seq`; state kinds chain revisions by `supersedes`; the identity log is a digest chain; snapshot import replays every ledger and must reproduce it exactly.

What the voice doc adds, and what this proposal recommends:

1. **Hash chain: per flow ledger, not per company.** A company-wide chain would make every write wait on one head, and its length would disclose activity across policies a reader cannot see. Each flow ledger already has a compare-and-set revision; `flow@1` adds `expected_digest`, the digest of the ledger's previous accepted fact, beside it (V14). The digests a fact lists are all in one book, so they disclose nothing outside it. State kinds keep their `supersedes` chains; the other event kinds are not chained in this proposal.
2. **Signatures.** Already there for every actor, models included (an installation signs).
3. **Anchoring: later.** A host could publish a daily Merkle root over a company's accepted records to a timestamping service, so that even the host cannot rewrite history. Useful and independent of the verbs; a separate proposal once a customer asks for it.
4. **Selective proof.** `evidence.issue` already discloses chosen exact records to one counterparty. A Merkle inclusion proof against an anchored root would let the counterparty check that a record was in the ledger on that day without receiving anything else. It depends on 3.

A chain proves the ledger was not rewritten after the fact; it does not prove that what was written was true. The documents should say both.

## 11. How the existing kinds map

| Existing | Under the verb layer | Changes to it |
|---|---|---|
| `product@1` | The defining component of a product object | None |
| `party@1` | The defining component of a party object; relationships move to `assign@1` | None; `roles` stay descriptive |
| `inventory@2` | The single-product subset of `flow@1` | None; registered beside `flow@1`, with a projection bridge as `inventory-v1` had |
| `inventory-v1` | Bridged from `inventory@2` | None |
| `order@1` | A claim with commercial lines | None; `order@2` later as a claim component |
| `forecast@1` | A projection; not a claim | None |
| `invoice-v1` | The arithmetic component of a money claim | None |
| v0.2 `trade.*`, `finance.*`, `traceability.*` | Legacy; not mapped automatically | None |

## 12. Decision record

Every row was decided by the owner on October 22, 2026, as recommended. The recommendation column is kept as the rationale.

| # | Decision | Decided |
|---|---|---|
| V1 | Adopt the verbs as the organizing vocabulary for new protocol kinds. | Yes. New protocol kinds are verb kinds or components; existing kinds stay registered and are bridged. |
| V2 | Build the verbs as protocol kinds on the v0.4 record and profile substrate, or as a new envelope and protocol version. | As kinds. No new signing domain, envelope or version; the voice doc's envelope is the existing signed command plus the act header. |
| V3 | A shared act header in every event verb kind's body, with P7 high-water marks per (kind, scope, source). | Yes. |
| V4 | Whether describing an object is an event (a `describe` verb) or a supersession of a state kind. | Supersession. Nine verbs carried by six kinds; describing is not a tenth verb. |
| V5 | Object identity across companies: foreign references `{minted_by, root}`, never writing under a foreign root; GS1 identifiers stay external identifiers; no global registry. | Yes. |
| V6 | Components attach by a `subject` object reference, omitted for a kind's own root. | Yes; `product@1` and `party@1` are already components of their own roots. |
| V7 | `flow@1`: assets include currencies; money ledgers per currency and account, with opt-in signed accounts; locations as objects; `owner` on positions; books under one policy, with up to 16 ledgers per fact, all in one book. | Yes. |
| V8 | `transfer` as its own reducer, or as `flow@1` facts with `rights`. | `flow@1` facts. One conservation reducer; title on the position, custody from `operates`. |
| V9 | Risk of loss never stored or reduced; computed, if at all, by a named risk system over a closed terms vocabulary (Incoterms 2020 rules and UCC shipment and destination terms). | Yes; the closed vocabulary to be fixed when drafting. |
| V10 | `claim@1` as a state kind with the table in 7.1; settled amounts checked against the company's own settlements; offsets and reversals as leg-free settlements. | Yes; `order@1` kept and later carried as a claim component. |
| V11 | `assign@1` with a closed core set of relationship types (seven in 8.1), private namespaced types, cardinality enforced, weights in basis points. | Yes. |
| V12 | `observe@1` with `basis`, instrument owner, summaries with a digest of the raw stream and `missing`; no writer-asserted "verified". | Yes. |
| V13 | When to draft `value@1`. | Last, after a costing system exists against `flow@1` and `claim@1`. |
| V14 | Hash chain per flow ledger (`expected_digest` beside `expected_revision`) versus per company. | Per flow ledger. Anchoring and Merkle proofs as a later, separate proposal. |
| V15 | AI output: `inferred` basis, model release digest, confidence in basis points; never accepted where `measured` is required; no model named by the protocol. | Yes. Calibration is a system comparing inferences with later facts. |
| V16 | People and positions as objects only under personnel-classified policies (extends P11 to `object@1`, `assign@1` and `observe@1` about a person). | Yes. |
| V17 | Remove NEAR from the protocol's documents; a settlement rail is evidence on a transfer. | Yes. [PHILOSOPHY.md](../PHILOSOPHY.md) still says history lives "in the NEAR contract"; correct it in a documentation change of its own. |
| V18 | Protocol object classes (`dtp/location`, `dtp/trailer`, ...) in a registry beside the kind registry, and measures for `observe@1` likewise. | Yes; both closed lists, added by pull request, private names namespaced. |
| V19 | The refrigerated-load and deduction scenarios (section 13) as the acceptance fixtures for steps 1 to 5. | Yes, with synthetic parties. |
| V20 | Build order. | Section 14. |

## 13. Acceptance fixtures

Both fixtures use synthetic parties: a shipper S (the writing company), a retailer R, a carrier C. Each is written from S's ledger, with R's and C's facts arriving as evidence, and each must produce exact final ledgers and claim standings, run under a destination term and under a shipment term.

**The refrigerated load** (the voice session's messy example):

| When | What happened | S's facts (destination term) |
|---|---|---|
| Fri | 20 pallets of one lot leave S's co-packer | `transfer` with `rights: ["custody"]`: one leg of 20, in the pallet packaging, to C's trailer (a location C `operates`). Title unchanged. Under a shipment term the same fact also carries title to R (`rights: ["title", "custody"]`, owner R). |
| Sat | C's reefer logger is silent for four hours | C's `observe@1` (`missing`, the window, instrument owner C) arrives as evidence and is cited. |
| Mon | R receives 19, accepts 17, rejects 2 for temperature, notes "1 short" | `transfer` of title for 17 to R and custody of 19 to R's DC, citing R's receipt as evidence. A status leg moving the 2 rejected pallets from `available` to `damaged`, still S's title, `act.basis: "asserted"`, citing R's receipt photo. The missing pallet stays in C's trailer position: the ledger says where S last knew it was. |
| +3 weeks | R's remittance is $6,400 short with an unclear code | A cash leg settling part of the invoice claim. R's damage claim as S records it: a `claim@1` with R as obligee, `offered`, `grounds` empty; S disputes it for lack of grounds. |
| Later | C finds the pallet at its cross-dock | C's observation arrives as evidence; S writes a move of 1 within C's custody to the cross-dock location. |

What the fixture checks: the ledgers and standings above; that the risk system, given the destination term, reports that risk had not passed to R for the 3 pallets not accepted, and given the shipment term, that it had passed at the dock; and that C's temperature evidence is marked as C's, an interested party's. It does not decide who owes what for the damage; that stays a disputed claim. The voice session's conclusion becomes a test: every step fits the verbs, and the hard parts are terms and evidence, not vocabulary.

**The deduction**: R deducts $3,000 from a $10,000 payment. The promotion part nets against S's accepted promotion claim owed to R (an offset, no dispute). The damage part is a new claim whose `grounds` must name specific cases, a lot and a delivery to be checkable; the fixture shows a system finding the facts it contradicts (a signed proof of delivery and a clean temperature summary S holds). The system finds contradictions; it does not decide the dispute.

## 14. Build order

Each step is a separately reviewable change with fixtures, a second implementation and registration, as the profiles build order was:

1. **The act header, foreign references and `object@1`** (V3 to V6, V18): the datatypes, the minimal component, the class registry. Done October 22, 2026: [`spec/profiles/verbs.md`](../../spec/profiles/verbs.md) with vectors in `spec/vectors/verb-datatypes.json` and the class list in `spec/profiles/classes.json` (generated from the reference list, so adding a class is a reviewed change to the `object-v1` rules rather than operator configuration); [`spec/profiles/object/1.md`](../../spec/profiles/object/1.md) with its contract and fixtures, `object-v1` in the reference host on write and on snapshot import, a second implementation in `sdk/tests/interop/object-reader.ts` and `verb-datatypes-reader.ts`, and `dtp/object@1` registered. The act header is specified and vectored but carried by no kind until step 2.
2. **`flow@1`** (V7, V8, V14): the `inventory@2` reducer generalized to books, assets, money accounts, location objects, `owner`, multi-ledger facts and `expected_digest`; `rights` and `settles` as fact members; the bridge projecting a `flow@1` ledger to `inventory@2` for one product. Done October 22, 2026: [`spec/profiles/flow/1.md`](../../spec/profiles/flow/1.md), its contract and fixtures, `flow-v1` in the reference host (`flow.open`, `flow.ledger.open`, `flow.book`, write and snapshot replay), a second implementation in `sdk/tests/interop/flow-reader.ts`, and `dtp/flow@1` registered. Decided while building, for the owner to confirm: ledgers are opened explicitly and the opening is signed and migrated; a money ledger's signed balance is fixed at opening; money's counterparts are `~counterparty` and `~adjustment`, and money changes hands only by a transfer of title with `~counterparty` (between the company's own accounts it moves); goods enter and leave a book by moves, and a transfer of goods is between two real positions; custody is checked structurally (the location changed) until `operates` exists in step 3; settlements are recorded and shape-checked here and interpreted by `claim@1`; an offset needs no legs; a yield loss must be of an input but its amount is informative; a serialized product still needs a lot, as in `inventory@2`; locations are not checked to exist, as in `inventory@2`.
3. **`assign@1`** (V11, V16): needed early because custody reads `operates`.
4. **`claim@1`** (V9, V10): the transition table, settlement checks, offsets and reversals, and the risk system's closed terms vocabulary.
5. **`observe@1`** (V12, V15): completes both fixtures (V19), which must then pass across steps 1 to 5.
6. **`value@1`** (V13), after a costing system is written against steps 2 and 4.

Steps 1 to 4 are the minimum for the flagship's shadow close: goods and money in one conserved ledger, title separate from custody, and invoices, payments and deductions as claims and settlements.

## 15. Still not decided

These arise only while building: the closed terms vocabulary for the risk system; the core measure and class lists (V18); whether `settles` needs more than 16 entries for a large remittance; whether an `inventory@3` should make serials object references so a serialized unit can carry components; the projection kind for sales opportunities; and whether `transform` facts should be allowed across two books when both are under policies the writer controls.

## 16. Where this departs from the voice-session notes

The voice doc invited pushback. These are the places this proposal does something else, with the reason:

| Voice-session idea | This proposal | Why |
|---|---|---|
| Nine verbs, each its own thing | Nine verbs carried by six kinds; describing is supersession, not a tenth verb | A description is not an event, and verbs that share a reducer share one conservation rule (V4, V8). |
| `claim` is a verb | A state kind with a lifecycle | Its standing is a head, as an order's is (V10). |
| Transfers change title, custody and risk | Title and custody are recorded; risk is computed by a system, never stored | Risk depends on terms, conformity and law, which a reducer cannot see (V9). |
| A transfer settles a claim | Only the company's own transfers settle its own claims; a counterparty's payment is evidence | Snapshot replay must reproduce every standing from the company's own records (6.2). |
| All state replayed from events | Event kinds and state kinds, both kept | Product and party descriptions are simpler and safer as revised records. |
| One hash chain | One chain per flow ledger | A company-wide chain serializes every write and discloses activity across policies (V14). |
| Confidence from asserted to verified | `basis`, with corroboration derived | A writer cannot verify its own statement (distinction 7). |
| Opportunities as claims with a probability | Not claims | A probability on a claim invites treating a guess as a commitment (P10). |
| A truck's move carries its pallets | Explicit legs until a logistics kind | Implicit containment is aggregation, deferred by P9; a holding of 20 pallets is still one leg. |
| An object's id continues in the next company's ledger | A foreign reference to the minter's root; each company keeps its own ledger | Writing under another company's root collides across hosts, and no company's data lives on another's host (V5). |

## 17. What this proposal does not do

It does not change any registered kind, vector, signing domain or v0.2 type, and it does not migrate any record: `product@1`, `party@1`, `inventory@2`, `inventory-v1`, `order@1`, `forecast@1` and `invoice-v1` keep their contracts and digests. It does not define the components a consumer-goods ERP needs beyond those (recipes, specifications, price lists); they follow the component rule in section 3 and are drafted when a module needs them. It does not settle privacy for cross-company sharing beyond what `evidence.issue` and resource policies already do, or the specification's own versioning. It does not decide accounting treatment or legal liability; `value@1` records valuations under named rules, a risk system reports what terms say, and choosing the rules, or deciding a dispute, remains a party's (and an accountant's or a court's) job.

## 18. Prior art

As in the profiles proposal, from published texts as understood by the author; check exact sections against the versions the owner pins.

| Source | What was taken | What was not, and why |
|---|---|---|
| Entity-component-system architecture (game engines) | Bare ids, components stored separately, systems selecting by component | Runtime mutation in place; components here are signed, revised records with policies. |
| REA (McCarthy's resource-event-agent accounting model) | Economic events between agents; duality (a transfer settles a commitment); commitments distinct from events | Its single shared enterprise model; here each company keeps its own ledger. |
| GS1 EPCIS 2.0 | Source and destination lists with owning and possessing party types (the title and custody split), sensor elements for summarized readings, transformation events with inputs and outputs | The open extension model, and the event stream as the stock ledger. |
| Double-entry bookkeeping; Odoo quants with an owner | Conservation through counterparts; consigned stock as a quant owned by another party | Chart-of-accounts structure: books are named, accounts are locations. |
| Incoterms 2020; UCC shipment and destination terms | Risk passing at a point the terms name | Their legal content and the effect of nonconforming goods; the protocol references terms and a system reports only what they alone decide. |
| Event sourcing; Git's content-addressed history | Append-only facts, reversal rather than deletion, a digest chain per history | Replaying descriptions from events (V4). |
