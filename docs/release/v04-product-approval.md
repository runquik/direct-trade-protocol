# DTP v0.4 independent product/contract review

Reviewer: `capability_audit`, 2026-09-10. Initial reviewed commit: `389bd0f8c3d2dc1a38a1fc2be1daaac636bc5ea5`, followed by explicitly identified working-tree fixes. This reviewer did not implement the v0.4 engine, permission model, profile validators, migration/snapshot helpers or builder guide. This reviewer did implement validation infrastructure and several conformance tests; the release runner is reviewed separately by `profile_contracts`, not self-certified here.

## Disposition

**Product/contract review approved for the bounded reference candidate after the closures below. Final release readiness remains pending fresh target-runtime evidence and the other mandatory gates.** This is not production authorization, a claim of exhaustive security, or proof that one runtime certifies another.

## Scope inspected

- `sdk/src/v04/{engine,permissions,profiles,router,federation,migration,snapshot}.ts`: current human/company authority, compartment rights, module intersections, immutable profile admission, exact-version reads, invoice reference inference, inventory integration, disclosure, authority relocation and cooperative migration.
- `sdk/src/profiles/invoice.ts` and inventory integration/replay: deterministic arithmetic versus evidence completeness; reserve/fulfill effects, source-observation idempotency and migration projection reconstruction.
- `spec/v0.4/SPEC.md`, `docs/DTP_V04_BUILDER_GUIDE.md`: builder-facing semantics, stated exclusions, privacy and host trust, recovery instructions, runtime qualification.
- v0.3 migration pre-freeze size guard and the PostgreSQL adapter serialization change. Historical signed bytes must not be silently translated or renamed.

## Findings and closure conditions

### PR-01: derived inventory bypasses exact installed-profile boundaries (blocking)

The original `inventory.get` check accepted any installed profile with `inventory-v1` semantics. A pool can contain accepted events from multiple exact profile digests. The module could not read the second profile's records directly, yet received its quantities and observation identifiers through the pool projection.

Actual HTTP reproduction: publish two distinct inventory profiles A/B; append seven units under each to one authorized pool; install a module declaring only A. `inventory.get` returned HTTP 200, `on_hand: "14"`, and `beta-private-observation`. A module declaring both A and B was a positive control. This is an installed-module scope bypass, even though the human has whole-pool authority.

Closure: the engine now requires the installed consumer to understand every exact profile contributing to the pool, as well as current policy/resource read rights and a declared inventory semantic profile. It does not return a partial total. Regression: `sdk/tests/v04/product-review.test.ts`, second test. **Closed: independently rerun after the coordinator's fix, passing with the full-scope positive control intact.**

### PR-02: unsupported consumer profile looks like an empty business dataset (blocking builder contract defect)

`records.list`, `records.export` and `workspace.view` accepted syntactically valid unknown profile digests and filtered to an empty successful page. The guide promises explicit incompatibility for unsupported profiles. Empty inventory/invoice data is materially different from an unsupported contract, particularly when a builder uses the response for a dashboard or downstream calculation.

Closure: the engine rejects unsupported/inaccessible requested profile contracts consistently with `422 unsupported_profile`, without revealing whether a private foreign profile exists. Per-record permissions and installed release intersections remain. Regression: first test in `sdk/tests/v04/product-review.test.ts`; initial `records.list` response was 200 rather than 422. **Closed: independently rerun, all three endpoint variants pass.**

### PR-03: native PostgreSQL stores a JSON scalar, masked by row normalization (blocking pending real PostgreSQL rerun)

The real PostgreSQL run reported a native JSON-path assertion returning null rather than false. Source inspection agrees with the coordinator's diagnosis: postgres.js infers `$1::jsonb` as JSON and its JSON serializer applies `JSON.stringify`; passing an already serialized state string therefore double-encodes it. Adapter normalization reparses a returned string and masks the wrong physical JSON type from application-only assertions.

The working-tree v0.4 router now binds `$1::text::jsonb`; the coordinator applied the equivalent legacy router fix. This is the appropriate typed binding for the already serialized parameter. Keep `jsonb_typeof(body) = 'object'` and native `->` assertions in PostgreSQL tests; do not coalesce null or weaken expectations. **Code interpretation verified.** The coordinator reports PostgreSQL job `103049406923` in run `34530387940` passed at `dd09d30`; this reviewer has not independently fetched that job. Final release evidence must be refreshed because subsequent source/tests changed. No local real PostgreSQL result is claimed here.

### PR-04: evidence dependency documentation differed from implementation (closed by text review)

Earlier specification language described direct profile definitions and pre-admitted transitive dependencies. The implementation includes the complete dependency closure, capped at 32 profiles, and denies unauthorized redistribution of private foreign dependencies. The current section 7 now describes that exact behavior. This matters to an independent recipient implementing inspection without guessing which contracts travel with an evidence token.

## Additional trust-boundary conclusions

- Controllers administer company authority but do not automatically read personnel/business compartments. Current membership, policy grants, resource scope and module restrictions are evaluated together. Steward migration approval is separate from controller quorum; stale/expired stewards do not become implicit controller privileges.
- A fixed write retry returns a minimal receipt rather than signed business data after read access is removed. Reads are recomputed, not treated as cached authorization. Company listing endpoints must reject unrelated registered people before returning metadata.
- Artifact-assessment pins are separate from federation pins. Installation access rechecks the immutable release's assessment expiry/revocation. This is a trust-gated descriptor, not an implemented malware scanner, sandbox or hosted module marketplace.
- Invoice arithmetic validity is not creditworthiness or settlement. Reference-party comparison requires the operator's exact profile pins and caller access. Missing/inaccessible evidence stays unknown, avoiding a global existence oracle. Source signatures attest attribution, not physical delivery or financial clearance.
- Evidence inspection does not adopt source record ownership or promise live head status. The recipient receives exact historical versions; issuer-provided sequence/head/validation claims are separated from recipient checks. Plaintext copies cannot be revoked by expiring a token.
- Migration readiness checks signed content/projections and reserves identity namespaces/capacity before source freeze. Activation replaces staged copies rather than retaining duplicate payloads. The destination does not renew expired authority or enable imported module credentials. A partner remains on its own host and requires a fresh verified authority/handoff path.
- The source host remains trusted for completeness and original acceptance. Historical signatures and deterministic projection reconstruction do not establish every execution-time grant independently. This limitation is appropriately explicit; do not market the candidate as hostile-host consensus or disaster recovery.
- The v0.3 transfer-size check runs before status becomes migrated and leaves 16 KiB for the destination's bounded signed command wrapper. It prevents an obvious oversized one-shot handoff trap; it does not retrofit v0.4 staged recovery into the legacy protocol.

## Checks actually observed in this review pass

Pinned Node 22.23.2 executed real loopback HTTP/PGlite probes in `product-review.test.ts`: two desired-invariant failures, zero skips, before the coordinator's fixes. After fixes, this reviewer reran that file together with `review-probes.test.ts`: **12 passed, zero failed/skipped/cancelled/TODO**. The positive fully declared module control succeeded. New probes use public signed commands; they do not mutate store state directly.

The separate runner regression rerun had 17 passing tests and zero skips, including the independently authored unavailable-runtime and malformed-evidence tests. A failed runtime preflight is now persisted before a former green observation can survive a retry. That infrastructure's independent approval belongs to its other reviewer.

The initial CI URL is `https://github.com/runquik/portable-business-protocol/actions/runs/34530098040`. Its PostgreSQL failure was reported by the coordinator and diagnosed against source here; this document does not call that run green. New probes and fixes invalidate old source fingerprints and require a fresh release-gate run.

## Builder handoff boundary

This candidate provides a signed, bounded interchange/authority grammar and reference host, not Passport login UX, a deployed workspace, executable app hosting, security screening operations, finance rails or production HR storage. Future modules must declare exact profiles and authority; storing arbitrary structural JSON is not automatic domain support. Work can proceed on builders only with these distinctions carried into examples, onboarding and errors.

Production remains a separate gate: key custody/recovery, persistent backup and restore, encryption and personnel-data governance, abuse controls, operational screening, supported-runtime load/capacity and deployment authorization are not supplied by this review.
