// Shared by the inventory@2 and flow@1 fixture tests (#144): do the published fixtures pin the observation window's
// width? For each fact whose expected outcome is new stock or stale_observation, this predicts the outcome a reducer
// with a window of `width` would reach (stale exactly when the sequence is unseen and <= mark - width) and counts the
// facts where it disagrees with the fixture. The fixtures pin the width when 64 disagrees nowhere and 63 and 65 somewhere.
type Outcome = { ok: true; duplicate: boolean } | { ok: false; code: string };
export function windowDisagreements(facts: { observation: { source_id: string; sequence: number }; expect: Outcome }[], width: number): number {
  const mark = new Map<string, number>(), seen = new Map<string, Set<number>>();
  let disagreements = 0;
  for (const { observation: { source_id, sequence }, expect } of facts) {
    const m = mark.get(source_id) ?? 0, kept = seen.get(source_id) ?? new Set<number>();
    const isNew = expect.ok && !expect.duplicate, isStale = !expect.ok && expect.code === 'stale_observation';
    if ((isNew || isStale) && !(sequence <= m && kept.has(sequence))) {
      if ((sequence <= m - width) !== isStale) disagreements++;
    }
    if (isNew) { kept.add(sequence); seen.set(source_id, kept); mark.set(source_id, Math.max(m, sequence)); }
  }
  return disagreements;
}
