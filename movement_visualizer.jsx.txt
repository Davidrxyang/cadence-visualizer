import { useState, useEffect, useRef, useCallback } from "react";

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
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const lastTickRef = useRef(null);

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
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
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

    // trails
    if (showTrails) {
      for (let ti = Math.max(0, frameIdx - TRAIL_LENGTH); ti < frameIdx; ti++) {
        const alpha = (ti - (frameIdx - TRAIL_LENGTH)) / TRAIL_LENGTH * 0.35;
        const frame = frames[ti];
        for (const [idStr, [x, y]] of Object.entries(frame.nodes)) {
          const id = parseInt(idStr);
          const [sx, sy] = toScreen(x, y);
          const hue = hueForNode(id, total);
          ctx.beginPath();
          ctx.arc(sx, sy, NODE_RADIUS * 0.6, 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${hue},80%,60%,${alpha})`;
          ctx.fill();
        }
      }
    }

    // current frame nodes
    const frame = frames[frameIdx];
    for (const [idStr, [x, y]] of Object.entries(frame.nodes)) {
      const id = parseInt(idStr);
      const [sx, sy] = toScreen(x, y);
      const hue = hueForNode(id, total);
      ctx.beginPath();
      ctx.arc(sx, sy, NODE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = `hsl(${hue},80%,60%)`;
      ctx.fill();
    }
  }, [data, frameIdx, showTrails]);

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
    <div style={{ fontFamily: "var(--font-sans)", display: "flex", flexDirection: "column", gap: 0, height: "600px" }}>
      <h2 className="sr-only">Node movement visualizer</h2>

      {!data && (
        <div style={{
          flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 16, border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)",
          background: "var(--color-background-secondary)"
        }}>
          <i className="ti ti-upload" style={{ fontSize: 32, color: "var(--color-text-secondary)" }} aria-hidden="true" />
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
            <label style={{
              cursor: "pointer", fontSize: 12, padding: "4px 10px",
              border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
              background: "var(--color-background-secondary)", color: "var(--color-text-secondary)"
            }}>
              reload
              <input type="file" accept=".jsonl,.gz" onChange={handleFile} style={{ display: "none" }} />
            </label>
          </div>

          <canvas ref={canvasRef} style={{ flex: 1, width: "100%", display: "block", background: "var(--color-background-primary)" }} />

          <div style={{
            padding: "10px 12px", borderTop: "0.5px solid var(--color-border-tertiary)",
            display: "flex", alignItems: "center", gap: 12
          }}>
            <button
              onClick={() => { setPlaying(p => !p); }}
              style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center",
                border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
                background: "var(--color-background-secondary)", cursor: "pointer", flexShrink: 0 }}
              aria-label={playing ? "Pause" : "Play"}
            >
              <i className={`ti ${playing ? "ti-player-pause" : "ti-player-play"}`} style={{ fontSize: 18 }} aria-hidden="true" />
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
