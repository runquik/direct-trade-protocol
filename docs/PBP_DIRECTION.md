# Portable Business Protocol: name, scope, and implementation queue

September 7, 2026. **PBP is the adopted working name**, replacing Direct Trade Protocol (DTP).

An open protocol for company-controlled identity, authority, and business records across independent software.

*Your company, independent of its software.*

## Naming and compatibility

The protocol name is separate from the eventual workspace/marketplace product brand. Passport remains the working name of the onboarding and identity-management module. A company is an organization; the current trade schemas retain `company_id` terminology rather than gratuitously renaming every signed field.

Current prose uses PBP. Historical DTP design documents, audit reports, research, v0.1 marketplace/contract artifacts, and provenance are retained as history.

The following v0.2 technical identifiers deliberately remain unchanged:

- GitHub repository and local directory `direct-trade-protocol`.
- `dtp-store` function, URLs, deployment configuration, and service identifier.
- `@dtp/sdk`, `DtpStoreClient`, `dtps_` bearer prefix, and `DTP_*` environment variables.
- `https://dtp.dev/schemas/0.2/`, `x-dtp-*`, record type names, fixture company IDs and fixed signing vectors.

The new preview is explicitly versioned `0.3`, uses `/pbp-store/commands`, `PbpClient`, `PBP_*` local configuration and `urn:pbp:0.3:command`. It does not reinterpret v0.2 signatures or grant a v0.2 key access to the new authority plane. No hosted repository, domain or live service is renamed or deployed by this work.

## Scope boundary

| Layer | Responsibility |
|---|---|
| PBP core | Actor identity, company authority, signed records, permissions, attribution, synchronization, authorized portability |
| Business profiles | Trade, finance, inventory/manufacturing semantics and evidence requirements; keep independent of UI and marketplace |
| Passport | Establish identities/memberships and manage company authority through the protocol |
| Workspace | Login experience, company switcher, role-based dashboards, notifications, module navigation, approval presentation and execution services |
| Modules | Specialist calculations, domain workflows, data production/consumption and optional specialized UI |
| Marketplace | Discovery, commercial terms, metering reconciliation, billing and payouts; no exclusivity or ownership of customer data |

The core is not a universal HR system, login provider, autonomous agent runtime, public employee directory, scheduling algorithm or commercial marketplace. Open standard does not mean public company data. Possessing a key is not verified legal identity or proof of entitlement to a real company name.

## Agreed workspace direction

- One person may belong to multiple organizations with different permissions. Company switching changes authorization context, not just a query filter.
- Dashboard defaults are role-oriented, with movable/resizable/customizable widgets. Personal layouts are keyed by person and organization.
- Important notifications, messages and decisions are visible on arrival. Routine activity stays quieter.
- Module-provided widgets and cross-module views are distinct. Every derived result needs sources, freshness and explainable unknowns; source email extraction is not counterparty attestation.
- Connected modules appear as clickable bars beneath the dashboard, opening their deeper interfaces.
- Cross-company search, cached results, exports, notifications and AI context must remain isolated. A personal organization list is not permission for a cross-company financial summary.
- Increased module/data coverage should improve understanding, not only increase dashboard density.

These are product requirements, **not an implemented dashboard**. The browser experience will be designed separately from the authority implementation.

## Implementation queue and current cut

| Work | This branch |
|---|---|
| PBP naming and protocol/workspace boundary | Recorded in current entry points; legacy technical names preserved |
| People, memberships and scoped authority | Implemented in isolated v0.3 reference service |
| Version-pinned module installations and interactive/automation credentials | Implemented; no remote code execution or universal operation runner |
| Signed person/module attribution, exact approvals, revocation and retries | Implemented for local protocol commands, not external job orchestration |
| Proof-of-possession access recovery and key rotation | Implemented with retained/backup signing keys; no all-keys-lost recovery oracle |
| Controller quorum and authorized migration | Implemented for pinned trusted source/destination stores; vendor installations disabled after import |
| Passport core/client demonstration | Implemented CLI walkthrough against the new authority surface; browser UI still needs design |
| Consumer evidence verifier, real-money controls, Deno/deployment qualification | Still explicit gates, not supplied by an authority-layer implementation |
| Role-friendly UI, full widget/action manifests, durable external jobs, marketplace billing | Subsequent work; not core v0.3 conformance claims |

See [the implemented v0.3 preview specification](../spec/v0.3/SPEC.md), its [command schema](../spec/v0.3/command.schema.json), and [Passport demo plan](PASSPORT_DEMO.md). The implementation is a reviewable reference preview, not production-ready infrastructure.

## Independent-builder boundary

The existing Boris sprint remains on an agreed v0.2 store/spec commit until both builders explicitly choose a change. The proposed split remains George: Passport + Early Pay; Boris: brand-side Trade Ledger + Books, pending the ShelfKit demo and agreement. Use fictional companies, explicit simulated buyer confirmations, mock lenders/funds, independent signing implementations and the gap log. No silent v0.3 rollout mid-test.

## Next review priorities

1. Independently review the new authority model and threat boundaries before merge/deployment.
2. Validate the three-company fractional-CFO demo and all negative permission tests.
3. Decide whether Boris's first demo exercises frozen v0.2 or the explicit v0.3 preview; do not mix credentials/signatures.
4. Design Passport's browser experience and custody/recovery UX without exposing root keys to models or module runtimes.
5. Revisit scale: replace the reference whole-state JSON transaction with indexed projections/journal without weakening atomic authorization, add deployment quotas, and qualify actual production runtimes.
