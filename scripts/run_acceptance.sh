#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS="$ROOT/contracts"
REPORT="$ROOT/docs/V1_ACCEPTANCE_REPORT.md"
TS="$(date -u +"%Y-%m-%d %H:%M:%SZ")"

pass() { echo "- ✅ $1" | tee -a "$REPORT"; }
fail() { echo "- ❌ $1" | tee -a "$REPORT"; exit 1; }

cat > "$REPORT" <<EOF
# DTP v1 Acceptance Report

Generated: $TS (UTC)

## Results
EOF

if [ ! -f "$ROOT/docs/PARITY_AUDIT_2026-03-07.md" ]; then
  fail "Parity audit file missing"
else
  pass "Parity audit file present"
fi

if ! docker --version >/dev/null 2>&1; then
  fail "Docker unavailable"
else
  pass "Docker available"
fi

set +e
docker run --rm -v "$CONTRACTS":/work -w /work rust:latest sh -lc 'export PATH=/usr/local/cargo/bin:$PATH; rustup target add wasm32-unknown-unknown >/dev/null; cargo check --target wasm32-unknown-unknown' >> "$REPORT" 2>&1
rc=$?
set -e
if [ $rc -ne 0 ]; then
  fail "cargo check wasm32 failed"
else
  pass "cargo check wasm32 passed"
fi

set +e
docker run --rm -v "$CONTRACTS":/work -w /work rust:latest sh -lc 'export PATH=/usr/local/cargo/bin:$PATH; cargo test -q' >> "$REPORT" 2>&1
rc=$?
set -e
if [ $rc -ne 0 ]; then
  fail "cargo test failed"
else
  pass "cargo test passed"
fi

pass "Acceptance run complete"

echo "Report written: $REPORT"
