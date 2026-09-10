// Fail-closed release graph and evidence runner. No network, merge or deployment.
// A successful test command is evidence, not a replacement for independent review.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync, existsSync, realpathSync } from "node:fs";
import { dirname, resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export type Status = "pending" | "passed" | "failed" | "blocked" | "skipped";
export interface Check {
  id: string; title: string; kind: "node" | "deno" | "manual";
  args?: string[]; files: string[]; timeout_ms?: number;
  independent_of?: string[];
}
export interface Gate {
  id: string; title: string; owner: string; required: boolean;
  depends_on: string[]; inputs: string[]; checks: string[];
}
export interface Graph {
  version: 1; release: "DTP-0.4"; initial_status: "pending";
  checks: Check[]; gates: Gate[];
}
export interface Observation {
  check_id: string; status: Status; source_hash: string; recorded_at: string;
  actor: string; summary: string; artifacts: Record<string, string>;
  exit_code?: number | null; skipped_tests?: number;
  command?: string[]; runtime?: string;
}
export interface Finding {
  id: string; gate: string; severity: "blocking" | "nonblocking";
  owner: string; reproducer: string; status: "open" | "closed";
  closure_checks: string[];
}
export interface Evidence {
  version: 1; release: "DTP-0.4"; observations: Observation[]; findings: Finding[];
}
export interface GateResult { id: string; status: Status | "stale"; reasons: string[]; source_hash: string }
export const expectedDependencies: Record<string, string[]> = {
  G00: [], G01: ["G00"], G02: ["G01"], G03: ["G02"], G04: ["G02"],
  G05: ["G01"], G06: ["G05"], G07: ["G02", "G03", "G04", "G05", "G06"],
  G08: ["G00", "G07"], G09: ["G01", "G02", "G03", "G04", "G05", "G06", "G07", "G08"],
  G10: ["G00", "G01", "G02", "G03", "G04", "G05", "G06", "G07", "G08", "G09"],
};
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function pinnedRuntime(kind: Check["kind"], runtime: unknown): boolean {
  return typeof runtime === "string" && (kind === "node" ? /^v22\.23\.2$/.test(runtime) : kind === "deno" ? /^deno 2\.9\.6(?:\s|$)/.test(runtime) : false);
}
function sourceHash(bytes: Buffer): string {
  // Source checkouts may have Git CRLF conversion on Windows. Preserve binary
  // inputs exactly; normalize only round-trippable UTF-8 text for cross-host CI.
  const text = bytes.toString("utf8");
  return hash(Buffer.from(text, "utf8").equals(bytes) ? text.replace(/\r\n/g, "\n") : bytes);
}
function sorted(value: any): string {
  if (Array.isArray(value)) return "[" + value.map(sorted).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + sorted(value[k])).join(",") + "}";
  return JSON.stringify(value);
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function unique(values: string[], label: string) {
  assert(Array.isArray(values) && values.every(v => typeof v === "string" && v.trim()), `${label}: nonempty strings required`);
  assert(new Set(values).size === values.length, `${label}: duplicates`);
}
export function safePath(root: string, path: string): string {
  assert(typeof path === "string" && path.length > 0 && !isAbsolute(path) && !path.includes("\\") && !path.includes(":"), `unsafe relative path: ${path}`);
  const target = resolve(root, path), rel = relative(resolve(root), target);
  assert(rel !== "" && rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel), `path escapes root: ${path}`);
  // Reject symlinks in existing parent segments as well as the final component.
  let cursor = resolve(root);
  for (const part of rel.split(sep)) {
    cursor = resolve(cursor, part);
    if (existsSync(cursor)) assert(!lstatSync(cursor).isSymbolicLink(), `symlink input is not allowed: ${path}`);
  }
  return target;
}
export function validateGraph(graph: Graph, root: string): string[] {
  assert(graph?.version === 1 && graph.release === "DTP-0.4" && graph.initial_status === "pending", "unsupported graph or non-pending initial status");
  assert(Array.isArray(graph.gates) && Array.isArray(graph.checks), "gates and checks required");
  unique(graph.gates.map(g => g.id), "gate IDs"); unique(graph.checks.map(c => c.id), "check IDs");
  assert(sorted(graph.gates.map(g => g.id).sort()) === sorted(Object.keys(expectedDependencies).sort()), "exact G00-G10 gate set required");
  const ids = new Set(graph.gates.map(g => g.id)), checks = new Map(graph.checks.map(c => [c.id, c]));
  const used = new Set<string>();
  for (const check of graph.checks) {
    assert(/^[a-z][a-z0-9-]+$/.test(check.id) && check.title?.trim(), "invalid check ID/title");
    assert(["node", "deno", "manual"].includes(check.kind), `${check.id}: unsupported kind`);
    unique(check.files, `${check.id} files`);
    assert(check.files.length > 0, `${check.id}: explicit executable or review files required`);
    for (const file of check.files) assert(existsSync(safePath(root, file)) && lstatSync(safePath(root, file)).isFile(), `${check.id}: dangling file ${file}`);
    if (check.kind !== "manual") {
      assert(Array.isArray(check.args) && check.args.length > 0 && check.args.every(a => typeof a === "string" && !a.includes("\0")), `${check.id}: executable arguments required`);
      // Every named .ts/.js test or entry point must be an explicit, existing file.
      for (const arg of check.args) if (/\.(?:ts|mjs|js)$/.test(arg)) {
        const referenced = relative(root, resolve(root, "sdk", arg)).replaceAll("\\", "/");
        assert(check.files.includes(referenced), `${check.id}: dangling executable reference ${arg}`);
      }
      assert(!check.args.some(a => /[*?]/.test(a)), `${check.id}: globbed commands hide dangling tests; enumerate files`);
      assert(check.timeout_ms === undefined || (Number.isSafeInteger(check.timeout_ms) && check.timeout_ms > 0 && check.timeout_ms <= 1800000), `${check.id}: invalid timeout`);
    } else assert(check.args === undefined, `${check.id}: manual check cannot run a command`);
    if (check.independent_of) unique(check.independent_of, `${check.id} reviewer exclusions`);
  }
  for (const gate of graph.gates) {
    assert(gate.title?.trim() && gate.owner?.trim() && gate.required === true, `${gate.id}: mandatory gate metadata required`);
    unique(gate.depends_on, `${gate.id} dependencies`); unique(gate.inputs, `${gate.id} inputs`); unique(gate.checks, `${gate.id} checks`);
    assert(gate.inputs.length > 0 && gate.checks.length > 0, `${gate.id}: inputs/checks required`);
    for (const dep of gate.depends_on) assert(ids.has(dep) && dep !== gate.id, `${gate.id}: missing/self dependency ${dep}`);
    assert(sorted([...gate.depends_on].sort()) === sorted([...expectedDependencies[gate.id]].sort()), `${gate.id}: dependency contract differs from release plan`);
    for (const input of gate.inputs) assert(existsSync(safePath(root, input)), `${gate.id}: missing input ${input}`);
    for (const check of gate.checks) { assert(checks.has(check), `${gate.id}: dangling check ${check}`); assert(!used.has(check), `${check}: check belongs to more than one gate`); used.add(check); }
  }
  for (const check of checks.keys()) assert(used.has(check), `orphan executable/review check ${check}`);
  return topologicalOrder(graph);
}
export function topologicalOrder(graph: Graph): string[] {
  const byId = new Map(graph.gates.map(g => [g.id, g])), visiting = new Set<string>(), visited = new Set<string>(), order: string[] = [];
  const visit = (id: string) => {
    assert(byId.has(id), `missing dependency ${id}`); assert(!visiting.has(id), `dependency cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id); for (const dep of byId.get(id)!.depends_on) visit(dep);
    visiting.delete(id); visited.add(id); order.push(id);
  };
  for (const gate of graph.gates) visit(gate.id);
  return order;
}
function inputFiles(root: string, path: string): string[] {
  const absolute = safePath(root, path);
  if (lstatSync(absolute).isFile()) return [path];
  assert(lstatSync(absolute).isDirectory(), `not a regular input: ${path}`);
  return readdirSync(absolute).sort().filter(name => !["node_modules", ".git"].includes(name)).flatMap(name => inputFiles(root, path + "/" + name));
}
export function gateFingerprint(graph: Graph, gateId: string, root: string): string {
  const gates = new Map(graph.gates.map(g => [g.id, g])), included = new Set<string>();
  const include = (id: string) => { assert(gates.has(id), `missing gate ${id}`); if (included.has(id)) return; included.add(id); gates.get(id)!.depends_on.forEach(include); };
  include(gateId);
  const selected = [...included].sort().map(id => gates.get(id)!);
  const checkIds = new Set(selected.flatMap(g => g.checks));
  const checks = graph.checks.filter(c => checkIds.has(c.id)).sort((a, b) => a.id.localeCompare(b.id));
  const paths = new Set([...selected.flatMap(g => g.inputs), ...checks.flatMap(c => c.files)].flatMap(p => inputFiles(root, p)));
  const inputs = Object.fromEntries([...paths].sort().map(p => [p, sourceHash(readFileSync(safePath(root, p)))]));
  return hash(sorted({ version: graph.version, release: graph.release, gates: selected, checks, inputs }));
}
export function emptyEvidence(): Evidence { return { version: 1, release: "DTP-0.4", observations: [], findings: [] }; }
export function evaluate(graph: Graph, evidence: Evidence, root: string): { ready: boolean; gates: GateResult[]; open_blockers: string[] } {
  const order = validateGraph(graph, root);
  assert(evidence?.version === 1 && evidence.release === graph.release && Array.isArray(evidence.observations) && Array.isArray(evidence.findings), "invalid evidence document");
  const allowed = new Set(graph.checks.map(c => c.id));
  for (const observation of evidence.observations) {
    assert(allowed.has(observation.check_id), `evidence references unknown check ${observation.check_id}`);
    assert(["pending", "passed", "failed", "blocked", "skipped"].includes(observation.status), "invalid evidence status");
    assert(/^[0-9a-f]{64}$/.test(observation.source_hash) && Number.isFinite(Date.parse(observation.recorded_at)), "invalid evidence hash/time");
    assert(observation.actor?.trim() && observation.summary?.trim() && observation.artifacts && typeof observation.artifacts === "object" && !Array.isArray(observation.artifacts), "evidence actor/summary/artifacts required");
  }
  unique(evidence.findings.map(f => f.id), "finding IDs");
  for (const finding of evidence.findings) {
    assert(order.includes(finding.gate) && ["blocking", "nonblocking"].includes(finding.severity) && ["open", "closed"].includes(finding.status), "invalid finding gate/severity/status");
    assert(finding.owner?.trim() && finding.reproducer?.trim(), `${finding.id}: owner/reproducer required`);
    unique(finding.closure_checks, `${finding.id}: closure checks`);
    for (const check of finding.closure_checks) assert(allowed.has(check), `${finding.id}: dangling closure check`);
    assert(finding.status !== "closed" || finding.closure_checks.length > 0, `${finding.id}: closure evidence required`);
  }
  const results = new Map<string, GateResult>(), checkStates = new Map<string, boolean>();
  for (const id of order) {
    const gate = graph.gates.find(g => g.id === id)!, fingerprint = gateFingerprint(graph, id, root), reasons: string[] = [];
    let status: GateResult["status"] = "passed";
    for (const checkId of gate.checks) {
      const check = graph.checks.find(c => c.id === checkId)!;
      // Last recorded observation wins, including a later failure or blocked rerun.
      const observation = evidence.observations.filter(o => o.check_id === checkId).at(-1);
      let valid = true;
      if (!observation) { reasons.push(`${checkId}: no evidence`); status = "pending"; valid = false; }
      else if (observation.status !== "passed") { reasons.push(`${checkId}: ${observation.status}`); status = observation.status; valid = false; }
      else if (observation.source_hash !== fingerprint) { reasons.push(`${checkId}: source/dependency evidence stale`); status = "stale"; valid = false; }
      else {
        if (check.kind !== "manual" && (observation.exit_code !== 0 || observation.skipped_tests !== 0 || !observation.command?.length || !pinnedRuntime(check.kind, observation.runtime))) {
          reasons.push(`${checkId}: successful, unskipped command/runtime evidence required`); status = "failed"; valid = false;
        }
        if (check.kind !== "manual" && sorted(observation.command?.slice(1)) !== sorted(check.args)) { reasons.push(`${checkId}: command differs from graph`); status = "failed"; valid = false; }
        if (check.independent_of?.includes(observation.actor)) { reasons.push(`${checkId}: reviewer is an implementer`); status = "failed"; valid = false; }
        if (!Object.keys(observation.artifacts).length) { reasons.push(`${checkId}: no inspectable artifact`); status = "failed"; valid = false; }
        for (const [path, digest] of Object.entries(observation.artifacts)) {
          if (!existsSync(safePath(root, path)) || hash(readFileSync(safePath(root, path))) !== digest) { reasons.push(`${checkId}: missing/changed artifact ${path}`); status = "stale"; valid = false; }
        }
      }
      checkStates.set(checkId, valid);
    }
    for (const dependency of gate.depends_on) if (results.get(dependency)?.status !== "passed") { reasons.push(`${dependency}: dependency not green`); status = "blocked"; }
    results.set(id, { id, status, reasons, source_hash: fingerprint });
  }
  const openBlockers = evidence.findings.filter(f => f.severity === "blocking" && (f.status !== "closed" || f.closure_checks.some(c => !checkStates.get(c)))).map(f => f.id);
  return { ready: openBlockers.length === 0 && [...results.values()].every(g => g.status === "passed"), gates: [...results.values()], open_blockers: openBlockers };
}
export function skippedTests(output: string): number {
  const plain = output.replace(/\u001b\[[0-9;]*m/g, "");
  const values = [...plain.matchAll(/^[#ℹ]\s+(?:skipped|cancelled|todo) (\d+)\s*$/gm)].map(m => Number(m[1]));
  values.push(...[...plain.matchAll(/test result:.*?\b(\d+) ignored\b/g)].map(m => Number(m[1])));
  if (/^.*# (?:SKIP|TODO)\b/m.test(plain)) values.push(1);
  return values.reduce((a, b) => a + b, 0);
}
function save(path: string, data: unknown) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(data, null, 2) + "\n"); }
function option(args: string[], key: string, fallback?: string): string | undefined {
  const index = args.indexOf(key); if (index < 0) return fallback;
  assert(args[index + 1] && !args[index + 1].startsWith("--"), `value required for ${key}`); return args[index + 1];
}
export function main(args = process.argv.slice(2), root = fileURLToPath(new URL("../../", import.meta.url))): number {
  const mode = args[0] ?? "report";
  assert(["validate", "report", "loop", "run-check", "record"].includes(mode), "usage: release-gates.ts validate|report|loop|run-check|record [--structure-only] [--gate G08] [--check CHECK] [--node PATH] [--deno PATH]");
  const graphPath = option(args, "--graph", "docs/release/v04-gates.json")!, evidencePath = option(args, "--evidence", "docs/release/v04-evidence.json")!;
  const graph: Graph = JSON.parse(readFileSync(safePath(root, graphPath), "utf8"));
  const order = validateGraph(graph, root);
  if (args.includes("--structure-only")) { assert(["validate", "report"].includes(mode), "structure-only does not run or record checks"); console.log(JSON.stringify({ valid_structure: true, ready: false, message: "Structure only; no release readiness claim", order }, null, 2)); return 0; }
  const evidence: Evidence = existsSync(safePath(root, evidencePath)) ? JSON.parse(readFileSync(safePath(root, evidencePath), "utf8")) : emptyEvidence();
  evaluate(graph, evidence, root);
  if (mode === "record") {
    const id = option(args, "--check"), check = graph.checks.find(c => c.id === id);
    assert(check?.kind === "manual", "record only accepts manual review checks; executable evidence must come from loop");
    const gate = graph.gates.find(g => g.checks.includes(check.id))!, actor = option(args, "--actor"), artifact = option(args, "--artifact"), summary = option(args, "--summary"), status = option(args, "--status", "passed") as Status;
    assert(actor && artifact && summary && ["passed", "failed", "blocked", "skipped"].includes(status), "record requires actor, artifact, summary and valid status");
    assert(!check.independent_of?.includes(actor), "reviewer cannot certify their implementation");
    const artifactHash = hash(readFileSync(safePath(root, artifact)));
    evidence.observations.push({ check_id: check.id, status, source_hash: gateFingerprint(graph, gate.id, root), recorded_at: new Date().toISOString(), actor, summary, artifacts: { [artifact]: artifactHash } });
    save(safePath(root, evidencePath), evidence);
  }
  let selectedPassed = false;
  if (mode === "loop" || mode === "run-check") {
    assert(!process.env.STORE_URL, "refusing local release loop with STORE_URL configured");
    const selectedCheck = mode === "run-check" ? option(args, "--check") : undefined;
    if (mode === "run-check") assert(selectedCheck && graph.checks.some(c => c.id === selectedCheck && c.kind !== "manual"), "run-check requires one concrete executable check");
    const requested = selectedCheck ? graph.gates.find(g => g.checks.includes(selectedCheck))!.id : option(args, "--gate"); assert(!requested || order.includes(requested), "unknown gate selection");
    const runtimes = { node: option(args, "--node", process.execPath)!, deno: option(args, "--deno", "deno")! };
    for (const id of order.filter(id => !requested || id === requested)) {
      const gate = graph.gates.find(g => g.id === id)!, state = evaluate(graph, evidence, root);
      if (mode === "loop" && gate.depends_on.some(dep => state.gates.find(g => g.id === dep)?.status !== "passed")) { console.log(`${id}: blocked by dependency; no checks executed`); continue; }
      for (const checkId of gate.checks.filter(check => !selectedCheck || check === selectedCheck)) {
        const check = graph.checks.find(c => c.id === checkId)!;
        if (check.kind === "manual") { console.log(`${check.id}: manual review requires record plus artifact`); continue; }
        const fingerprint = gateFingerprint(graph, id, root), runtime = runtimes[check.kind];
        // Persist the attempt BEFORE runtime discovery. A failed preflight or a
        // killed runner must invalidate the previous successful observation.
        const started = new Date().toISOString();
        const artifact = `docs/release/evidence/${check.id}-${started.replace(/[:.]/g, "-")}.txt`;
        const attempt: Observation = { check_id: check.id, status: "pending", source_hash: fingerprint, recorded_at: started, actor: "release-runner", summary: "Execution started; no successful result yet", artifacts: {}, command: [runtime, ...check.args!] };
        evidence.observations.push(attempt); save(safePath(root, evidencePath), evidence);
        const version = spawnSync(runtime, ["--version"], { cwd: resolve(root, "sdk"), encoding: "utf8", timeout: 10000, windowsHide: true, shell: false });
        if (version.status !== 0 || !pinnedRuntime(check.kind, version.stdout?.trim())) {
          const output = `Runtime preflight failed: expected pinned ${check.kind}\n${version.stdout ?? ""}\n${version.stderr ?? ""}\n${version.error ?? ""}`;
          mkdirSync(dirname(safePath(root, artifact)), { recursive: true }); writeFileSync(safePath(root, artifact), output);
          Object.assign(attempt, { status: "blocked", summary: "Runtime preflight failed; previous pass invalidated", artifacts: { [artifact]: hash(output) }, exit_code: version.status, runtime: version.stdout?.trim() ?? "" });
          save(safePath(root, evidencePath), evidence); console.log(output); return 1;
        }
        console.log(`Running ${id}/${check.id}`);
        const result = spawnSync(runtime, check.args!, { cwd: resolve(root, "sdk"), encoding: "utf8", timeout: check.timeout_ms ?? 300000, maxBuffer: 16 * 1024 * 1024, windowsHide: true, shell: false });
        const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error ? String(result.error) : ""}`;
        const skipped = skippedTests(output), fresh = fingerprint === gateFingerprint(graph, id, root);
        const status: Status = result.status === 0 && !skipped && fresh ? "passed" : "failed";
        mkdirSync(dirname(safePath(root, artifact)), { recursive: true }); writeFileSync(safePath(root, artifact), output);
        Object.assign(attempt, { status, recorded_at: new Date().toISOString(), summary: fresh ? `${check.title}: ${status}` : "Source changed during run; evidence invalid", artifacts: { [artifact]: hash(output) }, exit_code: result.status, skipped_tests: skipped, runtime: version.stdout.trim() });
        save(safePath(root, evidencePath), evidence);
        if (status !== "passed") { console.log(output); console.log(`${check.id}: loop stopped; reproduce/fix/review before rerun`); console.log(JSON.stringify(evaluate(graph, evidence, root), null, 2)); return 1; }
        if (checkId === selectedCheck) selectedPassed = true;
      }
    }
  }
  const report = evaluate(graph, evidence, root); console.log(JSON.stringify(report, null, 2));
  if (mode === "run-check") { console.log("Single-check execution result only; overall release readiness is reported above and is not bypassed."); return selectedPassed ? 0 : 1; }
  return report.ready ? 0 : 1;
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try { process.exitCode = main(); } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
