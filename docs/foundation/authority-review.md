# Independent operation-authority review

September 12, 2026. Scope: root-authored `sdk/src/foundation/authority.ts`, its
eight original tests and `docs/foundation/authority.md`. Eight independent
desired-invariant probes are in `sdk/tests/foundation/authority-review.test.ts`.
The reviewer did not implement this helper or its production corrections.

## Reproduced finding

### P2: retry returns before validating the selected grant's operation scope

`authorizeAndCharge` initially checks that the selected grant chain is active and
its leaf names the actor, then returns an existing receipt before checking that
the requested organization/operation/profile/resources are within every selected
grant's scope. A prior `trade.quote` receipt can therefore be replayed by the same
person using an active but unrelated `trade.inspect` grant while preserving the
original intent and plan digests. The independent test builds both grants through
the public helper rather than inventing malformed authority state.

This does not charge the budget twice or cause a new effect by itself. It violates
the documented current-authority scope condition for a retry and can mislead an
integrating caller into treating any active grant as permission for that operation.
Current receipt disclosure policies remain a separate mandatory defense.

Required correction: validate requested scope against every live ancestor before
the replay shortcut, or bind the receipt's grant context and reauthorize it with
equivalent strictness. Do not charge budgets again or require a fresh business
effect merely to return the existing receipt. The implementation lead owns the fix.

Initial independent run with Node 22.23.2: **16 tests, 15 passed, one failed**.
The failure is a desired-denial assertion, not a known-gap test labeled green.

## Positive observations

- Scope is explicitly represented-company, operation, profile and resource bound;
  delegation can narrow but cannot add a different operation, metric issuer,
  resource, profile, longer duration or delegation power.
- Sibling and grandchild spending charges each live ancestor. Independent probes
  spend 60 through a grandchild and 40 through a sibling, then reject one additional
  unit against the shared parent ceiling. Exact successful retries do not recharge.
- Parent and staff-grant revocation independently block new execution. Using agency
  controller identity in place of its worker or revoking a client mandate without
  the client quorum fails. No client employee account is fabricated by this chain.
- Parent approval rules remain effective even when a child has no rule. Distinct
  identities, actor exclusion, expiry, operation ID, intent digest and evaluated-plan
  digest are checked for a new effect. A changed plan or actor's self-approval fails.
- Failed approval/budget decisions leave the supplied state intact despite tentative
  charges on the copied state. Nested grant/accessor and consent-array probes reject
  without executing getters. This is useful for transactional orchestration, not
  a substitute for it.

## Host input and integration boundaries

`PrincipalConsent`, `ApprovalEvidence`, `actor`, `usage` and the authority snapshot
are authenticated/current host inputs, not client credentials. The helper cannot
verify a signature, discover a person's current key, infer whether a service is
active, or calculate trustworthy usage from arbitrary business terms. Falsely
measured zero usage can bypass an economic ceiling if the enclosing host fails
its contract; the kernel must derive each metric from the exact accepted plan and
conformance-test that accounting mapping. Exact issuer-scoped metric names alone
do not prove currency scale or economic meaning.

An agency organization grants authority through its controller-approved child
grant. Employment/engagement lifecycle still must deactivate that authority when
the employee departs. This helper has no live HR directory or service-custodian
transfer implementation. It must not be advertised as automatically knowing every
staff change or checking remote organizational state.

Approval evidence is already verified outside this helper. Thresholds and
`exclude_actor` compare person identities, not beneficial ownership, service
custodians or hidden related parties. Do not imply broader separation-of-duties
rules. Empty limit lists explicitly mean no metric budget for that chain; there
are no automatic daily resets, FX conversions, refunds or unbounded policy code.

The helper returns an uncommitted next snapshot. The host must atomically compare
authority revision, current grant/mandate state and resource expectations; persist
budget charges, business receipt and outbox only with the accepted effect; and
discard everything on failure. Two independent calculations from an old snapshot
are not concurrent-budget safety until indexed storage CAS/locking is implemented
and tested. Schema-valid `record.append` must not bypass the operation path.

Input copying rejects malformed plain-data objects and has depth/node/container
and final canonical-byte limits. It is not a proxy sandbox, tenant rate limiter or
proof of low memory/CPU cost for arbitrary in-process objects. Public request byte
limits and authorization must run before expensive state construction. The bounded
4,096-entry grant/receipt model is an oracle, not the final indexed storage design.

## Disposition

The implementation lead moved every-ancestor scope checks before the receipt
replay branch. This reviewer independently reran both suites: **16 passed, zero
failed, zero skipped**. The reproduced P2 is resolved; the bounded helper slice
has scoped acceptance under its explicit authenticated-host-input contract.

This does not close F2: signatures/enrollment, service lifecycle, current data
rights, agency termination propagation, transaction races, generic-write bypasses
and durable migration remain separate graph gates.
