# Portable onboarding integration — September 17, 2026

Status: implemented local synthetic vertical slice, **not DTP 0.1 release approval**. Nothing deployed, published, merged, or connected to NetSuite. Existing experimental Passport and signing domains are unchanged.

## What is implemented

The person creates client-held operational and separate recovery keys. The public Passport library constructs the existing foundation identity genesis and owner-signed resolver enrollment. A DTP reference host persists identity control through the existing indexed identity registry. The person then signs company creation, invitations, acceptance, revocation and data requests. A second reference client can unlock the same encrypted identity and enter the same company without calling the client that created it.

Company creation establishes a single cryptographic controller and an explicit data grant. A name or a CEO title is **not** verification of legal authority. The host does not verify a real person or legal business. Real pilot onboarding still needs a documented manual authority-verification procedure.

## Public / private boundary

| Location | Responsibility |
| --- | --- |
| Public DTP: `sdk/src/foundation` | Existing portable person-control, resolver registry and capability primitives. Unchanged by this slice. |
| Public DTP: `sdk/src/onboarding` | Preview client/wallet format, command host and HTTP boundary. Generic reference implementation, not any product's code and not a normative release. |
| Public DTP: `modules/passport/reference` | Minimal independent client, for inspecting identity and company interoperability. |
| Any private client | Its own UX and onboarding screens, kept in its own repository. It reaches this preview only through the client library and HTTP boundary above. |

The old public Passport demonstration is preserved, not silently deleted or relabeled proprietary. Repository separation is an engineering boundary, not a determination of licensing terms. Choose protocol/SDK and commercial licenses explicitly before publishing new code.

## Run

Use the pinned Node 22.23.2 runtime and installed SDK dependencies. From `sdk`:

```powershell
npm run dev:onboarding
```

The reference client and API run at `http://127.0.0.1:8790/`. To prove portability, run any second client from another origin and import the same identity file. The host accepts browser requests only from origins it is told about: list them, comma-separated, in `DTP_ONBOARDING_ALLOWED_ORIGINS` (default `http://127.0.0.1:8791`, a conventional port for a second local client).

Reference state is durable under `sdk/.onboarding-data/`, ignored by Git. It includes the local resolver signing key and PGlite database. Back up that entire directory together while the host is stopped. Do not delete it to fix a login problem, change its port, or replace its resolver key: existing identity files pin that resolver. Database-at-rest encryption and Windows ACL qualification are not provided by this prototype.

## Identity and custody contract

- Foundation person ID derives from the established release-independent genesis domain, not from any product, email or employer.
- Operational and recovery private keys are generated in the browser. API calls carry public material and signatures, not those secrets. A client that generates and holds these keys is trusted first-party wallet code, not an untrusted business module.
- Exports use AES-256-GCM with a random salt/IV and PBKDF2-SHA256 at 600,000 iterations. This is a preview format pending independent cryptographic/UX review, not a recommended general-purpose wallet standard.
- The operational file is also saved encrypted in the creating client's browser storage; unlocked keys live in page memory. The recovery kit is downloaded separately and not persisted by that client. Keep it offline. JavaScript cannot promise secure memory erasure.
- The same initial passphrase encrypts the two separate files. Store the passphrase separately; possession of both file and passphrase grants its authority. There is no email reset and no operator master key.
- Normal rotation needs current operational authority and new-key possession. Recovery needs separately enrolled recovery authority and new-key possession. Recovery cannot perform ordinary company commands.
- Key changes stop new commands during the existing lease-drain safety barrier, at most roughly 35 seconds in this demo. New credentials are exported before submission. Pending signed transition and encrypted replacement file are saved locally; exact transition retry can recover a lost response.
- Imported operational identity files contain the stable person ID, key and pinned resolver. This proves portability between clients against **the same host**, not independent host migration. Resolver replacement, disaster recovery after resolver loss, and legacy-identity migration remain open.

## Company authority and persistence

- A company is a keyless derived identifier controlled by people, per the [organization identity decision](organization-identity.md). The host derives the id through the portable foundation function under `DTP-ORGANIZATION-GENESIS-1`, from a genesis that commits to the founder, a nonce and the initial controllers and threshold, and retains that genesis. It defines no derivation of its own. Companies created by an earlier run of this preview keep the id they were given; it is not re-derived.
- Each company has one controller. Viewer/editor invitations are addressed to a registered person and require that person's signed acceptance of the exact grant ID. A revoked/replaced invitation cannot be accepted by replaying an old acceptance.
- Viewers may read company notes; editors may also create notes. Only the controller invites/revokes or reads the access log. The sole controller cannot be revoked. Multi-controller governance and controller transfer are not exposed in this slice.
- The foundation grant engine rechecks current grants, expiry, scope and controller authority. Revocation blocks subsequent commands and receipt replay; it cannot recall data already downloaded or displayed.
- Per-command challenge signatures replace long-lived bearer sessions. The host verifies current operational keys while locking the same identity row used by rotation/recovery. This **co-located resolver adapter** deliberately does not claim to implement the separate distributed person-authentication gateway or its production SQL commit-deadline guarantees.
- Identity, company, membership, notes, challenge consumption, command receipts and access-log writes are transactional. Exact mutating-command retries require fresh authentication and do not repeat effects. Reads are re-evaluated, never served from historical receipts.
- Commands use an isolated preview domain and reserved synthetic profile marker. Notes are a test resource, **not a financial reporting profile**, and no arbitrary app/module execution is enabled.
- PGlite is one local process, not production multi-connection PostgreSQL. Company authority uses a bounded per-company state row. Foundation grant/receipt capacities apply; this prototype is not a scalable, unlimited ingestion service.

## HTTP boundary

Loopback binding, exact Host validation, explicit browser origin allowlist, JSON-only writes, bounded request bodies, no cookies, no secret-bearing logs and an explicit static-asset allowlist. No client serves an identity directory or database files. The public resolver endpoint exposes a current public control proof for a known identifier, not private business data. No public identity directory is provided.

These controls do not defend against malicious code executing in the trusted wallet origin or a compromised local OS. Production requires reviewed signing consent UI, secure custody, recovery drills, rate limits, retention/backups, TLS, hosted deployment qualification, account-abuse controls and independent review.

## Acceptance evidence

Pinned Node 22.23.2:

- Existing foundation suite: 280 passed, 0 failed, 0 skipped.
- Existing default SDK suite: 103 passed, 0 failed, 0 skipped.
- New onboarding suite: 9 passed, 0 failed, 0 skipped, including a full child-process HTTP server restart with persistent resolver identity and revoked access.
- Full SDK TypeScript check and private app JavaScript syntax check passed during implementation; rerun after edits.
- Browser observed: create person, both encrypted downloads saved, create company, add company note; import the exported file into the separate reference browser client, authenticate and read the same company note without the first client's session.
- Browser testing found and fixed a real-network rotation timestamp bug: proof verification now samples time after the resolver response, not before the request. The process test deliberately delays resolution to cover this boundary. Browser rotation subsequently completed: the replacement identity kept its company access and the old reference-client key was rejected.
- The private launch script was run successfully with permission to create its private log directory. SDK typechecking, private JavaScript syntax and PowerShell parsing passed. The displayed demo contains two fictional companies. Browser recovery-file import and invitation/revocation UI clicks are not separately claimed as tested; their host/client behavior is covered by integration tests.

Tests also cover cross-company isolation, invitation acceptance/revocation/re-invitation, viewer write denial, non-controller management denial, last-controller protection, signature/body tampering, replay, stale credentials, ordinary rotation, recovery, encrypted-file corruption/wrong passwords, transactional rollback, disk reopen, Host/origin rejection, input validation and safe HTTP errors.

This is implementer testing, **not independent review**, and it does not update or green the foundation release gates. The initial baseline invocation accidentally used another cached Node version; its runtime-enforcement failures were superseded by the clean pinned-runtime rerun above.

## Next milestone: read-only NetSuite shadow

Keep the connector a separately identified, company-installed private service. Its grants must name allowed source/target scopes and support revocation. It must not receive a person's keys or controller privileges. Before implementation, define service-principal authentication, credential custody, source provenance, checkpoint/reconciliation contracts, and the first financial reporting profile. The current onboarding host intentionally provides no live connector credential endpoint or fake green readiness signal.

No real accounts, business financials, deployment, production recovery or NetSuite compatibility have been qualified by this work.
