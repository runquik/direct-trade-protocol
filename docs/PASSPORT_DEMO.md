# Passport into the PBP workspace: demo scope

September 7, 2026. Product/demo plan, not a claim that the dashboard already exists.

## Narrative

A fictional fractional CFO signs in once and has different memberships in three fictional companies. They select a company, enter its role-oriented workspace, connect an approved module and inspect the resulting records. A second persona demonstrates that unavailable actions are rejected by the backend, not merely hidden in the UI.

## Two-minute browser experience to build next

1. **Passport entry:** create/recover the person's access, choose an existing company or onboard a fictional one. Clearly distinguish person identity, company membership and company control. Mock KYB only; no claim of verified company ownership.
2. **Company selection:** show three company cards and the user's role in each. Switching must reset company-specific search, notifications, cached data, module context and any chat context.
3. **Workspace arrival:** attention/messages at the top; movable/resizable role-default widgets below; clickable connected-module bars beneath them. Show unknown data honestly and provide useful empty states.
4. **Connect a module:** show publisher, pinned version, requested read/write/action access and whether it can run without a human request. Do not combine data consent with spending approval. Sample module only until ShelfKit's public interface is agreed.
5. **Inspect and revoke:** identify the exact person/company/module behind a record. Revoke the module and show that future access is denied while company records remain.

No backend mock is acceptable for the identity/permission demonstration. Operational widget content can be clearly labeled fixtures. This cut does not need live money, a lender, public employee identities, or a marketplace catalog.

## Backend acceptance checks

- One self-certifying person ID is reused across company memberships; the company controls membership permissions independently.
- Membership invitation alone gives no access; acceptance requires the invited person's signed command.
- Three companies show different allowed records. Knowing another company or installation ID does not confer access.
- Removing one membership does not remove the person's other memberships.
- A previously signed request or old cached read cannot retain access after revocation or scope reduction.
- Interactive module execution needs both the person's current authority/signature and the installation's scoped credential. Autonomous execution requires an explicitly autonomous installation.
- Person credential recovery works with a retained/backup signing key and a fresh signed command. A revoked key and an attempt to remove the last active key are rejected.
- High-impact governance/full-company migration obey controller quorum. A destination-bound handoff freezes the source and preserves signed records; installations require reauthorization at the destination.

The v0.3 tests exercise these backend boundaries on ephemeral local stores. The CLI demo is a developer walkthrough, not the intended customer UI.

## Decisions before browser implementation

- Person sign-in/custody experience: browser-managed credentials, local encrypted vault, or external identity provider with portable authority bindings. Never put a root secret into MCP output, chat history or module code.
- Initial role templates and the capabilities each grants. The protocol stores concrete permissions; role labels and dashboard defaults must not create authority.
- What company-wide controls require quorum in addition to control/migration, and how recovery works when all personal keys are lost.
- Trusted treatment of module UI, cross-module attention grouping and organization-isolated AI sessions.

Keep these decisions explicit rather than silently treating broad v0.2 company delegates as employee accounts.
