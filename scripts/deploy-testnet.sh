#!/usr/bin/env bash
#
# Deploy the DTP smart contract to NEAR testnet.
#
# Prerequisites:
#   - Rust with wasm32-unknown-unknown target
#   - near-cli-rs installed (cargo install near-cli-rs)
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
WASM_PATH="${PROJECT_DIR}/contracts/target/wasm32-unknown-unknown/release/dtp_contract.wasm"

export PATH="$HOME/.cargo/bin:$PATH"

echo "=== Building DTP contract ==="
cd "${PROJECT_DIR}/contracts"
cargo build --target wasm32-unknown-unknown --release
echo "  WASM: ${WASM_PATH}"
echo "  Size: $(wc -c < "${WASM_PATH}") bytes"

echo ""
echo "=== Deploying to ${CONTRACT_ACCOUNT} ==="
echo ""
echo "To complete deployment, run these near-cli commands manually:"
echo ""
echo "  # 1. Create contract sub-account (if it doesn't exist yet):"
echo "  near account create-account fund-myself ${CONTRACT_ACCOUNT} '10 NEAR' \\"
echo "    autogenerate-new-keypair save-to-keychain sign-as ${MASTER_ACCOUNT} \\"
echo "    network-config testnet sign-with-keychain send"
echo ""
echo "  # 2. Deploy the contract:"
echo "  near contract deploy ${CONTRACT_ACCOUNT} \\"
echo "    use-file ${WASM_PATH} \\"
echo "    with-init-call new json-args '{\"owner\":\"${MASTER_ACCOUNT}\"}' \\"
echo "    prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' \\"
echo "    network-config testnet sign-with-keychain send"
echo ""
echo "  # 3. Save contract ID to mcp-server .env:"
echo "  echo 'DTP_CONTRACT_ID=${CONTRACT_ACCOUNT}' >> ${PROJECT_DIR}/mcp-server/.env"
echo ""
echo "=== Done ==="
