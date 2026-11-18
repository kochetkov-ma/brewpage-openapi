#!/usr/bin/env bash
set -euo pipefail
if [[ "$#" != 3 || ! "$2" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ || ( "$3" != legacy && "$3" != compact ) ]]; then
  echo 'Usage: smoke-image.sh IMAGE VERSION legacy|compact' >&2
  exit 2
fi
IMAGE="$1"
VERSION="$2"
CATALOG="$3"
NAME="brewpage-mcp-smoke-$$"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$NAME" -e "BREWPAGE_MCP_CATALOG=$CATALOG" \
  -e BREWPAGE_TRUSTED_PROXY_CIDRS=127.0.0.1/32 "$IMAGE" node dist/http.js >/dev/null
if ! docker exec -i "$NAME" node --input-type=module - "$VERSION" "$CATALOG" < "$(dirname "$0")/smoke-http.mjs"; then
  docker logs "$NAME" || true
  echo "::error::image smoke failed for $CATALOG"
  exit 1
fi
