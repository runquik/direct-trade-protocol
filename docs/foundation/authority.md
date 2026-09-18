# Operation authority, bounded pilot contract

This module implements finite authorization decisions and cumulative counters over a supplied, trusted authority snapshot. It is not a login API. The host must verify all principal consents and approval signatures, resolve current keys, and load current grants inside the transaction that accepts the effects. Client-supplied `actor`, `approvals` or `usage` are never sufficient evidence.

## The two-company example

Acme controllers grant an exact-resource, exact-profile `trade.quote` mandate to Agency. Agency's current controller quorum delegates a subset to Riley. Riley is still an Agency worker, not an Acme employee. Both grants are checked on every new execution. Acme mandate revocation or Agency staff-grant revocation stops new work without erasing past obligations. An organization relationship alone gives no data access.

Root grants require the represented company's controller quorum. A child requires its parent's subject: the person/service, or an organization controller quorum. Delegation depth, time, operations, profiles, resources and metric ceilings may only narrow. Every ancestor's approval requirement remains effective. A steward/controller self-grant is an explicit governance action, not an undetectable bypass; persistent signed governance receipts remain host integration work.

Read access is independent. A business capability does not return records and a record-write permission does not authorize `trade.quote`, `reserve` or `pay`. No wildcards or executable policy expressions are admitted in this pilot helper.

## Budgets and approvals

Metrics use issuer-scoped identifiers and nonnegative integral strings (up to78digits). Their scale and meaning are pinned in the admitted profile, e.g. USD minor units or cases. There is no currency/unit conversion. Every descendant has the exact same metric set and an equal or lower ceiling. Every successful command charges every ancestor; siblings cannot each spend the full parent ceiling. Limits are cumulative over the grant's lifetime, not a silently resetting daily window. Zero is zero; absence of a limit list explicitly means no metric budget in that chain.

Usage must be calculated by trusted profile/host logic from accepted effects, never from the submitter's claimed amount. A grant with a money limit is not safe until the handler's accounting contract has passed conformance. Allocation/refund/reset policies are not implemented.

Approvals bind organization, operation ID, exact intent digest, exact evaluated-plan digest, grant ID and expiry. The plan digest must include every resource expectation and exact quote/terms dependency. Changing current resource state or terms requires fresh evaluation and, where required, fresh approval. Distinct people, thresholds and actor exclusion are enforced. Identity validity and signer authority at execution are checked by the enclosing host, not trusted from these objects.

## Required transaction boundary

`authorizeAndCharge` returns a copied next snapshot, not a durable commit. Commit its state, resource CAS effects, business receipt and outbox atomically, comparing the authority revision and all resource expectations. Never commit counters if effects fail, and never return success before durable commit. Concurrent siblings must conflict on the same ancestor counter. A duplicate operation returns replay without charging again only after current grant-chain checks; it must use the exact original intent/plan and actor. Removed access does not confer access to old receipt bodies.

This bounded in-memory reference has4096grant/receipt limits and fails closed at capacity. It is an oracle for indexed storage, not the proposed production storage layout. Registry enrollment, consent authentication, service-sponsor lifecycle, governance-change receipts, current read policies, revocation notifications and indexed transactional integration remain separate gates. Do not claim F2 complete from helper tests.
