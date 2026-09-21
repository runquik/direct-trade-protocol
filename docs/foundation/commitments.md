# Provider commitments and replaceable coordination

Internal foundation draft, September 12, 2026. Pure helpers in
`sdk/src/foundation/commitments.ts`; no authenticated endpoint, database transaction,
provider network request or payment rail is implemented here.

## Provider-owned capacity

One `ProviderState` represents one company-owned capacity resource with a fixed
issuer-scoped unit and positive safe-integer capacity. Pool kind distinguishes
goods, warehouse, transport and staffing but does not pretend their replenishment
semantics are identical. This bounded fixture uses time-windowed capacity for all
four; consumptive goods inventory requires the inventory handler, not an assumption
that a fulfilled order automatically replenishes stock.

Quotes pin an exact company-local record revision, previous revision, provider,
customer, resource, integer quantity, unit, half-open UTC time window, expiry,
decimal price/currency, taxes/fees, cancellation policy and risk responsibility.
The combined quote issuer, buyer's counterparty and freight-cost bearer are
explicit company IDs. A substitution requires a new quote and new approval.
No default guarantee is assigned to DTP or the coordinator.

`applyProviderCommand(state,command,{expected_revision,accepted_at})` returns a new
state and historical minimal receipt. It never mutates/persists the supplied
state. The enclosing host must authenticate actor/provider/customer rights,
validate source revision signatures and approvals, and atomically compare state
revision, store effects, durable business-ID receipt and outbox. The supplied
context is trusted host input, not a caller-selected clock or authorization token.

Commands are `quote.publish`, `hold`, `confirm`, `release`, `cancel`, `fulfill` and
`dispute`. Business operation IDs are distinct from transport IDs. Exact retries
return their prior receipt without reapplying, even after expiry or unrelated
state revisions. Changed command reuse conflicts. The state CAS is execution
metadata outside the durable command digest; a failed uncommitted CAS can retry
after reading fresh state without changing the logical operation.

Holds bind exact current quote revisions, parties, terms and resources and expire
no later than their quote. Confirmation requires the same quote and an unexpired
hold/current quote; it cannot swap provider, quantity or terms. Existing accepted
commitments survive later quote revisions. A sweep over half-open interval
boundaries checks peak simultaneous held/accepted capacity, not the sum of all
individually overlapping but mutually disjoint reservations. Arithmetic uses
BigInt for aggregation even though individual units are safe integers.

Expired holds free capacity. Released/cancelled holds do not reserve it. Accepted,
fulfilling, completed and disputed commitments retain their booking through their
window; fulfillment is not implicit resource replenishment. Release only applies
to held capacity. Cancellation of accepted commitments is allowed only under the
quoted `before_fulfillment` policy before any fulfillment; `never` is irreversible
through this helper. A failure cannot be represented as successful cancellation.

Fulfillment records good and damaged units separately, bounded by committed
quantity, with exact evidence references. A final short or damaged delivery is
disputed, not completed. Other disputes retain their reason and evidence. Payment
is independently `external_pending` throughout these fixtures; receiving goods
or closing a delivery does not establish settlement or move money.

## Durable coordinator contract

The coordinator owns no provider capacity. `createCoordinator` stores up to 16
exact quote legs, hold IDs/expiries and preallocated provider operation IDs.
`planCoordinator` returns copied next state plus at most one command for its
persisted pending request. The application must persist this state/outbox before
sending. Calling it again, including after process restart, produces the same
provider and logical command ID rather than creating another booking.

`recordCoordinatorTimeout` marks the pending request uncertain and retains it.
Timeout is not refusal or proof of no effect. `recordCoordinatorResponse` requires
the exact pending provider/operation/digest binding. A success receipt or definitive
refusal must come from the authenticated provider; the helper does not authenticate
that source. Only a definitive provider refusal is eligible for compensation.

All holds precede confirmation. Failure triggers release of reversible holds and
requested cancellation only where the original terms allow it. Accepted legs
with no cancellation route, rejected cancellation or unresolved uncertain request
remain visible. The result is `exception`, never a fictional rollback, while any
irreversible accepted commitment remains. `compensated` means the known accepted
legs were explicitly cancelled and holds released; it does not undo external
side effects or financial obligations outside the declared provider protocol.
Provider responses are deduplicated; conflicting responses cannot overwrite
already recorded progress. Provider replacement is not an in-place field edit:
it requires a new approved coordination plan with unresolved old commitments
retained for reconciliation.

The coordinator state/revision and pending command need atomic persistent CAS and
outbox storage supplied by the enclosing application. A function accepting a
previously persisted object is not durable storage by itself. Host/app replacement
tests serialize/restore this state but do not certify crash-safe PostgreSQL or
cross-host atomicity. External calls remain pending work, not direct effects here.

## Bounds and qualification

Provider history is bounded: 256 quote revisions, 512 holds and 1,024 command
receipts, with explicit capacity errors and no silent idempotency eviction.
Coordinator progress is bounded by 16 legs and four commands per leg. Records are
closed plain data, times/refs validated, integer arithmetic checked, and state
updates checked before returning. Tests are synthetic and independently reviewed;
the implementer does not approve their own implementation. Full F7 still needs
authenticated execution, approvals, persistence, provider messaging and failure
recovery integration before authoritative use.
