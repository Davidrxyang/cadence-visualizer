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
from fastapi.staticfiles import StaticFiles

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

def _build_custody(msg_origins: dict, transfers: dict, drops: dict) -> dict[str, list]:
    """Replay transfer and drop events into custody intervals per message.

    Returns {msg_id: [[node, start, end], ...]} where the node held the message
    during [start, end); end is None if it still held it when the simulation ended.

    The simulator timestamps events at its time step (60 s), so many events share a
    timestamp and their true order within a step is not recorded. Within a tied
    group we apply events causally: a receive is applied once its sender holds the
    message and the receiver doesn't, a drop once the node holds it. On the japan DB
    this resolves every event consistently for all experiments.
    """
    custody: dict[str, list] = {}
    for mid in set(transfers) | set(drops) | set(msg_origins):
        # (t, kind, node, sender) — kind 0 = receive, 1 = drop; sorts receives first
        events = [(x["t"], 0, x["to"], x["from"]) for x in transfers.get(mid, ())]
        events += [(t, 1, node, None) for t, node in drops.get(mid, ())]
        events.sort(key=lambda e: (e[0], e[1]))  # stable: keeps rowid order within ties

        held: dict[int, int] = {}  # node → custody start time
        intervals: list = []
        origin = msg_origins.get(mid)
        if origin is not None:
            held[origin["origin"]] = origin["created"]

        def apply(ev):
            t, kind, node, _ = ev
            if kind == 0:
                held.setdefault(node, t)
            elif node in held:
                intervals.append([node, held.pop(node), t])

        def valid(ev):
            _, kind, node, sender = ev
            return (sender in held and node not in held) if kind == 0 else node in held

        i = 0
        while i < len(events):
            j = i
            while j < len(events) and events[j][0] == events[i][0]:
                j += 1
            if j - i == 1:  # fast path: no tie to resolve
                apply(events[i])
                i = j
                continue
            pending = events[i:j]
            while pending:
                k = next((k for k, ev in enumerate(pending) if valid(ev)), 0)
                apply(pending.pop(k))
            i = j

        intervals.extend([node, start, None] for node, start in held.items())
        if intervals:
            intervals.sort(key=lambda iv: iv[1])
            custody[mid] = intervals
    return custody


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

    # message transfers — every transfer event, not deduplicated: a node can drop a
    # message and later receive it again (common in flooding/handoff protocols).
    transfers: dict[str, list] = {}
    cur.execute(
        "SELECT message_id, sender_node, reciever_node, transfer_time "
        "FROM message_dbs WHERE experiment_name=? ORDER BY transfer_time, rowid",
        (experiment_name,),
    )
    for msg_id, sndr, recv, t_xfer in cur.fetchall():
        mid = str(msg_id)
        transfers.setdefault(mid, []).append(
            {"id": mid, "t": int(float(t_xfer)), "from": int(sndr), "to": int(recv)}
        )

    # total message copies per epoch
    epoch_loads: list = []
    cur.execute(
        "SELECT now, load FROM epoch_loads WHERE experiment_name=? ORDER BY now",
        (experiment_name,),
    )
    for now, load in cur.fetchall():
        epoch_loads.append({"t": int(float(now)), "load": int(float(load))})

    # per-encounter bandwidth (message transfers) — used for running total
    bandwidths: list = []
    cur.execute(
        "SELECT time, bandwidth FROM bandwidths WHERE experiment_name=? ORDER BY time",
        (experiment_name,),
    )
    for t, bw in cur.fetchall():
        bandwidths.append({"t": int(float(t)), "bw": float(bw)})

    # drops covering all reasons: buffer_overflow, ttl_expired, probabilistic_removal
    # (all events, not deduplicated — a node can hold and drop the same message repeatedly)
    drops: dict[str, list] = {}
    cur.execute(
        "SELECT message_id, node_id, drop_time FROM message_drop_dbs "
        "WHERE experiment_name=? ORDER BY drop_time, rowid",
        (experiment_name,),
    )
    for msg_id, node_id, drop_time in cur.fetchall():
        drops.setdefault(str(msg_id), []).append((int(float(drop_time)), int(node_id)))

    custody = _build_custody(msg_origins, transfers, drops)

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
        "custody": custody,
        "epochLoads": epoch_loads,
        "bandwidths": bandwidths,
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
    con.execute("CREATE INDEX IF NOT EXISTS idx_drop_exp ON message_drop_dbs(experiment_name, drop_time)")
    # Covering index for the GROUP BY dedup query (experiment_name → message_id, node_id, drop_time)
    con.execute(
        "CREATE INDEX IF NOT EXISTS idx_drop_exp_grp "
        "ON message_drop_dbs(experiment_name, message_id, node_id, drop_time)"
    )
    con.execute("CREATE INDEX IF NOT EXISTS idx_epoch_loads_exp ON epoch_loads(experiment_name, now)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_bandwidths_exp ON bandwidths(experiment_name, time)")
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


for _dist in [
    Path(__file__).parent.parent / "dist",
    Path(__file__).parent.parent / "app" / "dist",
]:
    if _dist.exists():
        app.mount("/", StaticFiles(directory=str(_dist), html=True), name="static")
        break