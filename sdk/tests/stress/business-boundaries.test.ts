// Expected-observation tests: a passing GAP probe reproduces a deficiency.
// Does not certify product readiness. No SDK client/signing or direct DB access.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPbpStore } from "../../scripts/pbp-dev-server.ts";
import { RawClient, identity, orgId, draft, resign, commandBytes, verifyCommand, canonical, hash } from "./independent-client.ts";
import type { Identity, Response } from "./independent-client.ts";

const root = new URL("../../../", import.meta.url);
const end = () => new Date(Date.now() + 86400000).toISOString();
const type = "traceability.cte", read = `records.read:${type}`, write = `records.write:${type}`;
const status = (r: Response, expected: number) => assert.equal(r.status, expected, JSON.stringify(r.error));
function cte(org: string, extra: any = {}, visibility = "granted", counterparties: string[] = []) {
  const id = randomUUID();
  return { record_id: id, root_id: id, supersedes: null as string | null, type, subject_company_id: org,
    counterparty_ids: counterparties, visibility, body: { cte_type: "receiving", lot_id: "SYNTHETIC-LOT-01",
      actor_company_id: org, quantity: { amount: "10", unit: "case" }, event_date: "2026-09-01T12:00:00.000Z", ...extra } };
}
async function register(client: RawClient, p = identity()) { await client.ok(p, "person.register", null, { keys: [p.keyId] }); return p; }
async function company(client: RawClient, owner: Identity, name: string) {
  const nonce = randomUUID(), id = orgId(owner.id, nonce);
  await client.ok(owner, "organization.create", id, { name, nonce, controllers: [owner.id], threshold: 1 }); return id;
}
async function member(client: RawClient, owner: Identity, org: string, who: Identity, permissions: string[]) {
  const invitation_id = randomUUID();
  await client.ok(owner, "membership.invite", org, { invitation_id, person_id: who.id, permissions, expires_at: end() });
  await client.ok(who, "membership.accept", org, { invitation_id });
}
async function all(client: RawClient, person: Identity, org: string, limit = 100): Promise<any[]> {
  let after = 0; const records: any[] = [];
  for (let page = 0; page < 100; page++) {
    const r = await client.ok(person, "records.list", org, { after, limit }); records.push(...r.records);
    if (r.next_cursor === null) return records;
    assert.ok(r.next_cursor > after, "cursor must advance"); after = r.next_cursor;
  }
  throw new Error("pagination did not terminate");
}

test("DTP business boundary stress: expected observations, NOT readiness certification", { timeout: 180000 }, async t => {
  const started = new Date().toISOString(), findings: any[] = [];
  let source: Awaited<ReturnType<typeof createPbpStore>> | undefined;
  let destination: typeof source;
  let a: RawClient | undefined, b: RawClient | undefined;
  const auxiliaryJournal: any[] = [];
  let setupComplete = false;
  async function probe(id: string, cases: string[], classification: "control" | "gap", title: string, run: () => Promise<any> | any) {
    await t.test(`${id} [${classification.toUpperCase()}] ${title}`, async () => {
      try {
        const evidence = await run(); findings.push({ id, cases, classification, title, observation_matched: true, evidence });
      } catch (error) {
        findings.push({ id, cases, classification, title, observation_matched: false, error: String(error) }); throw error;
      }
    });
  }
  try {
    await probe("S01", ["T04"], "control", "Independent signing matches published vector and verifies proof", () => {
      const vector = JSON.parse(readFileSync(new URL("spec/v0.3/signing-vector.json", root), "utf8"));
      assert.equal(commandBytes(vector.command).toString(), vector.signing_input_utf8);
      assert.equal(hash(vector.command), vector.request_hash);
      assert.ok(verifyCommand(vector.command));
      assert.equal(canonical({ "2": 2, "10": 10 }), '{"10":10,"2":2}');
      assert.throws(() => canonical("\ud800")); assert.throws(() => canonical(1.5));
      return { fixed_vector: "spec/v0.3/signing-vector.json", independent_crypto: "node:crypto Ed25519" };
    });
    source = await createPbpStore(); destination = await createPbpStore({ trustedSources: [source.keyId] });
    a = new RawClient(source.audience); b = new RawClient(destination.audience);
    const A = a, B = b, owner = await register(A), cfo = await register(A), employee = await register(A);
    const org = await company(A, owner, "Synthetic Jerky"), partner = await company(A, owner, "Synthetic Buyer");
    const third = await company(A, owner, "Synthetic Third Company");
    await member(A, owner, org, cfo, [read, write]); await member(A, owner, partner, cfo, [read]);
    await member(A, owner, third, cfo, [read]); await member(A, owner, org, employee, [read]);
    setupComplete = true;

    await probe("S02", ["T01", "T12"], "gap", "Native inventory, personnel and company-owned type grants are unavailable", async () => {
      const observations = [];
      for (const name of ["inventory.stock_movement", "hr.employee", "jerky.scan", "com.jerky.scan"]) {
        const r = await A.act(owner, "module.publish", org, { module_id: randomUUID(), manifest: { version: "1.0.0", name: "Synthetic module", permissions: [`records.read:${name}`] } });
        status(r, 400); observations.push({ type: name, status: r.status, error: r.error });
        const record = { ...cte(org), type: name };
        status(await A.act(owner, "record.append", org, record), 400);
      }
      return observations;
    });

    let physicalScan: any;
    await probe("S03", ["T05"], "control", "Identical signed retry does not duplicate an accepted record", async () => {
      physicalScan = cte(org, { x_inventory: { scan_id: "scanner-a:42", sku: "JERKY", cases: 10, units_per_case: 12 } });
      const cmd = draft(A.audience, owner, "record.append", org, physicalScan);
      const first = await A.send(cmd), retry = await A.send(cmd); status(first, 200); status(retry, 200); assert.deepEqual(first.result, retry.result);
      assert.equal((await all(A, owner, org)).filter(r => r.record_id === physicalScan.record_id).length, 1);
      const changed = resign({ ...structuredClone(cmd), payload: cte(org) }, [owner]); status(await A.send(changed), 409);
      return { exact_retry: "same result, one record", changed_payload_same_request: 409 };
    });
    await probe("S04", ["T05"], "gap", "A fresh record ID duplicates the same physical scan", async () => {
      const duplicate = cte(org, structuredClone(physicalScan.body)); await A.ok(owner, "record.append", org, duplicate);
      const records = (await all(A, owner, org)).filter(r => r.body.x_inventory?.scan_id === "scanner-a:42");
      assert.equal(records.length, 2);
      return { same_physical_scan: records.length, naive_cases_sum: records.reduce((sum, r) => sum + r.body.x_inventory.cases, 0), correct_cases: 10,
        caveat: "x_inventory is deliberately nonstandard; no native deduplication contract exists" };
    });
    await probe("S05", ["T05", "T06"], "control", "Concurrent corrections to one record cannot both become the head", async () => {
      const base = cte(org); await A.ok(owner, "record.append", org, base);
      const correction = () => ({ ...structuredClone(base), record_id: randomUUID(), supersedes: base.record_id });
      const outcomes = await Promise.all([A.act(owner, "record.append", org, correction()), A.act(owner, "record.append", org, correction())]);
      assert.deepEqual(outcomes.map(r => r.status).sort(), [200, 409]);
      const records = (await all(A, owner, org)).filter(r => r.root_id === base.root_id);
      assert.equal(records.filter(r => r.is_head).length, 1);
      return { statuses: outcomes.map(r => r.status), heads: 1 };
    });
    await probe("S06", ["T06", "T07"], "gap", "Independent reservations and contradictory pack conversions are accepted", async () => {
      const reservations = [12, 24].map(units => cte(org, { x_inventory: { operation: "reserve", stock_key: "SYNTHETIC-STOCK-10-CASES", cases: 8, available_cases: 10, units_per_case: units, pack_version: "same-v1" } }));
      const results = await Promise.all(reservations.map(r => A.act(owner, "record.append", org, r)));
      results.forEach(r => status(r, 200));
      return { accepted_reserved_cases: 16, stated_available_cases: 10, same_pack_version_units_per_case: [12, 24],
        caveat: "No native reservation/pack profile; accepting extra JSON is not validating inventory" };
    });
    await probe("S07", ["T05", "T28"], "gap", "Arrival order is not physical event order", async () => {
      for (const date of ["2026-09-02T12:00:00.000Z", "2026-09-01T12:00:00.000Z"]) {
        await A.ok(owner, "record.append", org, cte(org, { event_date: date, x_order_probe: true }));
      }
      const records = (await all(A, owner, org)).filter(r => r.body.x_order_probe);
      assert.ok(records[0].seq < records[1].seq); assert.ok(records[0].body.event_date > records[1].body.event_date);
      return { arrival_sequence_increases: true, physical_time_decreases: true, implication: "Consumers need late-event and correction semantics; seq is not event time" };
    });
    await probe("S08", ["T09"], "control", "Internally inconsistent invoice totals are rejected before storage", async () => {
      const id = randomUUID(), usd = (amount: string) => ({ amount, currency: "USD" });
      const record = { record_id: id, root_id: id, supersedes: null, type: "finance.invoice", subject_company_id: org, counterparty_ids: [partner], visibility: "private",
        body: { invoice_number: "SYNTHETIC-BAD-MATH", seller_company_id: org, buyer_company_id: partner, contract_id: randomUUID(),
          line_items: [{ description: "Synthetic", quantity: { amount: "2", unit: "case" }, unit_price: usd("100"), amount: usd("999") }],
          subtotal: usd("1"), deductions: [], total: usd("700"), issued_at: new Date().toISOString(), due_at: end(),
          payment_terms: { net_days: 30, paca_covered: false }, status: "issued", paid_amount: usd("0"), settlement_event_ids: [], assigned_to_company_id: null } };
      const r = await A.act(owner, "record.append", org, record); status(r, 422);
      assert.equal(r.error.code,"invalid_invoice");
      return { status: 422, quantity_times_unit_price: "200 USD", recorded_line: "999 USD", subtotal: "1 USD", total: "700 USD", contract_exists: false, reference_validation_tested:false };
    });

    const canary = "SYNTHETIC-EMPLOYEE-B-SALARY-NOT-REAL";
    let personnelRecord: any;
    await probe("S09", ["T12", "T13"], "gap", "Type permission exposes all same-company private records, including signed payload", async () => {
      personnelRecord = cte(org, { x_personnel: { employee_id: "synthetic-employee-b", salary_canary: canary } }, "private");
      await A.ok(owner, "record.append", org, personnelRecord);
      const visible = (await all(A, employee, org)).find(r => r.record_id === personnelRecord.record_id);
      assert.equal(visible.body.x_personnel.salary_canary, canary);
      assert.equal(visible.command.payload.body.x_personnel.salary_canary, canary);
      const workspace = await A.ok(employee, "workspace.view", org, {});
      assert.ok(JSON.stringify(workspace).includes(canary));
      const admin = await A.ok(owner, "workspace.view", org, {}); assert.ok(JSON.stringify(admin).includes(canary));
      return { ordinary_type_reader_sees_canary: true, controller_sees_canary: true, signed_command_duplicates_data: true,
        caveat: "Synthetic canary in a loose CTE, NOT a native employee record or authorization bypass. Current type-level policy is insufficient for HR." };
    });
    await probe("S10", ["T12"], "gap", "Employee-scoped rights and conditional memberships are not expressible", async () => {
      const base = { invitation_id: randomUUID(), person_id: employee.id, permissions: [read], expires_at: end() };
      const scoped = await A.act(owner, "membership.invite", org, { ...base, permissions: [read + ":employee:self"] }); status(scoped, 400);
      const conditional = await A.act(owner, "membership.invite", org, { ...base, conditions: { employee_id: "self" } }); status(conditional, 400);
      return { scoped_permission: scoped.status, conditions_field: conditional.status };
    });
    await probe("S11", ["T11", "T13"], "control", "Parallel fractional-CFO reads remain company-scoped", async () => {
      await A.ok(owner, "record.append", partner, cte(partner, { notes: "SYNTHETIC-PARTNER-ONLY" }, "private"));
      await A.ok(owner, "record.append", third, cte(third, { notes: "SYNTHETIC-THIRD-ONLY" }, "private"));
      const contexts = [org, partner, third];
      const views = await Promise.all(contexts.map(id => A.ok(cfo, "workspace.view", id, {})));
      views.forEach((v, index) => { assert.ok(v.records.length > 0); assert.ok(v.records.every((r: any) => r.subject_company_id === contexts[index])); });
      assert.ok(!JSON.stringify(views[1]).includes(canary)); assert.ok(!JSON.stringify(views[2]).includes(canary));
      return { contexts: 3, parallel_requests: true, cross_company_canary_leak: false, browser_cache_tested: false };
    });
    await probe("S12", ["T14"], "control", "Membership revocation blocks both prepared read and exact read replay", async () => {
      const used = draft(A.audience, employee, "records.list", org, { after: 0, limit: 100 }); status(await A.send(used), 200);
      const queued = draft(A.audience, employee, "workspace.view", org, {});
      await A.ok(owner, "membership.revoke", org, { person_id: employee.id });
      status(await A.send(used), 403); status(await A.send(queued), 403);
      return { replay_after_revoke: 403, prepared_read_after_revoke: 403, previously_downloaded_copy_erased: false };
    });

    const moduleId = randomUUID();
    await A.ok(owner, "module.publish", org, { module_id: moduleId, manifest: { version: "1.0.0", name: "Synthetic Scanner", permissions: [read, write] } });
    const inst = { ...identity(), id: randomUUID() };
    await A.ok(owner, "installation.create", org, { installation_id: inst.id, module_id: moduleId, manifest_version: "1.0.0", key_id: inst.keyId,
      permissions: [read], mode: "interactive", expires_at: end() }, { signers: [owner, inst] });
    const installationOptions = { kind: "installation" as const, requestedBy: cfo.id, signers: [inst, cfo] };
    await probe("S13", ["T14", "T25"], "control", "Module and human rights intersect; private records remain hidden from module", async () => {
      const r = await A.act(inst, "records.list", org, { after: 0, limit: 100 }, installationOptions); status(r, 200);
      assert.ok(r.result.records.length > 0); assert.ok(!JSON.stringify(r.result).includes(canary));
      status(await A.act(inst, "record.append", org, cte(org), installationOptions), 403);
      status(await A.act(inst, "records.list", third, { after: 0, limit: 100 }, installationOptions), 403);
      status(await A.act(inst, "records.list", org, { after: 0, limit: 100 }, { kind: "installation", requestedBy: null }), 403);
      const restricted = await register(A); await member(A, owner, org, restricted, []);
      const none = await A.ok(inst, "records.list", org, { after: 0, limit: 100 }, { kind: "installation", requestedBy: restricted.id, signers: [inst, restricted] });
      assert.equal(none.records.length, 0);
      return { private_canary_visible: false, ungranted_write: 403, other_org: 403, missing_human: 403, human_with_no_read_records: 0 };
    });
    await probe("S14", ["T02", "T22", "T23"], "gap", "Manifest pins permission version but has no artifact or publication policy", async () => {
      const manifest = { version: "1.0.0", name: "Synthetic Scanner", permissions: [read, write] };
      status(await A.act(owner, "module.publish", org, { module_id: moduleId, manifest: { ...manifest, name: "Changed silently" } }), 409);
      status(await A.act(owner, "module.publish", org, { module_id: randomUUID(), manifest: { ...manifest, artifact_digest: "sha256:" + "0".repeat(64), visibility: "private" } }), 400);
      return { immutable_version_control: 409, artifact_and_visibility_fields: 400, note: "No executable artifact was uploaded or screened" };
    });
    await probe("S15", ["T14", "T16"], "control", "Disabling a module blocks prepared reads while records remain accessible to owner", async () => {
      const queued = draft(A.audience, inst, "records.list", org, { after: 0, limit: 100 }, installationOptions);
      status(await A.send(queued), 200);
      await A.ok(owner, "installation.revoke", org, { installation_id: inst.id }); status(await A.send(queued), 403);
      assert.ok((await all(A, owner, org)).some(r => r.record_id === physicalScan.record_id));
      return { disabled_installation_read: 403, data_retained: true, workflow_reconstruction_tested: false };
    });
    await probe("S16", ["T11"], "control", "Filtered pagination returns all authorized records once, despite interleaved tenants", async () => {
      const expected = await all(A, cfo, org, 100), paged = await all(A, cfo, org, 2);
      assert.deepEqual(paged.map(r => r.record_id), expected.map(r => r.record_id));
      assert.equal(new Set(paged.map(r => r.record_id)).size, paged.length);
      assert.ok(paged.every(r => r.subject_company_id === org));
      return { records: paged.length, page_size: 2, duplicates: 0, omissions: 0 };
    });

    // Reinstall an active automation so migration's disable-on-import is tested.
    const activeInst = { ...identity(), id: randomUUID() };
    await A.ok(owner, "installation.create", org, { installation_id: activeInst.id, module_id: moduleId, manifest_version: "1.0.0", key_id: activeInst.keyId,
      permissions: [read], mode: "automation", expires_at: end() }, { signers: [owner, activeInst] });
    const shared = cte(org, { notes: "SYNTHETIC-SHARED-BEFORE-MOVE" }, "counterparties", [partner]);
    await A.ok(owner, "record.append", org, shared);
    await register(B, owner);
    let preview: any, transfer: any;
    await probe("S17", ["T18", "T20"], "control", "Migration refuses a stale preview then produces a recoverable source receipt", async () => {
      const stale = await A.ok(owner, "migration.preview", org, {});
      await A.ok(owner, "record.append", org, cte(org, { notes: "SYNTHETIC-CHANGE-AFTER-PREVIEW" }));
      const destinationInfo = { audience: B.audience, key_id: destination!.keyId };
      status(await A.act(owner, "migration.commit", org, { destination: destinationInfo, snapshot_hash: stale.snapshot_hash }), 409);
      preview = await A.ok(owner, "migration.preview", org, {});
      transfer = await A.ok(owner, "migration.commit", org, { destination: destinationInfo, snapshot_hash: preview.snapshot_hash });
      assert.deepEqual(await A.ok(owner, "migration.receipt", org, {}), transfer);
      const frozen = await A.act(owner, "record.append", org, cte(org)); status(frozen, 409);
      return { stale_preview: 409, receipt_retrievable: true, source_write_after_commit: 409 };
    });
    await probe("S18", ["T18", "T19"], "control", "Tampered transfer and wrong destination cannot be imported", async () => {
      const corrupt = structuredClone(transfer); corrupt.snapshot.records[0].body.notes = "TAMPERED";
      const bad = await B.act(owner, "migration.import", null, { transfer: corrupt }); status(bad, 401);
      // Source does not pin itself: this separately checks rejection, not destination binding.
      const wrong = await A.act(owner, "migration.import", null, { transfer }); status(wrong, 403);
      // A third trusted-source store has a different destination audience/key pair.
      const other = await createPbpStore({ trustedSources: [source!.keyId] });
      try {
        const C = new RawClient(other.audience); await register(C, owner);
        const mismatch = await C.act(owner, "migration.import", null, { transfer }); status(mismatch, 403);
        assert.equal(mismatch.error.code, "invalid_transfer");
        auxiliaryJournal.push(...C.observations);
        return { tampered: bad.status, untrusted: wrong.status, different_destination: mismatch.status };
      } finally { await other.close(); }
    });
    await probe("S19", ["T18", "T19", "T21"], "control", "Small-company import retains independently verifiable records and disables installations", async () => {
      await B.ok(owner, "migration.import", null, { transfer });
      const records = await all(B, owner, org);
      assert.equal(records.length, preview.snapshot.records.length);
      for (const r of records) {
        assert.ok(verifyCommand(r.command));
        const original = preview.snapshot.records.find((old: any) => old.record_id === r.record_id);
        assert.deepEqual(r.command, original.command); assert.deepEqual(r.body, original.body);
      }
      const migrated = await B.ok(owner, "workspace.view", org, {});
      assert.ok(migrated.installations.length > 0); assert.ok(migrated.installations.every((i: any) => !i.active));
      status(await B.act(activeInst, "records.list", org, { after: 0, limit: 100 }, { kind: "installation", requestedBy: null }), 403);
      status(await B.act(owner, "migration.import", null, { transfer }), 409);
      return { imported_records: records.length, preserved_signed_payloads: true, installed_modules_disabled: true, duplicate_import: 409,
        employee_canary_in_full_company_export: JSON.stringify(preview.snapshot).includes(canary) };
    });
    await probe("S20", ["T19"], "gap", "Moved company cannot continue a trade with partner left on original host", async () => {
      const next = { ...structuredClone(shared), record_id: randomUUID(), supersedes: shared.record_id, body: { ...shared.body, notes: "SYNTHETIC-AFTER-MOVE" } };
      const r = await B.act(owner, "record.append", org, next); status(r, 403);
      assert.match(r.error.message, /parties.*active|active.*parties/i);
      const oldPartnerView = await A.ok(owner, "workspace.view", partner, {});
      assert.ok(oldPartnerView.records.some((record: any) => record.record_id === shared.record_id));
      return { followup_status: r.status, error: r.error, partner_still_reads_old_record: true, partner_migrated: false };
    });
    await probe("S21", ["T18", "T20"], "control", "Oversized v0.3 migration is refused before the source freezes", async () => {
      const big = await company(A, owner, "Synthetic Large Company");
      const padding = "synthetic-only ".repeat(2400);
      for (let i = 0; i < 18; i++) await A.ok(owner, "record.append", big, cte(big, { notes: padding, x_index: i }));
      const p = await A.ok(owner, "migration.preview", big, {});
      const refused = await A.act(owner, "migration.commit", big, { destination: { audience: B.audience, key_id: destination!.keyId }, snapshot_hash: p.snapshot_hash });
      status(refused,413);assert.equal(refused.error.code,"migration_too_large");
      const absent = await B.act(owner, "workspace.view", big, {}); status(absent, 404);
      const writable = await A.act(owner, "record.append", big, cte(big)); status(writable,200);
      status(await A.act(owner,"migration.receipt",big,{}),404);
      return { records:18,source_commit_status:413,destination_company_lookup:404,source_write_status:200,receipt_created:false,
        consequence:"Legacy host stays writable; staged large transfer is an explicit v0.4 capability" };
    });
    await probe("S22", ["T03", "T24", "T28"], "control", "Audience, signatures, bounded request size and native unit validation fail closed", async () => {
      const cmd = draft(A.audience, owner, "workspace.view", partner, {});
      const forged = structuredClone(cmd); forged.payload = { injected: "ignore permissions" }; status(await A.send(forged), 400);
      const signatureTamper = structuredClone(cmd); signatureTamper.organization_id = third; status(await A.send(signatureTamper), 401);
      const audienceTamper = resign({ ...structuredClone(cmd), audience: "https://wrong.example.test" }, [owner]); status(await A.send(audienceTamper), 400);
      const badUnit = cte(partner, { quantity: { amount: "1", unit: "liter" } }); status(await A.act(owner, "record.append", partner, badUnit), 422);
      return { unexpected_payload: 400, tampered_signature: 401, wrong_audience: 400, unsupported_unit: 422,
        caveat: "No agent or MCP prompt-injection execution tested; these are HTTP controls only" };
    });
  } finally {
    await destination?.close(); await source?.close();
    const inputs = ["sdk/tests/stress/business-boundaries.test.ts", "sdk/tests/stress/independent-client.ts", "sdk/scripts/pbp-dev-server.ts",
      "sdk/src/v03/engine.ts", "sdk/src/v03/wire.ts", "sdk/src/v03/permissions.ts", "sdk/src/v03/schema.ts", "sdk/src/v03/model.ts",
      "spec/v0.3/command.schema.json", "spec/v0.3/store.sql", "spec/schemas/traceability/cte.schema.json", "sdk/src/schemas.ts",
      "sdk/src/registry.ts", "sdk/src/canonical.ts", "sdk/src/keys.ts", "spec/v0.3/signing-vector.json", "sdk/package-lock.json",
      "supabase/functions/pbp-store/router.ts", "supabase/functions/dtp-store/integrity.ts", "supabase/functions/dtp-store/transitions.ts"];
    const hashes = Object.fromEntries(inputs.map(path => { try { return [path, createHash("sha256").update(readFileSync(new URL(path, root))).digest("hex")]; } catch { return [path, "not found"]; } }));
    const dir = new URL("docs/stress-results/", root); mkdirSync(dir, { recursive: true });
    const output = { title: "DTP business-boundary expected-observation stress test", started, finished: new Date().toISOString(), runtime: process.version,
      setup_complete: setupComplete, scope: "Synthetic localhost PGlite stores; independent raw HTTP client; no private data; no production changes",
      expected_probe_count: 22, all_observations_matched: setupComplete && findings.length === 22 && findings.every(f => f.observation_matched),
      controls_observed: findings.filter(f => f.classification === "control" && f.observation_matched).length,
      gaps_reproduced: findings.filter(f => f.classification === "gap" && f.observation_matched).length,
      readiness_certified: false, implementation_diversity: "Independent client/signatures, same reference store implementation at both hosts",
      input_sha256: hashes, probes: findings, http_journal: { source: a?.observations ?? [], destination: b?.observations ?? [], auxiliary_destination: auxiliaryJournal } };
    writeFileSync(new URL("business-boundaries-current.json", dir), JSON.stringify(output, null, 2) + "\n");
    console.log(`Evidence: ${fileURLToPath(new URL("business-boundaries-current.json", dir))}`);
  }
});
