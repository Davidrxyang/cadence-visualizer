import { useState, useEffect, useRef, useCallback, useMemo } from "react";

const TRAIL_LENGTH = 5;
const NODE_RADIUS = 3;

function parseJSONL(text) {
  const lines = text.trim().split("\n");
  let meta = null;
  const frames = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line);
    if (obj.__meta__) {
      meta = obj;
    } else {
      const nodes = {};
      const n = obj.n;
      for (let i = 0; i < n.length; i += 3) {
        nodes[n[i]] = [n[i + 1], n[i + 2]];
      }
      frames.push({ t: obj.t, nodes });
    }
  }
  return { meta, frames };
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
  const [showTrails, setShowTrails] = useState(true);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const [selectedNodes, setSelectedNodes] = useState(new Set());
  const [filterMode, setFilterMode] = useState("highlight"); // "highlight" | "isolate"
  const [showPanel, setShowPanel] = useState(false);
  const [nodeSearch, setNodeSearch] = useState("");

  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const lastTickRef = useRef(null);

  const allNodeIds = useMemo(() => {
    if (!data) return [];
    return Array.from({ length: data.meta.node_count }, (_, i) => i);
  }, [data]);

  const filteredNodeIds = useMemo(() => {
    const q = nodeSearch.trim();
    if (!q) return allNodeIds;
    return allNodeIds.filter(id => String(id).includes(q));
  }, [allNodeIds, nodeSearch]);

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
      setFrameIdx(0);
      setPlaying(false);
      setSelectedNodes(new Set());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleNode = (id) => {
    setSelectedNodes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

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

    const bgColor = (id, alpha) => {
      if (hasSelection && filterMode === "isolate") return null;
      const hue = hueForNode(id, total);
      if (hasSelection) {
        return alpha != null
          ? `rgba(100,100,100,${alpha * 0.25})`
          : "rgba(100,100,100,0.3)";
      }
      return alpha != null ? `hsla(${hue},80%,60%,${alpha})` : `hsl(${hue},80%,60%)`;
    };

    // trails
    if (showTrails) {
      for (let ti = Math.max(0, frameIdx - TRAIL_LENGTH); ti < frameIdx; ti++) {
        const alpha = (ti - (frameIdx - TRAIL_LENGTH)) / TRAIL_LENGTH * 0.35;
        const frame = frames[ti];
        for (const [idStr, [x, y]] of Object.entries(frame.nodes)) {
          const id = parseInt(idStr);
          const isSelected = selectedNodes.has(id);

          if (hasSelection && isSelected) {
            const [sx, sy] = toScreen(x, y);
            ctx.beginPath();
            ctx.arc(sx, sy, NODE_RADIUS * 0.6, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(239,68,68,${alpha})`;
            ctx.fill();
          } else {
            const color = bgColor(id, alpha);
            if (!color) continue;
            const [sx, sy] = toScreen(x, y);
            ctx.beginPath();
            ctx.arc(sx, sy, NODE_RADIUS * 0.6, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
          }
        }
      }
    }

    // current frame — background nodes first, selected on top
    const frame = frames[frameIdx];
    const entries = Object.entries(frame.nodes);

    for (const [idStr, [x, y]] of entries) {
      const id = parseInt(idStr);
      if (hasSelection && selectedNodes.has(id)) continue;
      const color = bgColor(id, null);
      if (!color) continue;
      const [sx, sy] = toScreen(x, y);
      ctx.beginPath();
      ctx.arc(sx, sy, NODE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }

    if (hasSelection) {
      for (const [idStr, [x, y]] of entries) {
        const id = parseInt(idStr);
        if (!selectedNodes.has(id)) continue;
        const [sx, sy] = toScreen(x, y);
        ctx.beginPath();
        ctx.arc(sx, sy, NODE_RADIUS * 2, 0, Math.PI * 2);
        ctx.fillStyle = "#ef4444";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(sx, sy, NODE_RADIUS * 2, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }, [data, frameIdx, showTrails, selectedNodes, filterMode]);

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

  const nodeCount = data ? Object.keys(data.frames[frameIdx]?.nodes ?? {}).length : 0;

  return (
    <div style={{ fontFamily: "var(--font-sans)", display: "flex", flexDirection: "column", height: "100vh" }}>
      {!data && (
        <div style={{
          flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 16, border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)",
          background: "var(--color-background-secondary)"
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
          <div style={{
            display: "flex", alignItems: "center", gap: 16, padding: "8px 12px",
            borderBottom: "0.5px solid var(--color-border-tertiary)", flexWrap: "wrap"
          }}>
            <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
              {formatTime(data.frames[frameIdx].t)}
            </span>
            <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
              {nodeCount} nodes visible
            </span>
            <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
              frame {frameIdx + 1} / {data.frames.length}
            </span>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--color-text-secondary)", marginLeft: "auto" }}>
              <input type="checkbox" checked={showTrails} onChange={e => setShowTrails(e.target.checked)} />
              trails
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--color-text-secondary)" }}>
              speed
              <input type="range" min="1" max="60" step="1" value={speed}
                onChange={e => setSpeed(Number(e.target.value))}
                style={{ width: 80 }} />
              <span style={{ minWidth: 28 }}>{speed}fps</span>
            </label>
            <button
              onClick={() => setShowPanel(p => !p)}
              style={{
                padding: "4px 10px", fontSize: 13, cursor: "pointer",
                border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
                background: showPanel ? "var(--color-text-secondary)" : "var(--color-background-secondary)",
                color: showPanel ? "var(--color-background-primary)" : "var(--color-text-secondary)"
              }}
            >
              Nodes{selectedNodes.size > 0 ? ` (${selectedNodes.size})` : ""}
            </button>
            <label style={{
              cursor: "pointer", fontSize: 12, padding: "4px 10px",
              border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
              background: "var(--color-background-secondary)", color: "var(--color-text-secondary)"
            }}>
              reload
              <input type="file" accept=".jsonl,.gz" onChange={handleFile} style={{ display: "none" }} />
            </label>
          </div>

          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            <canvas ref={canvasRef} style={{ flex: 1, minWidth: 0, display: "block", background: "var(--color-background-primary)" }} />

            {showPanel && (
              <div style={{
                width: 220, borderLeft: "0.5px solid var(--color-border-tertiary)",
                display: "flex", flexDirection: "column", overflow: "hidden",
                background: "var(--color-background-secondary)"
              }}>
                <div style={{ padding: "10px 12px", borderBottom: "0.5px solid var(--color-border-tertiary)", display: "flex", flexDirection: "column", gap: 8 }}>
                  <input
                    type="text"
                    placeholder="Search node ID…"
                    value={nodeSearch}
                    onChange={e => setNodeSearch(e.target.value)}
                    style={{
                      width: "100%", padding: "5px 8px", fontSize: 13, boxSizing: "border-box",
                      border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
                      background: "var(--color-background-primary)", color: "var(--color-text-primary)"
                    }}
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => setFilterMode("highlight")}
                      style={{
                        flex: 1, padding: "4px 0", fontSize: 12, cursor: "pointer",
                        border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
                        background: filterMode === "highlight" ? "#ef4444" : "var(--color-background-primary)",
                        color: filterMode === "highlight" ? "#fff" : "var(--color-text-secondary)"
                      }}
                    >
                      Highlight
                    </button>
                    <button
                      onClick={() => setFilterMode("isolate")}
                      style={{
                        flex: 1, padding: "4px 0", fontSize: 12, cursor: "pointer",
                        border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
                        background: filterMode === "isolate" ? "#ef4444" : "var(--color-background-primary)",
                        color: filterMode === "isolate" ? "#fff" : "var(--color-text-secondary)"
                      }}
                    >
                      Isolate
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => setSelectedNodes(new Set(filteredNodeIds))}
                      style={{
                        flex: 1, padding: "3px 0", fontSize: 11, cursor: "pointer",
                        border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
                        background: "var(--color-background-primary)", color: "var(--color-text-secondary)"
                      }}
                    >
                      Select all
                    </button>
                    <button
                      onClick={() => setSelectedNodes(new Set())}
                      style={{
                        flex: 1, padding: "3px 0", fontSize: 11, cursor: "pointer",
                        border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
                        background: "var(--color-background-primary)", color: "var(--color-text-secondary)"
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
                  {filteredNodeIds.map(id => (
                    <label
                      key={id}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "4px 6px",
                        borderRadius: "var(--border-radius-md)", cursor: "pointer", fontSize: 13,
                        background: selectedNodes.has(id) ? "rgba(239,68,68,0.12)" : "transparent",
                        color: selectedNodes.has(id) ? "#ef4444" : "var(--color-text-secondary)"
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedNodes.has(id)}
                        onChange={() => toggleNode(id)}
                        style={{ accentColor: "#ef4444" }}
                      />
                      Node {id}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div style={{
            padding: "10px 12px", borderTop: "0.5px solid var(--color-border-tertiary)",
            display: "flex", alignItems: "center", gap: 12
          }}>
            <button
              onClick={() => { setPlaying(p => !p); }}
              style={{
                width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center",
                border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
                background: "var(--color-background-secondary)", cursor: "pointer", flexShrink: 0
              }}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? "⏸" : "▶"}
            </button>
            <input
              type="range"
              min={0}
              max={data.frames.length - 1}
              step={1}
              value={frameIdx}
              onChange={e => { setPlaying(false); setFrameIdx(Number(e.target.value)); }}
              style={{ flex: 1 }}
              aria-label="Timeline scrubber"
            />
          </div>
        </>
      )}
    </div>
  );
}
