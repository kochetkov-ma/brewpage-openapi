#!/usr/bin/env bash
# Smoke-test the brewpage-mcp image in remote HTTP mode (requests run inside the container, peer 127.0.0.1): smoke-image.sh <image> <version>
set -euo pipefail
IMAGE="$1"
VERSION="$2"
NAME="brewpage-mcp-smoke-$$"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$NAME" -e BREWPAGE_TRUSTED_PROXY_CIDRS=127.0.0.1/32 "$IMAGE" node dist/http.js >/dev/null
PROBE='
const base = "http://127.0.0.1:8787";
const version = process.argv[1];
for (let i = 0; ; i++) {
  try { if ((await fetch(base + "/healthz")).ok) break; } catch {}
  if (i >= 30) { console.error("healthz not ready"); process.exit(1); }
  await new Promise((r) => setTimeout(r, 1000));
}
const post = async (body) => {
  const res = await fetch(base + "/mcp", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream", "X-Forwarded-For": "203.0.113.7" }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
};
const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } });
if (init.status !== 200) { console.error("initialize HTTP " + init.status); process.exit(1); }
if (init.json.result.serverInfo.version !== version) { console.error("serverInfo.version " + init.json.result.serverInfo.version + " != " + version); process.exit(1); }
const list = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
if (list.status !== 200 || list.json.result.tools.length !== 20) { console.error("tools/list HTTP " + list.status + ", tools " + list.json.result?.tools?.length + ", expected 20"); process.exit(1); }
console.log("image smoke ok: serverInfo.version=" + version + " tools=20");
'
if ! docker exec "$NAME" node --input-type=module -e "$PROBE" "$VERSION"; then
  docker logs "$NAME" || true
  echo "::error::image smoke failed"
  exit 1
fi
