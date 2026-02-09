#!/bin/bash
# Lightpanda Cloud Setup Helper
# Validates env vars and prints the CDP WebSocket URL to use.

set -e

usage() {
  cat <<'EOF'
Usage:
  bash install.sh [--print]

Behavior:
  - If LIGHTPANDA_CDP_URL (or CDP_WS_URL) is set, uses it as-is.
  - Otherwise, if LIGHTPANDA_TOKEN is set, builds a best-effort URL using:
      wss://$LIGHTPANDA_REGION.cloud.lightpanda.io/ws?token=$LIGHTPANDA_TOKEN

Notes:
  - The exact Lightpanda Cloud URL format can vary by offer/region. Prefer using
    the Cloud dashboard/docs and setting LIGHTPANDA_CDP_URL explicitly.
  - By default output is redacted. Use --print to output the full URL.
EOF
}

PRINT_FULL=0
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi
if [[ "${1:-}" == "--print" ]]; then
  PRINT_FULL=1
fi

echo "=== Lightpanda Cloud Setup ==="

endpoint_url="${LIGHTPANDA_CDP_URL:-${CDP_WS_URL:-}}"
if [[ -z "$endpoint_url" ]]; then
  token="${LIGHTPANDA_TOKEN:-}"
  if [[ -z "$token" ]]; then
    echo "ERROR: Missing LIGHTPANDA_CDP_URL (recommended), CDP_WS_URL, or LIGHTPANDA_TOKEN."
    echo ""
    echo "Set one of:"
    echo "  export LIGHTPANDA_CDP_URL='wss://...'"
    echo "  export CDP_WS_URL='wss://...'"
    echo "  export LIGHTPANDA_TOKEN='...'"
    echo "  export LIGHTPANDA_REGION='uswest'  # optional"
    exit 1
  fi

  region="${LIGHTPANDA_REGION:-uswest}"
  host="${LIGHTPANDA_CLOUD_HOST:-${region}.cloud.lightpanda.io}"
  endpoint_url="wss://${host}/ws?token=${token}"
fi

if [[ "$PRINT_FULL" -eq 1 ]]; then
  echo "$endpoint_url"
  exit 0
fi

redacted="$endpoint_url"
redacted="${redacted/token=*/token=***}"
echo "CDP URL (redacted): $redacted"
echo ""
echo "Tip: run with --print to output the full URL for your automation client."
