# Independent release policy and historical compatibility review

September 12, 2026. Policy and compatibility test author: `release_architect`. Reviewer: `root`. This is a review of those deliverables, not root's own release graph, archive controls or whole F0 approval.

Reviewed the complete `release-policy.md`, its seven tests, the historical signing implementations and the actual v0.4 development-server command. The policy accurately distinguishes public release target0.1.0, immutable historical signing domains, profile identity and private software package labels. It does not treat a new display name or a successful old signature as admission to another protocol. The current local v0.4 reference really uses disposable PGlite and its explicit entry command uses loopback8790; no new foundation HTTP endpoint is implied.

Independently added two regression probes in `release-policy-review.test.ts`. Native Node Ed25519 verification and an independently implemented base58 decoder verify the original vector signing bytes and reject modified bytes/domains without using SDK cryptography or canonicalization. The manifest/wire probe confirms private package0.2.0, graph target0.1.0 and distinct preserved PBP0.3/DTP0.4 contracts.

The combined run passed **9 tests, zero skips or failures**, using pinned Node22.23.2. Root previously reran the separate baseline suites:103default and116candidate tests passed. Those observations are scoped local evidence, not approval of a new release artifact or a claim that all old data can already be imported into the foundation.

No defect was reproduced in the policy or its seven authored tests. Full F0 still requires a qualified default foundation runtime/getting-started path, generated-artifact and packaging checks, final support/dependency decisions and review of source-bound evidence by someone outside that package's implementation authors. Live publication state was not refreshed during this review. Historical tests use original issuance times for compatibility only, never as an execution-time escape hatch. No source vectors, manifests, runtime routing, remote services or prior release evidence were altered by this review.
