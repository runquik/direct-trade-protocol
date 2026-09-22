# Business-fact profiles: design proposal

September 22, 2026. Status: **proposal for the owner's review. Nothing here is implemented, reserved or normative.** It recommends; it does not decide. Section 10 lists the decisions the owner must make before any of it is built.

## 1. The gap

A workspace built on this protocol runs modules that publish *facts*: a stock movement, an order placed, a message posted in a channel. Other modules subscribe to facts **by kind**, never by producing module, so that a company can replace a producer without touching its consumers. That only works across implementations if every kind has a protocol-level definition: a name, a version, a payload schema, rules for what identifies a fact and how it is revised, and a stated relation to the profiles that already exist.

Today the repository has:

- `inventory-v1` (`sdk/src/profiles/inventory.ts`, fixtures in `spec/v0.4/fixtures`): one scalar `on_hand` per `(company, pool, product)`, reservations by id, packaging conversions. No lots, no locations, no status, no serials; an atomic transfer between two pools cannot be expressed; the observation map grows without bound; the unit set is a closed enum of seven names.
- `invoice-v1`: arithmetic and evidence rules for an invoice.
- The v0.2 `trade.*` and `finance.*` record types, which are cross-company signed agreements, not a company's own operational facts.
- v0.4 profiles (`<publisher>/<name>@<version>`, digest-pinned, `dtp.schema/1` bounded dialect, `semantics` label), which are the right vehicle but define no `order`, `party` or `product`.
- The [business-domain map](../DTP_BUSINESS_DOMAIN_MAP.md), which lists inventory as "absent as a strict operational profile" and requires that "forecasts must not look like actual orders".

The implementer's report referred to "H1/H2 items in docs". No document in this checkout labels items that way; the closest statements are the two domain-map rows just quoted. That is recorded as a finding, not resolved here.

**Terms used below.** *Fact*: one signed, immutable statement published by a module into a company's records. *Kind*: the protocol-level name a subscriber selects on. *Profile*: the versioned definition of a kind (schema plus semantics plus identity rules). *Producer* and *subscriber*: modules, or the workspace itself. *Position*: a quantity of one product at one place in one condition.

## 2. What a profile must state

A business-fact profile is a document under `spec/profiles/<kind>/<major>.md` plus a machine-readable schema. Every profile MUST state the following, in this order, so that two implementers reading two profiles find the same things in the same places:

| Section | Content |
|---|---|
| Name and version | The kind and its major version (section 3). |
| Nature | *Event* (append-only; corrections are compensating facts) or *state* (supersedable; the head is the current statement). Never both. |
| Identity | Which payload fields, together with the envelope, identify the entity (`root_id`) and which identify the exact revision (`record_id`). Which references in the payload are entity links (root) and which are evidence links (exact revision). See SPEC.md §3.1. |
| Payload schema | In the bounded dialect (section 4). |
| Semantics | The deterministic rules a conforming reducer applies beyond shape: invariants, ordering, deduplication, arithmetic, units. Named by a `semantics` label. |
| Relations | How this kind relates to other kinds and to the v0.2 types: what it refines, what it must never be confused with, what a bridge from the previous major looks like. |
| Fixtures | Positive and negative vectors, and for a state kind an event stream with expected final state, as `spec/v0.4/fixtures` already does for inventory. |
| Not in scope | What the kind deliberately does not say. |

## 3. Registry and naming

### 3.1 Kinds are namespaced by publisher

v0.4 already identifies a profile as `<publisher_company_id>/<name>@<version>` with a digest over the exact contract. Keep that, and define a *kind* as the profile identity without its minor and patch versions:

```
kind      = <namespace>/<name>@<major>
namespace = "dtp" | <publisher organization id>
name      = [a-z][a-z0-9._-]{0,79}      (the existing v0.4 grammar)
major     = positive integer
```

- **Protocol kinds** live in the reserved namespace `dtp`, for example `dtp/inventory@2`. They are added by pull request to a registry file, `spec/profiles/index.json`, which lists for each kind and major the digests of every admitted profile version. That mirrors `spec/schemas/index.json` for v0.2 types. No dialects: a protocol kind's payload schema is the registry's, not an implementation's.
- **Private kinds** are namespaced by the publisher's organization id, which is a derived, collision-resistant identifier ([organization identity](organization-identity.md)). A private kind cannot collide with a protocol kind because `dtp` is not an organization id, and cannot collide with another publisher's kind because the ids differ. No central approval is needed to publish one. This is exactly the v0.4 rule; the only addition is that `dtp` is reserved.
- A kind name MUST NOT be reused for an incompatible payload. Incompatible change means a new major; additive optional fields mean a new minor within the same major and a new digest. Subscribers select on the major.

### 3.2 Subscription by kind

A subscriber declares the kinds it consumes. The host resolves each kind to the set of profile digests admitted for that kind and major, and delivers facts whose `profile_digest` is in that set. A subscriber MUST accept every admitted digest of the major it declared, which is what "additive optional fields" commits producers to: a subscriber built against minor 3 reads minor 4 payloads by ignoring fields it does not know. Since v0.4 schemas are closed (`additionalProperties: false`), "ignoring" means the *subscriber's* validation is against the admitted digest of the fact, not against the digest it was built with. This needs a rule in the v0.4 read path that today requires callers to name exact digests (`records.list {profile_digests}`); a `kinds` selector that expands to digests is the proposed addition.

Facts are delivered in the company's event order, not the producer's. A subscriber that needs a complete stream for a state kind (inventory) MUST establish stream completeness before deriving state, as the inventory fixture README already says: partial history is unknown, never zero.

### 3.3 Replacing a producer

Because subscribers bind to a kind and the record's owning company, not to `issuer.module_id`, uninstalling one producer and installing another changes nothing for subscribers, provided the new producer continues the same *entities*: it must write with the same `root_id` for the same stock position or order. That requires the entity identity to be derivable from business keys (section 5.2), not from a producer-private id. This is the single most important rule in this proposal and the reason each profile must state its identity rule.

### 3.4 Private kinds that mirror protocol kinds

A publisher will sometimes want a private kind that carries more than a protocol kind. Two options were considered:

- *Inheritance* (a private profile declares it refines `dtp/inventory@2` and its payload validates under both). Rejected as the default: it makes subscribers' validation depend on two schemas and reintroduces dialects by another name.
- *Dual publication*: the producer publishes the protocol fact and, separately, its private fact, linked by the protocol fact's exact `record_id`. Recommended. The protocol fact is what subscribers rely on; the private fact is the producer's own business.

## 4. Payload schema language

Reuse the v0.4 bounded dialect `dtp.schema/1` unchanged: closed objects, bounded arrays and strings, safe integers with bounds, finite string enums, no `$ref`, no regex, no remote resolution. Decimals are strings; the dialect cannot say "decimal", so every decimal field's scale and integer-digit bound is stated in the profile's semantics and enforced by the reducer, as `inventory-v1` does through `decimal.ts` (scale 3 for quantities, 6 for money, 18 integer digits).

Two extensions are worth the owner's decision, both additive to the dialect:

1. **`nullable: true`** on any node, so that "unknown" and "absent" can be expressed without `anyOf`. Today a profile must use a separate `Knowledge` object (`datatypes.ts`), which is more honest but heavier. Recommendation: keep `Knowledge` for facts where absent/unknown/withheld matters (a count, a lien check) and add `nullable` for plain optional references.
2. **`decimal: { scale, integer_digits }`** on a string node, so that a validator can check precision without the reducer. Recommendation: defer; the reducer enforces it and the profile text states it.

Member names follow the existing rule (no quotation mark, reverse solidus or control character) and the v0.4 field-name grammar.

## 5. `dtp/inventory@2`

### 5.1 Nature and scope

An **event** kind whose reducer maintains a **state**: the set of positions of one company. A position is keyed by exactly

```
position = { product_id, lot_id | null, location_id, status }
```

with a nonnegative quantity in the product's base unit, and a set of reservations against it. `lot_id` is null for products the product profile declares as not lot-tracked. `status` is one of a closed set the owner must fix (proposed: `available`, `quarantine`, `damaged`, `expired`, `in_transit`); status is a property of the position, not of the product, so the same lot can be partly available and partly quarantined.

Serialized products are positions with quantity equal to the count of listed serials; a move of a serialized product names the serials it moves. Serials are the only place where the reducer keeps an identity per unit.

### 5.2 Identity

- The *entity* is the company's inventory ledger for one product: `root_id` is derived from `(organization_id, product_id)` through a stated digest rule, so any producer writing stock for that product continues the same entity. Locations and lots are keys inside the ledger, not separate entities; a location or lot that no fact has touched does not exist.
- Each fact is one *revision* of the ledger: `record_id` is the writer's id; the reducer records the exact `record_id` of every accepted fact, so evidence links (an order line's allocation citing the stock move that fulfilled it) name an exact revision.
- Corrections are new facts. A fact is never superseded (`x-dtp-append-only` in v0.2 terms).

### 5.3 The move: double entry as discipline

Every change of quantity is a **move** with a *from* position and a *to* position and one quantity. This is the modelling discipline of double-entry stock ledgers (Odoo's `stock.move` between locations is the well-known example): the sum over all positions plus all virtual positions is invariant, so nothing appears or vanishes without a named counterpart. External counterparts are *virtual* locations, reserved names in the location namespace:

| Virtual location | Meaning of a move from / to it |
|---|---|
| `~supplier` | receipt from outside the company / return to supplier |
| `~customer` | shipment to a customer / customer return |
| `~adjustment` | count correction (loss or gain), with a mandatory reason |
| `~production` | consumed by, or produced by, a transformation, with a `transformation_id` link |

A `move` fact:

```
{
  kind: "dtp/inventory@2", ...envelope...
  body: {
    observation: { source_id, sequence },          // dedup key, section 5.6
    occurred_at,                                   // physical time
    expected_revision,                             // ledger CAS, as in v1
    moves: [ { from: Position, to: Position, quantity: { amount, unit }, serial_ids: [...] | null, reason: string | null, links: {...} }, ... ]
  }
}
```

`moves` has one to sixteen legs and is applied **atomically**: either every leg's from-position has the quantity (or, for a virtual from, no check) and every leg is applied, or the whole fact is refused. **An atomic two-leg transfer** is therefore a single fact with one leg (`from` real, `to` real). A status change is a leg between two positions that differ only in `status`. A split of one lot into two locations is two legs in one fact. Nothing in v1 could say any of these.

Reservations are kept from v1 with the same semantics, but keyed to a position rather than a pool: `reserve`, `release` and `fulfill` become moves of a *reservation* quantity within a position, and a `fulfill` is a move from the position to `~customer` that also consumes the reservation. The exact encoding (a separate `reservations` array in the body versus a `status: reserved`) is a decision for the owner; the recommendation is a separate array, because a reservation is a claim by a party, not a physical condition.

### 5.4 Units: an open registry, UCUM first

v1's unit is a closed enum whose `ton` is ambiguous (short, long or metric). v2 replaces the enum with a unit reference:

```
unit = { system: "ucum", code: string }               // e.g. { system: "ucum", code: "kg" }, { system: "ucum", code: "[lb_av]" }
     | { system: "packaging", packaging_id, version, digest }   // a packaging revision of this product, as in v1's packaging pin
```

- UCUM (already cited by the domain map) supplies unambiguous codes for physical quantities and allows annotations for counted units (`{case}`, `{unit}`), so every v1 enum value has a UCUM spelling. The reducer performs **no** UCUM conversion, not even kg to g: the base unit of a product is fixed by its product profile, every move is expressed in that base unit or through a packaging pin, and the v1 rule that a conversion exceeding the base precision is refused rather than rounded is kept.
- The "open registry" is therefore not a table the protocol maintains: it is UCUM's own code space plus the company's packaging revisions. A private unit outside both is not expressible, by design; a company that counts in "bins" defines a packaging revision "bin".

### 5.5 Relation to `inventory-v1`

A v1 pool is a v2 ledger restricted to one location, no lot, status `available`. Every v1 event maps to a v2 fact: `receive` is a leg from `~supplier`; `adjust` a leg from or to `~adjustment`; `reserve`, `release` and `fulfill` as in 5.3; `packaging` is unchanged. A v1 subscriber can be served from a v2 ledger by a bridge that projects the `available` positions of one location; the reverse is not possible. Both majors may be admitted at one host during a transition. No fact is ever rewritten from one major to the other; the bridge is a module.

### 5.6 Observation compaction

v1 keeps a hash for every observation ever accepted, so a pool's state grows without bound and every duplicate check scans it. v2 changes the observation key to `(source_id, sequence)` with `sequence` a positive integer that each source increases by one, and the reducer keeps only a **high-water mark per source** plus a bounded window of recently accepted sequences (for out-of-order arrival). A fact whose sequence is at or below the mark and inside the window is a duplicate if its digest matches and a conflict otherwise; one below the window is refused as `stale_observation`, never silently accepted as new stock. State size is then proportional to the number of sources, not the number of facts.

The cost is that a source must number its observations. A source that cannot (an import of an unordered spreadsheet) wraps its rows in one numbered fact per row under a source id it owns. The owner must choose between this and a clock-based horizon (drop observation hashes older than N days by `occurred_at`), which needs no numbering but trusts the physical clock. The recommendation is the high-water mark, because it needs no clock and is what every reliable log consumer already does.

### 5.7 Relation to EPCIS

GS1 EPCIS 2.0 describes *what happened to physical objects*: ObjectEvent, AggregationEvent, TransactionEvent, TransformationEvent and AssociationEvent, each with `bizStep`, `disposition`, `readPoint` and `bizLocation` drawn from the Core Business Vocabulary, and identifies lots as LGTINs and locations as GLNs. A v2 move is close to an ObjectEvent with `bizStep` receiving or shipping and a `bizLocation`; a status is close to a `disposition`; `~production` legs correspond to a TransformationEvent's inputs and outputs. Two things are deliberately not taken from EPCIS: its open-ended extension model, and the idea that an event stream is the stock ledger. A v2 ledger is a *derived* state with a closed reducer; an EPCIS export is a projection of accepted moves, listed in the profile as an informative mapping, not a conformance target. Aggregation (cases on a pallet) is out of scope for `inventory@2` and belongs with handling units in a later `logistics` kind.

## 6. `dtp/order@1`

### 6.1 Nature, identity, the one hard rule

A **state** kind. The entity is one order as placed by one party with another; `root_id` is the writer's id at genesis (there is no natural business key; a buyer's PO number is an external identifier namespaced by the buyer and is recorded, not used as identity). Revisions supersede.

**A forecast or a plan is never an order.** An `order@1` fact is a binding commercial commitment by the party that placed it. A producer MUST NOT publish an order fact for projected, planned, simulated or recommended demand, and a subscriber MAY treat every order fact as a commitment without inspecting a flag. Projections belong to a distinct kind (`forecast@1`, not drafted here) whose profile says the opposite: nothing in it commits anyone. This is the domain map's distinction 3 (plan vs commitment vs actual) made into a rule with teeth: a workspace that shows a forecast in an "orders" list has a bug in the module, not an ambiguity in the protocol.

### 6.2 Payload draft

Drawn from UBL 2.4 `Order` and `OrderResponse`, reduced to what a workspace needs and expressed with existing DTP datatypes:

```
body: {
  buyer: PartyRef, seller: PartyRef,            // section 7; exactly one is the owning organization
  placed_at: instant, currency: string,          // ISO 4217 or a monetary asset label as in invoice-v1
  external: [ ExternalIdentifier ],              // buyer PO number etc., issuer-namespaced
  lines: [ { line_id, product: ProductRef, quantity: { amount, unit }, price: Money | null,
             requested: DateInterval | null, links: { contract_id: root | null } } ],   // 1..256
  status: "placed" | "acknowledged" | "rejected" | "partially_fulfilled" | "fulfilled" | "cancelled" | "closed",
  terms: { payment_net_days: integer | null, incoterm: string | null }
}
```

Transitions (who may write which, in the spirit of `x-dtp-transitions`): `placed` by the buyer; `acknowledged` or `rejected` by the seller; `partially_fulfilled` and `fulfilled` by the seller, citing exact stock-move revisions as evidence; `cancelled` by either before fulfilment; `closed` by the buyer. Amendments to lines after `acknowledged` are a new order that `replaces` the old one, not an edit, matching the v0.2 rule that commercial terms are immutable once agreed.

### 6.3 Relation to `trade.contract`

`trade.contract` (v0.2) is a cross-company, counterparty-signed agreement in a store. `order@1` is a company's own fact about an order in its workspace; it MAY cite a contract by root and it MAY exist without one (an order taken by phone). Where both exist, the contract is the evidence and the order is the working state. UBL's `Order` and `OrderResponse` split maps onto the buyer's `placed` revision and the seller's `acknowledged` revision of one entity.

## 7. `dtp/party@1`

A **state** kind. The entity is a counterparty *as known to this company*: `root_id` is the writer's id at genesis. A party is one of `organization`, `person` or `unit` (a site or department of an organization). The payload draws on UBL `Party` and the EDIFACT `NAD` segment for the shape and on this repository's datatypes for the values:

```
body: {
  kind: "organization" | "person" | "unit",
  names: [ { name, language | null } ],           // 1..8
  identifiers: [ ExternalIdentifier ],             // GLN, DUNS, tax id, a registry number: each namespaced by its issuer
  protocol_identity: { organization_id } | null,   // a CLAIM that this party is that DTP organization
  roles: [ "customer" | "supplier" | "carrier" | "financer" | "service_provider" | ... ],  // descriptive, never permissions
  locations: [ { location_id, address: Address, gln: string | null } ],
  parent: PartyRef | null,                         // for units
  status: "active" | "inactive"
}
```

Rules worth stating in the profile: `roles` are descriptive and no module may derive authority from them (SPEC.md §2.2 says the same of `business_types`); linking a party to a DTP organization id is an attributable claim by the writer, not proof of identity, per distinction 4 of the domain map; a `person` party is personal data and MUST be written under a personnel-classified policy in v0.4 terms; contact details are out of this kind (a later `contact@1` under a personnel policy). A `PartyRef` used by other kinds is `{ party_id: root, revision: record_id | null }`: entity link by default, exact revision when the citing fact is evidence.

## 8. `dtp/product@1`

A **state** kind. The entity is a product as defined by this company; `root_id` is the writer's id at genesis, and every inventory ledger for it is keyed by this root (section 5.2). The payload takes its vocabulary from schema.org `Product` (names, description, brand, category, identifiers) and GS1 (GTIN per packaging level) and its units from UCUM:

```
body: {
  names: [ { name, language | null } ], description: string | null, brand: string | null, category: string | null,
  identifiers: [ ExternalIdentifier ],             // GTIN, supplier SKU, internal SKU: issuer-namespaced
  base_unit: { system: "ucum", code },             // fixed for the life of the product; changing it is a new product
  packaging: [ PackagingRevision ],                // the v1 packaging revisions, each with its own GTIN if any
  tracking: "none" | "lot" | "serial",             // decides whether inventory positions carry lot_id / serials
  shelf_life_days: integer | null,
  status: "active" | "discontinued"
}
```

`tracking` and `base_unit` are immutable after genesis; a change is a new product with a `replaces` link, because the inventory ledger's keys depend on them. The relation to v0.2 `goods_spec` is one way: a `goods_spec` inside a trade record MAY cite a product by root, and never the reverse.

## 9. Prior art, honestly

This survey is from the standards' published texts as understood by the author; exact section references should be checked against the versions the owner pins.

| Source | What was taken | What was not, and why |
|---|---|---|
| GS1 EPCIS 2.0 and CBV | The event vocabulary (object, aggregation, transformation), lot as an identifier distinct from product, location as GLN, `disposition` as the source for the status idea, business time distinct from record time. | Its extension mechanism and JSON-LD context handling (open-ended, unbounded); its role as the stock ledger. EPCIS describes observations; this proposal needs a closed reducer with a CAS. |
| OASIS UBL 2.4 `Order`, `OrderResponse`, `Party` | Document structure: buyer, seller, lines, requested delivery, references to prior documents; the party/identifier/address split. | The size of the vocabulary and its code lists; the XML/JSON schema machinery. Bounded mappings only, as the domain map already recommends. |
| UN/EDIFACT ORDERS, NAD | The discipline that a party is identified by a code namespaced by its issuer (NAD with qualifier and agency), which became `ExternalIdentifier`. | Everything else: EDIFACT's implementation guides are the dialect problem this protocol exists to avoid. |
| Odoo stock moves and quants | Double entry between locations, virtual locations for supplier, customer, inventory loss and production; a reservation as a claim against a quant. This is the shape of section 5.3. | Odoo's model is an application's; its location hierarchy, routes, putaway rules and picking types are workflow, not shared facts. |
| schema.org `Product`, `Offer` | The descriptive vocabulary and the GTIN mapping. | Its open, untyped extensibility and web-page orientation; nothing in schema.org says how a product's units or lots behave. |
| UCUM | Unit codes and annotations for counted units. | Conversion: UCUM defines it, this proposal forbids it in the reducer. |

Not surveyed and worth the owner's attention: GS1 GDSN for product master data exchange, and the OpenPEPPOL order profiles built on UBL, which are the most widely deployed subset of UBL orders.

## 10. Decisions for the owner

| # | Decision | Recommendation |
|---|---|---|
| P1 | Reserve the `dtp` namespace for protocol kinds and add `spec/profiles/index.json` as the kind registry. | Yes. |
| P2 | Add a `kinds` selector to the v0.4 read path that expands to admitted digests. | Yes; it is the mechanism that makes "subscribe by kind" real. |
| P3 | Dual publication versus inheritance for private kinds that extend protocol kinds. | Dual publication. |
| P4 | Dialect extensions: `nullable`; `decimal`. | `nullable` yes; `decimal` defer. |
| P5 | The closed status set for inventory positions. | `available`, `quarantine`, `damaged`, `expired`, `in_transit`. |
| P6 | Reservations as a separate array versus a status. | Separate array. |
| P7 | Observation compaction: per-source high-water mark versus clock horizon. | High-water mark. |
| P8 | Maximum legs per move fact. | 16. |
| P9 | Whether `inventory@2` includes aggregation (handling units). | No; a later logistics kind. |
| P10 | Whether `order@1` carries a `commitment` field at all. | No; the kind is the commitment, and a field invites the wrong use. |
| P11 | `party@1` `kind: person` under a personnel policy only. | Yes. |
| P12 | Whether product `base_unit` and `tracking` are immutable. | Yes; a change is a new product. |
| P13 | Which drafts are built first. | `inventory@2` and `product@1` together (the ledger key depends on the product), then `party@1`, then `order@1`. |
| P14 | Whether a forecast kind is drafted alongside `order@1` so that the "never an order" rule has a home for the other thing. | Yes, a minimal `forecast@1`. |

## 11. What this proposal does not do

It does not change any existing profile, vector, signing domain or v0.2 type. It does not claim that the four drafts are complete; each needs its own fixtures, negative vectors and a second implementation before it is registered, per the domain map's promotion rule. It does not settle personnel privacy for `party@1` beyond routing person parties to a personnel policy. It does not define transport or delivery of facts to subscribers beyond the existing v0.4 list and export commands.
