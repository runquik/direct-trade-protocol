# Early Pay: modular financing demonstration

September 8, 2026. Local simulation only. No real company data, payments, lockbox, customer payment redirection or automated lender approval.

## Walkthrough

Start `Start-Passport-Demo.cmd` and open http://127.0.0.1:8789. Restarting resets fictional records, keys and applications.

1. Alex enters Acme. Open **Financial Profile** directly from the workspace to inspect the independent current company view.
2. Open **Early Pay**, select INV-1021 and **Find financing**. Choose Harbor Finance or Cedar Capital. Invoice/delivery disclosure is recipient-specific; Financial Profile and the bank aggregate are separate unchecked consent choices.
3. Riley enters Harbor's workspace. Its module updates include the new financing request. Follow **Open** directly to the request. Reading does not approve; inbox read state and assignment are separate.
4. Set advance %, fee % of principal and term within demo bounds. Numeric inputs and sliders show dollars and gross annualized equivalents. Review the server's exact quote, maturity and early-payoff policy, then issue.
5. Alex sees the offer on the invoice row and in the workspace. Review and accept it. Competing lender offers cannot also be accepted for this invoice root.
6. Riley separately approves simulated funding. Alex now sees an active advance awaiting repayment, not an immediate requirement to advance the demo.
7. Alex gets an early payoff quote or chooses full repayment. A repayment attempt remains pending and outstanding until Riley confirms simulated settlement. Riley can also simulate failure; Alex then requests a new quote.
8. After settlement, Financial Profile reports the current obligation and attributed repayment history from PBP. The original shared snapshot remains dated and unchanged. Buyer invoice payment is a separate event.

Taylor represents Cedar, a separately onboarded lender. Neither lender is an Acme member; each sees only its own applications. Sam has no finance permissions. Jamie can independently disconnect/reconnect Financial Profile. Early Pay can continue without a new profile snapshot; prior separately consented snapshots follow their disclosure rules.

## Module and protocol boundaries

Financial Profile owns collection, aggregation and snapshot production. Early Pay only consumes consented signed snapshots; it does not contain a private fallback profile collector.

PBP holds identities, authority, module manifests/installations, exact-version disclosures, offers, acceptance, simulated settlements and advance records. Early Pay's request index, per-person read state, assignments, quote cache and payment attempts are local module memory, not durable production services.

Published criteria are a demo lender directory, not firm automatic offers or approval probabilities. Two applications can coexist, but one invoice root can have only one accepted commitment within this running module. No external lien, competing module or off-protocol financing clearance is implied.

Exact USD principal and original fees round down to cents. Early payoff uses the signed proportional-fee policy over actual funded duration with a one-day minimum, rounded up to cents and capped at the original fee. Closure records the waiver separately:
principal + original fee = settled amount + waived fee + outstanding.
Annualized equivalents are simple gross calculations, not regulatory APR or realized net yield. Quoted maturity stays fixed if funding happens later.

No settlement record is published at payment initiation. The demo prepares a short-lived signed payer command; lender confirmation publishes it and separately reconciles the advance. Expired authorization requires explicit borrower renewal. Once settlement publication starts, a replacement payment is blocked until that same attempt is reconciled. Expired retry commands use exact-record readback, or identical-payload reauthorization by the original current approver.

## Known limitations

- The short-lived mock payment authorization is not a bank mandate. Real payment instruction/settlement semantics remain future work.
- Accepted-but-unfunded offers that expire require a demo reset; agreement cancellation is not modeled.
- Requests, read state and retry state are ephemeral. No crash-safe production payment coordinator, real underwriting, banking connector, legal protection, billing or global duplicate-financing prevention.
- Sharing references the buyer-owned PO; it does not redisclose it without owner permission.
- Unknown external debts/liens are not cleared. Signed evidence proves attribution, not real-world truth.
- The current read loops paginate, but no production scale or independent conformance certification is claimed.
- Do not expose the persona-selecting server publicly. This is not Boris's ShelfKit implementation.

See [Financial Profile](../financial-profile/README.md) and [review record](../../docs/MODULAR_FINANCE_REVIEW.md). Run the full SDK tests under Node 22.23.2; tests 12–14 cover the financing/disclosure/module flows. Rendered borrower/lender and narrow-screen checks are recorded in the review document.
