# Organization identity: decision record, draft 1

September 21, 2026. Status: decision for the unreleased foundation layer, pending independent review. It does not change the v0.3 or v0.4 candidates, their signing domains or their vectors.

## The question

A person is a key-controlled identity: a signed genesis under `DTP-PERSON-GENESIS-1`, operational and recovery key sets with thresholds, rotation and recovery. An organization had no equivalent statement. Its id was derived as `hash(founder, nonce)` in three places under three domains (`PBP-ORGANIZATION-0.3`, `DTP-ORGANIZATION-0.4`, and an onboarding-preview domain inside a database-typed host file), with control expressed separately as a controller quorum. Nothing said whether that was the intended design or a placeholder, so an implementer could not tell whether to build company keys, and one on another storage engine had to import a database-typed file to derive an id.

Two coherent answers exist:

- **(a) Derived id, governed by people.** The organization has no keys. Its id is derived from a genesis statement. Control is a governance state naming people and a threshold.
- **(b) Key-controlled identity**, like a person: organization genesis keys, thresholds, rotation, recovery, resolver enrollment.

## Decision: (a), with a genesis that commits to the initial governance

**An organization is a keyless, derived identifier. It is controlled by people, never by a key of its own.**

Reasons:

1. **Accountability.** Every business act must be attributable to a person or a sponsored service principal acting for an organization. A signature by "the company key" is a signature by whoever holds a shared secret, which is nobody in particular. A person quorum keeps each consent attributable.
2. **Custody.** A company key is either shared, so every departure is a compromise, or held by one custodian, so that person is the company. Person-held keys plus a quorum already solve this, and each person already has rotation and recovery.
3. **One control mechanism, not two.** (b) would duplicate rotation, recovery, leases and resolver binding for a second kind of principal, and every relying party would resolve two chains to check one act.
4. **Consistency.** The v0.3 and v0.4 candidates and `foundation/authority.ts` (`Governance {organization_id, controllers, threshold}`) already model control this way. (b) would contradict all three.

Accepted costs: verifying an organization's control history means verifying its controllers' person histories (see the portable identity log), and an organization cannot act while its people cannot.

Automation that must outlive any one employee is a **service principal** sponsored by the organization's governance. That is a separate work item. It is not the organization's identity and does not reopen this decision.

### What changes from the placeholder

The placeholder id committed only to `founder` and `nonce`. The initial controller set was whatever a host recorded. A host, or a founder later removed as controller, could therefore present a different "initial governance" for the same id, and a fresh verifier had nothing to check it against. The foundation genesis commits to the initial governance as well, so the id pins exactly one starting point.

## Normative

### Genesis and identifier

An organization genesis is the closed object

```
{ "nonce": uuid, "founder": person_id, "controllers": [person_id, ...], "threshold": integer }
```

- `nonce` and every id are lowercase UUID-format strings (`8-4-4-4-12` hex).
- `controllers` holds 1 to 16 distinct person ids in ascending code-unit order. The order is fixed so that one controller set has one id.
- `founder` MUST be one of `controllers`.
- `1 <= threshold <= controllers.length`.
- No other member is permitted.

The **genesis digest** is the SHA-256, as lowercase hex, of the canonical JSON (RFC 8785, as profiled in SPEC.md) of `{"domain":"DTP-ORGANIZATION-GENESIS-1","body":<genesis>}`. The **organization id** is the first 32 hex characters of that digest formatted `8-4-4-4-12`, the same rule as a person id. The domain string is permanent and independent of any release number, host address, legal name or product.

Conformance vectors: [`spec/vectors/organization-identity.json`](../../spec/vectors/organization-identity.json).

### Host obligations at creation

The derivation is pure and proves nothing about consent. Before accepting a genesis a host MUST:

1. authenticate **every** initial controller as the current controller of that person identity, consenting to this exact genesis digest (a threshold of them is not enough at creation, since a controller carries duties as well as power); the consent document below is how;
2. retain the full genesis and its digest, and on any id collision compare the full digest rather than merge;
3. install the initial governance exactly as the genesis states it.

### Consent (draft 2, September 22, 2026)

A person consents to an organization act by signing, under `DTP-ORGANIZATION-CONSENT-1`, the closed object

```
OrganizationConsent { organization_id, subject: "genesis" | "transition", digest, person_id, head_digest, issued_at, expires_at }
```

- `digest` is the genesis digest (for `genesis`) or the transition digest (for `transition`, below). The consent binds the exact act: a different genesis or a different transition is a different consent.
- `head_digest` is the digest of the person's control head (`sdk/src/foundation/identity.ts`, `Control`) whose **operational** quorum signs. Recovery keys are not business signers. `person_id` MUST equal that head's `identity_id`.
- Signatures are one to eight distinct current operational keys of that head, at least `operational.threshold` of them, over the canonical JSON of `{"domain":"DTP-ORGANIZATION-CONSENT-1","body":consent}`.
- `issued_at < expires_at <= issued_at + 86,400,000`. A governance change is a ceremony among up to sixteen people, so the window is a day, not the five minutes of an identity command.

A host verifying a consent at acceptance establishes the head itself, from a resolution it verified, and checks its clock against the window. A verifier replaying history later has no clock and establishes the head from the person's [portable identity log](identity-log.md): a consent verifies under any head that log contains, since nothing says when it was signed. That is the accepted cost of keyless organizations, stated in the decision above, made concrete.

Genesis acceptance (`verifyOrganizationGenesis`): every initial controller has exactly one verified consent with `subject: "genesis"`; a consent from anyone else, or a duplicate, is refused. The result is governance head 0.

### Governance transition and history

Governance changes by a **transition**, a closed object that is not itself signed; its digest, under `DTP-ORGANIZATION-TRANSITION-1`, is what consents name:

```
GovernanceTransition { organization_id, expected_digest, sequence, controllers, threshold, issued_at, expires_at }
GovernanceHead       { organization_id, sequence, previous_digest, controllers, threshold }
```

- `expected_digest` is the digest of the governance head it replaces and `sequence` that head's sequence plus one. Every member of a head comes from signed material; there is no host-asserted instant, so a head digest is fully determined by the people who consented. Head 0 is `{organization_id, 0, null, genesis.controllers, genesis.threshold}`; head `n` has `previous_digest` equal to the transition digest, which itself names head `n-1`, so two transitions with the same outcome from one head produce different heads.
- `controllers` and `threshold` obey the genesis rules (1 to 16 distinct ascending person ids, feasible threshold). A transition that changes nothing is refused.
- Consents (`subject: "transition"`, `digest` = the transition digest) MUST come from at least `threshold` of the **current** controllers **and** from **every** controller the transition adds. A consent from anyone else, or a duplicate, is refused. Removing the founder is an ordinary transition; after genesis the founder holds no standing authority.
- The window rule is the consent's. A host checks its clock; a replaying verifier cannot.

The **governance log** mirrors the identity log: `{ format: "dtp-governance-log-1", genesis, consents, entries: [{ transition, consents }, ...] }`, at most 4096 entries. `verifyGovernanceLog` replays it from genesis with a lookup that vouches for person heads (`controlFromIdentityLogs` over the controllers' verified identity logs, or `controlFromHeads` over heads a host just resolved) and yields every head, the current head and the `Governance` the authority layer consumes. It proves that each change was consented to by the people entitled to consent; it proves neither that the log is complete nor that its head is current, exactly as the identity log does not. A verifier holding a governance log and a person's identity log can therefore check an organization's control history end to end without trusting the host that served either.

Conformance vectors: [`spec/vectors/organization-governance.json`](../../spec/vectors/organization-governance.json) (consents accepted and refused against stated heads; governance logs accepted with their exact heads, and refused, each with the identity logs a verifier needs).

A name, a title or a registration number is not part of the identity and is not evidence of legal authority. Creating an organization is not incorporation.

### Control

Control is the current governance state: a set of person controllers and a threshold. Controllers administer the organization. They do not thereby gain read access to its business data, which comes only from grants.

### Succession

Governance changes by a **governance transition** that names the organization id, the digest of the governance it replaces and the next sequence, and that is consented to by the current controller quorum **and** by every newly added controller. The id never changes. Removing the founder is an ordinary transition. After genesis the founder is a historical fact the id commits to and holds no standing authority. The document, its digest rule and the replayable history are specified under "Governance transition and history" above.

### Loss

- **A controller loses operational keys.** Nothing happens at the organization layer. The person recovers through their own recovery keys, their person id is unchanged, and they are still a controller.
- **A controller is permanently lost** (no operational or recovery authority survives). The remaining quorum removes or replaces them by a governance transition.
- **The quorum is unreachable**, for example a sole controller permanently lost. The organization is orphaned at the protocol level. No host, workspace operator or registry may reset it, because a reset path is a takeover path. Existing grants run to their expiry. Whoever succeeds to the business creates a new organization, and the connection between the two is a matter for legal process and explicit counterparty acceptance, not something this protocol can assert.

Hosts SHOULD warn when an organization has a single controller or a threshold of one, and SHOULD require more before any real-money use.

## Reference implementation status

Implemented with this decision: `sdk/src/foundation/organization.ts` (validation, digest, id, initial `Governance`), reachable portably as `organization` from the preview entry. The onboarding preview host derives ids through it, retains the genesis, and no longer defines a derivation of its own.

Implemented September 22, 2026, implementer-tested and not independently reviewed: the consent document (`signOrganizationConsent`, `verifyOrganizationConsent`), genesis acceptance over consents (`verifyOrganizationGenesis`), the governance transition (`governanceTransitionDigest`, `applyGovernanceTransition`), the replayable history (`verifyGovernanceLog`, `controlFromIdentityLogs`, `controlFromHeads`) and their vectors. `authority.ts` still creates governance from a head and has no operation of its own that changes it; a host applies a transition here and re-creates the authority state from the resulting `Governance`.

Not implemented, and not claimed:

- Wiring of consents into the onboarding preview host, which still creates one controller with a threshold of one and treats the signed creation command as that controller's consent; and a durable governance store with a CAS on the head, which is the host's transaction, not this module's.
- Any mapping from v0.3 or v0.4 organization ids. Those remain separate identities under their own domains. No automatic alias is permitted, for the same reason as for people.
- Moving an organization's records between hosts, which belongs to the persistence and migration work.
