# Passport core — PBP 0.3 reference preview

The trusted-client library in `src/index.ts` creates a person identity, creates a company, accepts memberships, enters a scoped workspace and revokes memberships. It uses signed PBP commands, not a shared company-root bearer token. The company switcher is backed by active memberships, not a client-side list of arbitrary company IDs.

Run the local-only developer walkthrough from `sdk` with the pinned Node runtime:

```sh
npm run demo:passport
```

The demo creates an ephemeral store and fictional people/companies, proves company-specific views and a backend denial after one membership is removed, and closes the store. It prints no keys or secrets and uses no real lender, mailbox, external module or company data.

**Not yet a customer UI.** Key custody is an in-memory trusted-client boundary in this cut. Do not expose `createIdentity` or its private-key results to an LLM, MCP client or untrusted module. A browser/identity-provider custody adapter, role-template editor, widgets and login/recovery UX remain separate implementation work after reviewing the authority model. See [the demo design](../../docs/PASSPORT_DEMO.md) and [v0.3 specification](../../spec/v0.3/SPEC.md).
