// Deliberately separate implementation of the verb-layer datatypes, written from spec/profiles/verbs.md, the class
// registry spec/profiles/classes.json and spec/vectors/verb-datatypes.json. Do not import the SDK's act.ts, its
// canonicalizer or its class list here. Same author: separately coded agreement, not independent authorship.
import { readFileSync } from 'node:fs';
import { readerCanonical } from './product-reader.ts';
import { instantValid } from './order-reader.ts';

export type Issue = { path: string; message: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const plain = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const keysAre = (v: Record<string, unknown>, keys: string[]) => { const k = Object.keys(v); return k.length === keys.length && keys.every(x => k.includes(x)); };
const bounded = (v: unknown, max: number) => typeof v === 'string' && v.length >= 1 && v.length <= max && v === v.trim() && !/[\x00-\x1f\x7f]/.test(v);
const uuidOrNull = (v: unknown) => v === null || (typeof v === 'string' && UUID.test(v));

const registry = JSON.parse(readFileSync(new URL('../../../spec/profiles/classes.json', import.meta.url), 'utf8'));
if (registry.format !== 'dtp-object-classes-1') throw new Error('unknown class registry format');
const protocolClasses = new Set<string>(registry.classes);
/** `<namespace>/<name>`: namespace dtp (and then a listed class) or an organization id; name as the kind grammar. */
export function classValid(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  const slash = name.indexOf('/'); if (slash < 0) return false;
  const ns = name.slice(0, slash), local = name.slice(slash + 1);
  if (!/^[a-z][a-z0-9._-]{0,79}$/.test(local)) return false;
  if (ns === 'dtp') return protocolClasses.has(name);
  return UUID.test(ns);
}
export function readRef(ref: unknown, path: string): Issue[] {
  if (!plain(ref) || !keysAre(ref, ['minted_by', 'root', 'record_id'])) return [{ path, message: 'shape' }];
  const out: Issue[] = [];
  if (!uuidOrNull(ref.minted_by)) out.push({ path: `${path}.minted_by`, message: 'minter' });
  if (!(typeof ref.root === 'string' && UUID.test(ref.root))) out.push({ path: `${path}.root`, message: 'root' });
  if (!uuidOrNull(ref.record_id)) out.push({ path: `${path}.record_id`, message: 'revision' });
  return out;
}
export function readRefs(list: unknown, path: string, max: number): Issue[] {
  if (!Array.isArray(list) || list.length > max) return [{ path, message: 'count' }];
  const out: Issue[] = [], seen: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const mine = readRef(list[i], `${path}[${i}]`); out.push(...mine); if (mine.length) continue;
    const key = readerCanonical(list[i]); if (seen.includes(key)) out.push({ path: `${path}[${i}]`, message: 'twice' }); seen.push(key);
  }
  return out;
}
export function readAct(act: unknown, path = '$.act'): Issue[] {
  if (!plain(act) || !keysAre(act, ['verb', 'occurred_at', 'observation', 'basis', 'references', 'evidence'])) return [{ path, message: 'shape' }];
  const out: Issue[] = [], bad = (p: string, m: string) => out.push({ path: p, message: m });
  if (!['move', 'transform', 'transfer', 'assign', 'observe', 'value'].includes(act.verb)) bad(`${path}.verb`, 'verb');
  if (!instantValid(act.occurred_at)) bad(`${path}.occurred_at`, 'time');
  const o = act.observation;
  if (!plain(o) || !keysAre(o, ['source_id', 'sequence']) || !bounded(o.source_id, 200) || !Number.isSafeInteger(o.sequence) || o.sequence < 1) bad(`${path}.observation`, 'observation');
  if (!['asserted', 'measured', 'inferred'].includes(act.basis)) bad(`${path}.basis`, 'basis');
  out.push(...readRefs(act.references, `${path}.references`, 16));
  if (!Array.isArray(act.evidence) || act.evidence.length > 16) bad(`${path}.evidence`, 'count');
  else {
    const seen: string[] = [];
    act.evidence.forEach((e: unknown, i: number) => {
      const at = `${path}.evidence[${i}]`;
      if (!plain(e) || !keysAre(e, ['ref', 'document'])) return bad(at, 'shape');
      const hasRef = e.ref !== null, hasDoc = e.document !== null;
      if (hasRef === hasDoc) return bad(at, 'one of');
      if (hasRef) { const mine = readRef(e.ref, `${at}.ref`); out.push(...mine); if (mine.length) return; }
      else {
        const d = e.document;
        if (!plain(d) || !keysAre(d, ['digest', 'media_type', 'description'])) return bad(`${at}.document`, 'shape');
        if (typeof d.digest !== 'string' || !/^[0-9a-f]{64}$/.test(d.digest)) bad(`${at}.document.digest`, 'digest');
        if (typeof d.media_type !== 'string' || !/^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$/.test(d.media_type)) bad(`${at}.document.media_type`, 'media type');
        if (d.description !== null && !bounded(d.description, 200)) bad(`${at}.document.description`, 'description');
      }
      const key = readerCanonical(e); if (seen.includes(key)) bad(at, 'twice'); seen.push(key);
    });
  }
  return out;
}
/** A reference may not name its own writer as minter: the writer's own objects are spelled with minted_by null. */
export const readOwnership = (act: any, organizationId: string): boolean =>
  [...act.references, ...act.evidence.map((e: any) => e.ref).filter((r: any) => r !== null)].every((r: any) => r.minted_by !== organizationId);
