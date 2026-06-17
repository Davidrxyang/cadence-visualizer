#!/usr/bin/env bash
# generate_frames.sh
# -------------------
# Runs export_frames.py once per experiment, producing the full set of
# frames files used by the visualizer. Each output is named
# {experiment}_japan_frames.jsonl.gz to match frames/ convention.

set -euo pipefail

DB="db/japan.db"
OUT_DIR="frames"

EXPERIMENTS=(
  "broadcast"
  "mirage"
  "ppbr"
  "randomwalk-v1"
  "randomwalk-v1-random"
)

for exp in "${EXPERIMENTS[@]}"; do
  out="${OUT_DIR}/${exp}_japan_frames.jsonl.gz"
  echo "=== Generating ${out} (experiment LIKE '%${exp}%') ==="
  python export_frames.py --db "$DB" --out "$out" --experiment "$exp"
  echo
done

echo "All frames generated."
