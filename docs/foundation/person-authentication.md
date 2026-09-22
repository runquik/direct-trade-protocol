# Transaction-bound person operation authentication

This adapter supplies actual Ed25519 person authentication for the foundation persistence library. It is a host library, not a public login/challenge route. It does not implement service identity, agency mandates, company governance, read policies, module admission or signature verification of business approvals. Those persistence hooks remain mandatory. The tests combine real person/resolver signatures with explicitly synthetic implementations of those other hooks.

## Frozen authentication contract

`createPersonAuthentication({ host_id, audience, identities }, { now })` requires an exact host audience origin and an explicit per-person resolver ID, resolver Ed25519 key, resolver epoch and minimum control sequence/digest. The optional second argument supplies a trusted local host clock and defaults to `Date.now`; it is a local runtime dependency, never a clock function or timestamp accepted from the wire. There is no discovery-based trust, key supplied by an untrusted request, automatic resolver replacement, or service-to-person fallback. The trusted enrollment of these pins is a separate deployment responsibility.

The configured pin is the binding the host **enrolled** the person with. The effective binding is the durable checkpoint row. Only `admitIdentityMove` advances that row to a later resolver epoch, from a verified [portable identity log](identity-log.md) whose lineage at the pinned epoch matches the enrollment; configuration alone can never move a person, and a restart with the enrollment configuration keeps an admitted move. Resolutions are verified against the row's binding, so the former resolver is refused from the admitting commit on.

Use `PERSON_AUTHENTICATION_SCHEMA` alongside the foundation storage schema. The adapter supplies:

- `issueChallenge(tx, { organization_id, person_id, intent, grant_id })` in a caller-owned transaction. The host generates 32 random bytes with `crypto.getRandomValues`; it never accepts a caller nonce.
- `authenticateOperation(tx, context)` as the mandatory persistence authentication hook.
- `beforeCommit(tx, context)` as the mandatory final persistence hook, for both new execution and historical business retry.
- `admitIdentityMove(tx, { person_id, log, require_attestation })` in a caller-owned transaction: the relying-party admission procedure over the durable checkpoint. It refuses a log for another identity, a lineage not enrolled here, or a fork at the same epoch; a fork at a higher epoch supersedes the checkpoint and is reported. Whether unattested heads are acceptable is the caller's explicit policy, since a former resolver that is gone or hostile may have attested nothing.
- `receiveIdentityLogPush(tx, { message, require_attestation })` in a caller-owned transaction: the relying-party side of the owner push (`dtp-identity-log-push-1`). It judges the pushed log against the durable checkpoint exactly as `admitIdentityMove` does, stores an admission the same way, and answers with the acknowledgment and its normative reason; an identity this host never enrolled is refused as `unknown-identity`, and repeating a push is idempotent.
- `signPersonOperation(...)` as a client convenience; this signing helper does not independently establish trust in the host offering the challenge.

The persisted challenge has exactly `host_id`, `nonce`, `organization_id`, `person_id`, `audience`, `intent_digest`, `grant_id`, `issued_at` and `expires_at`. Its lifetime is 60 seconds measured from the database clock. Issuance is bounded to 16 outstanding challenges per person and 4096 total issued rows per configured host. These are fail-closed pilot capacity limits, not an abuse-protection service. No automatic cleanup, public issuance route or network rate-limit implementation is claimed.

The signed request contains exact `intent`, global-person `actor`, `grant_id`, and an `authentication` object containing the full challenge, resolver-signed resolution and operational signatures. Signatures cover canonical bytes for:

```text
domain: DTP-PERSON-OPERATION-1
body:
  challenge: full immutable stored challenge
  actor: exact global person reference
  intent_digest: SHA-256(canonical exact intent)
  grant_id: exact capability grant ID
  resolution_digest: SHA-256(canonical signed resolution envelope)
```

All signatures must be distinct currently operational keys and satisfy the resolved operational threshold. Recovery keys are not normal business signers. The adapter uses the existing `verifyResolution` implementation, including resolver signature, audience/challenge/identity/epoch binding, control digest, lease and checkpoint checks. A valid signature over a different signing domain does not authenticate a person command.

The adapter admits closed ordinary data only. It uses the identity copier's bounded depth/containers, 4096-character string limit and 32-field object limit, plus a 256 KiB authentication envelope ceiling. This is intentionally a stricter bounded authentication envelope than unrestricted application payloads; large payloads need exact references, not embedded attachments. It never fetches URLs, invokes schema code or strips unknown request fields.

## Challenge, checkpoint and retry durability

The authentication hook locks a durable checkpoint keyed by host and person, shared across all represented organizations. It then locks the challenge row, verifies the complete original binding and signatures, advances the high-water control checkpoint and marks the nonce consumed in the **same passed business transaction**. It stores the full signed-request digest, transaction ID, consumption time and earliest challenge/proof deadline.

Failed business validation or any later SQL failure rolls back nonce consumption and checkpoint advancement with the business effects. The identical signed request can then be retried while still valid. After a successful commit, that nonce is unusable. A historical business retry requires a fresh random challenge, fresh resolver proof and fresh operational signatures, while preserving the original business intent, person and grant ID. The persistence layer returns its original business receipt without re-evaluating or charging again.

Higher control checkpoints learned while acting for one company prevent older control from being reused at another company on the same host. Configured checkpoint advances and same-epoch resolver changes that conflict with durable state fail closed; a resolver change is admitted only through `admitIdentityMove`. This is not protection against a pinned resolver forging an entirely new authorized-looking control head. The chosen resolver trust model remains relevant.

Lock order is represented-organization authority row (persistence), shared person checkpoint, then challenge. Same-person operations at different organizations deliberately serialize on their common checkpoint. Issuance separately uses a short host issuer-counter lock for finite capacity; business execution never takes that issuer lock. Additional identity, foreign-origin policy, agency and governance locks must follow the host's documented ordering or abort/retry on database deadlock. Retry uses the same logical operation and does not imply a business refusal.

## Expiry at the actual SQL commit boundary

A JavaScript check before `COMMIT` is insufficient: asynchronous work, process pauses or database queuing could carry acceptance beyond the proof's lifetime.

The adapter brackets each actual database `clock_timestamp()` query with fresh trusted host-clock samples, taken **after** any checkpoint/challenge lock wait. The DB timestamp must lie inside that host sample interval, allowing at most **1000 ms** of skew on either side. Query round-trip duration is separately bounded to **1000 ms**; a slower/ambiguous sample fails as a clock-measurement failure, not evidence of mismatched clocks. No lock-wait duration is added to any credential deadline or skew allowance. The supplied immutable admission time must not be in the future at hook entry; the host clock must not regress across the hook or its sample. Database time must not regress between authentication checks or below consumption time at finalization.

Passing that bracket test establishes consistency with a possible sample instant, **not proof that the actual clock offset is at most 1000 ms**. At the maximum admitted round-trip duration, sampling uncertainty can add up to another 1000 ms to an inferred offset bound. The separate **5000 ms remaining-validity reserve** and all proof/challenge/grant deadlines remain unchanged.

Resolver/host/database clock synchronization within the declared operator bound is a deployment prerequisite, not certified by this interval test. Sampling cannot independently measure a remote resolver clock, locate the DB sample more precisely than its request interval, or promise correctness under arbitrary clock jumps. Host integrations must obtain admission timestamps from the same trusted time source and independently monitor clock health. A long queue wait is permitted only while the unchanged credential deadlines remain live.

The final persistence hook receives a newly checked `valid_until`: the earliest live grant-chain expiry and, for a fresh operation, relevant approval expiries. `beforeCommit` checks the exact consumed signed request, actor/intent/grant binding and current transaction ID, then lowers the stored deadline to the minimum of that bound and its existing challenge/proof deadline. It can never extend a consumed credential's validity or reuse another transaction's consumption.

The hook sets the named deadline constraint to deferred, then updates the consumed row. A `DEFERRABLE INITIALLY DEFERRED` SQL constraint trigger compares the stored deadline with `clock_timestamp() + 5000 ms` during actual SQL commit. If expired, the entire transaction fails, including business effects, budget counters, receipt, outbox, checkpoint and nonce consumption. The trigger is not a promise of an exact disk-flush timestamp or an external payment guarantee. It defines the database's commit-time authorization check with an explicit safety reserve.

The application must not disable the trigger, change constraint timing after the final hook, bypass the library, or let an untrusted client execute arbitrary SQL. The database role/operator remains trusted. Direct SQL mutation of identity pins, proof deadlines or business state is outside the adapter's threat model.

## Test evidence and remaining integration

`person-authentication.test.ts` exercises real signatures/quorum, immutable challenge scope, wrong-purpose/recovery/duplicate keys, resolver pins and cross-organization checkpoint rollback, fresh authentication of a historical business retry, whole-transaction rollback, the real database-clock deferred trigger, clock-skew/late-deadline denial and finite issuance capacity. `person-authentication-move.test.ts` (implementer-tested, not yet independently reviewed) exercises admission of a move: the new resolver authenticates, the former is refused, the binding survives a restart with the enrollment configuration, refusals for another identity, a foreign lineage, an operational-signed move and a same-epoch fork, a reported higher-epoch supersession, and transactional rollback. `personAuthenticationFixture(Db)` can be reused for PostgreSQL qualification; only its person authentication is real, while its other policy/governance/accounting hooks remain synthetic and explicitly identified.

Independent review and real PostgreSQL trigger/race qualification remain separate from owner test execution. This adapter does not claim an authenticated production workspace, service lifecycle, a complete authorization policy engine, global checkpoint federation, production rate limiting or whole-foundation release readiness.
