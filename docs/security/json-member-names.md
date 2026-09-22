# JSON member names and the parser fault

## The rule

In any JSON that this protocol signs or admits, an object member name must not contain a quotation mark, a reverse solidus or a control character. Put the other way round: **a member name is never written with an escape sequence.** A receiver enforces this on the raw text before it parses, and refuses the whole message otherwise. Member values are not restricted.

The reference implementation is `sdk/src/safe-json.ts`: `parseUntrustedJson`, `parseUntrustedJsonBytes` and `parseUntrustedResponse` for receivers, `assertSafeMemberNames` for producers. Conformance vectors are in `spec/vectors/unsafe-json.json`.

## Why

Several widely deployed JavaScript engines misread member names. Within one isolate, once any JSON containing a member named with a single reverse solidus has been parsed, a later **single-character member name written with an escape sequence** is returned as a reverse solidus instead. The escaped newline, tab, quotation mark and solidus are affected, as are control characters and even an ordinary letter written as a Unicode escape. Values are not affected, names of two or more characters are not affected, and names written without an escape are not affected.

Three properties make this a protocol concern rather than a curiosity.

1. **Isolates are shared.** A server handles many requests in one isolate, so one sender's message changes how the next sender's message is read. The same is true of a browser tab and of an edge worker.
2. **A failed parse still poisons.** Text that makes the parser throw, for example the polluting member followed by garbage, leaves the engine poisoned. A host cannot parse first and validate afterwards, even if it rejects the message.
3. **It is silent.** Nothing throws. Two hosts can read the same signed bytes differently, so one admits a record that the other refuses.

Observed on Node.js 24.20.0 and 25.4.0, on Chrome 152, and on Cloudflare's workerd runtime. Node.js 22.23.2 is not affected, which is why `.node-version` pins it. The pin protects this repository's own test runs; it cannot protect an implementer's server, a browser client or an edge runtime. The rule above can, because it does not depend on the engine: text that could trigger the fault never reaches the parser.

Reproduction is sensitive to how an engine happens to hold the text in memory. Identical logic faulted on every run in one launch mode and on none in another, so a quick check that reports "not affected" proves little. `sdk/tests/15_safe_json.test.ts` uses a mode observed to fault reliably, reports whether the current runtime is affected, and shows that a host which parses only through the guard stays clean on an affected engine. `npm run check:runtime` remains the minimal engine reproducer.

## Why the rule costs nothing

A name containing a quotation mark, a reverse solidus or a control character can only be written with an escape sequence, so one test on the raw text, "no reverse solidus inside a member name", forbids exactly those names and also forbids needless escapes such as a letter written as a Unicode escape. No schema in this repository uses such a name. Canonical JSON (RFC 8785) escapes nothing else in a string, so under this rule canonical output never escapes a name at all.

`canonicalize` itself remains a faithful RFC 8785 implementation and still serialises such names, because the published canonicalization vectors include them. The restriction applies where data is signed and where it is received.

## For implementers in other languages

The fault described is specific to one family of engines, but the rule is part of the protocol, so every receiver enforces it. A scan needs no parser: walk the text, track whether the innermost open container is an object and whether a name is expected (after an opening brace, or after a comma inside an object), and reject if a reverse solidus appears inside a string in name position. It only has to agree with a conforming parser on the valid prefix of the text, because a parser stops at the first syntax error and reads no names beyond it.

## Deployment note

The two reference stores under `supabase/functions/` import the guard. Hosted copies built before this change do not have it until they are redeployed.
