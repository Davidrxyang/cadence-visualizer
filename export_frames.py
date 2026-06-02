#!/usr/bin/env python3
"""
export_frames.py
----------------
Reads a SQLite database of node location events and exports a compact
.jsonl.gz file suitable for use in the movement visualizer.

Usage:
    python export_frames.py --db path/to/your.db --out frames.jsonl.gz

    # Optional overrides:
    python export_frames.py --db my.db --out frames.jsonl.gz \
        --table events \
        --col-time time \
        --col-node node \
        --col-x x \
        --col-y y \
        --bucket 30
"""

import argparse
import gzip
import json
import sqlite3
from collections import defaultdict


def export(
    db_path: str,
    out_path: str,
    table: str = "events",
    col_time: str = "time",
    col_node: str = "node",
    col_x: str = "x",
    col_y: str = "y",
    bucket_seconds: int = 30,
):
    print(f"Connecting to {db_path} ...")
    con = sqlite3.connect(db_path)
    cur = con.cursor()

    # --- count rows for progress reporting ---
    cur.execute(f"SELECT COUNT(*) FROM {table}")
    total_rows = cur.fetchone()[0]
    print(f"Total rows: {total_rows:,}")

    # --- stream all rows ordered by time ---
    print("Reading rows ...")
    cur.execute(
        f"SELECT {col_time}, {col_node}, {col_x}, {col_y} FROM {table} ORDER BY {col_time}"
    )

    # bucket -> { node_id -> (x, y) }  (last-write-wins within bucket)
    buckets: dict[int, dict[int, tuple[int, int]]] = defaultdict(dict)

    processed = 0
    for row in cur:
        t, node_id, x, y = row
        bucket = (int(t) // bucket_seconds) * bucket_seconds
        buckets[bucket][int(node_id)] = (int(x), int(y))
        processed += 1
        if processed % 500_000 == 0:
            print(f"  ... {processed:,} / {total_rows:,} rows processed")

    print(f"Done reading. {len(buckets):,} time buckets generated.")

    # --- compute coordinate bounds for the artifact ---
    all_x = [x for nodes in buckets.values() for x, _ in nodes.values()]
    all_y = [y for nodes in buckets.values() for _, y in nodes.values()]
    bounds = {
        "x_min": min(all_x), "x_max": max(all_x),
        "y_min": min(all_y), "y_max": max(all_y),
        "t_min": min(buckets.keys()),
        "t_max": max(buckets.keys()),
        "bucket": bucket_seconds,
        "node_count": max(
            nid for nodes in buckets.values() for nid in nodes.keys()
        ) + 1,
    }

    # --- encounters (optional table) ---
    encounters = []
    try:
        cur.execute("SELECT time, node1, node2, x, y, duration FROM encounters ORDER BY time")
        for row in cur:
            t, n1, n2, x, y, dur = row
            encounters.append({
                "__enc__": True,
                "t": int(t), "n1": int(n1), "n2": int(n2),
                "x": int(x), "y": int(y), "dur": int(dur)
            })
        print(f"Encounters loaded: {len(encounters):,}")
    except Exception as e:
        print(f"No encounters exported: {e}")

    con.close()

    # --- write output ---
    print(f"Writing to {out_path} ...")
    opener = gzip.open if out_path.endswith(".gz") else open
    with opener(out_path, "wt", encoding="utf-8") as f:
        f.write(json.dumps({"__meta__": True, **bounds}) + "\n")

        for bucket_t in sorted(buckets.keys()):
            nodes = buckets[bucket_t]
            flat = []
            for nid, (x, y) in nodes.items():
                flat.extend([nid, x, y])
            f.write(json.dumps({"t": bucket_t, "n": flat}) + "\n")

        for enc in encounters:
            f.write(json.dumps(enc) + "\n")

    print(f"Export complete → {out_path}")
    print(f"Bounds: {bounds}")


def main():
    parser = argparse.ArgumentParser(description="Export SQLite events to JSONL frames.")
    parser.add_argument("--db",         required=True,       help="Path to SQLite database file")
    parser.add_argument("--out",        default="frames.jsonl.gz", help="Output file path (.jsonl or .jsonl.gz)")
    parser.add_argument("--table",      default="events",    help="Table name (default: events)")
    parser.add_argument("--col-time",   default="time",      help="Timestamp column name (default: time)")
    parser.add_argument("--col-node",   default="node",      help="Node ID column name (default: node)")
    parser.add_argument("--col-x",      default="x",         help="X coordinate column name (default: x)")
    parser.add_argument("--col-y",      default="y",         help="Y coordinate column name (default: y)")
    parser.add_argument("--bucket",     default=30, type=int,help="Bucket size in seconds (default: 30)")
    args = parser.parse_args()

    export(
        db_path=args.db,
        out_path=args.out,
        table=args.table,
        col_time=args.col_time,
        col_node=args.col_node,
        col_x=args.col_x,
        col_y=args.col_y,
        bucket_seconds=args.bucket,
    )


if __name__ == "__main__":
    main()
