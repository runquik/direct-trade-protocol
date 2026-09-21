# Source-bound test loop

Run the declared test check with pinned Node22.23.2:

```powershell
node sdk/scripts/foundation-run.ts C:/Users/runqu/dev/direct-trade-protocol F1-helper-tests root
node sdk/scripts/foundation-gates.ts
```

The first command records a pending attempt before execution, then a source-bound pass or failure with captured output, exact arguments, runtime and artifact digest. A missing test, changed source, skip, TODO, cancellation, failed exit or interrupted attempt does not qualify. Concurrent runs lock the evidence writer; a stale lock must be inspected, never blindly deleted. Test children receive a small OS environment allowlist, not inherited database/deployment secrets or Node loader hooks. The command is not a security sandbox: reviewed test source still has the local process's filesystem/network permissions.

Checks named `helper-tests` and `graph-tests` describe bounded implementation slices. Each package still separately requires its full `${gate}-tests` and independent `${gate}-review`; the external-builder check also remains mandatory. A helper pass is not package or release acceptance. The runner does not author reviews or impersonate an external builder.

The graph must list the entire transitive source/test/configuration boundary. Source changes invalidate dependent observations. Artifact edits invalidate their own observations. Reviewer identity and findings are reviewed repository evidence, not cryptographically authenticated attestations; the manifest cannot protect against a malicious maintainer rewriting the entire repository.
