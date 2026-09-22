// Guarded JSON parsing for untrusted input. No platform imports; runs on any runtime.
//
// Why this exists. Several widely deployed JavaScript engines misread object member names:
// once a member named with a single reverse solidus has been parsed anywhere in the same
// isolate, a later single-character member name written with an escape sequence is returned
// as a reverse solidus instead. A server isolate is shared between requests, so one sender can
// change how another sender's signed bytes are read, and two hosts can disagree about the same
// record. The fault is in the engine's parser, so nothing done after JSON.parse can be trusted
// to notice it. See docs/security/json-member-names.md.
//
// The defence is a rule that does not depend on the engine, applied to the raw text BEFORE it
// is parsed: a member name must not be written with an escape sequence. A name containing a
// quotation mark, a reverse solidus or a control character can only be written with one, so
// this single check also forbids those characters in names, and it means a canonical
// serialisation (RFC 8785) never needs to escape a name. Member VALUES are unaffected by the
// fault and may use any escape.

export class UnsafeJsonError extends Error {
  readonly code = "unsafe_member_name";
  readonly offset: number;
  constructor(message: string, offset: number) {
    super(message);
    this.name = "UnsafeJsonError";
    this.offset = offset;
  }
}

const QUOTE = 0x22, REVERSE_SOLIDUS = 0x5c, COMMA = 0x2c, COLON = 0x3a;
const OPEN_OBJECT = 0x7b, CLOSE_OBJECT = 0x7d, OPEN_ARRAY = 0x5b, CLOSE_ARRAY = 0x5d;

/**
 * Throws UnsafeJsonError if any object member name in `text` is written with an escape
 * sequence. Linear time, no recursion, does not parse. It is deliberately not a JSON validator:
 * JSON.parse still runs afterwards and rejects malformed text. It only has to agree with a
 * conforming parser about which strings are member names in the valid prefix of the text,
 * because a parser stops at the first syntax error and never reads a name beyond it.
 */
export function assertSafeJsonText(text: string): void {
  const objectContext: boolean[] = [];
  let expectName = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === QUOTE) {
      const isName = expectName;
      let j = i + 1;
      for (; j < text.length; j++) {
        const d = text.charCodeAt(j);
        if (d === REVERSE_SOLIDUS) {
          if (isName) throw new UnsafeJsonError("object member names must not use escape sequences", j);
          j++; // the escaped character, which may itself be a quotation mark
        } else if (d === QUOTE) break;
      }
      i = j;
      expectName = false;
    } else if (c === OPEN_OBJECT) { objectContext.push(true); expectName = true; }
    else if (c === OPEN_ARRAY) { objectContext.push(false); expectName = false; }
    else if (c === CLOSE_OBJECT || c === CLOSE_ARRAY) { objectContext.pop(); expectName = false; }
    else if (c === COMMA) expectName = objectContext.length > 0 && objectContext[objectContext.length - 1];
    else if (c === COLON) expectName = false;
  }
}

/** Parse JSON text from an untrusted source. Use this instead of JSON.parse at every boundary. */
export function parseUntrustedJson(text: string): unknown {
  if (typeof text !== "string") throw new TypeError("JSON text must be a string");
  assertSafeJsonText(text);
  return JSON.parse(text);
}

/** As parseUntrustedJson, for bytes. Invalid UTF-8 is rejected rather than replaced. */
export function parseUntrustedJsonBytes(bytes: Uint8Array): unknown {
  return parseUntrustedJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

/** Read and parse a fetch Response body without handing the text to the engine unguarded. */
export async function parseUntrustedResponse(response: { text(): Promise<string> }): Promise<unknown> {
  return parseUntrustedJson(await response.text());
}

/**
 * Producer-side counterpart: throws if any member name in an in-memory value could only be
 * serialised with an escape sequence, so a conforming receiver would refuse it. Call before
 * signing, so an author learns immediately rather than from a rejection.
 */
export function assertSafeMemberNames(value: unknown): void {
  const pending: unknown[] = [value];
  const seen = new Set<object>();
  while (pending.length) {
    const current = pending.pop();
    if (current === null || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) { for (const item of current) pending.push(item); continue; }
    for (const name of Object.keys(current)) {
      for (let i = 0; i < name.length; i++) {
        const c = name.charCodeAt(i);
        if (c === QUOTE || c === REVERSE_SOLIDUS || c < 0x20) {
          throw new UnsafeJsonError(`member name ${JSON.stringify(name)} contains a character that requires an escape sequence`, i);
        }
      }
      pending.push((current as Record<string, unknown>)[name]);
    }
  }
}
