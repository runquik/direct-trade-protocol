# Foundation M0: independent architecture and authority review

September 12, 2026. **Contract proposal and implementation blockers, not release approval.**

The foundation plan names source baseline `5045e52`. The actual local HEAD at this
review is `755adcc`; this review inspected the current source rather than inheriting
the old candidate's green gates. No production implementation was changed by this
reviewer. Scope is M0 identity, operation authority and semantic admission, with
interfaces for the existing kernel and its planned persistence replacement.

The user has explicitly approved synthetic user-controlled recovery with separately
enrolled recovery keys, a replaceable explicitly trusted resolver, no unilateral
reset by any host or workspace operator, and optional NEAR. That approval chooses a trust model; the details
below still require an implementation contract and negative tests.

## Current assessment

| Dimension | Assessment for the expanded foundation |
|---|---|
| Security | Hold: host-local personal key state, person-only grants and generic write are not the proposed network identity and operation authority |
| Correctness | Hold: no resolver fencing, cumulative operation budgets, dual-organization execution or admitted handler effect contract yet |
| Performance | Reference only: the singleton transaction serializes unrelated reads/writes; do not export that assumption into resolver or resource guarantees |
| Maintainability | Preserve separation between controllers, stewards and data rights; replace semantic switches through one explicit registry rather than another runtime |

Positive controls worth retaining: canonical signed commands, strict audience and
expiry checks, distinct-person quorums, current grant checks, resource/policy
binding, exact revision/CAS, minimal retry receipts, immutable profile contracts,
and migration that validates before freezing the source.

Source anchors: `sdk/src/v04/wire.ts:32` derives IDs using draft-specific domains;
`engine.ts:82` rotates keys in only this host's person projection;
`permissions.ts:26` intersects installation grants with a sponsoring human;
`model.ts:16` exposes data actions rather than business operations;
`engine.ts:188` admits general record writes; `profiles.ts:47` admits only a fixed
semantic family set; `router.ts:29` begins the global serialized state transaction.
These are scoped legacy capabilities, not newly discovered violations of their
original v0.4 promise.

## 1. Proposed identity contract to freeze

Separate three counters: **identity control sequence**, **resolver authority epoch**,
and **company resource/host authority generation**. A host move is not a person
rotation. Package or public-release versions must not enter new identity derivation.

```ts
type IdentityRef = { namespace: string; id: string };
type ControlRef = { identity: IdentityRef; sequence: number; digest: string };
type KeySet = { keys: string[]; threshold: number };
type ControlRevision = {
  identity: IdentityRef; sequence: number; previous_digest: string | null;
  kind: "genesis" | "rotate" | "recover" | "recovery-policy";
  operational: KeySet; recovery: KeySet;
  resolver_id: string; resolver_epoch: number;
};
```

These are review interfaces, not generated wire artifacts. Freeze the actual domain
strings, canonical field set and derivation vectors before signing new records.
Recommended new identity namespace: a permanent DTP identity-genesis domain and
full content digest, not a hostname, email, employer or development-version label.
Retain old IDs under an explicit legacy namespace without rehashing their history.
Import requires the original genesis/verifier and authorized continuity statement;
matching keys, names or emails is not an automatic identity merge.

Control revisions require exact previous-head CAS at one declared resolver. All
counters are bounded safe integers. Recommended pilot bounds: eight operational
and eight recovery keys, distinct within/across sets, thresholds 1..set size,
bounded history pages, and independently verified contiguous history to a trusted
checkpoint. Multiple keys of one identity never count as multiple people.

- Normal rotation: current operational quorum plus possession of every added
  operational key; cannot remove or replace recovery authority.
- Recovery: current pre-enrolled recovery quorum plus new operational key
  possession; invalidates the previous operational generation. Ordinary keys need
  not survive. Recovery does not grant a new employer membership or data policy.
- Recovery-policy change: current recovery quorum plus possession of new recovery
  keys. Ordinary credentials alone cannot remove the owner's recovery route.
- No surviving authorized recovery quorum: explicitly unrecoverable under this
  pilot. Support staff cannot synthesize a reset. Personal recovery does not
  override the company's controller threshold or compartment stewardship.
- Every accepted revision has a durable signed resolver receipt. Two siblings of
  the same head are a conflict, never resolved by “largest sequence wins.”

### Resolution, freshness and replacement

An adapter is optional infrastructure, not optional verification. A verifier that
cannot establish sufficiently current control must reject new authorized effects.
It may still verify an old signature as historical attribution. The resolver
serves keys/control/locator data only, not memberships, employee records, grants,
or a searchable universal person directory.

Proposed injected adapter boundary:

```ts
interface IdentityResolver {
  resolve(request: {
    identity: IdentityRef; minimum: ControlRef | null;
    verifier_audience: string; challenge: string;
  }): Promise<ResolutionProof>;
  transition(request: SignedControlTransition): Promise<TransitionReceipt>;
}
```

`ResolutionProof` must bind exact identity/head, resolver ID and epoch, enrolled
resolver key, audience, caller challenge, issuance and expiry. No trust-on-first-use
from a returned URL or key. Challenges must be unpredictable and single-use for
execution, not a stable public nonce. Cache the highest verified checkpoint to
reject rollback and equal-sequence conflicts. Do not silently retain expired
authority when the resolver is unreachable. Proposed lifetime ceiling: 30 seconds.

**Freshness decision still needs ratification:** a fresh lookup is not atomic with
a remote host's later commit. Recommended bounded pilot semantics are that a
resolution proof is a short authorization lease. Rotation/recovery blocks issuance
of old-head proofs immediately and becomes effective no earlier than outstanding
lease expiry plus the declared clock margin. Hosts must not execute after proof
expiry; the effective barrier must be persisted by the resolver. Alternatively,
use an online single-use execution fence with explicitly documented cross-system
failure recovery. Do not promise instantaneous global revocation while merely
issuing short-lived bearer proofs. The delayed-effective lease option is simpler
but exposes a disclosed bounded compromise window and depends on trusted clocks.

Resolver replacement requires the existing trusted resolver to freeze that
identity, a new pinned resolver to acknowledge the exact head and epoch, and a
durable old-resolver transfer receipt binding both identities/keys, the head and
new epoch. Wait out old leases before new authority activates. The new resolver
cannot independently mint a competing lineage. Third-party verifiers validate
the transfer chain one hop at a time and retain rollback checkpoints. Cancellation
is possible before committed transfer; no old-resolver rollback after commit.

This is cooperative resolver replacement, not resolver-destruction recovery or
global consensus. If the old resolver is lost and might return writable, accepting
a recovery-key statement at another resolver is insufficient to fence the old
one. Mark that scenario unsupported until an external authoritative epoch/fencing
mechanism and failure tests are approved. Keep the adapter replaceable; do not
embed a blockchain or another network stack to hide this decision.

## 2. Service principals and agency dual authority

A service principal is organization-owned identity, not a pretend employee and
not merely an installed artifact. Proposed fields: stable service ID, owner
organization, keys/control revision, active status, bounded operation grants,
separately steward-approved data grants, and accountable custodian identities.
An installation may invoke that principal only through an explicit binding to
its admitted artifact/profile/operation set. Artifact approval is not business
authority; key possession is not legal verification.

Creation, key change, suspension and custodian transfer require the owning
organization's declared governance authority and new-key/custodian acceptance.
An unattended service cannot self-transfer sponsorship or approve its own grants.
If all current accountable custodians depart, pause new execution until explicit
transfer; a departed founding employee need not be impersonated forever. Name the
custodian role and its quorum separately from access grants. Transfer changes
accountability, not resource scope, budget, historical attribution or accepted
obligations. Legacy human-sponsored automation retains its old semantics.

Agency execution must carry **actor identity**, **actor organization**, **represented
client organization**, and an exact bilateral mandate revision. The client grants
only specified powers to the agency; the agency independently assigns those powers
to its active staff/service. Recheck both organizations at execution:

```text
client operation grant + current bilateral mandate
  intersect agency's current staff/service delegation
  intersect admitted installation powers, when applicable
  intersect required data grants + approvals + budgets
  -> authorized client-scoped effect
```

No fake client membership, inherited client controller rights, implied access from
a relationship, or actor substitution. Client data disclosure needs explicit
client stewardship; operation authority alone does not expose unrelated inputs.
Mandate termination blocks new work even if an agency grant remains cached, but
does not erase existing client obligations or imply valid cancellation of them.
Initially prohibit agency redelegation to another agency; support one explicit
client-to-agency mandate and bounded staff delegation.

## 3. Operation and approval contract

Proposed immutable `OperationContract` binds profile digest, operation name,
input schema/digest, required actor roles, finite constraint vocabulary, input
revision requirements, effect kinds, concurrency scope and retry semantics. A
descriptor neither executes code nor grants permission.

`OperationIntent` binds represented organization, business operation ID, exact
contract digest/name, actor/context, mandate/grant references, exact input record
revisions, output resource scope, quantities, monetary assets and full terms.
Its canonical digest is what approvers sign. Transport request IDs remain separate
from durable business-effect IDs: a new HTTP command after uncertain timeout must
not duplicate the original effect. The receipt key is the represented organization
plus business operation ID, with an immutable intent digest; conflicting reuse
fails. Replaying a receipt must still respect current disclosure permissions.

Recommended `OperationGrant` constraints for the first contract:

- Exact issuer/represented organization, grantee identity or agency, contract
  digest and operation-name list; finite exact resource IDs, not user predicates.
- Explicit expiry and optional not-before; parent grant ID; `may_delegate` flag;
  maximum delegation depth four. The child must narrow every constraint, including
  quantity, monetary asset, counterparty, resource, duration and delegation power.
- Per-operation amount/quantity ceilings and cumulative budgets with explicit
  immutable start/end window and denomination. No implicit FX or unit conversion.
  Missing means denied/unbounded only according to an explicit tagged field, never
  ambiguous `null`, omitted, or zero. Unsupported constraints fail closed.
- Charge every applicable ancestor and mandate budget in the same transaction as
  the effect. Different child grants cannot multiply their parent's spending
  ceiling. New windows, split orders and retries cannot reset charges. Do not
  automatically refund a commercial cancellation; compensating credits need a
  specified, authorized accounting event linked to the original charge.

Approval records bind the full intent digest, expiry, approval-policy revision,
approver identity, represented company and exact input revisions. Distinct-person
thresholds count identities, not keys. Separation of duties must say whether the
requester, delegate, service custodian, or beneficial organization is excluded;
implement only the declared finite rule. Mutation of amount, provider, quote,
currency, date, resource or terms invalidates prior approval. Authority, mandate,
parent grants and approval policy are rechecked at execution. A new business effect
cannot reuse a prior approval by swapping its business operation ID.

## 4. Semantic handler contract and kernel integration

Keep one admission path and one persistence transaction boundary. Suggested
interfaces, to coordinate with the implementation lead rather than fork a runtime:

```ts
type HandlerKey = { contract_digest: string; implementation_digest: string };
interface SemanticHandler {
  key: HandlerKey;
  evaluate(input: Readonly<AuthorizedOperationInput>): EffectPlan;
}
interface EffectPlan {
  expected_resources: ResourceRevision[];
  records: ProposedRecord[];
  resource_updates: DeclaredResourceUpdate[];
  budget_charges: ProposedCharge[];
  emitted_changes: ProposedChange[];
}
```

The operator statically admits reviewed handler implementations with pinned
contract and implementation digests and conformance vectors. No package download,
network schema resolution, dynamic evaluation or submitted-record import path.
Handlers receive only authorized input copies and explicit accepted time, not
`Context`, the whole `State`, arbitrary database access, clocks, randomness or
unrestricted callbacks. This interface is a least-authority convention for trusted
code, not a JavaScript sandbox against a malicious operator-installed function.

The kernel owns identity verification, operation/data rights, delegation and
approval checks, canonical effect identity, allowed effect tables/scopes, budget
charges, CAS, receipt/outbox atomicity and bounded output validation. It must reject
a plan that reaches unrelated resources or changes identities, grants or handler
admission. It validates that charges correspond to the declared intent; a handler
cannot omit budget consumption. Define hard bounds before implementation (propose
32 input revisions, 32 effect records/updates and 64 change events per operation;
existing request byte/depth ceilings still apply).

**Bypass blocker:** authoritative operation effects must not remain constructible
through generic `record.append` plus ordinary data-write permission. Mark affected
record kinds/resources as operation-managed; ordinary append may store attributed
structural observations but cannot mutate capacity, create a firm commitment or
mark a payment authorized. Handler-produced records carry the admitted contract,
operation/intent reference and receipt linkage. Structural-only hosts cannot
advertise enforcement or accept an unsupported operation as a structural success.

Migration must preflight exact handler support and carry operation receipts,
ancestor budget usage, mandates, service authority, resource revisions and outbox
checkpoints before source freeze. A replacement app can read/reconstruct pending
work without receiving the old app's secret key or blindly retrying accepted
effects. Actual provider/network calls remain external work driven by durable
outbox entries; there is no cross-host atomic promise.

## 5. M0 decisions and adversarial gates

| ID | Decision / blocker | Required evidence before closure |
|---|---|---|
| A01 | Freeze new identity-genesis wire domain and legacy continuity mapping | Same identity through app/host/package changes; original signatures retained; wrong domain and guessed alias rejected |
| A02 | Ratify freshness lease/barrier versus execution-fence semantics | A/B hosts see rotation/recovery; stale/expired/challenge-replayed proofs denied; resolver outage fails closed; no implied instant revocation |
| A03 | Freeze recovery-policy modification and proof-of-possession rules | Lost ordinary key recovers; ordinary key cannot delete recovery; attacker-owned recovery replacement denied; no surviving quorum remains unavailable |
| A04 | Cooperative resolver replacement only, or approve separate disaster fencing | Two resolver candidates cannot become writable; stale third peer rejects old epoch; lost receipt retrievable; old resolver cannot roll back |
| A05 | Define organization service custodian governance | Departure pauses under declared policy; explicit transfer resumes same service identity without widening grants; no service self-approval |
| A06 | Freeze dual-organization agency and finite operation constraints | Broker can quote but cannot accept; client/agency revocation independently blocks queued action; no cross-client reads or fake membership |
| A07 | Define cumulative charge/refund semantics and durable effect identity | Concurrent split orders and descendant grants share parent ceiling; retry charges once; changed intent/expired approval denied |
| A08 | Freeze handler admission and central effect validation | Private structural app requires no core edit; unknown handler rejected; submitted code never loaded; generic-write effect bypass denied |
| A09 | Integrate authoritative reads and locks with indexed storage | Revocation/approval/budget/CAS races cannot commit stale authority; effect, receipt and outbox roll back together |
| A10 | Freeze service/grant/feed/operation migration dependency closure | Mid-operation host/app replacement preserves pending state and prior receipts; capability mismatch fails before source freeze |

No broad approval is given. The approved recovery direction closes the product
choice, not A02-A04's operational semantics. These decisions should become explicit
ADRs and source-bound graph nodes before implementation depends on them. A cold
external builder, real PostgreSQL contention and host-loss recovery remain distinct
gates; agent review cannot impersonate those results.
