#!/usr/bin/env bash
# Usage: sign.sh [--mode anyone] INPUT OUTPUT -- signs a shortcut for anyone (macOS); other modes are refused.
set -euo pipefail

usage() {
  echo 'Usage: sign.sh [--mode anyone] INPUT.shortcut OUTPUT.shortcut' >&2
  echo "Signs with 'shortcuts sign --mode anyone'; then run inspect_signed.py before publishing the output." >&2
}

MODE=anyone
ARGS=()
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    -h|--help|help) usage; exit 0 ;;
    -m|--mode)
      [[ "$#" -ge 2 ]] || { usage; exit 2; }
      MODE="$2"; shift 2 ;;
    --mode=*) MODE="${1#--mode=}"; shift ;;
    -*) echo "Unknown option: $1" >&2; usage; exit 2 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done

if [[ "$MODE" != anyone ]]; then
  echo "Refused mode: $MODE (only 'anyone'; other modes embed the signer's Apple ID)" >&2
  exit 2
fi
if [[ "${#ARGS[@]}" -ne 2 ]]; then
  usage
  exit 2
fi
INPUT="${ARGS[0]}"
OUTPUT="${ARGS[1]}"
[[ -f "$INPUT" ]] || { echo "Input not found: $INPUT" >&2; exit 2; }
[[ "$INPUT" -ef "$OUTPUT" ]] && { echo 'Output must differ from input' >&2; exit 2; }
command -v shortcuts >/dev/null || { echo 'shortcuts CLI not found (macOS only)' >&2; exit 1; }

OUT_DIR="$(cd "$(dirname "$OUTPUT")" && pwd)"
TMP="$(mktemp "$OUT_DIR/.sign.XXXXXX")"
trap 'rm -f "$TMP" "$TMP.shortcut"' EXIT
# Sign to a temporary name beside the target, so a failed run leaves no partial output.
shortcuts sign --mode anyone --input "$INPUT" --output "$TMP.shortcut"
mv -f "$TMP.shortcut" "$OUTPUT"
echo "Signed (anyone): $OUTPUT"
