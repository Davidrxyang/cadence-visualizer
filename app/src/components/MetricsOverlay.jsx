import { useRef, useEffect, useMemo, useState, useCallback } from "react";

const EXP_COLORS = ["#3b82f6", "#22c55e"];
const PAD = { top: 18, right: 10, bottom: 22, left: 46 };

function fmt(v) {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1) + "K";
  return Math.round(v).toString();
}

function niceMax(v) {
  if (v === 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / mag) * mag;
}

function drawGraph(canvas, panelEl, { series, frameT, tMin, tMax, title, names }) {
  const W = (canvas.width = panelEl.offsetWidth);
  const H = (canvas.height = panelEl.offsetHeight);
  if (W === 0 || H === 0) return;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);

  const gW = W - PAD.left - PAD.right;
  const gH = H - PAD.top - PAD.bottom;
  if (gW <= 0 || gH <= 0) return;

  let rawMax = 0;
  for (const s of series) for (const p of s.pts) if (p.v > rawMax) rawMax = p.v;
  const yMax = niceMax(rawMax);

  const toX = (t) => PAD.left + ((t - tMin) / (tMax - tMin)) * gW;
  const toY = (v) => PAD.top + gH - (v / yMax) * gH;

  // Grid
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  for (let i = 0; i <= 4; i++) {
    const y = PAD.top + (gH * i) / 4;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + gW, y); ctx.stroke();
  }

  // Y axis labels
  ctx.fillStyle = "rgba(156,163,175,0.75)";
  ctx.font = "9px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i++) {
    ctx.fillText(fmt(yMax * (1 - i / 4)), PAD.left - 4, PAD.top + (gH * i) / 4);
  }

  // X axis labels
  ctx.fillStyle = "rgba(156,163,175,0.6)";
  ctx.font = "8px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const totalDays = Math.round((tMax - tMin) / 86400);
  const dayStep = totalDays <= 35 ? 5 : totalDays <= 70 ? 10 : 15;
  for (let d = 0; d <= totalDays; d += dayStep) {
    const x = toX(tMin + d * 86400);
    if (x < PAD.left || x > PAD.left + gW) continue;
    ctx.fillText(`${d}d`, x, PAD.top + gH + 4);
  }

  // Title
  ctx.fillStyle = "rgba(209,213,219,0.9)";
  ctx.font = "10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(title, PAD.left + gW / 2, 3);

  // Now marker
  const nowX = toX(Math.min(frameT, tMax));
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(nowX, PAD.top); ctx.lineTo(nowX, PAD.top + gH); ctx.stroke();
  ctx.setLineDash([]);

  // Lines up to frameT
  for (const s of series) {
    const visible = s.pts.filter((p) => p.t <= frameT);
    if (!visible.length) continue;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(toX(visible[0].t), toY(visible[0].v));
    for (let i = 1; i < visible.length; i++) ctx.lineTo(toX(visible[i].t), toY(visible[i].v));
    ctx.stroke();
    const last = visible[visible.length - 1];
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(toX(last.t), toY(last.v), 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Legend
  if (series.length > 1 && names?.length) {
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.font = "9px system-ui, sans-serif";
    for (let i = 0; i < series.length; i++) {
      ctx.fillStyle = series[i].color;
      ctx.fillText("● " + (names[i] ?? `Protocol ${i + 1}`).slice(0, 22), PAD.left + gW - 2, PAD.top + 4 + i * 13);
    }
  }
}

export default function MetricsOverlay({ visible, onClose, data1, data2, frameIdx, expName1, expName2 }) {
  const [pos, setPos] = useState({ x: 80, y: 120 });
  const windowRef = useRef(null);
  const leftPanelRef = useRef(null);
  const rightPanelRef = useRef(null);
  const copiesRef = useRef(null);
  const xfersRef = useRef(null);
  const drawRef = useRef(null);

  const frameT = data1?.frames[frameIdx]?.t ?? null;
  const tMin = data1?.meta.t_min ?? 0;
  const tMax = data1?.meta.t_max ?? 1;
  const names = [expName1, expName2].filter(Boolean);

  const copiesSeries = useMemo(() => {
    if (!data1?.epochLoads) return [];
    const s1 = { pts: data1.epochLoads.map((e) => ({ t: e.t, v: e.load })), color: EXP_COLORS[0] };
    if (!data2?.epochLoads) return [s1];
    return [s1, { pts: data2.epochLoads.map((e) => ({ t: e.t, v: e.load })), color: EXP_COLORS[1] }];
  }, [data1, data2]);

  const xfersSeries = useMemo(() => {
    if (!data1?.bandwidths) return [];
    const build = (bws, color) => {
      let sum = 0;
      return { pts: bws.map((b) => { sum += b.bw; return { t: b.t, v: sum }; }), color };
    };
    const s1 = build(data1.bandwidths, EXP_COLORS[0]);
    if (!data2?.bandwidths) return [s1];
    return [s1, build(data2.bandwidths, EXP_COLORS[1])];
  }, [data1, data2]);

  // Set initial window size imperatively so CSS resize can manage it after
  useEffect(() => {
    if (!windowRef.current) return;
    windowRef.current.style.width = "640px";
    windowRef.current.style.height = "220px";
  }, [visible]); // runs each time the window is shown

  // Drag handling
  const handleDragStart = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const ox = e.clientX - pos.x;
    const oy = e.clientY - pos.y;
    const onMove = (e) => {
      const el = windowRef.current;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = el ? el.offsetWidth : 0;
      const h = el ? el.offsetHeight : 0;
      setPos({
        x: Math.max(0, Math.min(e.clientX - ox, vw - w)),
        y: Math.max(0, Math.min(e.clientY - oy, vh - h)),
      });
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [pos.x, pos.y]);

  // Keep draw fn current (closure over latest data) without re-creating ResizeObserver
  useEffect(() => {
    drawRef.current = () => {
      if (!visible || frameT == null) return;
      const args = { frameT, tMin, tMax, names };
      if (copiesRef.current && leftPanelRef.current)
        drawGraph(copiesRef.current, leftPanelRef.current, { ...args, series: copiesSeries, title: "Total Message Copies" });
      if (xfersRef.current && rightPanelRef.current)
        drawGraph(xfersRef.current, rightPanelRef.current, { ...args, series: xfersSeries, title: "Total Message Transfers" });
    };
  });

  // Redraw when data or frame changes
  useEffect(() => { drawRef.current?.(); }, [visible, copiesSeries, xfersSeries, frameT, tMin, tMax]);

  // ResizeObserver on the panel containers (NOT the canvases — avoids infinite loop)
  useEffect(() => {
    if (!visible) return;
    const ro = new ResizeObserver(() => drawRef.current?.());
    if (leftPanelRef.current) ro.observe(leftPanelRef.current);
    if (rightPanelRef.current) ro.observe(rightPanelRef.current);
    return () => ro.disconnect();
  }, [visible]);

  if (!visible || !data1) return null;

  return (
    <div
      ref={windowRef}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        zIndex: 1000,
        background: "rgba(10,12,18,0.95)",
        border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: 6,
        boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        display: "flex",
        flexDirection: "column",
        resize: "both",
        overflow: "hidden",
        minWidth: 360,
        minHeight: 150,
      }}
    >
      {/* Title bar / drag handle */}
      <div
        onMouseDown={handleDragStart}
        style={{
          padding: "5px 10px",
          background: "rgba(255,255,255,0.05)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          cursor: "grab",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          userSelect: "none",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 11, color: "rgba(209,213,219,0.85)", fontWeight: 500, letterSpacing: "0.02em" }}>
          Protocol Metrics
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: "rgba(156,163,175,0.5)" }}>drag · resize ↘</span>
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={onClose}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "rgba(156,163,175,0.6)", fontSize: 14, lineHeight: 1,
              padding: "0 2px", display: "flex", alignItems: "center",
            }}
          >
            ×
          </button>
        </div>
      </div>

      {/* Graphs — panel refs are on the divs, canvases follow their parent size */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
        <div ref={leftPanelRef} style={{ flex: 1, overflow: "hidden", minWidth: 0 }}>
          <canvas ref={copiesRef} style={{ display: "block" }} />
        </div>
        <div style={{ width: 1, background: "rgba(255,255,255,0.08)", flexShrink: 0 }} />
        <div ref={rightPanelRef} style={{ flex: 1, overflow: "hidden", minWidth: 0 }}>
          <canvas ref={xfersRef} style={{ display: "block" }} />
        </div>
      </div>
    </div>
  );
}
