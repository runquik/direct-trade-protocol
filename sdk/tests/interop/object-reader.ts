// Deliberately separate implementation of dtp/object@1, written from spec/profiles/object/1.md and its fixtures.
// Do not import the SDK validator, canonicalizer or class list here. Same author: separately coded agreement.
import { readerCanonical, gtinValid } from './product-reader.ts';
import { classValid, readRefs } from './verb-datatypes-reader.ts';

export type Issue = { path: string; message: string };
const plain = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const keysAre = (v: Record<string, unknown>, keys: string[]) => { const k = Object.keys(v); return k.length === keys.length && keys.every(x => k.includes(x)); };
const bounded = (v: unknown, max: number) => typeof v === 'string' && v.length >= 1 && v.length <= max && v === v.trim() && !/[\x00-\x1f\x7f]/.test(v);
const REASONS = ['scrapped', 'lost', 'consumed', 'ended', 'other'];
/** The GS1 check digit for any length: from the right-most payload digit, weights 3, 1, 3, ... */
function gs1(value: string): boolean {
  let sum = 0;
  for (let i = value.length - 2, w = 3; i >= 0; i--, w = 4 - w) sum += Number(value[i]) * w;
  return (10 - (sum % 10)) % 10 === Number(value.at(-1));
}

export function readObject(body: unknown): Issue[] {
  const out: Issue[] = [], bad = (path: string, message: string) => out.push({ path, message });
  if (!plain(body) || !keysAre(body, ['class', 'label', 'identifiers', 'status', 'retired', 'evidence'])) return [{ path: '$', message: 'exact fields' }];
  const b = body;
  if (!classValid(b.class)) bad('$.class', 'class');
  if (b.label !== null && !bounded(b.label, 200)) bad('$.label', 'label');
  if (!Array.isArray(b.identifiers) || b.identifiers.length > 16) bad('$.identifiers', 'count');
  else {
    const seen: string[] = [];
    b.identifiers.forEach((id: any, i: number) => {
      const at = `$.identifiers[${i}]`;
      if (!plain(id) || !keysAre(id, ['scheme', 'value'])) return bad(at, 'shape');
      if (typeof id.scheme !== 'string' || id.scheme.length > 64 || !/^[a-z][a-z0-9]*(\.[a-z0-9]+)*$/.test(id.scheme)) bad(`${at}.scheme`, 'scheme');
      if (!bounded(id.value, 128)) bad(`${at}.value`, 'value');
      const key = readerCanonical([id.scheme, id.value]); if (seen.includes(key)) bad(at, 'twice'); seen.push(key);
      if (id.scheme === 'gs1.sscc' && !(typeof id.value === 'string' && /^\d{18}$/.test(id.value) && gs1(id.value))) bad(`${at}.value`, 'sscc');
      if (id.scheme === 'gs1.gtin' && !gtinValid(id.value)) bad(`${at}.value`, 'gtin');
      if (id.scheme === 'gs1.gln' && !(typeof id.value === 'string' && id.value.length === 13 && gtinValid(id.value))) bad(`${at}.value`, 'gln');
    });
  }
  if (b.status === 'active') { if (b.retired !== null) bad('$.retired', 'active carries no retirement'); }
  else if (b.status === 'retired') {
    const r = b.retired;
    if (!plain(r) || !keysAre(r, ['reason', 'note'])) bad('$.retired', 'retirement');
    else {
      if (!REASONS.includes(r.reason)) bad('$.retired.reason', 'reason');
      if (r.note !== null && !bounded(r.note, 500)) bad('$.retired.note', 'note');
      else if (r.reason === 'other' && r.note === null) bad('$.retired.note', 'other needs a note');
    }
  } else bad('$.status', 'status');
  out.push(...readRefs(b.evidence, '$.evidence', 16));
  return out;
}
export const readObjectGenesis = (body: any): Issue[] => body.status === 'active' ? [] : [{ path: '$.status', message: 'born active' }];
export function readObjectContinuity(previous: any, next: any): Issue[] {
  const out: Issue[] = [];
  if (previous.class !== next.class) out.push({ path: '$.class', message: 'immutable' });
  const now = next.identifiers.map((id: any) => readerCanonical([id.scheme, id.value]));
  if (!previous.identifiers.every((id: any) => now.includes(readerCanonical([id.scheme, id.value])))) out.push({ path: '$.identifiers', message: 'removed' });
  if (previous.status === 'retired') {
    if (next.status !== 'active') out.push({ path: '$.status', message: 'only found' });
    else {
      if (next.label !== previous.label) out.push({ path: '$.label', message: 'renamed' });
      const had = previous.evidence.map((r: any) => readerCanonical(r));
      if (next.evidence.every((r: any) => had.includes(readerCanonical(r)))) out.push({ path: '$.evidence', message: 'no new evidence' });
    }
  }
  return out;
}
