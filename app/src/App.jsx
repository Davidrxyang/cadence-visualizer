import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { DEFAULT_NODE_RADIUS, MAX_SELECTED_NODES } from "./lib/constants";
import { NODE_COLOR_PALETTE } from "./lib/colors";
import { parseAPIFrames, formatDisplayTime } from "./lib/parse";
import { useVisualizerPanel } from "./hooks/useVisualizerPanel";
import Header from "./components/Header";
import VisualizerPanel from "./components/VisualizerPanel";
import CombinedSidebar from "./components/CombinedSidebar";
import Timeline from "./components/Timeline";

// ── Experiment display names ──────────────────────────────────────────────────
// Maps raw DB experiment_name → friendly display label.
// Only experiments listed here are shown in the selection UI.
const EXP_DISPLAY = {
  "japan - broadcast buffer=500 run=1":                          "Maximal Flooding",
  "japan - randomwalk-v1-random p_t=0.5 p_d=0.8 buffer=500 run=1": "Probabilistic Flooding",
  "japan - randomwalk-v1 buffer=500 run=1":                     "Handoff",
  "japan - ppbr buffer=500 run=1":                              "PPBR",
  "japan - mirage p=0.55 k=2 buffer=500 run=1":                "MIRAGE p=0.55",
  "japan - mirage p=0.6 k=2 buffer=500 run=1":                 "MIRAGE p=0.6",
  "japan - mirage p=0.65 k=2 buffer=500 run=1":                "MIRAGE p=0.65",
};
const EXP_GROUPS = [
  {
    label: "Basic Protocols",
    keys: [
      "japan - broadcast buffer=500 run=1",
      "japan - randomwalk-v1-random p_t=0.5 p_d=0.8 buffer=500 run=1",
      "japan - randomwalk-v1 buffer=500 run=1",
    ],
  },
  {
    label: "Profile-Based Protocols",
    keys: [
      "japan - ppbr buffer=500 run=1",
      "japan - mirage p=0.55 k=2 buffer=500 run=1",
      "japan - mirage p=0.6 k=2 buffer=500 run=1",
      "japan - mirage p=0.65 k=2 buffer=500 run=1",
    ],
  },
];
const EXP_ORDER = EXP_GROUPS.flatMap(g => g.keys);
const displayName = (raw) => !raw ? "" : (EXP_DISPLAY[raw] ?? raw.replace(/^japan - /, ""));

// ── Welcome step helpers ──────────────────────────────────────────────────────

const GH_ICON = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
  </svg>
);

export default function App() {
  // ── Welcome flow ──────────────────────────────────────────────────────────
  // 'mode'   → choose 1 or 2 experiments
  // 'select' → pick experiment(s) from the list
  // 'loading'→ blocking load screen before visualizer opens
  const [welcomeStep, setWelcomeStep] = useState("mode");
  const [mode, setMode] = useState(null); // 'single' | 'split'
  const [pendingExps, setPendingExps] = useState([]); // names being selected
  const [loadProgress, setLoadProgress] = useState({ frames: false, exp1: false, exp2: false });

  // ── Experiment list (from server) ─────────────────────────────────────────
  const [experiments, setExperiments] = useState(null);
  const [serverAvailable, setServerAvailable] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/experiments")
      .then(r => r.json())
      .then(d => { setExperiments(d.experiments); setServerAvailable(true); })
      .catch(() => setServerAvailable(false));
  }, []);

  // ── Loaded experiment data ────────────────────────────────────────────────
  const [data, setData] = useState(null);   // exp 1
  const [data2, setData2] = useState(null); // exp 2 (null in single mode)
  const [fileName, setFileName] = useState(null);
  const [fileName2, setFileName2] = useState(null);

  // Visualizer is open once all required data is loaded
  const visualizerOpen = mode === "split"
    ? (!!data && !!data2)
    : !!data;

  // ── Playback state ────────────────────────────────────────────────────────
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(5);
  const [nodeSize, setNodeSize] = useState(DEFAULT_NODE_RADIUS);
  const [showAbsoluteTime, setShowAbsoluteTime] = useState(false);
  const [showLegend, setShowLegend] = useState(false);

  const onScrub = useCallback((idx) => { setPlaying(false); setFrameIdx(idx); }, []);

  // ── Shared selection state (both canvases use the same selection) ──────────
  const [selectedNodes, setSelectedNodes] = useState(new Set());
  const [nodeColors, setNodeColors] = useState({});
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [filterMode, setFilterMode] = useState("highlight");
  const [showEncounters, setShowEncounters] = useState(true);
  const [hideCarriers, setHideCarriers] = useState(false);

  // Sidebar UI state (shared)
  const [sidebarTab, setSidebarTab] = useState("messages");
  const [nodeSearch, setNodeSearch] = useState("");
  const [msgSearch, setMsgSearch] = useState("");
  const [onlyDelivered, setOnlyDelivered] = useState(false);
  const [encSearch, setEncSearch] = useState("");
  const [expandedEncGroupT, setExpandedEncGroupT] = useState(null);

  const selection = useMemo(() => ({
    selectedNodes, nodeColors, selectedMessage, filterMode, showEncounters, hideCarriers,
  }), [selectedNodes, nodeColors, selectedMessage, filterMode, showEncounters, hideCarriers]);

  // ── Selection handlers ────────────────────────────────────────────────────

  const focusOnPathNodes = useCallback((pathNodeIds) => {
    const ids = pathNodeIds.slice(0, MAX_SELECTED_NODES);
    setSelectedNodes(new Set(ids));
    setNodeColors(() => {
      const next = {};
      ids.forEach((id, i) => { next[id] = NODE_COLOR_PALETTE[i % NODE_COLOR_PALETTE.length]; });
      return next;
    });
  }, []);

  const handleMessageClick = useCallback((id) => {
    // Toggle: re-clicking the selected message clears it
    if (selectedMessage === id) {
      setSelectedMessage(null);
      return;
    }
    setSelectedMessage(id);

    // Collect nodes relevant to this message from one experiment's data
    const getFromData = (d) => {
      if (!d) return [];
      const path = d.deliveredPaths[id];
      if (path) return path;
      const origin = d.messageOrigins[id]?.origin;
      const ids = [];
      const seen = new Set();
      if (origin !== undefined) { ids.push(origin); seen.add(origin); }
      for (const xfer of (d.transfers[id] ?? [])) {
        if (!seen.has(xfer.to)) { seen.add(xfer.to); ids.push(xfer.to); }
      }
      return ids;
    };

    const nodes1 = getFromData(data);
    const nodes2 = getFromData(data2);

    if (data2) {
      // Split mode: union nodes from both experiments.
      // Shared nodes (in both paths) get white so they look the same on both canvases.
      // Experiment-unique nodes get sequential palette colors.
      const set1 = new Set(nodes1);
      const set2 = new Set(nodes2);
      const shared = nodes1.filter(n => set2.has(n));
      const only1  = nodes1.filter(n => !set2.has(n));
      const only2  = nodes2.filter(n => !set1.has(n));
      const allIds = [...shared, ...only1, ...only2].slice(0, MAX_SELECTED_NODES);
      if (allIds.length) {
        setSelectedNodes(new Set(allIds));
        setNodeColors(() => {
          const next = {};
          let pi = 0;
          shared.forEach(n => { next[n] = "#ffffff"; });
          only1.forEach(n => { next[n] = NODE_COLOR_PALETTE[pi++ % NODE_COLOR_PALETTE.length]; });
          only2.forEach(n => { next[n] = NODE_COLOR_PALETTE[pi++ % NODE_COLOR_PALETTE.length]; });
          return next;
        });
      }
    } else {
      if (nodes1.length) focusOnPathNodes(nodes1);
    }
  }, [selectedMessage, data, data2, focusOnPathNodes]);

  const toggleNode = useCallback((id) => {
    setSelectedNodes(prev => {
      if (prev.has(id)) { const next = new Set(prev); next.delete(id); return next; }
      if (prev.size >= MAX_SELECTED_NODES) return prev;
      const next = new Set(prev);
      next.add(id);
      setNodeColors(c => c[id] ? c : { ...c, [id]: NODE_COLOR_PALETTE[(next.size - 1) % NODE_COLOR_PALETTE.length] });
      return next;
    });
  }, []);

  const setNodeColor = useCallback((id, color) => {
    setNodeColors(prev => ({ ...prev, [id]: color }));
  }, []);

  const selectAllNodes = useCallback((ids) => {
    setSelectedNodes(new Set(ids));
    setNodeColors(prev => {
      const next = { ...prev };
      ids.forEach((id, i) => { if (!next[id]) next[id] = NODE_COLOR_PALETTE[i % NODE_COLOR_PALETTE.length]; });
      return next;
    });
  }, []);

  const clearNodes = useCallback(() => {
    setSelectedNodes(new Set());
    setNodeColors({});
  }, []);

  const resetSelection = useCallback(() => {
    setSelectedNodes(new Set());
    setNodeColors({});
    setSelectedMessage(null);
    setFilterMode("highlight");
    setShowEncounters(true);
    setHideCarriers(false);
    setSidebarTab("messages");
    setNodeSearch("");
    setMsgSearch("");
    setOnlyDelivered(false);
    setEncSearch("");
    setExpandedEncGroupT(null);
  }, []);

  // ── Panel hook instances ──────────────────────────────────────────────────
  const panel1 = useVisualizerPanel(data, frameIdx, onScrub, selection, handleMessageClick);
  const panel2 = useVisualizerPanel(data2, frameIdx, onScrub, selection, handleMessageClick);

  // ── Day markers (shared — same frames for both experiments) ───────────────
  const dayMarkers = useMemo(() => {
    const d = data ?? data2;
    if (!d) return [];
    const { t_min, t_max } = d.meta;
    const frames = d.frames;
    const totalDays = Math.floor((t_max - t_min) / 86400);
    const markers = [];
    for (let day = 5; day <= totalDays; day += 5) {
      const targetT = t_min + day * 86400;
      let lo = 0, hi = frames.length - 1, best = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (frames[mid].t <= targetT) { best = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      markers.push({ idx: best, day });
    }
    return markers;
  }, [data, data2]);

  // ── Animation loop ────────────────────────────────────────────────────────
  const animRef = useRef(null);
  const lastTickRef = useRef(null);
  const activeData = data ?? data2;

  useEffect(() => {
    if (!playing || !activeData) return;
    const tick = (now) => {
      if (lastTickRef.current === null) lastTickRef.current = now;
      const elapsed = now - lastTickRef.current;
      if (elapsed >= 1000 / speed) {
        lastTickRef.current = now;
        setFrameIdx(i => {
          if (i >= activeData.frames.length - 1) { setPlaying(false); return i; }
          return i + 1;
        });
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(animRef.current); lastTickRef.current = null; };
  }, [playing, activeData, speed]);

  // ── Fetch helpers ─────────────────────────────────────────────────────────

  const fetchFrames = async () => {
    const [metaRes, framesRes] = await Promise.all([
      fetch("/api/meta"),
      fetch("/api/frames"),
    ]);
    if (!metaRes.ok) throw new Error(`Meta fetch failed: ${metaRes.status}`);
    if (!framesRes.ok) throw new Error(`Frames fetch failed: ${framesRes.status}`);
    const [metaData, framesData] = await Promise.all([metaRes.json(), framesRes.json()]);
    const frames = parseAPIFrames(framesData.frames);
    if (!frames.length) throw new Error("No frames returned from API.");
    return { meta: metaData, frames };
  };

  const fetchExpData = async (name) => {
    const res = await fetch(`/api/experiment-data/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`Experiment data fetch failed: ${res.status}`);
    return res.json();
  };

  // ── Blocking load (called after experiments are selected) ─────────────────

  const startLoading = async (exps) => {
    setWelcomeStep("loading");
    setError(null);
    setLoadProgress({ frames: false, exp1: false, exp2: false });
    try {
      const tasks = [
        fetchFrames().then(r => { setLoadProgress(p => ({ ...p, frames: true })); return r; }),
        fetchExpData(exps[0]).then(r => { setLoadProgress(p => ({ ...p, exp1: true })); return r; }),
        exps[1]
          ? fetchExpData(exps[1]).then(r => { setLoadProgress(p => ({ ...p, exp2: true })); return r; })
          : Promise.resolve(null),
      ];

      const [framesResult, exp1Result, exp2Result] = await Promise.all(tasks);

      resetSelection();
      setFrameIdx(0);
      setPlaying(false);

      setData({ ...framesResult, ...exp1Result });
      setFileName(exps[0]);

      if (exps[1] && exp2Result) {
        setData2({ ...framesResult, ...exp2Result });
        setFileName2(exps[1]);
      }
    } catch (err) {
      setError(err.message);
      setWelcomeStep("select");
    }
  };

  // ── Home ──────────────────────────────────────────────────────────────────

  const handleGoHome = () => {
    setData(null); setData2(null);
    setFileName(null); setFileName2(null);
    setWelcomeStep("mode");
    setMode(null);
    setPendingExps([]);
    setError(null);
    setFrameIdx(0);
    setPlaying(false);
    resetSelection();
  };

  // ── Welcome step: experiment selection toggle ──────────────────────────────

  const togglePendingExp = (name) => {
    if (mode === "single") {
      // Single mode: clicking an experiment starts loading immediately
      startLoading([name]);
      return;
    }
    // Split mode: select up to 2; clicking selected one deselects it
    setPendingExps(prev => {
      if (prev.includes(name)) return prev.filter(n => n !== name);
      if (prev.length >= 2) return [prev[1], name]; // replace oldest
      return [...prev, name];
    });
  };

  // ── Timeline ticks ────────────────────────────────────────────────────────

  const combinedEncTicks = useMemo(() => new Set([...panel1.encounterTicks, ...panel2.encounterTicks]), [panel1.encounterTicks, panel2.encounterTicks]);

  // ── Render ────────────────────────────────────────────────────────────────

  const expNames = [fileName, fileName2].filter(Boolean).map(displayName);

  return (
    <div style={{ fontFamily: "var(--font-sans)", display: "flex", flexDirection: "column", height: "100vh" }}>

      {/* ══ Welcome screen ════════════════════════════════════════════════════ */}
      {!visualizerOpen && (
        <div style={{
          flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", gap: 24,
          background: "var(--color-background-secondary)", padding: "0 24px",
        }}>

          {/* ── Loading screen ───────────────────────────────────────────── */}
          {welcomeStep === "loading" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, width: "100%", maxWidth: 480 }}>
              <h2 style={{ fontSize: 22, fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>
                Loading…
              </h2>
              <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  { key: "frames", label: "Loading frames" },
                  { key: "exp1", label: `Loading ${displayName(pendingExps[0] ?? "protocol 1")}` },
                  ...(mode === "split" ? [{ key: "exp2", label: `Loading ${displayName(pendingExps[1] ?? "protocol 2")}` }] : []),
                ].map(({ key, label }) => (
                  <div key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{label}</span>
                      <span style={{ fontSize: 12, color: loadProgress[key] ? "#22c55e" : "var(--color-text-secondary)", opacity: loadProgress[key] ? 1 : 0.5 }}>
                        {loadProgress[key] ? "✓" : "⟳"}
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: "var(--color-background-primary)", overflow: "hidden" }}>
                      <div style={{
                        height: "100%", borderRadius: 3,
                        background: loadProgress[key] ? "#22c55e" : "var(--color-text-secondary)",
                        opacity: loadProgress[key] ? 1 : 0.3,
                        width: loadProgress[key] ? "100%" : "0%",
                        transition: "width 0.4s ease, background 0.3s",
                        animation: !loadProgress[key] ? "loading-bar-fill 1.4s ease-in-out infinite" : "none",
                      }} />
                    </div>
                  </div>
                ))}
              </div>
              {error && <p style={{ fontSize: 14, color: "var(--color-text-danger)", margin: 0 }}>{error}</p>}
            </div>
          )}

          {/* ── Mode selection ───────────────────────────────────────────── */}
          {welcomeStep === "mode" && (
            <>
              <h1 style={{ fontSize: 28, fontWeight: 600, color: "var(--color-text-primary)", margin: 0, textAlign: "center" }}>
                Welcome to the Cadence Simulator Visualizer
              </h1>
              <p style={{ fontSize: 18, color: "var(--color-text-secondary)", margin: 0 }}>
                How many protocols would you like to examine?
              </p>
              <div style={{ display: "flex", gap: 16 }}>
                <button
                  onClick={() => { setMode("single"); setWelcomeStep("select"); }}
                  style={{
                    padding: "14px 32px", borderRadius: "var(--border-radius-md)", fontSize: 16,
                    border: "0.5px solid var(--color-border-secondary)", cursor: "pointer",
                    background: "var(--color-background-primary)", color: "var(--color-text-primary)",
                    fontWeight: 500,
                  }}
                >
                  1 Protocol
                </button>
                <button
                  onClick={() => { setMode("split"); setWelcomeStep("select"); }}
                  style={{
                    padding: "14px 32px", borderRadius: "var(--border-radius-md)", fontSize: 16,
                    border: "0.5px solid var(--color-border-secondary)", cursor: "pointer",
                    background: "var(--color-background-primary)", color: "var(--color-text-primary)",
                    fontWeight: 500,
                  }}
                >
                  2 Protocols
                </button>
              </div>

              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
                <span style={{ fontSize: 14, color: "var(--color-text-secondary)", opacity: 0.6 }}>
                  Authors: Ruoxing Yang, Harel Berger, Micah Sherr, Adam Aviv
                </span>
                <span style={{ fontSize: 14, color: "var(--color-text-secondary)", opacity: 0.6 }}>
                  Visualization Software created by Ruoxing Yang
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "var(--color-text-secondary)", opacity: 0.5, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  GitHub Repositories
                </span>
                <div style={{ display: "flex", gap: 20, fontSize: 15 }}>
                  <a href="https://github.com/GUSecLab/cadence" target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
                    {GH_ICON} Cadence Simulator
                  </a>
                  <a href="https://github.com/Davidrxyang/cadence-visualizer" target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
                    {GH_ICON} Cadence Visualizer
                  </a>
                </div>
              </div>
            </>
          )}

          {/* ── Protocol selection ───────────────────────────────────────── */}
          {welcomeStep === "select" && (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 20, width: "100%", maxWidth: 360, alignItems: "stretch" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <button
                    onClick={() => { setMode(null); setWelcomeStep("mode"); setPendingExps([]); setError(null); }}
                    style={{ padding: "5px 10px", fontSize: 13, cursor: "pointer", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "transparent", color: "var(--color-text-secondary)", flexShrink: 0 }}
                  >
                    ← Back
                  </button>
                  <h2 style={{ fontSize: 17, fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>
                    {mode === "single" ? "Select a protocol" : "Select two protocols to compare"}
                  </h2>
                </div>

                {serverAvailable && experiments && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {EXP_GROUPS.map(group => {
                      const visible = group.keys.filter(n => experiments.includes(n));
                      if (!visible.length) return null;
                      return (
                        <div key={group.label} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", opacity: 0.6, textTransform: "uppercase", letterSpacing: 0.6, paddingLeft: 2, marginBottom: 2 }}>
                            {group.label}
                          </span>
                          {visible.map(name => {
                            const selIdx = pendingExps.indexOf(name);
                            const isSelected = selIdx >= 0;
                            return (
                              <button
                                key={name}
                                onClick={() => togglePendingExp(name)}
                                style={{
                                  display: "flex", alignItems: "center", gap: 10,
                                  padding: "11px 14px", borderRadius: "var(--border-radius-md)", fontSize: 14,
                                  border: isSelected ? "0.5px solid rgba(59,130,246,0.5)" : "0.5px solid var(--color-border-tertiary)",
                                  cursor: "pointer", textAlign: "left",
                                  background: isSelected ? "rgba(59,130,246,0.12)" : "rgba(255,255,255,0.03)",
                                  color: isSelected ? "#3b82f6" : "var(--color-text-primary)",
                                  fontWeight: isSelected ? 600 : 400,
                                  transition: "background 0.15s, border-color 0.15s",
                                }}
                              >
                                <span style={{ width: 18, fontSize: 13, flexShrink: 0, opacity: isSelected ? 1 : 0 }}>
                                  {["①", "②"][selIdx]}
                                </span>
                                {displayName(name)}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}

                {!serverAvailable && (
                  <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: 0 }}>
                    Server not available.
                  </p>
                )}

                {mode === "split" && (
                  <button
                    disabled={pendingExps.length < 2}
                    onClick={() => startLoading(pendingExps)}
                    style={{
                      padding: "11px 0", borderRadius: "var(--border-radius-md)", fontSize: 15,
                      border: "0.5px solid var(--color-border-secondary)",
                      cursor: pendingExps.length < 2 ? "not-allowed" : "pointer",
                      background: pendingExps.length < 2 ? "transparent" : "var(--color-background-primary)",
                      color: pendingExps.length < 2 ? "var(--color-text-secondary)" : "var(--color-text-primary)",
                      opacity: pendingExps.length < 2 ? 0.4 : 1,
                      fontWeight: 500,
                    }}
                  >
                    Compare ▶
                  </button>
                )}

                {error && <p style={{ fontSize: 14, color: "var(--color-text-danger)", margin: 0 }}>{error}</p>}
              </div>
            </>
          )}
        </div>
      )}

      {/* ══ Visualizer ════════════════════════════════════════════════════════ */}
      {visualizerOpen && (
        <>
          <Header
            expNames={expNames}
            timeLabel={formatDisplayTime(
              activeData.frames[frameIdx].t,
              activeData.meta.t_min,
              showAbsoluteTime,
            )}
            showAbsoluteTime={showAbsoluteTime}
            onShowAbsoluteTimeChange={setShowAbsoluteTime}
            nodeCount={panel1.nodeCount || panel2.nodeCount}
            frameIdx={frameIdx}
            frameCount={activeData.frames.length}
            nodeSize={nodeSize}
            onNodeSizeChange={setNodeSize}
            speed={speed}
            onSpeedChange={setSpeed}
            showLegend={showLegend}
            onToggleLegend={() => setShowLegend(v => !v)}
            onHome={handleGoHome}
            splitMode={mode === "split"}
          />

          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            {/* Canvas area */}
            <div style={{ flex: 1, display: "flex", overflow: "hidden", minWidth: 0, gap: mode === "split" ? 6 : 0 }}>
              <VisualizerPanel
                data={data}
                panel={panel1}
                frameIdx={frameIdx}
                nodeSize={nodeSize}
                selection={selection}
                borderColor={mode === "split" ? "#3b82f6" : undefined}
              />
              {mode === "split" && (
                <VisualizerPanel
                  data={data2}
                  panel={panel2}
                  frameIdx={frameIdx}
                  nodeSize={nodeSize}
                  selection={selection}
                  borderColor="#22c55e"
                />
              )}
            </div>

            {/* Always-visible unified sidebar */}
            <CombinedSidebar
              data1={data}
              data2={mode === "split" ? data2 : null}
              expName1={displayName(fileName)}
              expName2={displayName(fileName2)}
              panel1={panel1}
              panel2={mode === "split" ? panel2 : null}
              frameIdx={frameIdx}
              showAbsoluteTime={showAbsoluteTime}
              selectedNodes={selectedNodes}
              nodeColors={nodeColors}
              selectedMessage={selectedMessage}
              filterMode={filterMode}
              showEncounters={showEncounters}
              hideCarriers={hideCarriers}
              sidebarTab={sidebarTab}
              nodeSearch={nodeSearch}
              msgSearch={msgSearch}
              onlyDelivered={onlyDelivered}
              encSearch={encSearch}
              expandedEncGroupT={expandedEncGroupT}
              setSidebarTab={setSidebarTab}
              setNodeSearch={setNodeSearch}
              setMsgSearch={setMsgSearch}
              setOnlyDelivered={setOnlyDelivered}
              setEncSearch={setEncSearch}
              setExpandedEncGroupT={setExpandedEncGroupT}
              setFilterMode={setFilterMode}
              setShowEncounters={setShowEncounters}
              setHideCarriers={setHideCarriers}
              toggleNode={toggleNode}
              setNodeColor={setNodeColor}
              selectAllNodes={selectAllNodes}
              clearNodes={clearNodes}
              handleMessageClick={handleMessageClick}
            />
          </div>

          <Timeline
            playing={playing}
            onTogglePlay={() => setPlaying(p => !p)}
            frames={activeData.frames}
            frameIdx={frameIdx}
            onScrub={onScrub}
            showEncounters={showEncounters}
            encounterTicks={combinedEncTicks}
            transferTicks1={panel1.transferTicks}
            transferTicks2={panel2.transferTicks}
            deliveryFrameIdx1={panel1.deliveryFrameIdx}
            deliveryFrameIdx2={panel2.deliveryFrameIdx}
            dayMarkers={dayMarkers}
            tMin={activeData.meta.t_min}
            showAbsoluteTime={showAbsoluteTime}
          />
        </>
      )}
    </div>
  );
}
