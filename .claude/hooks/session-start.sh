#!/bin/bash
# Cloud sessions only: put the Node version pinned in .node-version first on PATH.
# The cloud image ships a nearby Node 22 release; some suites here refuse anything but the pin.
# Idempotent: the build is downloaded once per container, checked against nodejs.org's
# published SHA-256, and unpacked under /opt/node-v<version>.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

want="$(tr -d '[:space:]' < "$CLAUDE_PROJECT_DIR/.node-version")"
want="${want#v}"
if [ "$(node --version 2>/dev/null || true)" = "v$want" ]; then
  exit 0
fi

dir="/opt/node-v$want"
if [ ! -x "$dir/bin/node" ]; then
  name="node-v$want-linux-x64"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL -o "$tmp/$name.tar.xz" "https://nodejs.org/dist/v$want/$name.tar.xz"
  curl -fsSL "https://nodejs.org/dist/v$want/SHASUMS256.txt" | grep " $name.tar.xz\$" > "$tmp/SHASUMS256.txt"
  (cd "$tmp" && sha256sum -c --quiet SHASUMS256.txt)
  tar -xJf "$tmp/$name.tar.xz" -C "$tmp"
  rm -rf "$dir"
  mv "$tmp/$name" "$dir"
fi

echo "export PATH=\"$dir/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
