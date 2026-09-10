import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { validateGraph, topologicalOrder, gateFingerprint, emptyEvidence, evaluate, expectedDependencies, skippedTests, safePath, main } from "../../scripts/release-gates.ts";
import type { Graph, Evidence } from "../../scripts/release-gates.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dtp-release-gates-"));
  writeFileSync(join(root, "input.txt"), "source-v1"); writeFileSync(join(root, "review.txt"), "review passed");
  const graph: Graph = { version: 1, release: "DTP-0.4", initial_status: "pending", checks: [], gates: [] };
  for (const [id, deps] of Object.entries(expectedDependencies)) {
    const check = `${id.toLowerCase()}-review`;
    graph.checks.push({ id: check, title: id + " review", kind: "manual", files: ["input.txt"], independent_of: id === "G09" ? ["implementer"] : [] });
    graph.gates.push({ id, title: id, owner: "implementer", required: true, depends_on: [...deps], inputs: ["input.txt"], checks: [check] });
  }
  return { root, graph, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
function green(graph: Graph, root: string): Evidence {
  const evidence = emptyEvidence();
  for (const gate of graph.gates) for (const check of gate.checks) evidence.observations.push({ check_id: check, status: "passed", source_hash: gateFingerprint(graph, gate.id, root), recorded_at: new Date().toISOString(), actor: "independent-reviewer", summary: "Synthetic validator fixture only", artifacts: { "review.txt": createHash("sha256").update(readFileSync(join(root, "review.txt"))).digest("hex") } });
  return evidence;
}
test("release graph: exact G00-G10 order and pending evidence never imply readiness", () => {
  const f = fixture(); try {
    assert.deepEqual(validateGraph(f.graph, f.root), Object.keys(expectedDependencies));
    const result = evaluate(f.graph, emptyEvidence(), f.root); assert.equal(result.ready, false); assert.equal(result.gates[0].status, "pending");
    assert.equal(evaluate(f.graph, green(f.graph, f.root), f.root).ready, true);
  } finally { f.cleanup(); }
});
test("release graph: cycles, missing dependencies and contract weakening rejected", () => {
  const f = fixture(); try {
    f.graph.gates[0].depends_on = ["G10"]; assert.throws(() => topologicalOrder(f.graph), /cycle/); assert.throws(() => validateGraph(f.graph, f.root), /dependency contract/);
    f.graph.gates[0].depends_on = ["G99"]; assert.throws(() => topologicalOrder(f.graph), /missing dependency/);
    f.graph.gates[0].depends_on = []; f.graph.gates[5].required = false; assert.throws(() => validateGraph(f.graph, f.root), /mandatory/);
  } finally { f.cleanup(); }
});
test("release graph: dangling files, checks, executable references and orphan tests rejected", () => {
  const f = fixture(); try {
    f.graph.checks[0].files = ["missing.test.ts"]; assert.throws(() => validateGraph(f.graph, f.root), /dangling file/);
    f.graph.checks[0].files = ["input.txt"]; f.graph.gates[0].checks = ["unknown"]; assert.throws(() => validateGraph(f.graph, f.root), /dangling check/);
    f.graph.gates[0].checks = ["g00-review"]; f.graph.checks.push({ id: "orphan", title: "orphan", kind: "manual", files: ["input.txt"] }); assert.throws(() => validateGraph(f.graph, f.root), /orphan/);
    f.graph.checks.pop(); f.graph.checks[0].kind = "node"; f.graph.checks[0].args = ["--test", "missing.test.ts"]; assert.throws(() => validateGraph(f.graph, f.root), /dangling executable/);
  } finally { f.cleanup(); }
});
test("release graph: skipped, failed, blocked and newer failures cannot turn green", () => {
  const f = fixture(); try {
    for (const status of ["skipped", "failed", "blocked"] as const) {
      const evidence = green(f.graph, f.root); evidence.observations.push({ ...evidence.observations[0], status });
      const result = evaluate(f.graph, evidence, f.root); assert.equal(result.ready, false); assert.equal(result.gates[0].status, status); assert.equal(result.gates.at(-1)!.status, "blocked");
    }
  } finally { f.cleanup(); }
});
test("release graph: source and dependency changes invalidate downstream evidence", () => {
  const f = fixture(); try {
    const evidence = green(f.graph, f.root); writeFileSync(join(f.root, "input.txt"), "source-v2");
    const result = evaluate(f.graph, evidence, f.root); assert.equal(result.ready, false); assert.equal(result.gates[0].status, "stale");
    assert.ok(result.gates.at(-1)!.reasons.some(r => r.includes("evidence stale")));
  } finally { f.cleanup(); }
});
test("release graph: check definition changes invalidate evidence", () => {
  const f = fixture(); try {
    const evidence = green(f.graph, f.root); f.graph.checks[0].title = "new requirement";
    assert.equal(evaluate(f.graph, evidence, f.root).gates[0].status, "stale");
  } finally { f.cleanup(); }
});
test("release graph: checkout CRLF conversion preserves CI fingerprint but binary changes do not", () => {
  const f = fixture(); try {
    writeFileSync(join(f.root, "input.txt"), "first\nsecond\n"); const lf = gateFingerprint(f.graph, "G10", f.root);
    writeFileSync(join(f.root, "input.txt"), "first\r\nsecond\r\n"); assert.equal(gateFingerprint(f.graph, "G10", f.root), lf);
    writeFileSync(join(f.root, "input.txt"), Buffer.from([255, 0, 13, 10])); const binary = gateFingerprint(f.graph, "G10", f.root);
    writeFileSync(join(f.root, "input.txt"), Buffer.from([255, 0, 10])); assert.notEqual(gateFingerprint(f.graph, "G10", f.root), binary);
  } finally { f.cleanup(); }
});
test("release graph: artifact mutation invalidates passed observations", () => {
  const f = fixture(); try {
    const evidence = green(f.graph, f.root); writeFileSync(join(f.root, "review.txt"), "review now reports failure");
    assert.equal(evaluate(f.graph, evidence, f.root).ready, false);
  } finally { f.cleanup(); }
});
test("release graph: blocking findings require fresh closure checks", () => {
  const f = fixture(); try {
    const evidence = green(f.graph, f.root);
    evidence.findings.push({ id: "R1", gate: "G03", severity: "blocking", owner: "implementer", reproducer: "read wrong compartment", status: "open", closure_checks: ["g03-review"] });
    assert.deepEqual(evaluate(f.graph, evidence, f.root).open_blockers, ["R1"]);
    evidence.findings[0].status = "closed"; assert.equal(evaluate(f.graph, evidence, f.root).ready, true);
    evidence.observations.find(o => o.check_id === "g03-review")!.status = "failed"; assert.deepEqual(evaluate(f.graph, evidence, f.root).open_blockers, ["R1"]);
    evidence.findings[0].closure_checks = []; assert.throws(() => evaluate(f.graph, evidence, f.root), /closure evidence required/);
  } finally { f.cleanup(); }
});
test("release graph: implementer cannot supply their independent review", () => {
  const f = fixture(); try {
    const evidence = green(f.graph, f.root); evidence.observations.find(o => o.check_id === "g09-review")!.actor = "implementer";
    assert.equal(evaluate(f.graph, evidence, f.root).gates.find(g => g.id === "G09")!.status, "failed");
  } finally { f.cleanup(); }
});
test("release graph: executable success requires exact command, runtime, zero exit and no skips", () => {
  const f = fixture(); try {
    f.graph.checks[0].kind = "node"; f.graph.checks[0].args = ["--version"];
    const evidence = green(f.graph, f.root), observation = evidence.observations[0];
    assert.equal(evaluate(f.graph, evidence, f.root).gates[0].status, "failed");
    Object.assign(observation, { exit_code: 0, runtime: "v22.23.2", skipped_tests: 0, command: ["node", "--version"] });
    assert.equal(evaluate(f.graph, evidence, f.root).ready, true);
    observation.skipped_tests = 1; assert.equal(evaluate(f.graph, evidence, f.root).ready, false);
    observation.skipped_tests = 0; observation.exit_code = 1; assert.equal(evaluate(f.graph, evidence, f.root).ready, false);
    observation.exit_code = 0; observation.command = ["node", "--help"]; assert.equal(evaluate(f.graph, evidence, f.root).ready, false);
  } finally { f.cleanup(); }
});
test("release graph: skipped and cancelled TAP tests detected", () => {
  assert.equal(skippedTests("# skipped 0\n# cancelled 0\n"), 0);
  assert.equal(skippedTests("# skipped 2\n# cancelled 1\n"), 3);
  assert.equal(skippedTests("ok 1 - database # SKIP missing runtime\n"), 1);
  assert.equal(skippedTests("not ok 2 - future # TODO\n"), 1);
  assert.equal(skippedTests("ℹ skipped 2\nℹ cancelled 0\nℹ todo 1\n"), 3);
  assert.equal(skippedTests("test result: ok. 12 passed; 0 failed; 1 ignored; 0 measured\n"), 1);
});
test("release graph: unsafe relative paths rejected", () => {
  const f = fixture(); try { for (const path of ["../outside", "C:/outside", "/outside", "input\\nested", "."]) assert.throws(() => safePath(f.root, path)); } finally { f.cleanup(); }
});
test("release graph: CLI structure check succeeds without a readiness claim; report fails", () => {
  const f = fixture(); try {
    writeFileSync(join(f.root, "graph.json"), JSON.stringify(f.graph));
    assert.equal(main(["validate", "--graph", "graph.json", "--evidence", "evidence.json", "--structure-only"], f.root), 0);
    assert.equal(main(["report", "--graph", "graph.json", "--evidence", "evidence.json"], f.root), 1);
  } finally { f.cleanup(); }
});
test("release graph: CI run-check records an actual check without bypassing blocked release dependencies", () => {
  const f = fixture(); try {
    mkdirSync(join(f.root, "sdk"));
    const executable = f.graph.checks.find(c => c.id === "g08-review")!; executable.kind = "node"; executable.args = ["--version"];
    writeFileSync(join(f.root, "graph.json"), JSON.stringify(f.graph));
    assert.equal(main(["run-check", "--graph", "graph.json", "--evidence", "evidence.json", "--check", "g08-review"], f.root), 0);
    const evidence = JSON.parse(readFileSync(join(f.root, "evidence.json"), "utf8"));
    assert.equal(evidence.observations.length, 1); assert.equal(evidence.observations[0].status, "passed");
    const result = evaluate(f.graph, evidence, f.root); assert.equal(result.ready, false); assert.equal(result.gates.find(g => g.id === "G08")!.status, "blocked");
    assert.throws(() => main(["run-check", "--graph", "graph.json", "--evidence", "evidence.json", "--check", "g00-review"], f.root), /concrete executable/);
  } finally { f.cleanup(); }
});
