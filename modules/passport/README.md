# Passport — PBP 0.3 local browser demo and core

## Browser demo for the ShelfKit conversation

**Financial Profile and Early Pay are distinct modules:** enter Acme as Alex and open either module bar. Financial Profile has independent read-only authority; Early Pay consumes explicit snapshots. Riley represents Harbor Finance and Taylor represents Cedar Capital. See the [financing walkthrough and scope](../early-pay/README.md) and [review record](../../docs/MODULAR_FINANCE_REVIEW.md). The original Passport-only walkthrough below still applies; all financing is simulated.

On the prepared Windows workstation, double-click **Start-Passport-Demo.cmd** in the repository root. Keep that terminal window open, then visit **http://127.0.0.1:8789**. If it is already running, just open the URL. Stop with Ctrl+C. Restarting creates fresh fictional identities and resets all data; refresh the page after restarting.

Alternatively, from the repository root:

```powershell
npx --yes --package=node@22.23.2 node sdk/scripts/passport-web.ts
```

The launcher selects the project's qualified Node 22.23.2 runtime, which is already cached on this workstation. On a new machine, install npm and run `npm ci` in `sdk` first; the initial runtime/dependency downloads need internet. The demo itself uses only loopback servers and needs no Supabase, lender, mailbox or cloud credentials. Port 8789 must be free.

### Three-minute walkthrough

1. Choose **Alex Morgan**, the fictional fractional CFO. There are two active memberships and a Northstar invitation. Accept it, then enter Acme Sauce.
2. Show the invoice attention notice, receivables and movable widgets. Open an invoice to inspect its signed source. Change to Bluestem Foods: Alex has trade access there, but no finance records are returned.
3. Switch demo persona to **Jamie Chen**, enter Acme, and connect **Books**. Open it to see a financial reader backed by an independent module credential. Switch to Alex and open Books to show the same module bounded by Alex's own authority.
4. As Jamie, disconnect Books. Its **Test revoked access** button now produces a real protocol denial; the company's invoices remain on the dashboard.
5. As Jamie, revoke Alex's Acme membership. Switch to Alex: Acme is gone, while the other companies remain. To restore it, Jamie invites Alex again, then Alex accepts.

Optional: choose **Sam Rivera** to show an Acme operations member who can read orders but not invoices. Open a separate private browser window for a second independent session if you want to show Alex's open workspace losing access after Jamie revokes it. Visible workspaces recheck access every five seconds. Ordinary tabs share the selected persona; stale tabs cannot silently issue requests as a more privileged persona.

### What is real, and what is simulated

- **Real local PBP operations:** signed identities, memberships and invitation acceptance; scoped workspace reads; installation-specific module credentials; human/module permission intersection; membership and installation revocation.
- **Demo only:** one-click persona selection, job-title labels, fictional company data and notifications, local Books/Trade Ledger readers and Early Pay financing workflow. These are not Boris's ShelfKit modules. No real sign-in, KYB, payment, production scheduling, billing or marketplace is implemented here.
- The dashboard is a Passport view of permitted records. Connected modules have their own reader permissions; removing a module does not remove company records or the Passport dashboard's independent access. Module-supplied widget manifests remain future work.
- Widget order is stored only in browser session storage, separately per person and company. No business records or private signing keys are persisted in browser storage. All demo signing keys stay inside the disposable local server process. Anyone with local access may choose any fictional persona: **do not expose this server publicly or use real data**.
- A feature-detected WebMCP navigation tool can enter an already-authorized workspace. It cannot switch personas or change authority. Registration/execution in a supporting browser has not been verified; ordinary controls do not depend on it.

Verification: `node --test tests/10_passport_web.test.ts` from `sdk` under the qualified Node runtime covers HTTP controls, invitations, cross-company isolation, scoped module reads, revocation, reconnecting and stale-persona rejection. The next modular-finance build adds tests 12–14 and rendered borrower/lender, workspace notification and narrow-screen checks; see the review record for the exact scope.

## Core library and CLI walkthrough

The trusted-client library in `src/index.ts` creates a person identity, creates a company, accepts memberships, enters a scoped workspace and revokes memberships. It uses signed PBP commands, not a shared company-root bearer token. The company switcher is backed by active memberships, not a client-side list of arbitrary company IDs.

Run the local-only developer walkthrough from `sdk` with the pinned Node runtime:

```sh
npm run demo:passport
```

The demo creates an ephemeral store and fictional people/companies, proves company-specific views and a backend denial after one membership is removed, and closes the store. It prints no keys or secrets and uses no real lender, mailbox, external module or company data.

**Not production sign-in.** Key custody is an in-memory trusted-client boundary in this cut. Do not expose `createIdentity` or its private-key results to an LLM, MCP client or untrusted module. A production browser/identity-provider custody adapter, role-template editor, module-contributed widgets and login/recovery UX remain separate implementation work. See [the original demo design](../../docs/PASSPORT_DEMO.md) and [v0.3 specification](../../spec/v0.3/SPEC.md).
