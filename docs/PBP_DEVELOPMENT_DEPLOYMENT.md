# PBP v0.3 shared development backend

This is an explicitly gated, synthetic-data development environment in the existing Supabase `dtp` project (`vsuqtdofphppybkhnijg`). It is not a production qualification or a browser wireframe. The v0.2 `dtp-store` endpoint and `protocol` schema are untouched.

## Builder contract

- Signed audience: `https://vsuqtdofphppybkhnijg.supabase.co/functions/v1`
- Commands: `https://vsuqtdofphppybkhnijg.supabase.co/functions/v1/pbp-store/commands`
- Unsigned health: `https://vsuqtdofphppybkhnijg.supabase.co/functions/v1/pbp-store/health`
- Set `x-pbp-dev-token` on commands in addition to normal PBP signatures. Obtain the development token privately from the project owner. Do not use Supabase service-role keys, the store signing secret or old v0.2 bearer tokens.
- `new PbpClient(audience, developmentToken)` and `new Passport(audience, developmentToken)` support this deployment. The audience is the base above, NOT the full command/function URL.
- Prefer a local/server-side development proxy to hold the builder token. Never embed it in a publicly shipped browser bundle. Person keys belong in a trusted signing/custody client, not in MCP/model outputs.
- Allowed browser origins initially: localhost and 127.0.0.1 on ports 3000 and 5173. Hosted preview origins need explicit configuration; CORS does not confer protocol authority.
- Health and responses carry `x-pbp-revision`, identifying the deployed source commit. Main merging does **not** automatically deploy; use the explicit release procedure below.

Use the [v0.3 specification](../spec/v0.3/SPEC.md), command schema and fixed signing vector. Do not mix v0.2 envelopes/credentials with this API. Coordinate Boris's version choice explicitly.

## Deployment procedure

1. Require a green PR and check its exact head revision before merging. Qualify the Deno entry and runtime probe as well as Node/PostgreSQL tests.
2. Check `supabase migration list --linked` and `supabase db push --linked --dry-run`; apply only the reviewed additive `20260907000000_pbp_v03.sql` migration. Never reset/drop the existing database.
3. On first setup, `node sdk/scripts/pbp-deployment-secrets.ts` creates gitignored `supabase/.env.local` with fresh store/access secrets, refusing overwrite. Keep this file private and backed up securely. It is **not** a builder handoff file: share only the development access token when authorized. Windows users should retain their private user-profile ACL; do not sync the secret file.
4. Upload that file with `supabase secrets set --project-ref vsuqtdofphppybkhnijg --env-file supabase/.env.local`. Set `PBP_REVISION` to the exact merged main SHA. Keep `PBP_STORE_SECRET` stable on future deployments; rotating it changes trusted migration identity. No source migration keys are trusted by default.
5. Deploy only `pbp-store` with the CLI's `--use-api --no-verify-jwt` options and its `deno.json` import map. Do not deploy all functions.
6. Load the private environment file without displaying values; set expected `PBP_REVISION`; run `sdk/scripts/pbp-hosted-smoke.ts` with qualified Node. The test creates three labeled synthetic companies and two synthetic people; these records are retained as deployment evidence. It does not touch existing users or send external messages.
7. Verify health's revision, schema RLS/API privilege denial and unchanged v0.2 health. Record deployment evidence in the release PR/task.

## Limits and rollback

Shared private builder token is an outer development access gate, never permission to act as a company/person. Every command still needs valid PBP signatures and live authority. Hosting adds allowed-origin checks, 1 MiB requests, a 16 MiB total JSON-state ceiling and PostgreSQL lock/statement timeouts. These are prototype bounds, not production abuse prevention or scaling.

If the new service fails, stop building against it and redeploy a known-good `pbp-store` revision, or remove its development access secret to fail closed. Keep the additive schema and its records for diagnosis; do not drop/reset it. No v0.2 rollback is needed because this release does not modify its function or tables. Hosted smoke qualification does not replace independent security review, comprehensive consumer evidence checks, recovery/custody UX, durable jobs, federation or production rate quotas.
