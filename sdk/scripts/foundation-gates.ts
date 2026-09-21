// Foundation acceptance graph. Evidence is a reviewed claim, never a security certificate.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const dependencies: Record<string, string[]> = {
  F0: [], F1: ['F0'], F2: ['F1', 'F3'], F3: ['F0'], F4: ['F2', 'F3'],
  F5: ['F4'], F6: ['F5'], F7: ['F6'], F8: ['F7'], F9: ['F1', 'F2', 'F5'],
  F10: ['F0', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9'],
};
export type Status = 'pending' | 'passed' | 'failed' | 'blocked';
export interface Participant { id: string; kind: 'agent' | 'external' | 'runner'; }
export interface Check { id: string; kind: 'test' | 'review' | 'external'; title: string; command?: string[]; }
export interface Gate { id: string; required: true; authors: string[]; depends_on: string[]; inputs: string[]; checks: Check[]; }
export interface Graph { format: 1; release_target: '0.1.0'; participants: Participant[]; gates: Gate[]; }
export interface Observation {
  check: string; status: Status; fingerprint: string; actor: string; summary: string;
  artifacts: Record<string, string>; command?: string[]; runtime?: string; exit_code?: number; tests?: number; skipped?: number;
}
export interface Finding { id: string; gate: string; author: string; status: 'open' | 'closed'; closure_checks: string[]; }
export interface Evidence { format: 1; observations: Observation[]; findings: Finding[]; }
const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
const sorted = (values: string[]) => JSON.stringify([...values].sort());
function names(values: string[], label: string) {
  assert(Array.isArray(values) && values.every(v => typeof v === 'string' && v.length > 0), `${label}: invalid names`);
  assert(new Set(values).size === values.length, `${label}: duplicate names`);
}
export function safeFile(root: string, path: string): string {
  assert(typeof path === 'string' && path.length > 0 && !path.includes('\\') && !path.includes(':') && !path.startsWith('/'), 'relative portable path required');
  assert(path.split('/').every(p => p !== '.' && p !== '..' && p !== ''), 'unsafe path segment');
  const absolute = resolve(root, path);
  assert(!relative(root, absolute).startsWith('..'), 'path escapes workspace');
  let cursor = root;
  for (const part of path.split('/')) {
    cursor = resolve(cursor, part);
    if (existsSync(cursor)) assert(!lstatSync(cursor).isSymbolicLink(), 'symlink input prohibited');
  }
  return absolute;
}
export function validate(graph: Graph): string[] {
  assert(graph?.format === 1 && graph.release_target === '0.1.0', 'wrong foundation graph format');
  assert(Array.isArray(graph.participants) && Array.isArray(graph.gates), 'graph arrays required');
  names(graph.participants.map(p => p.id), 'participants');
  for (const p of graph.participants) assert(['agent', 'external', 'runner'].includes(p.kind), 'invalid participant kind');
  names(graph.gates.map(g => g.id), 'gates');
  assert(sorted(graph.gates.map(g => g.id)) === sorted(Object.keys(dependencies)), 'all F0-F10 mandatory gates required');
  const participants = new Set(graph.participants.map(p => p.id));
  const checkIds: string[] = [];
  for (const gate of graph.gates) {
    assert(gate.required === true, 'gate cannot be optional');
    names(gate.authors, 'authors'); names(gate.inputs, 'inputs'); names(gate.depends_on, 'dependencies');
    assert(gate.authors.length > 0 && gate.authors.every(a => participants.has(a)), 'registered authors required');
    assert(gate.authors.every(a => graph.participants.find(p => p.id === a)?.kind !== 'runner'), 'test runner cannot be an implementer');
    assert(gate.inputs.length > 0, 'source inputs required');
    assert(sorted(gate.depends_on) === sorted(dependencies[gate.id]), 'approved dependency graph weakened');
    assert(Array.isArray(gate.checks) && gate.checks.some(c => c.kind === 'test') && gate.checks.some(c => c.kind === 'review'), 'test and independent review required');
    assert(gate.checks.some(c => c.id === `${gate.id}-tests` && c.kind === 'test') && gate.checks.some(c => c.id === `${gate.id}-review` && c.kind === 'review'), 'mandatory acceptance check IDs required');
    for (const check of gate.checks) {
      assert(['test', 'review', 'external'].includes(check.kind) && typeof check.title === 'string' && check.title.trim(), 'invalid check');
      if (check.command !== undefined) assert(check.kind === 'test' && Array.isArray(check.command) && check.command.length > 1 && check.command[0] === '--test' && check.command.slice(1).every(a => typeof a === 'string' && !a.startsWith('-') && a.endsWith('.test.ts') && !a.includes('\0') && !/[*?]/.test(a)), 'invalid concrete test command');
      checkIds.push(check.id);
    }
  }
  names(checkIds, 'checks');
  assert(graph.gates.find(g => g.id === 'F10')!.checks.some(c => c.kind === 'external' && c.id === 'F10-external'), 'external builder gate cannot be removed');
  const order: string[] = [], visiting = new Set<string>();
  const visit = (id: string) => {
    assert(!visiting.has(id), 'dependency cycle'); if (order.includes(id)) return;
    visiting.add(id); dependencies[id].forEach(visit); visiting.delete(id); order.push(id);
  };
  graph.gates.forEach(g => visit(g.id)); return order;
}
function inventory(root: string, path: string): Record<string, string> {
  const file = safeFile(root, path);
  if (!existsSync(file)) return { [path]: 'MISSING' };
  if (lstatSync(file).isDirectory()) {
    return Object.assign({}, ...readdirSync(file).sort().filter(n => !['node_modules', '.git'].includes(n)).map(n => inventory(root, `${path}/${n}`)));
  }
  assert(lstatSync(file).isFile(), 'regular source file required');
  const bytes = readFileSync(file), text = bytes.toString('utf8');
  return { [path]: hash(Buffer.from(text, 'utf8').equals(bytes) ? text.replace(/\r\n/g, '\n') : bytes) };
}
export function fingerprint(graph: Graph, id: string, root: string): string {
  validate(graph); assert(id in dependencies, 'unknown gate');
  const selected = new Set<string>();
  const include = (key: string) => { if (selected.has(key)) return; selected.add(key); dependencies[key].forEach(include); }; include(id);
  const gates = [...selected].sort().map(key => graph.gates.find(g => g.id === key)!);
  const paths = [...new Set(gates.flatMap(g => g.inputs))].sort();
  return hash(JSON.stringify({ release: graph.release_target, participants: graph.participants, gates, inputs: paths.map(p => inventory(root, p)) }));
}
export function evaluate(graph: Graph, evidence: Evidence, root: string) {
  const order = validate(graph);
  assert(evidence?.format === 1 && Array.isArray(evidence.observations) && Array.isArray(evidence.findings), 'invalid evidence');
  const checks = new Map(graph.gates.flatMap(g => g.checks.map(c => [c.id, { check: c, gate: g }] as const)));
  for (const o of evidence.observations) {
    assert(checks.has(o.check) && ['pending', 'passed', 'failed', 'blocked'].includes(o.status), 'unknown check or status');
    assert(typeof o.fingerprint === 'string' && /^[0-9a-f]{64}$/.test(o.fingerprint), 'invalid fingerprint');
    assert(typeof o.actor === 'string' && typeof o.summary === 'string' && o.summary.trim(), 'evidence attribution required');
    assert(o.artifacts && typeof o.artifacts === 'object' && !Array.isArray(o.artifacts), 'artifact map required');
  }
  names(evidence.findings.map(f => f.id), 'findings');
  for (const f of evidence.findings) {
    assert(order.includes(f.gate) && graph.participants.some(p => p.id === f.author) && ['open', 'closed'].includes(f.status), 'invalid finding');
    names(f.closure_checks, 'closure checks'); assert(f.closure_checks.every(c => checks.has(c)), 'unknown closure check');
    assert(f.status !== 'closed' || f.closure_checks.length > 0, 'closure evidence required');
  }
  const passedChecks = new Set<string>();
  const results: { id: string; status: Status | 'stale'; fingerprint: string; reasons: string[] }[] = [];
  for (const id of order) {
    const gate = graph.gates.find(g => g.id === id)!, current = fingerprint(graph, id, root), reasons: string[] = [];
    let status: Status | 'stale' = 'passed';
    const reject = (why: string, next: typeof status) => { reasons.push(why); status = next; };
    if (gate.inputs.some(p => Object.values(inventory(root, p)).includes('MISSING'))) reject('planned source input not implemented', 'pending');
    for (const check of gate.checks) {
      const o = evidence.observations.filter(v => v.check === check.id).at(-1);
      if (!o) { reject(`${check.id}: no evidence`, 'pending'); continue; }
      if (o.status !== 'passed') { reject(`${check.id}: ${o.status}`, o.status); continue; }
      if (o.fingerprint !== current) { reject(`${check.id}: source/dependency changed`, 'stale'); continue; }
      const participant = graph.participants.find(p => p.id === o.actor);
      if (!participant) { reject(`${check.id}: unregistered actor`, 'failed'); continue; }
      if (check.kind !== 'test' && participant.kind === 'runner') { reject(`${check.id}: test runner cannot supply independent review`, 'failed'); continue; }
      const allAuthors = new Set(gate.authors);
      if (check.kind === 'external') graph.gates.forEach(g => g.authors.forEach(a => allAuthors.add(a)));
      if (check.kind !== 'test' && allAuthors.has(o.actor)) { reject(`${check.id}: implementer cannot review own work`, 'failed'); continue; }
      if (check.kind === 'external' && participant.kind !== 'external') { reject(`${check.id}: an agent is not an external builder`, 'blocked'); continue; }
      if (check.kind === 'test' && check.command) {
        const inputs = Object.assign({}, ...gate.inputs.map(p => inventory(root, p)));
        if (check.command.slice(1).some(p => !Object.hasOwn(inputs, p) || inputs[p] === 'MISSING' || !existsSync(safeFile(root, p)) || !lstatSync(safeFile(root, p)).isFile())) {
          reject(`${check.id}: executable test missing or absent from source inputs`, 'pending'); continue;
        }
      }
      if (check.kind === 'test' && (o.exit_code !== 0 || o.skipped !== 0 || !Number.isSafeInteger(o.tests) || o.tests! < 1 || !Array.isArray(o.command) || !o.command.length || !check.command || JSON.stringify(o.command.slice(1)) !== JSON.stringify(check.command) || o.runtime !== 'v22.23.2')) {
        reject(`${check.id}: successful unskipped executable tests required`, 'failed'); continue;
      }
      const artifacts = Object.entries(o.artifacts);
      if (!artifacts.length || artifacts.some(([path, digest]) => !/^[0-9a-f]{64}$/.test(digest) || !existsSync(safeFile(root, path)) || !lstatSync(safeFile(root, path)).isFile() || hash(readFileSync(safeFile(root, path))) !== digest)) {
        reject(`${check.id}: missing or changed artifact`, 'stale'); continue;
      }
      passedChecks.add(check.id);
    }
    if (gate.depends_on.some(dep => results.find(r => r.id === dep)?.status !== 'passed')) reject('dependency not green', 'blocked');
    results.push({ id, status, fingerprint: current, reasons });
  }
  const blockers = evidence.findings.filter(f => f.status !== 'closed'
    || f.closure_checks.some(c => !passedChecks.has(c) || checks.get(c)!.gate.id !== f.gate)
    || !f.closure_checks.some(c => checks.get(c)!.check.kind === 'review')
    || !f.closure_checks.some(c => checks.get(c)!.check.kind === 'test')).map(f => f.id);
  return { ready: results.every(r => r.status === 'passed') && blockers.length === 0, gates: results, open_blockers: blockers };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const graph = JSON.parse(readFileSync(resolve(root, 'docs/foundation/gates.json'), 'utf8')) as Graph;
    const evidence = JSON.parse(readFileSync(resolve(root, 'docs/foundation/evidence.json'), 'utf8')) as Evidence;
    const result = evaluate(graph, evidence, root); console.log(JSON.stringify(result, null, 2)); process.exitCode = result.ready ? 0 : 1;
  } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
