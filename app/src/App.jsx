import { useState, useEffect, useRef, useMemo } from "react";
import { DEFAULT_NODE_RADIUS } from "./lib/constants";
import { parseJSONL, parseAPIFrames, formatDisplayTime } from "./lib/parse";
import { useVisualizerPanel } from "./hooks/useVisualizerPanel";
import Header from "./components/Header";
import VisualizerPanel from "./components/VisualizerPanel";
import Timeline from "./components/Timeline";

export default function App() {
  // ── shared playback state ─────────────────────────────────────────────────
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(5);
  const [nodeSize, setNodeSize] = useState(DEFAULT_NODE_RADIUS);
  const [showAbsoluteTime, setShowAbsoluteTime] = useState(false);
  const [splitView, setSplitView] = useState(false);

  // ── panel 1 data ──────────────────────────────────────────────────────────
  const [data, setData] = useState(null);
  const [fileName, setFileName] = useState(null);
  const [loadingExpData, setLoadingExpData] = useState(false);
  const activeExpRef = useRef(null);

  // ── panel 2 data ──────────────────────────────────────────────────────────
  const [data2, setData2] = useState(null);
  const [fileName2, setFileName2] = useState(null);
  const [loadingExpData2, setLoadingExpData2] = useState(false);
  const activeExp2Ref = useRef(null);

  // ── loading / error ───────────────────────────────────────────────────────
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("");

  // ── API experiment list ───────────────────────────────────────────────────
  const [experiments, setExperiments] = useState(null);
  const [serverAvailable, setServerAvailable] = useState(null);

  useEffect(() => {
    fetch("/api/experiments")
      .then(r => r.json())
      .then(d => { setExperiments(d.experiments); setServerAvailable(true); })
      .catch(() => setServerAvailable(false));
  }, []);

  // ── shared scrub callback (also stops playback) ───────────────────────────
  const onScrub = (idx) => { setPlaying(false); setFrameIdx(idx); };

  // ── per-panel hook instances ───────────────────────────────────────────────
  const panel1 = useVisualizerPanel(data, frameIdx, showAbsoluteTime, onScrub);
  const panel2 = useVisualizerPanel(data2, frameIdx, showAbsoluteTime, onScrub);

  // ── day markers (shared — same frames for all experiments) ────────────────
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

  // ── animation loop ────────────────────────────────────────────────────────
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

  // ── loading helpers ───────────────────────────────────────────────────────

  const resetVisualizerState = () => {
    setFrameIdx(0);
    setPlaying(false);
    panel1.reset();
  };

  // Fetch just meta + frames (phase 1). Returns { meta, frames } or throws.
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

  // Fetch experiment-specific data (encounters + messages). Returns exp fields or throws.
  const fetchExpData = async (name) => {
    const res = await fetch(`/api/experiment-data/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`Experiment data fetch failed: ${res.status}`);
    return res.json();
  };

  // ── panel 1 experiment select ─────────────────────────────────────────────

  const handleExperimentSelect = async (name) => {
    activeExpRef.current = name;
    setLoading(true);
    setError(null);
    setLoadingStatus("Loading frames…");
    try {
      const { meta, frames } = await fetchFrames();
      setData({ meta, frames, encounters: [], messageOrigins: {}, transfers: {}, deliveredPaths: {} });
      setFileName(name);
      resetVisualizerState();
      setLoading(false);
      setLoadingStatus("");

      setLoadingExpData(true);
      const expData = await fetchExpData(name);
      if (activeExpRef.current === name) {
        setData(prev => prev ? { ...prev, ...expData } : prev);
      }
    } catch (err) {
      setError(err.message);
      setLoading(false);
      setLoadingStatus("");
    } finally {
      if (activeExpRef.current === name) setLoadingExpData(false);
    }
  };

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
      resetVisualizerState();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── panel 2 experiment select ─────────────────────────────────────────────

  const handleExperiment2Select = async (name) => {
    activeExp2Ref.current = name;
    panel2.reset();
    try {
      // Reuse already-loaded meta + frames from panel 1 (same dataset)
      const baseFrames = data
        ? { meta: data.meta, frames: data.frames }
        : await fetchFrames();

      setData2({ ...baseFrames, encounters: [], messageOrigins: {}, transfers: {}, deliveredPaths: {} });
      setFileName2(name);

      setLoadingExpData2(true);
      const expData = await fetchExpData(name);
      if (activeExp2Ref.current === name) {
        setData2(prev => prev ? { ...prev, ...expData } : prev);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      if (activeExp2Ref.current === name) setLoadingExpData2(false);
    }
  };

  // ── home ──────────────────────────────────────────────────────────────────

  const handleGoHome = () => {
    setData(null); setFileName(null); setLoadingExpData(false);
    setData2(null); setFileName2(null); setLoadingExpData2(false);
    setError(null); setFrameIdx(0); setPlaying(false);
    setSplitView(false);
    activeExpRef.current = null;
    activeExp2Ref.current = null;
    panel1.reset();
    panel2.reset();
  };

  const toggleSplitView = () => {
    setSplitView(v => {
      if (!v) return true; // opening split — panel 2 starts empty
      setData2(null); setFileName2(null); setLoadingExpData2(false);
      activeExp2Ref.current = null;
      panel2.reset();
      return false;
    });
  };

  // ── render ────────────────────────────────────────────────────────────────

  const timelineData = data ?? data2;
  const combinedEncTicks = new Set([...panel1.encounterTicks, ...panel2.encounterTicks]);
  const combinedXferTicks = new Set([...panel1.transferTicks, ...panel2.transferTicks]);
  const combinedDeliveryIdx = panel1.deliveryFrameIdx ?? panel2.deliveryFrameIdx;
  const showEncountersOnTimeline = panel1.showEncounters || panel2.showEncounters;

  return (
    <div style={{ fontFamily: "var(--font-sans)", display: "flex", flexDirection: "column", height: "100vh" }}>

      {/* ── Welcome screen ─────────────────────────────────────────────── */}
      {!data && !data2 && (
        <div style={{
          flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", gap: 22, background: "var(--color-background-secondary)", padding: "0 24px"
        }}>
          <h1 style={{ fontSize: 28, fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>
            Welcome to the Cadence Simulator Visualizer
          </h1>

          {serverAvailable && experiments && !loading && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center", width: "100%", maxWidth: 560 }}>
              <p style={{ fontSize: 19, color: "var(--color-text-secondary)", margin: 0 }}>
                Select an experiment
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                {experiments.map(name => (
                  <button
                    key={name}
                    onClick={() => handleExperimentSelect(name)}
                    style={{
                      padding: "9px 16px", borderRadius: "var(--border-radius-md)", fontSize: 14,
                      border: "0.5px solid var(--color-border-secondary)", cursor: "pointer",
                      background: "var(--color-background-primary)", color: "var(--color-text-primary)",
                    }}
                  >
                    {name.replace(/^japan - /, "")}
                  </button>
                ))}
              </div>
              <span style={{ fontSize: 13, color: "var(--color-text-secondary)", opacity: 0.5 }}>— or —</span>
            </div>
          )}

          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
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
              {loadingStatus && (
                <span style={{ fontSize: 13, color: "var(--color-text-secondary)", opacity: 0.7 }}>
                  {loadingStatus}
                </span>
              )}
            </div>
          ) : (
            <label style={{
              cursor: "pointer", padding: "11px 26px", borderRadius: "var(--border-radius-md)",
              border: "0.5px solid var(--color-border-secondary)", fontSize: 17,
              background: "var(--color-background-primary)", color: "var(--color-text-primary)"
            }}>
              {serverAvailable ? "Load from file" : "Choose file"}
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

      {/* ── Visualizer ─────────────────────────────────────────────────── */}
      {(data || data2) && (
        <>
          <Header
            fileName={fileName}
            timeLabel={formatDisplayTime(
              (data ?? data2).frames[frameIdx].t,
              (data ?? data2).meta.t_min,
              showAbsoluteTime,
            )}
            showAbsoluteTime={showAbsoluteTime}
            onShowAbsoluteTimeChange={setShowAbsoluteTime}
            nodeCount={panel1.nodeCount || panel2.nodeCount}
            frameIdx={frameIdx}
            frameCount={(data ?? data2).frames.length}
            nodeSize={nodeSize}
            onNodeSizeChange={setNodeSize}
            speed={speed}
            onSpeedChange={setSpeed}
            // per-panel buttons only visible in single-view (in split view they live in the panel header)
            splitView={splitView}
            sidebarTab={panel1.sidebarTab}
            showPanel={panel1.showPanel}
            selectedNodeCount={panel1.selectedNodes.size}
            selectedMessage={panel1.selectedMessage}
            hasMessages={panel1.hasMessages}
            hasEncounters={panel1.hasEncounters}
            onNodesBtn={panel1.handleNodesBtn}
            onMessagesBtn={panel1.handleMessagesBtn}
            onEncountersBtn={panel1.handleEncountersBtn}
            showLegend={panel1.showLegend}
            onToggleLegend={() => panel1.setShowLegend(v => !v)}
            onHome={handleGoHome}
            onToggleSplitView={toggleSplitView}
          />

          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            <VisualizerPanel
              data={data}
              panel={panel1}
              frameIdx={frameIdx}
              nodeSize={nodeSize}
              showAbsoluteTime={showAbsoluteTime}
              experimentName={fileName}
              loadingExpData={loadingExpData}
              splitView={splitView}
              experiments={experiments}
              onSelectExperiment={handleExperimentSelect}
            />
            {splitView && (
              <VisualizerPanel
                data={data2}
                panel={panel2}
                frameIdx={frameIdx}
                nodeSize={nodeSize}
                showAbsoluteTime={showAbsoluteTime}
                experimentName={fileName2}
                loadingExpData={loadingExpData2}
                splitView={splitView}
                experiments={experiments}
                onSelectExperiment={handleExperiment2Select}
              />
            )}
          </div>

          <Timeline
            playing={playing}
            onTogglePlay={() => setPlaying(p => !p)}
            frames={(data ?? data2).frames}
            frameIdx={frameIdx}
            onScrub={onScrub}
            showEncounters={showEncountersOnTimeline}
            encounterTicks={combinedEncTicks}
            transferTicks={combinedXferTicks}
            deliveryFrameIdx={combinedDeliveryIdx}
            dayMarkers={dayMarkers}
            tMin={(data ?? data2).meta.t_min}
            showAbsoluteTime={showAbsoluteTime}
          />
        </>
      )}
    </div>
  );
}
