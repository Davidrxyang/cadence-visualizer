"""
FastAPI backend for the Cadence Visualizer.

Serves node-position frames (shared across all experiments) and per-experiment
data (encounters, message transfers, delivered paths) from the local SQLite DB.

Run:
    uvicorn main:app

Startup preloads every experiment (~1 min) before accepting requests, so no user
ever waits on a first-time build. For local development with auto-reload, skip it:
    CADENCE_PRELOAD=0 uvicorn main:app --reload
"""

import gzip
import json
import logging
import os
import sqlite3
import time
from collections import defaultdict
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

DB_PATH = str(Path(__file__).parent.parent / "db" / "japan.db")
MESSAGES_PATH = Path(__file__).parent.parent / "messages" / "messages_japan_type_3.json"
DATASET = "japan"

# uvicorn's logger, so our startup progress lines match its "INFO:" output
logger = logging.getLogger("uvicorn.error")

# In-memory caches — populated on first request, reused for the server's lifetime
_frames_cache: list | None = None
_meta_cache: dict | None = None
_frames_json: bytes | None = None
# Per-experiment responses, cached as already-serialized JSON bytes. Large payloads
# are serialized once instead of on every request (FastAPI's default per-request
# encoding of the broadcast payload alone took ~20s).
_exp_json_cache: dict[str, bytes] = {}
# gzip-compressed copies of the cached JSON bytes: ("frames",) or ("exp", name) → bytes
_gzip_cache: dict[tuple, bytes] = {}


def _to_json_bytes(content) -> bytes:
    # Byte-for-byte the same rendering FastAPI/Starlette's JSONResponse applies to a
    # returned dict (our payloads hold only dict/list/str/int/float/None, which
    # FastAPI's jsonable_encoder passes through unchanged).
    return json.dumps(
        content, ensure_ascii=False, allow_nan=False, indent=None, separators=(",", ":"),
    ).encode("utf-8")

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
    # deterministic key order (a set's iteration order changes between server runs)
    for mid in dict.fromkeys([*msg_origins, *transfers, *drops]):
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


def load_experiment_data(experiment_name: str, log=None) -> dict:
    """Build the per-experiment payload from the DB (uncached; see experiment_json).
    `log`, if given, is called with a progress line after each stage."""
    log = log or (lambda _msg: None)
    t_stage = time.time()

    def stage_done(msg: str) -> None:
        nonlocal t_stage
        log(f"{msg} ({time.time() - t_stage:.1f}s)")
        t_stage = time.time()

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
    stage_done(f"encounters: {len(encounters):,}")

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
    stage_done(f"transfers: {sum(map(len, transfers.values())):,} across {len(transfers):,} messages")

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
    stage_done(f"network load series: {len(epoch_loads):,} epochs, {len(bandwidths):,} bandwidth records")

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
    stage_done(f"drops: {sum(map(len, drops.values())):,}")

    custody = _build_custody(msg_origins, transfers, drops)
    stage_done(f"custody replay: {sum(map(len, custody.values())):,} holding intervals")

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
    stage_done(f"delivered paths: {len(delivered_paths):,} of {len(msg_origins):,} messages")

    con.close()
    result = {
        "encounters": encounters,
        "messageOrigins": msg_origins,
        # Compact wire format (the frontend expands it back to {id, t, from, to} objects
        # in parse.js expandExperimentData): {msg_id: [t, from, to, t, from, to, ...]}
        "transfersFlat": {
            mid: [v for x in xfers for v in (x["t"], x["from"], x["to"])]
            for mid, xfers in transfers.items()
        },
        "deliveredPaths": delivered_paths,
        "custody": custody,
        "epochLoads": epoch_loads,
        "bandwidths": bandwidths,
    }
    return result


def experiment_json(experiment_name: str, log=None) -> bytes:
    """Serialized per-experiment payload, built and serialized once, then cached."""
    cached = _exp_json_cache.get(experiment_name)
    if cached is None:
        data = load_experiment_data(experiment_name, log)
        t0 = time.time()
        cached = _to_json_bytes(data)
        if log:
            log(f"serialized: {len(cached) / 1e6:.1f} MB JSON ({time.time() - t0:.1f}s)")
        _exp_json_cache[experiment_name] = cached
    return cached


def frames_json() -> bytes:
    global _frames_json
    if _frames_json is None:
        frames, _ = load_shared_data()
        _frames_json = _to_json_bytes({"frames": frames})
    return _frames_json


def _accepts_gzip(request: Request) -> bool:
    """True if the client's Accept-Encoding allows gzip (honours q=0 refusals)."""
    q_by_coding: dict[str, float] = {}
    for part in request.headers.get("accept-encoding", "").split(","):
        coding, _, params = part.strip().partition(";")
        coding = coding.strip().lower()
        if not coding:
            continue
        q = 1.0
        params = params.strip().lower()
        if params.startswith("q="):
            try:
                q = float(params[2:])
            except ValueError:
                q = 0.0
        q_by_coding[coding] = q
    if "gzip" in q_by_coding:
        return q_by_coding["gzip"] > 0
    return q_by_coding.get("*", 0) > 0


def _cached_json_response(key: tuple, body: bytes, request: Request) -> Response:
    """Serve cached JSON bytes, gzip-compressed (once, then cached under `key`) if the
    client accepts it. The decompressed bytes are exactly `body`."""
    headers = {"Vary": "Accept-Encoding"}
    if not _accepts_gzip(request):
        return Response(content=body, media_type="application/json", headers=headers)
    headers["Content-Encoding"] = "gzip"
    return Response(content=_gzipped(key, body), media_type="application/json", headers=headers)


def _gzipped(key: tuple, body: bytes) -> bytes:
    gz = _gzip_cache.get(key)
    if gz is None:
        gz = gzip.compress(body, compresslevel=6, mtime=0)
        _gzip_cache[key] = gz
    return gz


def preload_all() -> None:
    """Build, serialize and gzip every response up front, through the same functions the
    routes use, so no user request ever waits on (or races) a first-time build."""
    t_start = time.time()
    con = get_db()
    names = [row[0] for row in con.execute("SELECT experiment_name FROM experiments ORDER BY experiment_name")]
    con.close()
    logger.info(f"[preload] Preloading frames + {len(names)} experiments before accepting requests "
                f"(set CADENCE_PRELOAD=0 to skip)")

    t0 = time.time()
    body = frames_json()
    gz = _gzipped(("frames",), body)
    logger.info(f"[preload] frames: {len(body) / 1e6:.1f} MB JSON → {len(gz) / 1e6:.1f} MB gzip "
                f"({time.time() - t0:.1f}s)")

    for i, name in enumerate(names, 1):
        tag = f"[preload {i}/{len(names)}]"
        logger.info(f"{tag} {name}")
        t0 = time.time()
        body = experiment_json(name, log=lambda msg: logger.info(f"{tag}   {msg}"))
        t_gz = time.time()
        gz = _gzipped(("exp", name), body)
        logger.info(f"{tag}   gzip: {len(gz) / 1e6:.1f} MB ({time.time() - t_gz:.1f}s)")
        logger.info(f"{tag} done in {time.time() - t0:.1f}s · total elapsed {time.time() - t_start:.0f}s · "
                    f"{len(names) - i} remaining")

    cached_mb = (sum(map(len, _exp_json_cache.values())) + sum(map(len, _gzip_cache.values()))
                 + len(_frames_json or b"")) / 1e6
    logger.info(f"[preload] Complete: {len(names)} experiments in {time.time() - t_start:.0f}s · "
                f"{cached_mb:.0f} MB of responses cached{_rss_note()}")


def _rss_note() -> str:
    """' · process memory N MB' on Linux, else ''."""
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return f" · process memory {int(line.split()[1]) // 1024} MB"
    except OSError:
        pass
    return ""


# ── app setup ─────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    t_start = time.time()
    logger.info(f"[startup] Database: {DB_PATH}")
    # Add indexes on startup so experiment-data queries are fast.
    # These are no-ops if the indexes already exist.
    t0 = time.time()
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
    logger.info(f"[startup] Indexes ready ({time.time() - t0:.1f}s)")
    # Load canonical message list from the raw JSON file
    t0 = time.time()
    global _message_registry
    _message_registry = _load_message_registry()
    logger.info(f"[startup] Message registry: {len(_message_registry):,} messages from "
                f"{MESSAGES_PATH.name} ({time.time() - t0:.1f}s)")
    # Pre-warm the frame cache so the first /api/frames request is instant
    t0 = time.time()
    frames, meta = load_shared_data()
    logger.info(f"[startup] Node positions: {len(frames):,} frames, {meta['node_count']:,} nodes, "
                f"{meta['bucket']}s apart ({time.time() - t0:.1f}s)")
    # Preload every response before the server starts accepting requests (~1 min).
    # Startup blocks on purpose: users never hit a cold or half-built cache.
    # Set CADENCE_PRELOAD=0 to skip it during local development (e.g. with --reload).
    if os.environ.get("CADENCE_PRELOAD", "1") != "0":
        preload_all()
    else:
        logger.info("[startup] CADENCE_PRELOAD=0: skipping preload; experiments build on first request")
    logger.info(f"[startup] Ready after {time.time() - t_start:.0f}s — now accepting requests")
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
def get_all_frames(request: Request):
    return _cached_json_response(("frames",), frames_json(), request)


@app.get("/api/experiment-data/{experiment_name:path}")
def get_experiment_data(experiment_name: str, request: Request):
    return _cached_json_response(("exp", experiment_name), experiment_json(experiment_name), request)


for _dist in [
    Path(__file__).parent.parent / "dist",
    Path(__file__).parent.parent / "app" / "dist",
]:
    if _dist.exists():
        app.mount("/", StaticFiles(directory=str(_dist), html=True), name="static")
        break