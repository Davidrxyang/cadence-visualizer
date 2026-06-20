import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { DEFAULT_NODE_RADIUS, MAX_SELECTED_NODES, ENCOUNTER_BUCKET_SECONDS } from "./lib/constants";
import { NODE_COLOR_PALETTE } from "./lib/colors";
import { parseJSONL, formatTime } from "./lib/parse";
import { renderFrame } from "./lib/canvasDraw";
import Header from "./components/Header";
import NodesPanel from "./components/NodesPanel";
import MessagesPanel from "./components/MessagesPanel";
import EncountersPanel from "./components/EncountersPanel";
import Timeline from "./components/Timeline";
import EncounterPopup from "./components/EncounterPopup";

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
  const [hideCarriers, setHideCarriers] = useState(false);

  const [encSearch, setEncSearch] = useState("");
  const [expandedEncGroupT, setExpandedEncGroupT] = useState(null);
  const [encounterPopup, setEncounterPopup] = useState(null);

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

  // flat index of all message transfers (across every message) keyed by node pair,
  // so a given encounter's two nodes can be looked up directly without scanning every message
  const transfersByNodePair = useMemo(() => {
    if (!data?.transfers) return {};
    const map = {};
    for (const msgId of Object.keys(data.transfers)) {
      for (const xfer of data.transfers[msgId]) {
        const key = xfer.from < xfer.to ? `${xfer.from}-${xfer.to}` : `${xfer.to}-${xfer.from}`;
        (map[key] ??= []).push(xfer);
      }
    }
    return map;
  }, [data]);

  const getMessagesForEncounter = (enc) => {
    const key = enc.n1 < enc.n2 ? `${enc.n1}-${enc.n2}` : `${enc.n2}-${enc.n1}`;
    const candidates = transfersByNodePair[key] ?? [];
    return candidates.filter(x => x.t >= enc.t && x.t < enc.t + enc.dur);
  };

  // Encounters grouped into 1-hour buckets for the browsable Encounters menu.
  // Grouping by exact timestamp produced one row per encounter (tens of thousands),
  // which was far too slow to render/filter — wide buckets keep the group count small.
  const encounterGroups = useMemo(() => {
    if (!data?.encounters.length) return [];
    const map = {};
    for (const enc of data.encounters) {
      const bucket = Math.floor(enc.t / ENCOUNTER_BUCKET_SECONDS) * ENCOUNTER_BUCKET_SECONDS;
      (map[bucket] ??= []).push(enc);
    }
    return Object.keys(map).map(Number).sort((a, b) => a - b).map(t => ({ t, encounters: map[t] }));
  }, [data]);

  const filteredEncounterGroups = useMemo(() => {
    const q = encSearch.trim().toLowerCase();
    if (!q) return encounterGroups;
    return encounterGroups.filter(g => formatTime(g.t).toLowerCase().includes(q) || String(g.t).includes(q));
  }, [encounterGroups, encSearch]);

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
      setEncSearch("");
      setExpandedEncGroupT(null);
      setEncounterPopup(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoHome = () => {
    setData(null);
    setFileName(null);
    setError(null);
    setFrameIdx(0);
    setPlaying(false);
    setSelectedNodes(new Set());
    setNodeColors({});
    setSelectedMessage(null);
    setOnlyDelivered(false);
    setClickedNode(null);
    setShowPanel(false);
    setShowLegend(false);
    setSidebarTab("nodes");
    setEncSearch("");
    setExpandedEncGroupT(null);
    setEncounterPopup(null);
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

  // Nodes "relevant" to a message: its delivered path if it has one, otherwise
  // the origin plus every node the message has been handed off to so far.
  const getRelevantNodesForMessage = (msgId) => {
    const path = data.deliveredPaths[msgId];
    if (path) return path;
    const origin = data.messageOrigins[msgId]?.origin;
    const ids = [];
    const seen = new Set();
    if (origin !== undefined) { ids.push(origin); seen.add(origin); }
    for (const xfer of (data.transfers[msgId] ?? [])) {
      if (!seen.has(xfer.to)) { seen.add(xfer.to); ids.push(xfer.to); }
    }
    return ids;
  };

  const handleMessageClick = (id) => {
    setSelectedMessage(prev => {
      const next = prev === id ? null : id;
      if (next !== null) {
        const nodes = getRelevantNodesForMessage(next);
        if (nodes.length) focusOnPathNodes(nodes);
      }
      return next;
    });
  };

  // jump the scrubber to the frame nearest a given timestamp (falls back to the
  // last frame at or before it, since exact buckets can have gaps in the data)
  const findFrameIdxForTime = (t) => {
    if (!data) return null;
    const { bucket } = data.meta;
    const bucketed = Math.floor(t / bucket) * bucket;
    const exact = frameIdxMap.get(bucketed);
    if (exact !== undefined) return exact;
    const frames = data.frames;
    let lo = 0, hi = frames.length - 1, best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (frames[mid].t <= bucketed) { best = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return best;
  };

  const openEncounterPopup = (enc) => {
    setEncounterPopup(enc);
    const idx = findFrameIdxForTime(enc.t);
    if (idx !== null) { setPlaying(false); setFrameIdx(idx); }
  };

  const handlePopupMessageClick = (msgId) => {
    setEncounterPopup(null);
    setShowPanel(true);
    setSidebarTab("messages");
    handleMessageClick(msgId);
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
    renderFrame(ctx, canvas.width, canvas.height, {
      data, frameIdx, selectedNodes, nodeColors, nodeSize, filterMode,
      showEncounters, encountersByNode, selectedMessage, carriers, hideCarriers,
    });
  }, [data, frameIdx, selectedNodes, nodeColors, nodeSize, filterMode, showEncounters,
      encountersByNode, selectedMessage, carriers, hideCarriers]);

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
  const handleEncountersBtn = () => {
    if (showPanel && sidebarTab === "encounters") setShowPanel(false);
    else { setShowPanel(true); setSidebarTab("encounters"); }
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
          gap: 22, background: "var(--color-background-secondary)"
        }}>
          <h1 style={{ fontSize: 28, fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>
            Welcome to the Cadence Simulator Visualizer
          </h1>
          <p style={{ fontSize: 19, color: "var(--color-text-secondary)", margin: 0 }}>
            Please select an experiment
          </p>
          <p style={{ fontSize: 16, color: "var(--color-text-secondary)", opacity: 0.7, margin: 0 }}>
            Load your <code>frames.jsonl</code> or <code>frames.jsonl.gz</code> file
          </p>
          {loading ? (
            <div style={{
              position: "relative", overflow: "hidden", textAlign: "center",
              padding: "11px 26px", borderRadius: "var(--border-radius-md)", fontSize: 17,
              border: "0.5px solid var(--color-border-secondary)",
              background: "var(--color-background-primary)", color: "var(--color-text-primary)"
            }}>
              <span style={{ opacity: 0, userSelect: "none" }}>Choose file</span>
              <div style={{
                position: "absolute", left: 0, top: 0, bottom: 0,
                background: "var(--color-text-primary)", opacity: 0.25,
                animation: "loading-bar-fill 1.4s ease-in-out infinite"
              }} />
            </div>
          ) : (
            <label style={{
              cursor: "pointer", padding: "11px 26px", borderRadius: "var(--border-radius-md)",
              border: "0.5px solid var(--color-border-secondary)", fontSize: 17,
              background: "var(--color-background-primary)", color: "var(--color-text-primary)"
            }}>
              Choose file
              <input type="file" accept=".jsonl,.gz" onChange={handleFile} style={{ display: "none" }} />
            </label>
          )}
          {error && <p style={{ fontSize: 15, color: "var(--color-text-danger)", margin: 0 }}>{error}</p>}
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
            <span style={{ fontSize: 14, color: "var(--color-text-secondary)", opacity: 0.6 }}>
              Authors: Ruoxing Yang, Harel Berger, Micah Sherr, Adam Aviv
            </span>
            <span style={{ fontSize: 14, color: "var(--color-text-secondary)", opacity: 0.6 }}>
              Visualization Software created by Ruoxing Yang
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center", marginTop: 6 }}>
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)", opacity: 0.5, textTransform: "uppercase", letterSpacing: 0.5 }}>
              GitHub Repositories
            </span>
            <div style={{ display: "flex", gap: 20, fontSize: 15 }}>
              <a href="https://github.com/GUSecLab/cadence" target="_blank" rel="noopener noreferrer"
                style={{ color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/>
                </svg>
                Cadence Simulator
              </a>
              <a href="https://github.com/Davidrxyang/cadence-visualizer" target="_blank" rel="noopener noreferrer"
                style={{ color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/>
                </svg>
                Cadence Visualizer
              </a>
            </div>
          </div>
        </div>
      )}

      {data && (
        <>
          <Header
            fileName={fileName}
            timeLabel={formatTime(data.frames[frameIdx].t)}
            nodeCount={nodeCount}
            frameIdx={frameIdx}
            frameCount={data.frames.length}
            nodeSize={nodeSize}
            onNodeSizeChange={setNodeSize}
            speed={speed}
            onSpeedChange={setSpeed}
            sidebarTab={sidebarTab}
            showPanel={showPanel}
            selectedNodeCount={selectedNodes.size}
            selectedMessage={selectedMessage}
            hasMessages={hasMessages}
            hasEncounters={hasEncounters}
            onNodesBtn={handleNodesBtn}
            onMessagesBtn={handleMessagesBtn}
            onEncountersBtn={handleEncountersBtn}
            showLegend={showLegend}
            onToggleLegend={() => setShowLegend(v => !v)}
            onHome={handleGoHome}
          />

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
                {sidebarTab === "nodes" && (
                  <NodesPanel
                    nodeSearch={nodeSearch}
                    onSearchChange={setNodeSearch}
                    filterMode={filterMode}
                    onFilterModeChange={setFilterMode}
                    onSelectAll={selectAllNodes}
                    onClear={clearNodes}
                    selectedNodes={selectedNodes}
                    filteredNodeIds={filteredNodeIds}
                    nodeColors={nodeColors}
                    onToggleNode={toggleNode}
                    onSetNodeColor={setNodeColor}
                    hasEncounters={hasEncounters}
                    showEncounters={showEncounters}
                    onShowEncountersChange={setShowEncounters}
                    currentEncounters={currentEncounters}
                    onEncounterClick={openEncounterPopup}
                  />
                )}

                {sidebarTab === "messages" && (
                  <MessagesPanel
                    msgSearch={msgSearch}
                    onSearchChange={setMsgSearch}
                    onlyDelivered={onlyDelivered}
                    onOnlyDeliveredChange={setOnlyDelivered}
                    selectedMessage={selectedMessage}
                    msgInfo={msgInfo}
                    carriers={carriers}
                    delivered={delivered}
                    hideCarriers={hideCarriers}
                    onHideCarriersChange={setHideCarriers}
                    deliveredPath={selectedMessage ? data.deliveredPaths[selectedMessage] : null}
                    nodeColors={nodeColors}
                    onClearSelected={() => setSelectedMessage(null)}
                    filteredMessageIds={filteredMessageIds}
                    messageOrigins={data.messageOrigins}
                    deliveredPaths={data.deliveredPaths}
                    onMessageClick={handleMessageClick}
                  />
                )}

                {sidebarTab === "encounters" && (
                  <EncountersPanel
                    encSearch={encSearch}
                    onSearchChange={setEncSearch}
                    groups={filteredEncounterGroups}
                    expandedT={expandedEncGroupT}
                    onToggleExpand={(t) => setExpandedEncGroupT(prev => prev === t ? null : t)}
                    onEncounterClick={openEncounterPopup}
                  />
                )}
              </div>
            )}
          </div>

          <Timeline
            playing={playing}
            onTogglePlay={() => setPlaying(p => !p)}
            frames={data.frames}
            frameIdx={frameIdx}
            onScrub={(idx) => { setPlaying(false); setFrameIdx(idx); }}
            showEncounters={showEncounters}
            encounterTicks={encounterTicks}
            transferTicks={transferTicks}
            deliveryFrameIdx={deliveryFrameIdx}
          />
        </>
      )}

      <EncounterPopup
        encounter={encounterPopup}
        getMessages={getMessagesForEncounter}
        onClose={() => setEncounterPopup(null)}
        onMessageClick={handlePopupMessageClick}
      />
    </div>
  );
}
