# Replaceable discovery helper

Internal foundation draft, September 12, 2026. Direct import from
`sdk/src/foundation/discovery.ts`. This is an in-memory contract/helper over an
already authenticated authoritative feed, not an integrated public index,
authenticated HTTP endpoint, live supply guarantee or network-wide catalogue.

`DiscoveryPublication` pins an exact company-local record revision, previous
revision, profile digest, provider company, kind (`goods.supply`, `goods.demand`,
`service.supply`, `service.demand`), explicit publication/withdrawal status,
public or company-allowlisted visibility, published time, expiry and terms.
Provider is the represented company, not necessarily the human/service actor.
The index's `apply(publication, authenticatedProvider, acceptedAt)` trusts the
caller to have verified original record signatures, exact revision/body binding,
current publishing authority and feed order. A company ID passed to a helper is
not authentication. The helper checks provider/company/reference consistency and
exact previous-head CAS; it does not verify identity or signatures itself.

Terms contain issuer-scoped category and service-area identifiers, optional exact
subject resource, UTC time window and explicitly supported timezone, knowledge-
tagged quantity with issuer-scoped unit, separate knowledge-tagged minimum/maximum
quantity constraints, authority locator, pricing, and exact condition identifiers.
Only intentionally published fields are represented; raw stock, internal costs,
bank/payroll fields and unrestricted extra metadata are not accepted. Terms may
still contain sensitive text deliberately published by their owner: this is
explicit-field admission, not automatic confidential-data classification.

Pricing is exactly `request_for_quote`, or `{kind:asking|estimate|budget,amount,
currency,basis,taxes,fees}`. Demand uses budget or RFQ; supply uses asking/estimate
or RFQ. Currency and basis are issuer-scoped external identifiers. Decimal amounts
are nonnegative canonical strings, at most 18 integer and six fractional digits;
no conversion or rounding occurs. A supply quantity may be known zero; a known
demand quantity must be positive. Unknown/withheld/absent quantities remain such,
never becoming available stock. Zero supply does not match positive demand.
Known quantity/bounds use identical unit identities and minimum cannot exceed
maximum. A known demand must satisfy its own bounds. A known requested quantity
outside a supplier's minimum/maximum is excluded; unknown/withheld limits are
flagged `order_limits_unknown_not_unrestricted`, not treated as permission.

## Admission, lifecycle and matching

`createDiscoveryIndex({profiles,supported_timezones})` receives exact operator-
admitted `{digest,kind,compatibility_group}` bindings. Group names are local
operator assertions of compatible meaning, not values accepted from publications.
Unrecognized profiles or mismatched kinds fail closed. Different kinds/digests
can match only under the admitted group and the same goods/service family.

Publication opt-in is explicit. First revision has null previous; subsequent
revisions require exact previous current head. Withdrawals have null terms and
remain as tombstone heads. Previously seen revision IDs cannot roll back a newer
publication/withdrawal. An identical current-head retry is harmless; conflicting
reuse rejects. Republishing requires a distinct new revision explicitly based on
the withdrawal. Expired publications can only be renewed with a new revision.
The bounded index holds at most 1,024 publications and 8,192 accepted revisions;
capacity exhaustion is explicit, never silent history eviction.

`findPotentialOffers({demand,viewer_organization,now,limit,cursor})` requires the
exact currently visible demand revision. A missing/private/expired/withdrawn/stale
demand produces the same unavailable error. Provider companies can see their own
publications; allowlisted counterparties see only granted publications; anonymous
viewers see only public publications. The caller must derive viewer organization
from current authenticated authority, not accept it as an unchecked URL parameter.

Matches require exact category/area identifiers, exact subject when demand names
one, compatible admitted profiles, overlapping time windows and all demanded
condition IDs. Known quantities require identical unit identities and sufficient
positive published quantity. Known prices require identical currency and basis
and stay within a declared budget; no FX, packaging conversion, geocoding,
category synonym or implicit product substitution is attempted. Unknown quantity
or RFQ pricing remains only a potential match with explicit limitations. Partial
time coverage, unspecified subject and excluded/unknown taxes or fees are flagged.
Every result requires an authoritative freshness/availability/terms check before
quoting or booking; publication time and expiry do not prove current capacity.

## Paging and replaceability

Results sort by stable publication identity. The cursor binds the viewer, exact
demand and digest of the currently visible matching results, never a raw feed
sequence, hidden row offset, hidden result count or global index version. Hidden
updates cannot alter another viewer's page/cursor. A visible matching revision,
visibility loss, expiry or withdrawal invalidates that viewer's cursor and
requires restarting the query; it never returns an old cached offer. Invalid or
cross-viewer cursors fail without revealing inaccessible state. There is no total
count. Limit is 1..50; cursor size is bounded. A replica with the same accepted
history yields the same pages and cursors.

Two disposable instances in tests replay the same verified fixture history and
produce identical results, including after withdrawal/republication. This proves
the helper is replaceable, not actual durable feed recovery or network completeness.
Cursor hashes are not authentication tokens. A client may select a later visible
anchor and skip its own visible results; that does not expand authorization.

The authority locator binds the same provider company, exact operation-profile
digest and bounded quote/booking operation names. It does not certify that the
provider currently supports those operations. No endpoint URL is accepted or
dereferenced. Quoting/booking must resolve the provider through
the separately trusted authority/locator interface. Host movement therefore need
not rename publication identities; actual locator migration and authenticated
change-feed wiring are separate integration gates. No discovery result is a firm
commitment, underwriting outcome or legal/physical verification.

## Tests and review

Fixtures contrast a retailer's hot-sauce demand and warehouse/transport service
needs. Tests cover issuer/unit/currency mismatches, unknown versus zero, private
visibility, expiry/withdrawal, conflicting retries, wrong provider, exact source
revisions, pagination privacy, two replicas, bounds and malformed objects. The
implementer runs tests but does not approve this implementation; an independent
reviewer owns acceptance and host-integration approval remains separate.
