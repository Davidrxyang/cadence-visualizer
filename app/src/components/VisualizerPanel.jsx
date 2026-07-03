import { useRef, useCallback, useEffect } from "react";
import { renderFrame } from "../lib/canvasDraw";
import { formatDisplayTime } from "../lib/parse";
import NodesPanel from "./NodesPanel";
import MessagesPanel from "./MessagesPanel";
import EncountersPanel from "./EncountersPanel";
import EncounterPopup from "./EncounterPopup";

const BTN = (active, activeColor = "var(--color-text-secondary)") => ({
  padding: "3px 9px", fontSize: 12, cursor: "pointer",
  border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
  background: active ? activeColor : "var(--color-background-secondary)",
  color: active ? (activeColor === "var(--color-text-secondary)" ? "var(--color-background-primary)" : "#fff") : "var(--color-text-secondary)",
});

export default function VisualizerPanel({
  data, panel, frameIdx, nodeSize, showAbsoluteTime,
  experimentName, loadingExpData,
  // shown only when data is null (second panel before experiment is picked)
  experiments, onSelectExperiment,
  // whether we're in split view (controls panel mini-header visibility)
  splitView,
}) {
  const canvasRef = useRef(null);

  const draw = useCallback(() => {
    if (!data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    renderFrame(ctx, canvas.width, canvas.height, {
      data, frameIdx,
      selectedNodes: panel.selectedNodes,
      nodeColors: panel.nodeColors,
      nodeSize,
      filterMode: panel.filterMode,
      showEncounters: panel.showEncounters,
      encountersByNode: panel.encountersByNode,
      selectedMessage: panel.selectedMessage,
      carriers: panel.carriers,
      hideCarriers: panel.hideCarriers,
    });
  }, [data, panel, frameIdx, nodeSize]);

  useEffect(() => { draw(); }, [draw]);

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

  const handleCanvasClick = useCallback((e) => {
    if (!data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { meta, frames } = data;
    const W = canvas.width, H = canvas.height;
    const toScreen = (x, y) => [
      ((x - meta.x_min) / (meta.x_max - meta.x_min)) * (W - 40) + 20,
      H - (((y - meta.y_min) / (meta.y_max - meta.y_min)) * (H - 40) + 20),
    ];
    const frame = frames[frameIdx];
    let closest = null, closestDist = 10;
    for (const [idStr, [x, y]] of Object.entries(frame.nodes)) {
      const id = parseInt(idStr);
      if (panel.filterMode === "isolate" && panel.selectedNodes.size > 0 && !panel.selectedNodes.has(id)) continue;
      const [sx, sy] = toScreen(x, y);
      const d = Math.sqrt((sx - mx) ** 2 + (sy - my) ** 2);
      if (d < closestDist) { closestDist = d; closest = id; }
    }
    panel.setClickedNode(prev => prev === closest ? null : closest);
    if (closest !== null) panel.setTooltipPos({ x: e.clientX, y: e.clientY });
  }, [data, frameIdx, panel]);

  // ── no experiment loaded yet — show a picker ──────────────────────────────

  if (!data) {
    return (
      <div style={{
        flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", gap: 14,
        background: "var(--color-background-secondary)",
        borderLeft: "0.5px solid var(--color-border-tertiary)",
      }}>
        <span style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
          Select an experiment for this panel
        </span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxWidth: 380, justifyContent: "center" }}>
          {(experiments ?? []).map(name => (
            <button
              key={name}
              onClick={() => onSelectExperiment(name)}
              style={{
                padding: "7px 13px", borderRadius: "var(--border-radius-md)", fontSize: 13,
                border: "0.5px solid var(--color-border-secondary)", cursor: "pointer",
                background: "var(--color-background-primary)", color: "var(--color-text-primary)",
              }}
            >
              {name.replace(/^japan - /, "")}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── normal panel ──────────────────────────────────────────────────────────

  const tMin = data.meta.t_min;
  const fmt = (t) => formatDisplayTime(t, tMin, showAbsoluteTime);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>

      {/* Per-panel header — only in split view */}
      {splitView && (
        <div style={{
          padding: "4px 10px", display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
          borderBottom: "0.5px solid var(--color-border-tertiary)",
          background: "var(--color-background-secondary)",
        }}>
          <span style={{
            fontSize: 12, color: "var(--color-text-secondary)",
            flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }} title={experimentName}>
            {(experimentName ?? "").replace(/^japan - /, "") || "—"}
          </span>
          {loadingExpData && (
            <span style={{ fontSize: 11, color: "rgba(59,130,246,0.8)", flexShrink: 0 }}>
              <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span>
              {" "}Loading…
            </span>
          )}
          <button onClick={panel.handleNodesBtn}
            style={BTN(panel.showPanel && panel.sidebarTab === "nodes")}>
            Nodes{panel.selectedNodes.size > 0 ? ` (${panel.selectedNodes.size})` : ""}
          </button>
          {panel.hasMessages && (
            <button onClick={panel.handleMessagesBtn}
              style={BTN(panel.showPanel && panel.sidebarTab === "messages", "#3b82f6")}>
              Msgs{panel.selectedMessage ? ` #${panel.selectedMessage}` : ""}
            </button>
          )}
          {panel.hasEncounters && (
            <button onClick={panel.handleEncountersBtn}
              style={BTN(panel.showPanel && panel.sidebarTab === "encounters", "#fbbf24")}>
              Enc
            </button>
          )}
        </div>
      )}

      {/* Canvas + optional sidebar */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: 1, minWidth: 0, position: "relative" }} onClick={handleCanvasClick}>
          <canvas
            ref={canvasRef}
            style={{ display: "block", width: "100%", height: "100%", background: "var(--color-background-primary)" }}
          />
          {panel.clickedNode !== null && (
            <div style={{
              position: "fixed", left: panel.tooltipPos.x + 14, top: panel.tooltipPos.y - 10,
              background: "rgba(0,0,0,0.75)", color: "#fff",
              padding: "3px 8px", borderRadius: 4, fontSize: 12,
              pointerEvents: "none", zIndex: 20, whiteSpace: "nowrap",
            }}>
              Node {panel.clickedNode}
            </div>
          )}
        </div>

        {panel.showPanel && (
          <div style={{
            width: 220, borderLeft: "0.5px solid var(--color-border-tertiary)",
            display: "flex", flexDirection: "column", overflow: "hidden",
            background: "var(--color-background-secondary)",
          }}>
            {loadingExpData && !splitView && (
              <div style={{
                padding: "6px 10px", fontSize: 11, color: "var(--color-text-secondary)",
                borderBottom: "0.5px solid var(--color-border-tertiary)",
                background: "rgba(59,130,246,0.07)", display: "flex", alignItems: "center", gap: 6,
              }}>
                <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span>
                Loading message data…
              </div>
            )}

            {panel.sidebarTab === "nodes" && (
              <NodesPanel
                nodeSearch={panel.nodeSearch}
                onSearchChange={panel.setNodeSearch}
                filterMode={panel.filterMode}
                onFilterModeChange={panel.setFilterMode}
                onSelectAll={() => panel.selectAllNodes(panel.filteredNodeIds.slice(0, 10))}
                onClear={panel.clearNodes}
                selectedNodes={panel.selectedNodes}
                filteredNodeIds={panel.filteredNodeIds}
                nodeColors={panel.nodeColors}
                onToggleNode={panel.toggleNode}
                onSetNodeColor={panel.setNodeColor}
                hasEncounters={panel.hasEncounters}
                showEncounters={panel.showEncounters}
                onShowEncountersChange={panel.setShowEncounters}
                currentEncounters={panel.currentEncounters}
                onEncounterClick={panel.openEncounterPopup}
              />
            )}

            {panel.sidebarTab === "messages" && (
              <MessagesPanel
                msgSearch={panel.msgSearch}
                onSearchChange={panel.setMsgSearch}
                onlyDelivered={panel.onlyDelivered}
                onOnlyDeliveredChange={panel.setOnlyDelivered}
                selectedMessage={panel.selectedMessage}
                msgInfo={panel.msgInfo}
                carriers={panel.carriers}
                delivered={panel.delivered}
                hideCarriers={panel.hideCarriers}
                onHideCarriersChange={panel.setHideCarriers}
                deliveredPath={panel.selectedMessage ? data.deliveredPaths[panel.selectedMessage] : null}
                deliveryMetrics={panel.delivered ? panel.deliveryMetrics : null}
                nodeColors={panel.nodeColors}
                onClearSelected={() => panel.handleMessageClick(panel.selectedMessage)}
                filteredMessageIds={panel.filteredMessageIds}
                messageOrigins={data.messageOrigins}
                deliveredPaths={data.deliveredPaths}
                onMessageClick={panel.handleMessageClick}
              />
            )}

            {panel.sidebarTab === "encounters" && (
              <EncountersPanel
                encSearch={panel.encSearch}
                onSearchChange={panel.setEncSearch}
                groups={panel.filteredEncounterGroups}
                expandedT={panel.expandedEncGroupT}
                onToggleExpand={t => panel.setExpandedEncGroupT(prev => prev === t ? null : t)}
                onEncounterClick={panel.openEncounterPopup}
                tMin={tMin}
                showAbsoluteTime={showAbsoluteTime}
              />
            )}
          </div>
        )}
      </div>

      <EncounterPopup
        encounter={panel.encounterPopup}
        getMessages={panel.getMessagesForEncounter}
        onClose={() => panel.setEncounterPopup(null)}
        onMessageClick={panel.handlePopupMessageClick}
        tMin={tMin}
        showAbsoluteTime={showAbsoluteTime}
      />
    </div>
  );
}