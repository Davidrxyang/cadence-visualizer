import { useState, useEffect, useRef, useCallback, useMemo } from "react";

const DEFAULT_NODE_RADIUS = 3;
const MAX_SELECTED_NODES = 20;

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

// Van der Corput sequence: at every prefix length, the hues are spread as far
// apart as possible (e.g. 0°, 180°, 90°, 270°, 45°, 225°, ...). Colors only
// start crowding together once many nodes are selected.
function vanDerCorput(n, base = 2) {
  let vdc = 0;
  let denom = 1;
  while (n > 0) {
    denom *= base;
    vdc += (n % base) / denom;
    n = Math.floor(n / base);
  }
  return vdc;
}

const NODE_COLOR_PALETTE = Array.from({ length: MAX_SELECTED_NODES }, (_, i) =>
  hslToHex(vanDerCorput(i) * 360, 75, 58)
);

// Reserved color for message carriers that aren't part of the selected-node set.
// Pure black sits maximally distinct from the saturated hues in NODE_COLOR_PALETTE.
const CARRIER_RESERVED_COLOR = "#000000";

function drawTriangle(ctx, cx, cy, r, fillColor, strokeColor, lineWidth) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r * Math.sin((2 * Math.PI) / 3), cy - r * Math.cos((2 * Math.PI) / 3));
  ctx.lineTo(cx + r * Math.sin((4 * Math.PI) / 3), cy - r * Math.cos((4 * Math.PI) / 3));
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function LegendRow({ preview, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 16, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {preview}
      </div>
      <span style={{ fontSize: 12, color: "var(--color-text-primary)" }}>{label}</span>
    </div>
  );
}

function TrianglePreview({ fill }) {
  return (
    <div style={{ position: "relative", width: 14, height: 14 }}>
      <div style={{
        position: "absolute", top: 0, left: 0, width: 0, height: 0,
        borderLeft: "7px solid transparent", borderRight: "7px solid transparent",
        borderBottom: "12px solid rgba(255,255,255,0.95)",
      }} />
      <div style={{
        position: "absolute", top: 2, left: 2, width: 0, height: 0,
        borderLeft: "5px solid transparent", borderRight: "5px solid transparent",
        borderBottom: `9px solid ${fill}`,
      }} />
    </div>
  );
}

function parseJSONL(text) {
  const lines = text.trim().split("\n");
  let meta = null;
  const frames = [];
  const encounters = [];
  const messageOrigins = {};
  const transfersRaw = [];
  const deliveredPaths = {};

  for (const line of lines) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line);
    if (obj.__meta__) {
      meta = obj;
    } else if (obj.__enc__) {
      encounters.push({ t: obj.t, n1: obj.n1, n2: obj.n2, x: obj.x, y: obj.y, dur: obj.dur });
    } else if (obj.__msgorigin__) {
      messageOrigins[obj.id] = { origin: obj.origin, created: obj.created, dest: obj.dest };
    } else if (obj.__xfer__) {
      transfersRaw.push({ id: obj.id, t: obj.t, from: obj.from, to: obj.to });
    } else if (obj.__delivered__) {
      deliveredPaths[obj.id] = obj.path;
    } else {
      const nodes = {};
      const n = obj.n;
      for (let i = 0; i < n.length; i += 3) {
        nodes[n[i]] = [n[i + 1], n[i + 2]];
      }
      frames.push({ t: obj.t, nodes });
    }
  }

  const transfers = {};
  for (const xfer of transfersRaw) {
    (transfers[xfer.id] ??= []).push(xfer);
  }

  return { meta, frames, encounters, messageOrigins, transfers, deliveredPaths };
}

function formatTime(unix) {
  return new Date(unix * 1000).toLocaleString();
}

function hueForNode(id, total) {
  return Math.round((id / Math.max(total, 1)) * 360);
}

export default function App() {
  const [data, setData] = useState(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(5);
  const [nodeSize, setNodeSize] = useState(DEFAULT_NODE_RADIUS);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState(null);

  const [selectedNodes, setSelectedNodes] = useState(new Set());
  const [nodeColors, setNodeColors] = useState({});
  const [filterMode, setFilterMode] = useState("highlight");
  const [showPanel, setShowPanel] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [sidebarTab, setSidebarTab] = useState("nodes");
  const [nodeSearch, setNodeSearch] = useState("");
  const [showEncounters, setShowEncounters] = useState(true);

  const [selectedMessage, setSelectedMessage] = useState(null);
  const [msgSearch, setMsgSearch] = useState("");
  const [onlyDelivered, setOnlyDelivered] = useState(false);

  const [clickedNode, setClickedNode] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const lastTickRef = useRef(null);

  // ── derived from data ─────────────────────────────────────────────────────

  const allNodeIds = useMemo(() => {
    if (!data) return [];
    return Array.from({ length: data.meta.node_count }, (_, i) => i);
  }, [data]);

  const filteredNodeIds = useMemo(() => {
    const q = nodeSearch.trim();
    if (!q) return allNodeIds;
    return allNodeIds.filter(id => String(id).includes(q));
  }, [allNodeIds, nodeSearch]);

  const allMessageIds = useMemo(() => {
    if (!data?.transfers) return [];
    return Object.keys(data.transfers).sort((a, b) => Number(a) - Number(b));
  }, [data]);

  const filteredMessageIds = useMemo(() => {
    let ids = allMessageIds;
    if (onlyDelivered) ids = ids.filter(id => data?.deliveredPaths[id] !== undefined);
    const q = msgSearch.trim();
    if (!q) return ids;
    return ids.filter(id => id.includes(q));
  }, [allMessageIds, msgSearch, onlyDelivered, data]);

  const frameIdxMap = useMemo(() => {
    if (!data) return new Map();
    return new Map(data.frames.map((f, i) => [f.t, i]));
  }, [data]);

  const encountersByNode = useMemo(() => {
    if (!data?.encounters.length) return {};
    const map = {};
    for (const enc of data.encounters) {
      (map[enc.n1] ??= []).push(enc);
      (map[enc.n2] ??= []).push(enc);
    }
    return map;
  }, [data]);

  const encounterTicks = useMemo(() => {
    if (!data?.encounters.length || !selectedNodes.size) return new Set();
    const { bucket } = data.meta;
    const ticks = new Set();
    for (const nodeId of selectedNodes) {
      for (const enc of (encountersByNode[nodeId] ?? [])) {
        const tStart = Math.floor(enc.t / bucket) * bucket;
        for (let t = tStart; t < enc.t + enc.dur; t += bucket) {
          const idx = frameIdxMap.get(t);
          if (idx !== undefined) ticks.add(idx);
        }
      }
    }
    return ticks;
  }, [data, selectedNodes, encountersByNode, frameIdxMap]);

  const currentEncounters = useMemo(() => {
    if (!data?.encounters.length || !selectedNodes.size) return [];
    const frameT = data.frames[frameIdx]?.t;
    if (frameT == null) return [];
    const seen = new Set();
    const result = [];
    for (const nodeId of selectedNodes) {
      for (const enc of (encountersByNode[nodeId] ?? [])) {
        if (frameT < enc.t || frameT >= enc.t + enc.dur) continue;
        const key = `${enc.t}-${enc.n1}-${enc.n2}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(enc);
      }
    }
    return result;
  }, [data, frameIdx, selectedNodes, encountersByNode]);

  const carriers = useMemo(() => {
    if (!selectedMessage || !data) return new Set();
    const frameT = data.frames[frameIdx]?.t;
    if (frameT == null) return new Set();
    const origin = data.messageOrigins[selectedMessage]?.origin;
    const result = new Set(origin != null ? [origin] : []);
    for (const xfer of (data.transfers[selectedMessage] ?? [])) {
      if (xfer.t > frameT) break;
      result.add(xfer.to);
    }
    return result;
  }, [selectedMessage, frameIdx, data]);

  const transferTicks = useMemo(() => {
    if (!selectedMessage || !data?.transfers[selectedMessage]) return new Set();
    const { bucket } = data.meta;
    const ticks = new Set();
    for (const xfer of data.transfers[selectedMessage]) {
      const bucketed = Math.floor(xfer.t / bucket) * bucket;
      const idx = frameIdxMap.get(bucketed);
      if (idx !== undefined) ticks.add(idx);
    }
    return ticks;
  }, [selectedMessage, data, frameIdxMap]);

  const deliveryFrameIdx = useMemo(() => {
    if (!selectedMessage || !data) return null;
    const dest = data.messageOrigins[selectedMessage]?.dest;
    if (dest == null) return null;
    const { bucket } = data.meta;
    for (const xfer of (data.transfers[selectedMessage] ?? [])) {
      if (xfer.to === dest) {
        const bucketed = Math.floor(xfer.t / bucket) * bucket;
        const exact = frameIdxMap.get(bucketed);
        if (exact !== undefined) return exact;
        // no frame at that exact bucket — binary search for nearest frame before delivery
        const frames = data.frames;
        let lo = 0, hi = frames.length - 1, best = 0;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (frames[mid].t <= bucketed) { best = mid; lo = mid + 1; }
          else hi = mid - 1;
        }
        return best;
      }
    }
    return null;
  }, [selectedMessage, data, frameIdxMap]);

  // ── file loading ──────────────────────────────────────────────────────────

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      let text;
      if (file.name.endsWith(".gz")) {
        const buf = await file.arrayBuffer();
        const ds = new DecompressionStream("gzip");
        const writer = ds.writable.getWriter();
        writer.write(new Uint8Array(buf));
        writer.close();
        const out = await new Response(ds.readable).arrayBuffer();
        text = new TextDecoder().decode(out);
      } else {
        text = await file.text();
      }
      const parsed = parseJSONL(text);
      if (!parsed.frames.length) throw new Error("No frames found in file.");
      setData(parsed);
      setFileName(file.name);
      setFrameIdx(0);
      setPlaying(false);
      setSelectedNodes(new Set());
      setNodeColors({});
      setSelectedMessage(null);
      setOnlyDelivered(false);
      setClickedNode(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleNode = (id) => {
    if (selectedNodes.has(id)) {
      const next = new Set(selectedNodes);
      next.delete(id);
      setSelectedNodes(next);
      return;
    }
    if (selectedNodes.size >= MAX_SELECTED_NODES) return;
    const next = new Set(selectedNodes);
    next.add(id);
    setSelectedNodes(next);
    if (!nodeColors[id]) {
      setNodeColors(prev => ({ ...prev, [id]: NODE_COLOR_PALETTE[(next.size - 1) % NODE_COLOR_PALETTE.length] }));
    }
  };

  const setNodeColor = (id, color) => {
    setNodeColors(prev => ({ ...prev, [id]: color }));
  };

  const selectAllNodes = () => {
    const ids = filteredNodeIds.slice(0, MAX_SELECTED_NODES);
    setSelectedNodes(new Set(ids));
    setNodeColors(prev => {
      const next = { ...prev };
      ids.forEach((id, i) => { if (!next[id]) next[id] = NODE_COLOR_PALETTE[i % NODE_COLOR_PALETTE.length]; });
      return next;
    });
  };

  const clearNodes = () => {
    setSelectedNodes(new Set());
    setNodeColors({});
  };

  // Focus only the nodes that were part of a delivered message's hop path,
  // deselecting everything else and assigning each a distinct color.
  const focusOnPathNodes = (pathNodeIds) => {
    const ids = pathNodeIds.slice(0, MAX_SELECTED_NODES);
    setSelectedNodes(new Set(ids));
    setNodeColors(() => {
      const next = {};
      ids.forEach((id, i) => { next[id] = NODE_COLOR_PALETTE[i % NODE_COLOR_PALETTE.length]; });
      return next;
    });
  };

  const handleMessageClick = (id) => {
    setSelectedMessage(prev => {
      const next = prev === id ? null : id;
      if (next !== null) {
        const path = data.deliveredPaths[next];
        if (path) focusOnPathNodes(path);
      }
      return next;
    });
  };

  // ── canvas click ──────────────────────────────────────────────────────────

  const handleCanvasClick = useCallback((e) => {
    if (!data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { meta, frames } = data;
    const W = canvas.width;
    const H = canvas.height;
    const toScreen = (x, y) => [
      ((x - meta.x_min) / (meta.x_max - meta.x_min)) * (W - 40) + 20,
      H - (((y - meta.y_min) / (meta.y_max - meta.y_min)) * (H - 40) + 20),
    ];
    const frame = frames[frameIdx];
    let closest = null;
    let closestDist = 10;
    for (const [idStr, [x, y]] of Object.entries(frame.nodes)) {
      const id = parseInt(idStr);
      if (filterMode === "isolate" && selectedNodes.size > 0 && !selectedNodes.has(id)) continue;
      const [sx, sy] = toScreen(x, y);
      const d = Math.sqrt((sx - mx) ** 2 + (sy - my) ** 2);
      if (d < closestDist) { closestDist = d; closest = id; }
    }
    setClickedNode(prev => prev === closest ? null : closest);
    if (closest !== null) setTooltipPos({ x: e.clientX, y: e.clientY });
  }, [data, frameIdx, filterMode, selectedNodes]);

  // ── draw ──────────────────────────────────────────────────────────────────

  const draw = useCallback(() => {
    if (!data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const { meta, frames } = data;
    const W = canvas.width;
    const H = canvas.height;

    const toScreen = (x, y) => {
      const sx = ((x - meta.x_min) / (meta.x_max - meta.x_min)) * (W - 40) + 20;
      const sy = H - (((y - meta.y_min) / (meta.y_max - meta.y_min)) * (H - 40) + 20);
      return [sx, sy];
    };

    ctx.clearRect(0, 0, W, H);

    // grid
    ctx.strokeStyle = "rgba(128,128,128,0.1)";
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 10; i++) {
      const x = 20 + (i / 10) * (W - 40);
      const y = 20 + (i / 10) * (H - 40);
      ctx.beginPath(); ctx.moveTo(x, 20); ctx.lineTo(x, H - 20); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(20, y); ctx.lineTo(W - 20, y); ctx.stroke();
    }

    const total = meta.node_count;
    const hasSelection = selectedNodes.size > 0;
    const hasMessage = !!selectedMessage && carriers.size > 0;

    const bgColor = (id) => {
      if (hasSelection && filterMode === "isolate" && !carriers.has(id)) return null;
      if (hasMessage) return "rgba(80,80,80,0.35)";
      const hue = hueForNode(id, total);
      if (hasSelection) return "rgba(100,100,100,0.3)";
      return `hsl(${hue},80%,60%)`;
    };

    const frame = frames[frameIdx];
    const entries = Object.entries(frame.nodes);

    // pass 1: background nodes
    for (const [idStr, [x, y]] of entries) {
      const id = parseInt(idStr);
      if (hasSelection && selectedNodes.has(id)) continue;
      if (hasMessage && carriers.has(id)) continue;
      const color = bgColor(id);
      if (!color) continue;
      const [sx, sy] = toScreen(x, y);
      ctx.beginPath(); ctx.arc(sx, sy, nodeSize, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
    }

    // pass 2: message carriers — always triangles with a white border.
    // Selected carriers keep their custom node color; everyone else gets the reserved black.
    if (hasMessage) {
      const msgInfo = data.messageOrigins[selectedMessage];
      for (const [idStr, [x, y]] of entries) {
        const id = parseInt(idStr);
        if (!carriers.has(id)) continue;
        const [sx, sy] = toScreen(x, y);
        const isSelected = selectedNodes.has(id);
        const isOrigin = msgInfo?.origin === id;
        const isDelivered = msgInfo?.dest === id;
        const fillColor = isSelected ? (nodeColors[id] ?? "#ef4444") : CARRIER_RESERVED_COLOR;
        const r = nodeSize * 2.4;

        if (isDelivered) {
          ctx.beginPath(); ctx.arc(sx, sy, nodeSize * 4.5, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(34,197,94,0.18)"; ctx.fill();
        }

        drawTriangle(ctx, sx, sy, r, fillColor, "rgba(255,255,255,0.95)", 2.5);

        if (isDelivered) {
          ctx.font = "bold 11px sans-serif";
          ctx.fillStyle = "#22c55e";
          ctx.fillText("✓ dest", sx + r + 4, sy + 4);
        } else if (isOrigin) {
          ctx.font = "11px sans-serif";
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          ctx.fillText("origin", sx + r + 4, sy + 4);
        }
      }
    }

    // pass 3: selected nodes (per-node custom color) — carriers already drawn as triangles above
    if (hasSelection) {
      for (const [idStr, [x, y]] of entries) {
        const id = parseInt(idStr);
        if (!selectedNodes.has(id)) continue;
        if (hasMessage && carriers.has(id)) continue;
        const [sx, sy] = toScreen(x, y);
        ctx.beginPath(); ctx.arc(sx, sy, nodeSize * 2, 0, Math.PI * 2);
        ctx.fillStyle = nodeColors[id] ?? "#ef4444"; ctx.fill();
        ctx.beginPath(); ctx.arc(sx, sy, nodeSize * 2, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1.5; ctx.stroke();
      }
    }

    // pass 4: encounter markers (amber)
    if (showEncounters && hasSelection) {
      const frameT = frames[frameIdx].t;
      const drawn = new Set();
      for (const nodeId of selectedNodes) {
        for (const enc of (encountersByNode[nodeId] ?? [])) {
          if (frameT < enc.t || frameT >= enc.t + enc.dur) continue;
          const key = `${enc.t}-${enc.n1}-${enc.n2}`;
          if (drawn.has(key)) continue;
          drawn.add(key);
          const [ex, ey] = toScreen(enc.x, enc.y);
          const posA = frame.nodes[enc.n1];
          const posB = frame.nodes[enc.n2];
          if (posA && posB) {
            const [ax, ay] = toScreen(posA[0], posA[1]);
            const [bx, by] = toScreen(posB[0], posB[1]);
            ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
            ctx.strokeStyle = "rgba(251,191,36,0.4)"; ctx.lineWidth = 1.5; ctx.stroke();
          }
          ctx.beginPath(); ctx.arc(ex, ey, 10, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(251,191,36,0.9)"; ctx.lineWidth = 2; ctx.stroke();
          ctx.beginPath(); ctx.arc(ex, ey, 3, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(251,191,36,0.9)"; ctx.fill();
          ctx.font = "11px sans-serif";
          ctx.fillStyle = "rgba(251,191,36,0.95)";
          ctx.fillText(`${enc.n1}↔${enc.n2}`, ex + 14, ey + 4);
        }
      }
    }

    // pass 5: message transfer markers (blue)
    if (hasMessage) {
      const frameT = frames[frameIdx].t;
      const { bucket } = meta;
      for (const xfer of (data.transfers[selectedMessage] ?? [])) {
        const xferBucket = Math.floor(xfer.t / bucket) * bucket;
        if (xferBucket < frameT) continue;
        if (xferBucket > frameT) break;
        const posA = frame.nodes[xfer.from];
        const posB = frame.nodes[xfer.to];
        if (!posA || !posB) continue;
        const [ax, ay] = toScreen(posA[0], posA[1]);
        const [bx, by] = toScreen(posB[0], posB[1]);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
        ctx.strokeStyle = "rgba(59,130,246,0.6)"; ctx.lineWidth = 2; ctx.stroke();
        const mx2 = (ax + bx) / 2, my2 = (ay + by) / 2;
        ctx.beginPath(); ctx.arc(mx2, my2, 8, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(59,130,246,0.95)"; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.arc(mx2, my2, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(59,130,246,0.95)"; ctx.fill();
        ctx.font = "11px sans-serif";
        ctx.fillStyle = "rgba(59,130,246,0.95)";
        ctx.fillText(`${xfer.from}→${xfer.to}`, mx2 + 12, my2 + 4);
      }
    }
  }, [data, frameIdx, selectedNodes, nodeColors, nodeSize, filterMode, showEncounters,
      encountersByNode, selectedMessage, carriers]);

  // ── effects ───────────────────────────────────────────────────────────────

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    if (!playing || !data) return;
    const tick = (now) => {
      if (lastTickRef.current === null) lastTickRef.current = now;
      const elapsed = now - lastTickRef.current;
      const msPerFrame = 1000 / speed;
      if (elapsed >= msPerFrame) {
        lastTickRef.current = now;
        setFrameIdx((i) => {
          if (i >= data.frames.length - 1) { setPlaying(false); return i; }
          return i + 1;
        });
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(animRef.current); lastTickRef.current = null; };
  }, [playing, data, speed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      draw();
    });
    ro.observe(canvas);
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    return () => ro.disconnect();
  }, [draw]);

  // ── helpers ───────────────────────────────────────────────────────────────

  const handleNodesBtn = () => {
    if (showPanel && sidebarTab === "nodes") setShowPanel(false);
    else { setShowPanel(true); setSidebarTab("nodes"); }
  };
  const handleMessagesBtn = () => {
    if (showPanel && sidebarTab === "messages") setShowPanel(false);
    else { setShowPanel(true); setSidebarTab("messages"); }
  };

  const nodeCount = data ? Object.keys(data.frames[frameIdx]?.nodes ?? {}).length : 0;
  const hasEncounters = data?.encounters.length > 0;
  const hasMessages = data && allMessageIds.length > 0;
  const msgInfo = selectedMessage ? data.messageOrigins[selectedMessage] : null;
  const delivered = msgInfo && carriers.has(msgInfo.dest);

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ fontFamily: "var(--font-sans)", display: "flex", flexDirection: "column", height: "100vh" }}>
      {!data && (
        <div style={{
          flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 16, background: "var(--color-background-secondary)"
        }}>
          <p style={{ fontSize: 15, color: "var(--color-text-secondary)", margin: 0 }}>
            Load your <code>frames.jsonl</code> or <code>frames.jsonl.gz</code> file
          </p>
          <label style={{
            cursor: "pointer", padding: "8px 20px", borderRadius: "var(--border-radius-md)",
            border: "0.5px solid var(--color-border-secondary)", fontSize: 14,
            background: "var(--color-background-primary)", color: "var(--color-text-primary)"
          }}>
            {loading ? "Loading…" : "Choose file"}
            <input type="file" accept=".jsonl,.gz" onChange={handleFile} style={{ display: "none" }} />
          </label>
          {error && <p style={{ fontSize: 13, color: "var(--color-text-danger)", margin: 0 }}>{error}</p>}
        </div>
      )}

      {data && (
        <>
          {/* header */}
          <div style={{
            display: "flex", alignItems: "center", gap: 12, padding: "8px 12px",
            borderBottom: "0.5px solid var(--color-border-tertiary)", flexWrap: "wrap"
          }}>
            {fileName && (
              <span style={{
                fontSize: 13, color: "var(--color-text-primary)", fontWeight: 500,
                maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
              }} title={fileName}>
                {fileName}
              </span>
            )}
            <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
              {formatTime(data.frames[frameIdx].t)}
            </span>
            <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
              {nodeCount} nodes
            </span>
            <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
              {frameIdx + 1} / {data.frames.length}
            </span>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--color-text-secondary)", marginLeft: "auto" }}>
              size
              <input type="range" min="1" max="10" step="0.5" value={nodeSize}
                onChange={e => setNodeSize(Number(e.target.value))} style={{ width: 70 }} />
              <span style={{ minWidth: 22 }}>{nodeSize}px</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--color-text-secondary)" }}>
              speed
              <input type="range" min="1" max="60" step="1" value={speed}
                onChange={e => setSpeed(Number(e.target.value))} style={{ width: 80 }} />
              <span style={{ minWidth: 28 }}>{speed}fps</span>
            </label>
            <button onClick={handleNodesBtn} style={{
              padding: "4px 10px", fontSize: 13, cursor: "pointer",
              border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
              background: showPanel && sidebarTab === "nodes" ? "var(--color-text-secondary)" : "var(--color-background-secondary)",
              color: showPanel && sidebarTab === "nodes" ? "var(--color-background-primary)" : "var(--color-text-secondary)"
            }}>
              Nodes{selectedNodes.size > 0 ? ` (${selectedNodes.size})` : ""}
            </button>
            {hasMessages && (
              <button onClick={handleMessagesBtn} style={{
                padding: "4px 10px", fontSize: 13, cursor: "pointer",
                border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
                background: showPanel && sidebarTab === "messages" ? "#3b82f6" : "var(--color-background-secondary)",
                color: showPanel && sidebarTab === "messages" ? "#fff" : "var(--color-text-secondary)"
              }}>
                Messages{selectedMessage ? ` #${selectedMessage}` : ""}
              </button>
            )}
            <div style={{ position: "relative" }}>
              <button onClick={() => setShowLegend(v => !v)} style={{
                padding: "4px 10px", fontSize: 13, cursor: "pointer",
                border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
                background: showLegend ? "var(--color-text-secondary)" : "var(--color-background-secondary)",
                color: showLegend ? "var(--color-background-primary)" : "var(--color-text-secondary)"
              }}>
                Legend
              </button>
              {showLegend && (
                <div style={{
                  position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 30,
                  width: 280, padding: "12px 14px", borderRadius: "var(--border-radius-md)",
                  border: "0.5px solid var(--color-border-secondary)",
                  background: "var(--color-background-secondary)",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
                  display: "flex", flexDirection: "column", gap: 10
                }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      Nodes
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <LegendRow
                        preview={<div style={{ width: 10, height: 10, borderRadius: "50%", background: "hsl(200,80%,60%)" }} />}
                        label="Node (no filter active)"
                      />
                      <LegendRow
                        preview={<div style={{ width: 10, height: 10, borderRadius: "50%", background: "rgba(100,100,100,0.5)" }} />}
                        label="Unselected node (filter active)"
                      />
                      <LegendRow
                        preview={<div style={{ width: 12, height: 12, borderRadius: "50%", background: "#22c55e", border: "1.5px solid rgba(255,255,255,0.7)" }} />}
                        label="Selected node (your chosen color)"
                      />
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      Encounters
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <LegendRow
                        preview={<div style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid rgba(251,191,36,0.9)" }} />}
                        label="Encounter between two selected nodes"
                      />
                      <LegendRow
                        preview={<div style={{ width: 6, height: 6, borderRadius: 1, background: "rgba(251,191,36,0.9)" }} />}
                        label="Encounter tick on timeline"
                      />
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      Messages
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <LegendRow
                        preview={<TrianglePreview fill="#000000" />}
                        label="Message carrier (not in your selection)"
                      />
                      <LegendRow
                        preview={<TrianglePreview fill="#22c55e" />}
                        label="Message carrier (also a selected node)"
                      />
                      <LegendRow
                        preview={
                          <div style={{ position: "relative", width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <div style={{ position: "absolute", width: 16, height: 16, borderRadius: "50%", background: "rgba(34,197,94,0.25)" }} />
                            <TrianglePreview fill="#000000" />
                          </div>
                        }
                        label="Destination — message delivered (✓ dest)"
                      />
                      <LegendRow
                        preview={<span style={{ fontSize: 10, color: "var(--color-text-secondary)" }}>"origin"</span>}
                        label="Label marking the message's origin node"
                      />
                      <LegendRow
                        preview={<div style={{ width: 6, height: 6, borderRadius: 1, background: "rgba(59,130,246,0.9)" }} />}
                        label="Transfer tick on timeline"
                      />
                      <LegendRow
                        preview={<div style={{ width: 3, height: 14, borderRadius: 2, background: "#22c55e" }} />}
                        label="Delivery marker on timeline"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
            <label style={{
              cursor: "pointer", fontSize: 12, padding: "4px 10px",
              border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
              background: "var(--color-background-secondary)", color: "var(--color-text-secondary)"
            }}>
              reload
              <input type="file" accept=".jsonl,.gz" onChange={handleFile} style={{ display: "none" }} />
            </label>
          </div>

          {/* main area */}
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            <div style={{ flex: 1, minWidth: 0, position: "relative" }} onClick={handleCanvasClick}>
              <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%", background: "var(--color-background-primary)" }} />
              {clickedNode !== null && (
                <div style={{
                  position: "fixed", left: tooltipPos.x + 14, top: tooltipPos.y - 10,
                  background: "rgba(0,0,0,0.75)", color: "#fff",
                  padding: "3px 8px", borderRadius: 4, fontSize: 12,
                  pointerEvents: "none", zIndex: 20, whiteSpace: "nowrap"
                }}>
                  Node {clickedNode}
                </div>
              )}
            </div>

            {showPanel && (
              <div style={{
                width: 220, borderLeft: "0.5px solid var(--color-border-tertiary)",
                display: "flex", flexDirection: "column", overflow: "hidden",
                background: "var(--color-background-secondary)"
              }}>

                {/* ── NODES TAB ── */}
                {sidebarTab === "nodes" && (
                  <>
                    <div style={{ padding: "10px 12px", borderBottom: "0.5px solid var(--color-border-tertiary)", display: "flex", flexDirection: "column", gap: 8 }}>
                      <input
                        type="text" placeholder="Search node ID…" value={nodeSearch}
                        onChange={e => setNodeSearch(e.target.value)}
                        style={{
                          width: "100%", padding: "5px 8px", fontSize: 13, boxSizing: "border-box",
                          border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
                          background: "var(--color-background-primary)", color: "var(--color-text-primary)"
                        }}
                      />
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => setFilterMode("highlight")} style={{
                          flex: 1, padding: "4px 0", fontSize: 12, cursor: "pointer",
                          border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
                          background: filterMode === "highlight" ? "#ef4444" : "var(--color-background-primary)",
                          color: filterMode === "highlight" ? "#fff" : "var(--color-text-secondary)"
                        }}>Highlight</button>
                        <button onClick={() => setFilterMode("isolate")} style={{
                          flex: 1, padding: "4px 0", fontSize: 12, cursor: "pointer",
                          border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
                          background: filterMode === "isolate" ? "#ef4444" : "var(--color-background-primary)",
                          color: filterMode === "isolate" ? "#fff" : "var(--color-text-secondary)"
                        }}>Isolate</button>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={selectAllNodes} style={{
                          flex: 1, padding: "3px 0", fontSize: 11, cursor: "pointer",
                          border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
                          background: "var(--color-background-primary)", color: "var(--color-text-secondary)"
                        }}>Select all</button>
                        <button onClick={clearNodes} style={{
                          flex: 1, padding: "3px 0", fontSize: 11, cursor: "pointer",
                          border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
                          background: "var(--color-background-primary)", color: "var(--color-text-secondary)"
                        }}>Clear</button>
                      </div>
                      <span style={{ fontSize: 11, color: "var(--color-text-secondary)", opacity: 0.6 }}>
                        {selectedNodes.size}/{MAX_SELECTED_NODES} selected
                      </span>
                    </div>

                    <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
                      {filteredNodeIds.map(id => {
                        const isSelected = selectedNodes.has(id);
                        const color = nodeColors[id] ?? "#ef4444";
                        return (
                          <label key={id} style={{
                            display: "flex", alignItems: "center", gap: 8, padding: "4px 6px",
                            borderRadius: "var(--border-radius-md)", cursor: "pointer", fontSize: 13,
                            background: isSelected ? `${color}1f` : "transparent",
                            color: isSelected ? color : "var(--color-text-secondary)"
                          }}>
                            <input
                              type="checkbox" checked={isSelected} onChange={() => toggleNode(id)}
                              disabled={!isSelected && selectedNodes.size >= MAX_SELECTED_NODES}
                              style={{ accentColor: color }}
                            />
                            {isSelected && (
                              <input
                                type="color" value={color}
                                onClick={e => e.stopPropagation()}
                                onChange={e => setNodeColor(id, e.target.value)}
                                title="Change color"
                                style={{
                                  width: 14, height: 14, padding: 0, border: "none",
                                  borderRadius: 2, cursor: "pointer", background: "none", flexShrink: 0
                                }}
                              />
                            )}
                            Node {id}
                          </label>
                        );
                      })}
                    </div>

                    {selectedNodes.size > 0 && hasEncounters && (
                      <div style={{ borderTop: "0.5px solid var(--color-border-tertiary)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(251,191,36,0.9)" }}>Encounters</span>
                          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--color-text-secondary)", cursor: "pointer" }}>
                            <input type="checkbox" checked={showEncounters} onChange={e => setShowEncounters(e.target.checked)} style={{ accentColor: "#fbbf24" }} />
                            show
                          </label>
                        </div>
                        {showEncounters && (
                          currentEncounters.length > 0 ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                              {currentEncounters.map((enc, i) => (
                                <div key={i} style={{
                                  fontSize: 12, padding: "3px 6px", borderRadius: "var(--border-radius-md)",
                                  background: "rgba(251,191,36,0.1)", color: "rgba(251,191,36,0.9)"
                                }}>
                                  {enc.n1} ↔ {enc.n2}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span style={{ fontSize: 12, color: "var(--color-text-secondary)", opacity: 0.5 }}>none at this time</span>
                          )
                        )}
                      </div>
                    )}
                  </>
                )}

                {/* ── MESSAGES TAB ── */}
                {sidebarTab === "messages" && (
                  <>
                    <div style={{ padding: "10px 12px", borderBottom: "0.5px solid var(--color-border-tertiary)", display: "flex", flexDirection: "column", gap: 8 }}>
                      <input
                        type="text" placeholder="Search message ID…" value={msgSearch}
                        onChange={e => setMsgSearch(e.target.value)}
                        style={{
                          width: "100%", padding: "5px 8px", fontSize: 13, boxSizing: "border-box",
                          border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
                          background: "var(--color-background-primary)", color: "var(--color-text-primary)"
                        }}
                      />
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-text-secondary)", cursor: "pointer" }}>
                        <input type="checkbox" checked={onlyDelivered} onChange={e => setOnlyDelivered(e.target.checked)} style={{ accentColor: "#22c55e" }} />
                        Delivered only
                      </label>
                      {selectedMessage && msgInfo && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "6px 8px", borderRadius: "var(--border-radius-md)", background: "rgba(59,130,246,0.1)" }}>
                          <span style={{ fontSize: 12, color: "#3b82f6", fontWeight: 600 }}>Msg #{selectedMessage}</span>
                          <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>Origin: Node {msgInfo.origin}</span>
                          <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>Dest: Node {msgInfo.dest}</span>
                          <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>Carriers: {carriers.size}</span>
                          <span style={{ fontSize: 11, color: delivered ? "#22c55e" : "var(--color-text-secondary)" }}>
                            {delivered ? "✓ Delivered" : "In transit"}
                          </span>
                          {data.deliveredPaths[selectedMessage] && (
                            <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                              Focused on {data.deliveredPaths[selectedMessage].length} path node{data.deliveredPaths[selectedMessage].length === 1 ? "" : "s"}
                            </span>
                          )}
                          <button onClick={() => setSelectedMessage(null)} style={{
                            marginTop: 2, padding: "2px 0", fontSize: 11, cursor: "pointer",
                            border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
                            background: "var(--color-background-primary)", color: "var(--color-text-secondary)"
                          }}>Clear</button>
                        </div>
                      )}
                    </div>

                    <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
                      {filteredMessageIds.map(id => {
                        const info = data.messageOrigins[id];
                        const isDelivered = data.deliveredPaths[id] !== undefined;
                        return (
                          <div
                            key={id}
                            onClick={() => handleMessageClick(id)}
                            style={{
                              padding: "5px 8px", borderRadius: "var(--border-radius-md)", cursor: "pointer",
                              background: selectedMessage === id ? "rgba(59,130,246,0.15)" : "transparent",
                              display: "flex", flexDirection: "column", gap: 1
                            }}
                          >
                            <span style={{ fontSize: 13, color: selectedMessage === id ? "#3b82f6" : "var(--color-text-primary)", display: "flex", alignItems: "center", gap: 6 }}>
                              #{id}
                              {isDelivered && <span style={{ fontSize: 10, color: "#22c55e" }} title="Delivered">✓</span>}
                            </span>
                            {info && (
                              <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                                {info.origin} → {info.dest}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* timeline */}
          <div style={{
            padding: "10px 12px", borderTop: "0.5px solid var(--color-border-tertiary)",
            display: "flex", alignItems: "center", gap: 12
          }}>
            <button
              onClick={() => setPlaying(p => !p)}
              style={{
                width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center",
                border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
                background: "var(--color-background-secondary)", cursor: "pointer", flexShrink: 0
              }}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? "⏸" : "▶"}
            </button>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
              {showEncounters && encounterTicks.size > 0 && (
                <div style={{ position: "relative", height: 8 }}>
                  {[...encounterTicks].map(idx => (
                    <div key={idx} onClick={() => { setPlaying(false); setFrameIdx(idx); }}
                      title={formatTime(data.frames[idx].t)}
                      style={{
                        position: "absolute", cursor: "pointer",
                        left: `${(idx / (data.frames.length - 1)) * 100}%`,
                        top: 1, width: 6, height: 6, borderRadius: 1, transform: "translateX(-50%)",
                        background: idx === frameIdx ? "rgba(251,191,36,1)" : "rgba(251,191,36,0.65)",
                      }}
                    />
                  ))}
                </div>
              )}
              {transferTicks.size > 0 && (
                <div style={{ position: "relative", height: 8 }}>
                  {[...transferTicks].map(idx => (
                    <div key={idx} onClick={() => { setPlaying(false); setFrameIdx(idx); }}
                      title={formatTime(data.frames[idx].t)}
                      style={{
                        position: "absolute", cursor: "pointer",
                        left: `${(idx / (data.frames.length - 1)) * 100}%`,
                        top: 1, width: 6, height: 6, borderRadius: 1, transform: "translateX(-50%)",
                        background: idx === frameIdx ? "rgba(59,130,246,1)" : "rgba(59,130,246,0.65)",
                      }}
                    />
                  ))}
                </div>
              )}
              <div style={{ position: "relative" }}>
                <input
                  type="range" min={0} max={data.frames.length - 1} step={1} value={frameIdx}
                  onChange={e => { setPlaying(false); setFrameIdx(Number(e.target.value)); }}
                  style={{ width: "100%" }} aria-label="Timeline scrubber"
                />
                {deliveryFrameIdx !== null && (
                  <div
                    onClick={() => { setPlaying(false); setFrameIdx(deliveryFrameIdx); }}
                    title={`Delivered · ${formatTime(data.frames[deliveryFrameIdx].t)}`}
                    style={{
                      position: "absolute",
                      left: `${(deliveryFrameIdx / (data.frames.length - 1)) * 100}%`,
                      top: "50%", transform: "translate(-50%, -50%)",
                      width: 3, height: 18,
                      background: deliveryFrameIdx === frameIdx ? "#22c55e" : "rgba(34,197,94,0.85)",
                      borderRadius: 2,
                      cursor: "pointer",
                      pointerEvents: "all",
                      zIndex: 2,
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
