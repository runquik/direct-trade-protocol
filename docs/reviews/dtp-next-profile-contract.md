# DTP next: deterministic business-profile contract

Status: implementation contract for review, not a production or legal verification claim.

## API and integration boundary

New pure TypeScript helpers live in `sdk/src/profiles/`. No database, network,
wall-clock reads, SDK authority bypasses or executable customer validators.

- `validateInvoice(body: unknown, options?: InvoiceValidationOptions): ValidationReport`
  checks decimal arithmetic independently of schema validation. Reference resolver
  is optional and returns explicit `present`, `missing`, `inaccessible`, or `unknown`
  observations. `report.valid` means no deterministic invalidity; `report.complete`
  additionally requires resolved references. Neither means buyer attestation or payment.
  Resolver metadata can establish an exact expected type and company parties. A
  missing local reference is a finding, not invented external truth.
- `applyInventoryEvent(state: InventoryState, event: InventoryEvent): InventoryResult`
  is an immutable reducer with company/source/observation deduplication, immutable
  version-pinned packaging, stock revision CAS, cumulative reservations, release,
  partial fulfillment and explicit correction/late-event handling. Exact retry is
  a no-op; conflicting reuse of an observation identity fails. It is an optional
  inventory profile, never inferred from loose CTE extra fields.
- `parseDecimal`, `formatDecimal`, and `multiplyRounded` use bounded `bigint`
  arithmetic. Invoice profile v1 uses six money decimal places, three quantity
  decimal places, and half-up rounding of each line before totals. Unsupported
  currency/unit or excess precision is rejected, never guessed or coerced.

Root integration should reject `validateInvoice(...).valid === false`; expose
incomplete reference observations honestly. Existing schema/role/transition checks
remain mandatory. The helper does not confer reference access: the caller must
resolve only evidence the acting principal is allowed to inspect and should use
`unknown`/`inaccessible` without leaking existence.

## Storage obligations, not promises made by pure functions

The store MUST run inventory observation uniqueness, packaging registration,
reservation invariants, expected-revision comparison and state persistence in one
atomic transaction for the same company/stock pool. Running a reducer against two
stale snapshots and writing both is unsafe. Observation identity includes source
namespace and company, not a bare external ID. Pack revisions are immutable and
events pin a digest; changing a pack does not reinterpret earlier events.

The reducer keeps the observations supplied in its pool snapshot. A host that
uses separate pool snapshots MUST additionally enforce a company-wide unique
`(company_id, source_id, observation_id)` index in that same transaction; otherwise
an identical physical scan can be submitted to two different pools. The helper
does not pretend a local object can enforce that database-wide condition.

Inventory availability is a declared stock-pool invariant, not proof of physical
stock, ownership or global exclusivity. Negative correction cannot consume reserved
stock. Fulfillment consumes the named reservation and on-hand balance together.
Late physical timestamps do not rewind committed allocation authority. A correction
is a distinct, authorized delta, not deletion of the original signed observation.

No aggregate HR rules, payroll calculations, tax engine, exchange-rate lookup,
forecast, lien clearance or lending decision belongs in these helpers.

## Verification and limitations

`node --test tests/profiles/business-profiles.test.ts` from `sdk` exercises exact
arithmetic, rounding/magnitude bounds, payment-state contradictions, reference
classification, namespaced retries, pinned revisions, reservation CAS, partial
fulfillment, releases, corrections and 1,000 deterministic mixed-event attempts.
This is pure-function evidence. Signed HTTP admission, persistence, atomic races,
cross-host migration and optional-profile negotiation require separate integration
tests. A schema-shaped invoice with mathematically reconciled values is not a
buyer-confirmed invoice, paid settlement or proof of fulfillment. This version
does not reconcile settlement values, credit-note histories or fulfillment amounts
across referenced records; it only classifies reference observations supplied by
the caller. It must not be labeled full business verification.
