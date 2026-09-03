# Accountability matrix (generated)

Who may create each record type and move it between states. Generated from `x-dtp-transitions` in spec/schemas — edit the schemas, not this file.

## `core.company`

Subject: `self` · default visibility: `public` · writable by: company

No status machine; superseding records are governed by the envelope rules only.

## `core.module`

Subject: `publisher_company_id` · default visibility: `public` · writable by: company, module

No status machine; superseding records are governed by the envelope rules only.

## `core.grant`

Subject: `self` · default visibility: `private` · writable by: company

Initial status: `active` — created by: subject

| From | To | Who | Clock | Note |
|---|---|---|---|---|
| active | revoked | subject |  |  |
| active | active | subject |  |  scope change |

## `trade.intent`

Subject: `buyer_company_id` · default visibility: `public` · writable by: company, module

Initial status: `draft`, `posted` — created by: buyer

| From | To | Who | Clock | Note |
|---|---|---|---|---|
| draft | posted | buyer |  |  |
| draft | cancelled | buyer |  |  |
| posted | matched | buyer |  |  recorded by the buyer (or its matcher module) when a match is accepted for negotiation |
| posted | cancelled | buyer |  |  |
| posted | expired | buyer | after expires_at |  |
| matched | contracted | buyer |  |  |
| matched | cancelled | buyer |  |  |
| contracted | fulfilled | buyer |  |  |
| fulfilled | settled | buyer |  |  |

## `trade.listing`

Subject: `seller_company_id` · default visibility: `public` · writable by: company, module

Initial status: `draft`, `active` — created by: seller

| From | To | Who | Clock | Note |
|---|---|---|---|---|
| draft | active | seller |  |  |
| draft | withdrawn | seller |  |  |
| active | matched | seller |  |  |
| active | withdrawn | seller |  |  |
| active | expired | seller | after expires_at |  |
| matched | contracted | seller |  |  |
| matched | withdrawn | seller |  |  |

## `trade.offer`

Subject: `offerer_company_id` · default visibility: `counterparties` · writable by: company, module

Initial status: `submitted` — created by: offerer

| From | To | Who | Clock | Note |
|---|---|---|---|---|
| submitted | shortlisted | target_owner |  |  |
| submitted | accepted | target_owner |  |  |
| submitted | rejected | target_owner |  |  |
| submitted | retracted | offerer |  |  |
| submitted | expired | offerer, target_owner | after expires_at |  |
| shortlisted | accepted | target_owner |  |  |
| shortlisted | rejected | target_owner |  |  |
| shortlisted | retracted | offerer |  |  |
| shortlisted | expired | offerer, target_owner | after expires_at |  |

## `trade.contract`

Subject: `buyer_company_id` · default visibility: `counterparties` · writable by: company, module

Initial status: `active` — created by: buyer, seller

| From | To | Who | Clock | Note |
|---|---|---|---|---|
| active | in_fulfillment | seller |  | trigger: trade.fulfillment created |
| active | cancelled | buyer, seller |  |  mutual: the other party countersigns by superseding again |
| in_fulfillment | delivered | buyer |  | trigger: fulfillment complete |
| in_fulfillment | delivered | seller | after dispute_window_hours past seller attestation |  presumed acceptance |
| in_fulfillment | disputed | buyer | within dispute_window_hours |  |
| delivered | settled | buyer |  | trigger: trade.settlement created |
| disputed | resolved_buyer | arbitrator | within P7D |  |
| disputed | resolved_seller | arbitrator | within P7D |  |
| resolved_buyer | settled | buyer |  |  |
| resolved_seller | settled | buyer |  |  |

## `trade.fulfillment`

Subject: `seller_company_id` · default visibility: `counterparties` · writable by: company, module

Initial status: `seller_attested` — created by: seller

| From | To | Who | Clock | Note |
|---|---|---|---|---|
| seller_attested | buyer_attested | buyer | within contract.dispute_window_hours |  |
| seller_attested | disputed | buyer | within contract.dispute_window_hours |  |
| seller_attested | complete | seller | after contract.dispute_window_hours |  presumed acceptance |
| buyer_attested | complete | buyer, seller |  |  |
| disputed | complete | buyer, seller |  |  after arbitration recorded on the contract |

## `trade.settlement`

Subject: `buyer_company_id` · default visibility: `counterparties` · writable by: company, module

Initial status: (none) — created by: buyer

## `trade.standing_agreement`

Subject: `proposer_company_id` · default visibility: `counterparties` · writable by: company, module

Initial status: `proposed` — created by: proposer

| From | To | Who | Clock | Note |
|---|---|---|---|---|
| proposed | countered | buyer, seller |  |  |
| proposed | active | buyer, seller |  |  counterparty countersigns |
| proposed | terminated | buyer, seller |  |  |
| countered | active | buyer, seller |  |  |
| countered | countered | buyer, seller |  |  |
| countered | terminated | buyer, seller |  |  |
| active | completed | buyer, seller | after terms.period_end |  |
| active | terminated | buyer, seller |  |  |

## `finance.invoice`

Subject: `seller_company_id` · default visibility: `counterparties` · writable by: company, module

Initial status: `draft`, `issued` — created by: seller

| From | To | Who | Clock | Note |
|---|---|---|---|---|
| draft | issued | seller |  |  |
| draft | void | seller |  |  |
| issued | acknowledged | buyer | within PT48H |  |
| issued | disputed | buyer | within PT48H |  |
| issued | partially_paid | seller |  | trigger: finance.settlement_event |
| issued | paid | seller |  | trigger: finance.settlement_event |
| issued | void | seller |  |  |
| acknowledged | partially_paid | seller |  |  |
| acknowledged | paid | seller |  |  |
| acknowledged | disputed | buyer |  |  |
| disputed | acknowledged | buyer |  |  |
| disputed | void | seller |  |  |
| partially_paid | paid | seller |  |  |

## `finance.advance_offer`

Subject: `seller_company_id` · default visibility: `counterparties` · writable by: company, module

Initial status: `offered` — created by: financer

| From | To | Who | Clock | Note |
|---|---|---|---|---|
| offered | accepted | seller |  |  |
| offered | declined | seller |  |  |
| offered | withdrawn | financer |  |  |
| offered | expired | seller, financer | after expires_at |  |

## `finance.advance`

Subject: `seller_company_id` · default visibility: `counterparties` · writable by: company, module

Initial status: `funded` — created by: financer

| From | To | Who | Clock | Note |
|---|---|---|---|---|
| funded | partially_repaid | financer |  | trigger: finance.settlement_event |
| funded | repaid | financer |  | trigger: finance.settlement_event |
| funded | defaulted | financer | after maturity_at |  |
| partially_repaid | repaid | financer |  |  |
| partially_repaid | defaulted | financer | after maturity_at |  |
| defaulted | repaid | financer |  |  |
| defaulted | written_off | financer |  |  |

## `finance.settlement_event`

Subject: `from_company_id` · default visibility: `counterparties` · writable by: company, module

Initial status: (none) — created by: payer

## `traceability.cte`

Subject: `actor_company_id` · default visibility: `counterparties` · writable by: company, module

Initial status: (none) — created by: actor

## `traceability.coa_anchor`

Subject: `company_id` · default visibility: `counterparties` · writable by: company, module

Initial status: (none) — created by: anchor

