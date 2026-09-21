# Contributing

Direct Trade Protocol is an open protocol. Anyone may implement it, host it, build modules
and workspaces on it, or propose changes to it.

## Licence of contributions

The project is licensed under the [Apache License, Version 2.0](LICENSE). Under section 5 of
that licence, anything you intentionally submit for inclusion is contributed under the same
terms, including its patent grant. There is no separate contributor agreement.

Sign off every commit to certify that you have the right to submit it, as described by the
[Developer Certificate of Origin](https://developercertificate.org/):

```
git commit -s
```

Do not contribute material you cannot license this way: code copied from projects under
incompatible terms, text reproduced from paid standards, or anything belonging to an employer
who has not agreed.

## What belongs here

The protocol, its schemas and test vectors, the reference SDK, and small reference modules
that prove interoperability. Reference code must stay vendor-neutral: it names no commercial
product, depends on no particular host, and runs without any proprietary service.

Products built on the protocol, including their user interfaces, hosting and business logic,
belong in their own repositories under whatever terms their authors choose.

## Making a change

1. Use the runtime in `.node-version`. From `sdk/`, run `npm ci`.
2. Behaviour changes need tests. The specification, the schemas and the reference kernel must
   agree; a discrepancy between them is a defect, not a documentation issue.
3. Run `npm test`, `npm run test:dtp-v04`, `npm run test:foundation` and `npm run typecheck`.
4. Regenerate derived files with `npm run build`. Continuous integration fails if a generated
   artifact differs from its source.
5. Anything that changes wire formats, signing, canonicalization or authority rules needs new
   or updated conformance vectors, and a note on compatibility.

Nothing here is released yet. Status, open gates and known limits are in `README.md` and
`docs/foundation/README.md`; please read them before relying on a layer.
