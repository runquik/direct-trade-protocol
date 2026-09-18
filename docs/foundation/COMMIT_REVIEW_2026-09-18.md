# Development checkpoint review — September 18, 2026

Disposition: suitable to preserve as an **unreleased development checkpoint**. This is a risk-focused review of the uncommitted foundation, archive guards, onboarding host/client, reference UI, CI and evidence tooling, not a fresh independent certification of every protocol module. It does not authorize release, push, merge or deployment.

## Findings resolved before committing

1. **P2 — malformed HTTP target could escape the local host's error boundary.** URL parsing in `sdk/src/onboarding/http.ts` preceded the request `try/catch`. Parsing now occurs inside it. The raw HTTP regression submits `//[`, expects a sanitized 400, then confirms the same host still serves metadata.
2. **P2 — onboarding integration tests were missing from required CI.** `.github/workflows/protocol.yml` now runs `npm run test:onboarding` unconditionally; the CI wiring regression checks that it cannot silently become optional.
3. **P2 — exact evidence artifact bytes were vulnerable to newline conversion.** `.gitattributes` preserves foundation run JSON and the hashed person-authentication review artifact byte-for-byte. Source fingerprints already normalize textual CRLF; artifact hashes deliberately do not.
4. **Publication boundary.** Private correspondence and its summary were excluded from the versioned progress note. The original private note remains local. Local tool configuration, scratch output and the nested vision-site Git repository are not included.

## Assessment

| Dimension | Checkpoint assessment |
| --- | --- |
| Security | Acceptable for the declared local/synthetic boundary after the HTTP fix. Current-signature checks, exact scopes, membership acceptance/revocation, parameterized SQL and explicit asset allowlists are retained. No new production authentication claim. |
| Correctness | Tests cover retries, rollback, cross-company access, rotation/recovery, persistence and malformed requests. Historical signing artifacts have no semantic diff. |
| Performance | Prototype only: bounded per-company authority state, receipt capacity, serialized local storage and unpaginated reference notes/lists remain unsuitable for unrestricted production growth. |
| Maintainability | Public reference code remains separate from any proprietary client built on it. Required onboarding CI and byte-stable evidence improve reproducibility; compressed source style and broad integration interfaces remain future cleanup work. |

## Verification

Pinned Node 22.23.2. Baseline combined SDK, foundation and onboarding run: 392 passed, zero failures or skips; SDK TypeScript passed. After the review changes, the same combined suite passed again (one new CI assertion, 393 tests), and the focused onboarding/CI run passed 12/12, including the malformed-target regression and real child-process restart. No new dependencies were installed.

Targeted candidate-file scans found no provider keys, AWS access keys, GitHub tokens, PEM private keys or long literal secret assignments. This is not a comprehensive secret-scanner certification. Synthetic fixture credentials and public identifiers are not live account secrets.

The foundation report remains `ready: false`: F0 evidence is stale and dependent gates remain blocked. Existing run artifacts are historical source-bound observations, not current acceptance. This review did not replace independent review or regenerate green claims. No fresh PostgreSQL service, Deno qualification, external-builder exercise, hosted deployment or browser-wallet recovery test was run in this commit-review pass.

Preserved outside the commit: `.codex/`, the private collaboration note, `output/`, and `docs/dtp-vision/` (a separate repository). Code for private clients is never committed here.
