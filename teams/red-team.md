# Red team

**Job:** find where DTP is wrong, weak or unsafe, and file it so that someone else can fix it. The red team never fixes what it finds. Keeping finding and fixing apart is the point: the maintainer should have to be convinced.

Read [README.md](README.md) first; every rule there applies.

## Each run: one surface

Rotate through these surfaces in order. Your log issue says which surface the last run attacked; take the next one. After the last, start again at the first.

1. **Canonicalization and signing.** Encodings, number and string edge cases, duplicate or escaped member names, signature domains, key encodings, replay.
2. **Identity and re-homing.** Identity logs, key rotation, recovery, host moves, forks, attestation, what a relying party can and cannot detect.
3. **Authority.** Grants, scopes, consent, controller quorum, organization governance, revocation, expiry, confused-deputy paths between modules.
4. **Business-fact profiles.** `product@1`, `inventory@2`, `party@1`, `order@1`, `forecast@1`: conservation of quantities, units and decimals, state transitions, reservations, idempotency, snapshot import versus live writes.
5. **Host behaviour and portability.** Migration and cutover, size limits, persistence and restart, exporting and re-importing a company, a second host reading the first host's records.
6. **Privacy and compartments.** What a module, a member or a counterparty can learn that it should not, including through errors, counts, timing or search.
7. **Packaging and outside builders.** The packed `@dtp/sdk` and its entries, the external module example, and whether the documented path works from a clean checkout with nothing else.
8. **Specification against implementation.** A section of the specification or a profile document read line by line against what the reference code actually does.

## How to attack

- **Start from the documents, not the code.** Read the specification, profile and docs for the surface and decide what must hold. Then try to make it not hold. Read the implementation only to confirm or to build a reproduction. Findings that come from the documents are worth more, because they are what an independent implementer would rely on.
- **Check before filing.** Search open and closed issues; do not file a duplicate. Confirm the behaviour on current `main`. Confirm the documents actually promise what you think they promise; if they are silent, that is a documentation finding, not a violation.
- **Prove it.** Every finding carries a reproduction that someone else can run: a test body, a script, or exact commands with their output.

## What you produce

One of these per run:

- **A finding issue** labelled `finding`, `team:red-team` and a severity, with: the surface; what the documents promise (quote and link); what actually happens; the reproduction; the impact, meaning who is hurt and how, concretely; and what would count as fixed. Do not propose the implementation.
- **A gap test pull request**, when a finding is best recorded executably: a test that asserts the current, wrong behaviour and is named as a gap, the way `sdk/tests/stress/business-boundaries.test.ts` records its gap observations, so CI stays green and the gap stays visible. Link it from the finding issue. Only tests; no fixes.
- **A clean result.** If a careful pass finds nothing, say what you tried in your log comment. That is evidence too.

## Severity

- `sev:critical`: forged authority, a signature or identity check bypassed, one company reading or writing another's records, silent loss or corruption of committed records.
- `sev:high`: a documented guarantee does not hold under realistic use; an honest implementer following the documents would build something unsafe or incompatible.
- `sev:medium`: a guarantee fails only in an edge case, or the documents are wrong or ambiguous in a way that would produce incompatible implementations.
- `sev:low`: unclear documentation, poor error behaviour, missing hardening that no current path exploits.

Severity is about consequences, not about how clever the attack was.
