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

function drawGraph(canvas, panelEl, { series, frameT, tMin, tMax, title, names, stepLine = false }) {
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

    if (stepLine) {
      for (let i = 1; i < visible.length; i++) {
        ctx.lineTo(toX(visible[i].t), toY(visible[i - 1].v)); // horizontal
        ctx.lineTo(toX(visible[i].t), toY(visible[i].v));     // vertical
      }
      // extend flat line to current time
      ctx.lineTo(toX(Math.min(frameT, tMax)), toY(visible[visible.length - 1].v));
    } else {
      for (let i = 1; i < visible.length; i++) ctx.lineTo(toX(visible[i].t), toY(visible[i].v));
    }
    ctx.stroke();

    // Dot at current end
    const last = visible[visible.length - 1];
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(stepLine ? toX(Math.min(frameT, tMax)) : toX(last.t), toY(last.v), 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Legend when two experiments
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

// Build per-message copies time series accounting for transfers and drops
function buildMsgCopies(data, selectedMessage, color) {
  const msgInfo = data.messageOrigins?.[selectedMessage];
  if (!msgInfo) return null;
  const xfers = data.transfers?.[selectedMessage] ?? [];
  const drops = (data.drops?.[selectedMessage] ?? []);

  const pts = [{ t: msgInfo.created, v: 1 }];
  let xi = 0, di = 0, copies = 1;
  while (xi < xfers.length || di < drops.length) {
    const nx = xfers[xi], nd = drops[di];
    if (nx && (!nd || nx.t <= nd.t)) {
      copies++;
      pts.push({ t: nx.t, v: copies });
      xi++;
    } else if (nd) {
      copies = Math.max(0, copies - 1);
      pts.push({ t: nd.t, v: copies });
      di++;
    }
  }
  return { pts, color };
}

function buildMsgTransfers(data, selectedMessage, color) {
  const xfers = data.transfers?.[selectedMessage] ?? [];
  let sum = 0;
  return { pts: xfers.map((x) => ({ t: x.t, v: ++sum })), color };
}

export default function MetricsOverlay({
  visible, onClose, data1, data2, frameIdx,
  expName1, expName2, selectedMessage,
}) {
  const [pos, setPos] = useState({ x: 80, y: 120 });
  const windowRef = useRef(null);
  const drawRef = useRef(null);

  // Aggregate panel refs
  const leftAggRef = useRef(null);
  const rightAggRef = useRef(null);
  const copiesRef = useRef(null);
  const xfersRef = useRef(null);

  // Per-message panel refs
  const leftMsgRef = useRef(null);
  const rightMsgRef = useRef(null);
  const msgCopiesRef = useRef(null);
  const msgXfersRef = useRef(null);

  const frameT = data1?.frames[frameIdx]?.t ?? null;
  const tMin = data1?.meta.t_min ?? 0;
  const tMax = data1?.meta.t_max ?? 1;
  const names = [expName1, expName2].filter(Boolean);
  const hasMsg = !!selectedMessage;

  // ── Aggregate series ──────────────────────────────────────────────────────
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

  // ── Per-message series ────────────────────────────────────────────────────
  const msgCopiesSeries = useMemo(() => {
    if (!selectedMessage || !data1) return [];
    const s1 = buildMsgCopies(data1, selectedMessage, EXP_COLORS[0]);
    if (!data2) return s1 ? [s1] : [];
    const s2 = buildMsgCopies(data2, selectedMessage, EXP_COLORS[1]);
    return [s1, s2].filter(Boolean);
  }, [selectedMessage, data1, data2]);

  const msgXfersSeries = useMemo(() => {
    if (!selectedMessage || !data1) return [];
    const s1 = buildMsgTransfers(data1, selectedMessage, EXP_COLORS[0]);
    if (!data2) return [s1];
    return [s1, buildMsgTransfers(data2, selectedMessage, EXP_COLORS[1])];
  }, [selectedMessage, data1, data2]);

  // ── Window sizing ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!windowRef.current) return;
    windowRef.current.style.width = "640px";
    windowRef.current.style.height = hasMsg ? "400px" : "220px";
  }, [visible]); // initial size on show

  useEffect(() => {
    if (!windowRef.current) return;
    windowRef.current.style.height = hasMsg ? "400px" : "220px";
  }, [hasMsg]); // resize when message selection changes

  // ── Drag ──────────────────────────────────────────────────────────────────
  const handleDragStart = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const ox = e.clientX - pos.x, oy = e.clientY - pos.y;
    const onMove = (e) => {
      const el = windowRef.current;
      const w = el?.offsetWidth ?? 0, h = el?.offsetHeight ?? 0;
      setPos({
        x: Math.max(0, Math.min(e.clientX - ox, window.innerWidth - w)),
        y: Math.max(0, Math.min(e.clientY - oy, window.innerHeight - h)),
      });
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [pos.x, pos.y]);

  // ── Draw ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    drawRef.current = () => {
      if (!visible || frameT == null) return;
      const base = { frameT, tMin, tMax, names };
      if (copiesRef.current && leftAggRef.current)
        drawGraph(copiesRef.current, leftAggRef.current, { ...base, series: copiesSeries, title: "Total Message Copies" });
      if (xfersRef.current && rightAggRef.current)
        drawGraph(xfersRef.current, rightAggRef.current, { ...base, series: xfersSeries, title: "Total Message Transfers" });
      if (hasMsg) {
        if (msgCopiesRef.current && leftMsgRef.current)
          drawGraph(msgCopiesRef.current, leftMsgRef.current, { ...base, series: msgCopiesSeries, title: "Msg Copies", stepLine: true });
        if (msgXfersRef.current && rightMsgRef.current)
          drawGraph(msgXfersRef.current, rightMsgRef.current, { ...base, series: msgXfersSeries, title: "Msg Transfers", stepLine: true });
      }
    };
  });

  useEffect(() => { drawRef.current?.(); }, [
    visible, copiesSeries, xfersSeries, msgCopiesSeries, msgXfersSeries, frameT, tMin, tMax, hasMsg,
  ]);

  // Observe the window div — its resize triggers panel reflow, then redraw
  useEffect(() => {
    if (!visible || !windowRef.current) return;
    const ro = new ResizeObserver(() => drawRef.current?.());
    ro.observe(windowRef.current);
    return () => ro.disconnect();
  }, [visible]);

  if (!visible || !data1) return null;

  const panelStyle = { flex: 1, overflow: "hidden", minWidth: 0, minHeight: 0 };
  const canvasStyle = { display: "block" };
  const dividerV = <div style={{ width: 1, background: "rgba(255,255,255,0.08)", flexShrink: 0 }} />;
  const dividerH = <div style={{ height: 1, background: "rgba(255,255,255,0.08)", flexShrink: 0 }} />;

  return (
    <div
      ref={windowRef}
      style={{
        position: "fixed", left: pos.x, top: pos.y, zIndex: 1000,
        background: "rgba(10,12,18,0.95)",
        border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: 6, boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        display: "flex", flexDirection: "column",
        resize: "both", overflow: "hidden",
        minWidth: 360, minHeight: 150,
      }}
    >
      {/* Title bar */}
      <div
        onMouseDown={handleDragStart}
        style={{
          padding: "5px 10px", background: "rgba(255,255,255,0.05)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          cursor: "grab", display: "flex", alignItems: "center",
          justifyContent: "space-between", userSelect: "none", flexShrink: 0,
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
          >×</button>
        </div>
      </div>

      {/* Aggregate graphs */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
        <div ref={leftAggRef} style={panelStyle}>
          <canvas ref={copiesRef} style={canvasStyle} />
        </div>
        {dividerV}
        <div ref={rightAggRef} style={panelStyle}>
          <canvas ref={xfersRef} style={canvasStyle} />
        </div>
      </div>

      {/* Per-message graphs */}
      {hasMsg && (
        <>
          {dividerH}
          <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
            <div ref={leftMsgRef} style={panelStyle}>
              <canvas ref={msgCopiesRef} style={canvasStyle} />
            </div>
            {dividerV}
            <div ref={rightMsgRef} style={panelStyle}>
              <canvas ref={msgXfersRef} style={canvasStyle} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
