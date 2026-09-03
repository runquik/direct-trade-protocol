# Sprint 01 Gap Log

Append-only during the sprint. Every time a module needs something the protocol (`SPEC.md` + `spec/schemas/`) does not define, add an entry here **before** working around it. Workarounds use `x_`-prefixed fields so they are auditable afterward.

Severity: `blocker` (could not proceed without the workaround) · `friction` (proceeded, but the spec should cover it) · `cosmetic` (naming, docs, ergonomics).

Format:

```
## GAP-NN: <one-line title>
- Found by: <module> while <doing what>
- What's missing: <field / object / semantic / permission / state>
- Workaround used: <x_-field or local hack>
- Proposed fix: <schema addition, spec clarification, or "needs design">
- Severity: blocker | friction | cosmetic
```

---

*(no entries yet)*
