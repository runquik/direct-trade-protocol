// What a length bound counts (#215): Unicode code points, as JSON Schema 2020-12 `maxLength` counts them and as the
// command schemas are checked. A character outside the Basic Multilingual Plane is one, not its two UTF-16 code units.
// A lone surrogate counts as one, as it does for a JSON Schema validator.
export function codePoints(value: string): number {
  let n = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < value.length) { const d = value.charCodeAt(i + 1); if (d >= 0xdc00 && d <= 0xdfff) i++; }
    n++;
  }
  return n;
}
