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
//
// The same pass refuses an object that names a member twice (I-JSON, RFC 7493 section 2.3).
// Parsers disagree about such an object: JSON.parse keeps the last value, others keep the first
// or fail. A signature is checked over the canonical form of what this side parsed, so a text
// with a duplicate name could verify here and mean something else to the next reader. Because
// names carry no escapes, two names are the same exactly when their raw text is the same.
//
// On request (`integerNumbers`), the same pass also refuses a number written with a fraction or
// an exponent. v0.4 JSON carries integers only, and parsers disagree about `1.0`, `1e0` and
// `1.0000000000000001`: an exact-decimal parser reads a non-integer where binary64 reads 1. The
// rule is therefore lexical: an integer is an optional minus sign and digits, nothing else (#97).

export type UnsafeJsonCode = "unsafe_member_name" | "duplicate_member_name" | "non_integer_number";

/** `integerNumbers`: also refuse any number written with a fraction or an exponent (code `non_integer_number`). */
export interface SafeJsonOptions { integerNumbers?: boolean }

export class UnsafeJsonError extends Error {
  readonly code: UnsafeJsonCode;
  readonly offset: number;
  constructor(message: string, offset: number, code: UnsafeJsonCode = "unsafe_member_name") {
    super(message);
    this.name = "UnsafeJsonError";
    this.offset = offset;
    this.code = code;
  }
}

const QUOTE = 0x22, REVERSE_SOLIDUS = 0x5c, COMMA = 0x2c, COLON = 0x3a;
const OPEN_OBJECT = 0x7b, CLOSE_OBJECT = 0x7d, OPEN_ARRAY = 0x5b, CLOSE_ARRAY = 0x5d;
const MINUS = 0x2d, PLUS = 0x2b, FULL_STOP = 0x2e, SMALL_E = 0x65, CAPITAL_E = 0x45, DIGIT_0 = 0x30, DIGIT_9 = 0x39;

/**
 * Throws UnsafeJsonError if any object member name in `text` is written with an escape
 * sequence (code `unsafe_member_name`), or if an object names the same member twice (code
 * `duplicate_member_name`). Linear time, no recursion, does not parse. It is deliberately not a JSON validator:
 * JSON.parse still runs afterwards and rejects malformed text. It only has to agree with a
 * conforming parser about which strings are member names in the valid prefix of the text,
 * because a parser stops at the first syntax error and never reads a name beyond it.
 * With `integerNumbers`, it also refuses a number written with a fraction or an exponent.
 */
export function assertSafeJsonText(text: string, options: SafeJsonOptions = {}): void {
  const objectContext: boolean[] = [];
  const names: (Set<string> | null)[] = []; // the names seen so far in each open object; null for an array
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
      if (isName) {
        const seen = names[names.length - 1], name = text.slice(i + 1, j);
        if (seen) {
          if (seen.has(name)) throw new UnsafeJsonError(`an object names the member ${JSON.stringify(name)} twice`, i, "duplicate_member_name");
          seen.add(name);
        }
      }
      i = j;
      expectName = false;
    } else if (c === OPEN_OBJECT) { objectContext.push(true); names.push(new Set()); expectName = true; }
    else if (c === OPEN_ARRAY) { objectContext.push(false); names.push(null); expectName = false; }
    else if (c === CLOSE_OBJECT || c === CLOSE_ARRAY) { objectContext.pop(); names.pop(); expectName = false; }
    else if (c === COMMA) expectName = objectContext.length > 0 && objectContext[objectContext.length - 1];
    else if (c === COLON) expectName = false;
    else if (options.integerNumbers && (c === MINUS || (c >= DIGIT_0 && c <= DIGIT_9))) {
      // A number token; outside strings, only numbers contain these characters.
      let j = i + 1;
      for (; j < text.length; j++) {
        const d = text.charCodeAt(j);
        if (d === FULL_STOP || d === SMALL_E || d === CAPITAL_E) throw new UnsafeJsonError("numbers must be written as integers, without a fraction or an exponent", i, "non_integer_number");
        if (!(d === PLUS || d === MINUS || (d >= DIGIT_0 && d <= DIGIT_9))) break;
      }
      i = j - 1;
    }
  }
}

/** Parse JSON text from an untrusted source. Use this instead of JSON.parse at every boundary. */
export function parseUntrustedJson(text: string, options: SafeJsonOptions = {}): unknown {
  if (typeof text !== "string") throw new TypeError("JSON text must be a string");
  assertSafeJsonText(text, options);
  return JSON.parse(text);
}

/** As parseUntrustedJson, for bytes. Invalid UTF-8 is rejected rather than replaced. */
export function parseUntrustedJsonBytes(bytes: Uint8Array, options: SafeJsonOptions = {}): unknown {
  return parseUntrustedJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes), options);
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
