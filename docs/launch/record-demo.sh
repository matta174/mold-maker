#!/usr/bin/env bash
# record-demo.sh — turn a screen recording into a README-ready demo GIF.
#
# Pipeline: raw recording (.mov/.mp4/.webm) → downscaled GIF with a shared
# palette so colors don't dither into mud. Default target is 720px wide at
# 15fps, which lands most 20-second captures well under GitHub's 10MB
# embed limit.
#
# Usage:
#   docs/launch/record-demo.sh input.mov [output.gif]
#   docs/launch/record-demo.sh input.mov output.gif --width 900 --fps 20
#   docs/launch/record-demo.sh input.mov --mp4          # produce an mp4 instead
#
# Why a two-pass palette:
#   A single-pass ffmpeg → gif runs the default 256-color palette generator
#   per frame, which causes flickering and awful banding on the Manifold
#   heatmap greens. The palettegen → paletteuse pipeline computes one
#   shared palette from the whole clip, then remaps frames against it.
#   Result: ~30% smaller file AND cleaner color.
#
# Recording tips (not enforced, just context):
#   - macOS: Cmd+Shift+5 → Record Selected Portion. Disable mouse clicks
#     overlay (it creates visual noise that the palette wastes bits on).
#   - Trim tight. Load sample → heatmap → generate → export. 15-25s max.
#     Viewers tab away after 30s no matter how interesting your demo is.
#   - Use the dark theme (#1a1a2e default) — the GIF palette has way more
#     headroom for UI contrast against a dark background.

set -euo pipefail

INPUT=""
OUTPUT=""
WIDTH=720
FPS=15
MP4_MODE=0

# --- arg parsing ---------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    --width)
      WIDTH="$2"
      shift 2
      ;;
    --fps)
      FPS="$2"
      shift 2
      ;;
    --mp4)
      MP4_MODE=1
      shift
      ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      if [[ -z "$INPUT" ]]; then
        INPUT="$1"
      elif [[ -z "$OUTPUT" ]]; then
        OUTPUT="$1"
      else
        echo "Unexpected argument: $1" >&2
        exit 1
      fi
      shift
      ;;
  esac
done

if [[ -z "$INPUT" ]]; then
  echo "Usage: $0 input.mov [output.gif] [--width N] [--fps N] [--mp4]" >&2
  exit 1
fi

if [[ ! -f "$INPUT" ]]; then
  echo "Input file not found: $INPUT" >&2
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required. Install via:" >&2
  echo "  macOS:   brew install ffmpeg" >&2
  echo "  Ubuntu:  sudo apt install ffmpeg" >&2
  echo "  Windows: https://ffmpeg.org/download.html" >&2
  exit 1
fi

# --- default output name -------------------------------------------------

if [[ -z "$OUTPUT" ]]; then
  BASE="${INPUT%.*}"
  if [[ "$MP4_MODE" -eq 1 ]]; then
    OUTPUT="${BASE}-demo.mp4"
  else
    OUTPUT="${BASE}-demo.gif"
  fi
fi

# --- mp4 branch (GitHub now plays these inline in READMEs) ---------------
# Kept as an option because an h264 mp4 is almost always 3-5x smaller than
# the equivalent gif for the same visual quality — and GitHub renders
# <video> tags in READMEs since 2021.

if [[ "$MP4_MODE" -eq 1 ]]; then
  echo "Encoding mp4: $INPUT → $OUTPUT (width=${WIDTH}, fps=${FPS})"
  ffmpeg -y -i "$INPUT" \
    -vf "fps=${FPS},scale=${WIDTH}:-2:flags=lanczos" \
    -c:v libx264 -crf 23 -preset slow -movflags +faststart \
    -an \
    "$OUTPUT"
else
  # --- gif branch (two-pass palette) ------------------------------------
  PALETTE="$(mktemp -t demo-palette-XXXXXX).png"
  trap 'rm -f "$PALETTE"' EXIT

  echo "Pass 1/2: generating shared palette"
  ffmpeg -y -i "$INPUT" \
    -vf "fps=${FPS},scale=${WIDTH}:-1:flags=lanczos,palettegen=stats_mode=diff" \
    "$PALETTE"

  echo "Pass 2/2: encoding gif with palette"
  ffmpeg -y -i "$INPUT" -i "$PALETTE" \
    -lavfi "fps=${FPS},scale=${WIDTH}:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
    -loop 0 \
    "$OUTPUT"
fi

# --- size check ---------------------------------------------------------
# GitHub caps inline image assets at 10MB but mobile users on flaky
# connections will thank you for staying under 5MB. At 8MB+ you've
# probably recorded too much; trim the input and re-run.

BYTES=$(wc -c < "$OUTPUT")
MB=$(awk "BEGIN { printf \"%.2f\", $BYTES / 1024 / 1024 }")
echo ""
echo "Wrote: $OUTPUT ($MB MB)"

if (( BYTES > 10 * 1024 * 1024 )); then
  echo "WARNING: $OUTPUT is over 10MB — GitHub will refuse to embed it." >&2
  echo "  Try --width 600 or trim the input to <15 seconds." >&2
  exit 2
elif (( BYTES > 5 * 1024 * 1024 )); then
  echo "Note: $OUTPUT is over 5MB. Works on GitHub but slow on mobile."
  echo "  If you want it smaller, re-run with --width 600 or --fps 12."
fi
