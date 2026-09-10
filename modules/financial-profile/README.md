# Financial Profile

Independent read-only module for the local PBP prototype, September 8, 2026.

Open `/financial-profile` from the Passport workspace. Financial Profile is not owned by Early Pay: it publishes its own manifest, installs a separate interactive credential per company, and reads through the intersection of that credential and the current person's finance permissions. Controllers can disconnect/reconnect it independently. Company switching is permission-checked and stale responses are discarded.

## Evidence contract

`state(person, organization)` produces the current permitted company view: fields, attributed source references, coverage, outstanding obligations, and as-of time. Reads paginate through all visible records; only current heads contribute. Borrower obligations are distinguished from receivables and lender portfolio assets. Unsupported currencies, negative balances and greater-than-cent precision are excluded with an explicit incomplete-coverage warning, not silently netted or converted to USD.

`snapshot(person, organization, shareCash)` uses the same authorized reader and signs a dated, expiring module snapshot. Early Pay may request it only after explicit borrower consent. Its PBP disclosure then binds the snapshot to one recipient, purpose and expiry. Snapshot verification is separate from permission to collect a fresh profile.

Disconnect blocks fresh profile access. It does not erase separately shared snapshots or cancel financing. Revoke a particular application's future evidence reads in Early Pay. Copies already received cannot be recalled. The current company view and a historic lender snapshot intentionally need not match.

## Scope and limitations

The bank aggregate is an explicitly fictional fixture, not a bank connection. Company age, licensed credit scores, external debt, lien searches and Reputation remain unknown/unconnected. Signed financing history is an attributed protocol claim, not independent confirmation of real settlement. No universal credit score is inferred.

The portable snapshot is an experimental signed module payload inside the existing company-authorized disclosure summary, not a new standardized PBP record type. The module signer is pinned by this local harness; a production trust registry, standard evidence schema, source connectors, refresh consent and durable snapshot management remain future work. There is no privileged fallback through Early Pay after revocation.

Tests: `sdk/tests/14_modular_finance.test.ts` covers isolation, disconnect/snapshot behavior, financing feedback, pagination and unsupported amounts. See `docs/MODULAR_FINANCE_REVIEW.md` for the build's full review scope.
