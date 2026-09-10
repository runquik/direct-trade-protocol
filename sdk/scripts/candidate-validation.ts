// Reproducible local/CI gates. Generators run in a disposable source copy and
// never overwrite candidate files to make parity pass. No merge or deployment.
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { skippedTests } from "./release-gates.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sdk = resolve(root, "sdk");
function requireSuccess(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function run(args: string[], cwd = sdk, timeout = 300000): void {
  const result = spawnSync(process.execPath, args, { cwd, encoding: "utf8", timeout, maxBuffer: 32 * 1024 * 1024, shell: false, windowsHide: true });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  process.stdout.write(output);
  requireSuccess(result.status === 0 && !result.error, `candidate subprocess failed: ${args.join(" ")} (${result.error?.message ?? result.status})`);
  requireSuccess(skippedTests(output) === 0, `required subprocess contained skipped/cancelled/TODO cases: ${args.join(" ")}`);
}
function tests(files: string[]) {
  requireSuccess(files.length > 0, "empty test suite is not evidence");
  for (const path of files) requireSuccess(existsSync(resolve(sdk, path)), `missing required test: ${path}`);
  run(["--test", "--test-reporter=tap", ...files]);
}
function generatedParity() {
  const temp = mkdtempSync(join(tmpdir(), "dtp-candidate-generation-"));
  const generators = ["build-schemas.ts", "build-pbp-schema.ts", "build-pbp-vectors.ts", "build-pbp-migration.ts", "build-dtp-v04.ts"];
  const expected = ["sdk/src/schemas.ts", "spec/generated/ts/types.d.ts", "spec/generated/accountability.md",
    "spec/v0.3/command.schema.json", "spec/v0.3/signing-vector.json", "supabase/migrations/20260907000000_pbp_v03.sql",
    "spec/v0.4/command.schema.json", "spec/v0.4/signing-vector.json"];
  function copyTree(source: string, destination: string) {
    requireSuccess(!lstatSync(source).isSymbolicLink(), `source symlink is not admitted: ${source}`);
    if (lstatSync(source).isDirectory()) {
      mkdirSync(destination, { recursive: true });
      for (const name of readdirSync(source)) { requireSuccess(![".git", "node_modules"].includes(name), "unexpected broad generator input"); copyTree(join(source, name), join(destination, name)); }
    } else { mkdirSync(dirname(destination), { recursive: true }); cpSync(source, destination); }
  }
  const normalize = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const before = new Map(expected.map(path => [path, normalize(resolve(root, path))]));
  try {
    copyTree(resolve(root, "spec"), resolve(temp, "spec"));
    copyTree(resolve(sdk, "src"), resolve(temp, "sdk/src"));
    copyTree(resolve(sdk, "package.json"), resolve(temp, "sdk/package.json"));
    mkdirSync(resolve(temp, "supabase/migrations"), { recursive: true });
    for (const script of generators) copyTree(resolve(sdk, "scripts", script), resolve(temp, "sdk/scripts", script));
    // Installed dependencies are reused read-only. Node's resolver may traverse
    // the junction; generators themselves write only inside the disposable tree.
    symlinkSync(resolve(sdk, "node_modules"), resolve(temp, "sdk/node_modules"), process.platform === "win32" ? "junction" : "dir");
    for (const script of generators) run([`scripts/${script}`], resolve(temp, "sdk"));
    const mismatches = expected.filter(path => normalize(resolve(temp, path)) !== before.get(path));
    requireSuccess(mismatches.length === 0, `generated artifacts differ from candidate: ${mismatches.join(", ")}`);
    requireSuccess(expected.every(path => normalize(resolve(root, path)) === before.get(path)), "candidate artifacts changed concurrently during validation");
    console.log(`PASS: ${expected.length} generated artifacts match source (UTF-8 LF-normalized); candidate files untouched`);
  } finally {
    const rel = relative(resolve(tmpdir()), resolve(temp));
    requireSuccess(rel.startsWith("dtp-candidate-generation-") && !rel.includes("..") && !lstatSync(temp).isSymbolicLink(), "refusing unsafe temporary cleanup");
    rmSync(temp, { recursive: true, force: true });
  }
}
export function main(args = process.argv.slice(2)) {
  requireSuccess(process.versions.node === "22.23.2", "candidate validation requires pinned Node22.23.2");
  requireSuccess(!process.env.STORE_URL, "refusing local validation with STORE_URL set");
  const modes = args.length ? args : ["all"];
  const allowed = ["default", "typecheck", "generated", "runtime", "stress", "all"];
  requireSuccess(modes.every(mode => allowed.includes(mode)), `choose ${allowed.join(" | ")}`);
  for (const mode of modes.flatMap(mode => mode === "all" ? allowed.filter(m => m !== "all") : [mode])) {
    console.log(`Candidate validation: ${mode}`);
    if (mode === "default") tests(readdirSync(resolve(sdk, "tests")).filter(name => name.endsWith(".test.ts")).sort().map(name => `tests/${name}`));
    if (mode === "typecheck") run(["node_modules/typescript/bin/tsc", "--noEmit"]);
    if (mode === "generated") generatedParity();
    if (mode === "runtime") {
      run(["tests/fuzz/repro-v8-check.mjs", "tests/fuzz/v8-repro/polluter.min.json", "tests/fuzz/v8-repro/target.min.json", "print"]);
      run(["scripts/dtp-v04-runtime-probe.ts"]);
    }
    if (mode === "stress") {
      console.log("Historical stress is regression evidence only; expected legacy GAP observations do not certify v0.4 capabilities.");
      tests(["tests/stress/business-boundaries.test.ts"]);
    }
  }
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try { main(); } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
