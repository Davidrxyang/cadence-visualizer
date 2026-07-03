"""
FastAPI backend for the Cadence Visualizer.

Serves node-position frames (shared across all experiments) and per-experiment
data (encounters, message transfers, delivered paths) from the local SQLite DB.

Run:
    uvicorn main:app --reload
"""

import json
import sqlite3
from collections import defaultdict
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

DB_PATH = str(Path(__file__).parent.parent / "db" / "japan.db")
MESSAGES_PATH = Path(__file__).parent.parent / "messages" / "messages_japan_type_3.json"
DATASET = "japan"

# In-memory caches — populated on first request, reused for the server's lifetime
_frames_cache: list | None = None
_meta_cache: dict | None = None
_exp_cache: dict[str, dict] = {}

# Canonical message registry — same for every experiment.
# Keys are message IDs (strings); values match the messageOrigins shape expected by the frontend.
_message_registry: dict[str, dict] = {}

def _load_message_registry() -> dict[str, dict]:
    if not MESSAGES_PATH.exists():
        return {}
    with MESSAGES_PATH.open() as f:
        raw = json.load(f)
    registry: dict[str, dict] = {}
    for msgs in raw.values():
        for m in msgs:
            mid = str(m["id"])
            registry[mid] = {
                "id": mid,
                "origin": int(m["sender"]),
                "created": int(m["time"]),
                "dest": int(m["destination"]),
            }
    return registry


def get_db() -> sqlite3.Connection:
    return sqlite3.connect(DB_PATH)


# ── shared frame data (node positions, same for every experiment) ─────────────

def load_shared_data() -> tuple[list, dict]:
    global _frames_cache, _meta_cache
    if _frames_cache is not None:
        return _frames_cache, _meta_cache

    con = get_db()
    cur = con.cursor()
    cur.execute(
        "SELECT time, node, x, y FROM events WHERE dataset_name=? ORDER BY time",
        (DATASET,),
    )
    buckets: dict[int, dict[int, tuple[int, int]]] = defaultdict(dict)
    for t, node, x, y in cur:
        buckets[int(t)][int(node)] = (int(x), int(y))
    con.close()

    times = sorted(buckets.keys())
    frames = []
    for t in times:
        flat: list[int] = []
        for nid, (x, y) in buckets[t].items():
            flat.extend([nid, x, y])
        frames.append({"t": t, "n": flat})

    all_x = [x for nodes in buckets.values() for x, _ in nodes.values()]
    all_y = [y for nodes in buckets.values() for _, y in nodes.values()]
    _meta_cache = {
        "x_min": min(all_x), "x_max": max(all_x),
        "y_min": min(all_y), "y_max": max(all_y),
        "t_min": times[0], "t_max": times[-1],
        "bucket": (times[1] - times[0]) if len(times) > 1 else 1800,
        "node_count": max(nid for nodes in buckets.values() for nid in nodes) + 1,
    }
    _frames_cache = frames
    return _frames_cache, _meta_cache


# ── per-experiment data ────────────────────────────────────────────────────────

def load_experiment_data(experiment_name: str) -> dict:
    if experiment_name in _exp_cache:
        return _exp_cache[experiment_name]

    con = get_db()
    cur = con.cursor()

    # encounters are dataset-wide (all experiments share the same physical encounter set)
    cur.execute(
        "SELECT time, node1, node2, x, y, duration FROM encounters "
        "WHERE dataset_name=? ORDER BY time",
        (DATASET,),
    )
    encounters = [
        {"t": int(r[0]), "n1": int(r[1]), "n2": int(r[2]),
         "x": int(r[3]), "y": int(r[4]), "dur": int(r[5])}
        for r in cur.fetchall()
    ]

    # Message origins come from the canonical raw messages file, not from message_dbs.
    # message_dbs only records transfers that actually happened, so messages that were
    # created but never transferred in this experiment would be invisible if we derived
    # origins from that table. All 4500 messages exist in every experiment — only their
    # transfer/delivery outcomes differ.
    msg_origins: dict[str, dict] = dict(_message_registry)

    # message transfers — deduplicate to earliest transfer per (msg_id, receiver) in SQL
    # sender_node in a GROUP BY is SQLite's arbitrary pick from the group; for our
    # visualisation (who transferred to whom at what time) this is close enough.
    transfers: dict[str, list] = {}
    cur.execute(
        "SELECT message_id, sender_node, reciever_node, MIN(transfer_time) "
        "FROM message_dbs WHERE experiment_name=? "
        "GROUP BY message_id, reciever_node "
        "ORDER BY MIN(transfer_time)",
        (experiment_name,),
    )
    for msg_id, sndr, recv, t_xfer in cur.fetchall():
        mid = str(msg_id)
        transfers.setdefault(mid, []).append(
            {"id": mid, "t": int(float(t_xfer)), "from": int(sndr), "to": int(recv)}
        )

    # delivered message paths
    delivered_paths: dict[str, list] = {}
    cur.execute(
        "SELECT message_id, path FROM delivered_message_dbs WHERE experiment_name=?",
        (experiment_name,),
    )
    for row in cur:
        msg_id, path = row
        msg_id = str(msg_id)
        if not path:
            continue
        nodes_in_path: list[int] = []
        seen: set[int] = set()
        for token in str(path).split(","):
            token = token.strip()
            if not token:
                continue
            try:
                node_id = int(token.split(":")[0].strip())
            except (ValueError, IndexError):
                continue
            if node_id not in seen:
                seen.add(node_id)
                nodes_in_path.append(node_id)
        if nodes_in_path:
            delivered_paths[msg_id] = nodes_in_path

    con.close()
    result = {
        "encounters": encounters,
        "messageOrigins": msg_origins,
        "transfers": transfers,
        "deliveredPaths": delivered_paths,
    }
    _exp_cache[experiment_name] = result
    return result


# ── app setup ─────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Add indexes on startup so experiment-data queries are fast.
    # These are no-ops if the indexes already exist.
    con = get_db()
    con.execute("CREATE INDEX IF NOT EXISTS idx_msg_exp ON message_dbs(experiment_name)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_del_exp ON delivered_message_dbs(experiment_name)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_enc_exp ON encounters(experiment_name, dataset_name)")
    # Covering index so the GROUP BY deduplication query reads from the index
    # directly without touching the main table or creating a temp B-tree.
    con.execute(
        "CREATE INDEX IF NOT EXISTS idx_msg_exp_grp "
        "ON message_dbs(experiment_name, message_id, reciever_node, transfer_time, sender_node)"
    )
    con.commit()
    con.close()
    # Load canonical message list from the raw JSON file
    global _message_registry
    _message_registry = _load_message_registry()
    print(f"Message registry loaded: {len(_message_registry)} messages")
    # Pre-warm the frame cache so the first /api/frames request is instant
    load_shared_data()
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:4173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


# ── routes ────────────────────────────────────────────────────────────────────

@app.get("/api/healthz")
def health():
    return {"ok": True}


@app.get("/api/experiments")
def list_experiments():
    con = get_db()
    cur = con.cursor()
    cur.execute("SELECT experiment_name FROM experiments ORDER BY experiment_name")
    names = [row[0] for row in cur.fetchall()]
    con.close()
    return {"experiments": names}


@app.get("/api/meta")
def get_meta():
    _, meta = load_shared_data()
    return meta


@app.get("/api/frames")
def get_all_frames():
    frames, _ = load_shared_data()
    return {"frames": frames}


@app.get("/api/experiment-data/{experiment_name:path}")
def get_experiment_data(experiment_name: str):
    return load_experiment_data(experiment_name)