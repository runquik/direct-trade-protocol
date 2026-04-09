#!/usr/bin/env bash
#
# Deploy the DTP smart contract to NEAR testnet.
#
# Prerequisites:
#   - Rust with wasm32-unknown-unknown target
#   - near-cli (npm install -g near-cli@4)
#   - wasm-opt (npm install -g binaryen)
#   - A funded NEAR testnet master account
#
# Usage:
#   ./scripts/deploy-testnet.sh <master-account>
#
# Example:
#   ./scripts/deploy-testnet.sh direct-trade-protocol.testnet

set -euo pipefail

MASTER_ACCOUNT="${1:?Usage: deploy-testnet.sh <master-account>}"
CONTRACT_ACCOUNT="dtp.${MASTER_ACCOUNT}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
WASM_RAW="${PROJECT_DIR}/contracts/target/wasm32-unknown-unknown/release/dtp_contract.wasm"
WASM_OPT="${PROJECT_DIR}/contracts/target/wasm32-unknown-unknown/release/dtp_contract_optimized.wasm"

export PATH="$HOME/.cargo/bin:$PATH"
export NEAR_ENV=testnet

echo "=== Building DTP contract ==="
cd "${PROJECT_DIR}/contracts"
cargo build --target wasm32-unknown-unknown --release
echo "  Raw WASM: $(wc -c < "${WASM_RAW}") bytes"

echo ""
echo "=== Applying wasm-opt signext-lowering ==="
echo "  (Required: NEAR VM does not support sign-extension opcodes from modern Rust)"
wasm-opt --signext-lowering -o "${WASM_OPT}" "${WASM_RAW}"
echo "  Optimized WASM: $(wc -c < "${WASM_OPT}") bytes"

echo ""
echo "=== Deploying to ${CONTRACT_ACCOUNT} ==="
echo ""
echo "Run these commands to deploy:"
echo ""
echo "  # 1. Create contract sub-account (if it doesn't exist yet):"
echo "  near create-account ${CONTRACT_ACCOUNT} --masterAccount ${MASTER_ACCOUNT} --initialBalance 10"
echo ""
echo "  # 2. Fund the contract account (needs ~3 NEAR for storage):"
echo "  near send ${MASTER_ACCOUNT} ${CONTRACT_ACCOUNT} 4"
echo ""
echo "  # 3. Deploy and initialize the contract:"
echo "  near deploy ${CONTRACT_ACCOUNT} ${WASM_OPT} --initFunction new --initArgs '{\"owner\":\"${MASTER_ACCOUNT}\"}' --initGas 300000000000000 --force"
echo ""
echo "  # 4. Verify deployment:"
echo "  near view ${CONTRACT_ACCOUNT} get_party '{\"account\":\"${MASTER_ACCOUNT}\"}'"
echo ""
echo "=== Done ==="
