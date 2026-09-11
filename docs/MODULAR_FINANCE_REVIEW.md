# Modular finance build and red-team review

September 8, 2026. Local simulation only. No deployment, real lending, lockbox, bank debit, or customer payment redirection.

## Architecture and assumptions

Passport owns person/company entry and authority. Workspace projects authorized module updates and deep links. Financial Profile independently reads PBP financial evidence through its own installation. Early Pay consumes explicitly consented profile snapshots and writes financing records back to PBP. Financial Profile subsequently observes those records, without an Early Pay database dependency.

Shared evidence is a snapshot, not continuous authority. A module disconnect and a disclosure revocation are different operations. Unknown off-protocol liabilities remain unknown. Published lender criteria do not imply automated approval.

The current distribution model is a directory with two separately onboarded lenders and selective applications. It supports multiple offers for comparison. One invoice root may have only one accepted financing commitment inside this running module. This does not detect external or other-module financing. Auto-underwriting and policy-issued firm offers are not implemented.

## Review team and fixes

Three independent read-only reviewers covered authorization/data isolation, financial logic/recovery, and UX/form/function. The owner implemented changes and performed rendered Chrome QA. Material findings corrected:

- Separate profile installation and explicit snapshot consent, rather than a second page backed by Early Pay's privileges.
- Lender-specific application access and invoice-root commitment guard.
- Pagination, current-head aggregation and explicit exclusions for unsupported money formats/currencies.
- Unread state distinct from assignment and financing decisions; workspace deep links and current invoice offer labels.
- Exact server-quoted offer terms, fixed maturity, bounded numeric inputs and explained annualized equivalents.
- Pending payment distinct from settlement, with full debt retained until reconciliation.
- Early payoff fee waiver recorded explicitly; original principal plus fee equals paid amount plus waiver plus outstanding.
- Expired mock payment authorization requires fresh borrower action; never silently re-sign as the borrower.
- Settlement-started recovery blocks a replacement payment. Exact closure writes can be recovered or reauthorized by the same current approver after expiry.
- Withdrawal remains available with unreadable unaccepted evidence; cross-company responses cannot overwrite the newly selected company's view.
- Settled outcomes lead with actual payment and fee, not original undiscounted economics.
- Default company choice uses Acme identity rather than unstable returned company ordering.

## Verification

Full final local SDK suite: **103 passing tests, zero failures** (99 top-level plus 4 nested), including six modular-finance tests. Qualified runtime: Node 22.23.2. Typecheck and browser JavaScript syntax checks pass. All three reviewers reported their blocking findings resolved for this bounded local prototype.

Integration coverage includes two lender companies, unauthorized person/company reads, scoped notifications, explicit sharing, profile disconnect, historical snapshot retention, competing-offer acceptance rejection, price tampering, exact quoted maturity, early payoff accounting, failed/pending payment, duplicate retries, and invoice payment remaining independent.

Adversarial tests advance the clock past authorization expiry and inject failure before and after the actual closure-send boundary before a delayed retry. A lost response recovers the already-persisted record without a second payment. Pending repayment rechecks borrower revocation. A 104-record profile test includes unsupported precision, negative balances and another currency.

Rendered QA: standalone Financial Profile, Acme request/consent, Harbor workspace notification, exact request deep link, assignment, editable 85%/1.25% offer, seller's prominent offer status, exact acceptance/funding, pending repayment and discounted settled outcome, profile feedback. Narrow-screen checks use a 390px viewport. This is not a WCAG certification or exhaustive device matrix.

## Known boundaries before production

- Ephemeral local data and persona selection are not production authentication or durable workflow recovery. Restart resets fictional data and keys.
- Mock payment authorization lasts two minutes; the borrower can renew an expired attempt. It is not a durable bank mandate. Accepted-but-unfunded expiry currently requires a demo reset; negotiated cancellation is not modeled.
- Notification read state and application workflow are module-memory projections, not a general durable workspace event service. Due reminders are evaluated on reads, not background delivery.
- No real bank integrations, underwriting model, lender policy automation, lien/priority search, buyer remittance integration, legal agreements, repayment guarantees or external duplicate-financing registry.
- The snapshot signature and x_terms/x_fee_waiver/x_simulated_receipt_at fields are experimental module conventions. Standardization and independent module interoperability need conformance work.
- Revisit durable orchestration, event/notification contracts, trusted-source enrollment, payment rail reconciliation, and agreement cancellation before persistent multi-user or real-money use.
