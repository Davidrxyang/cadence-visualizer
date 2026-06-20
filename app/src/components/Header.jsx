import Legend from "./Legend";

export default function Header({
  fileName, timeLabel, nodeCount, frameIdx, frameCount,
  nodeSize, onNodeSizeChange, speed, onSpeedChange,
  sidebarTab, showPanel, selectedNodeCount, selectedMessage,
  hasMessages, hasEncounters,
  onNodesBtn, onMessagesBtn, onEncountersBtn,
  showLegend, onToggleLegend, onHome,
}) {
  return (
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
      <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{timeLabel}</span>
      <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{nodeCount} nodes</span>
      <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{frameIdx + 1} / {frameCount}</span>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--color-text-secondary)", marginLeft: "auto" }}>
        size
        <input type="range" min="1" max="10" step="0.5" value={nodeSize}
          onChange={e => onNodeSizeChange(Number(e.target.value))} style={{ width: 70 }} />
        <span style={{ minWidth: 22 }}>{nodeSize}px</span>
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--color-text-secondary)" }}>
        speed
        <input type="range" min="1" max="60" step="1" value={speed}
          onChange={e => onSpeedChange(Number(e.target.value))} style={{ width: 80 }} />
        <span style={{ minWidth: 28 }}>{speed}fps</span>
      </label>
      <button onClick={onNodesBtn} style={{
        padding: "4px 10px", fontSize: 13, cursor: "pointer",
        border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
        background: showPanel && sidebarTab === "nodes" ? "var(--color-text-secondary)" : "var(--color-background-secondary)",
        color: showPanel && sidebarTab === "nodes" ? "var(--color-background-primary)" : "var(--color-text-secondary)"
      }}>
        Nodes{selectedNodeCount > 0 ? ` (${selectedNodeCount})` : ""}
      </button>
      {hasMessages && (
        <button onClick={onMessagesBtn} style={{
          padding: "4px 10px", fontSize: 13, cursor: "pointer",
          border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
          background: showPanel && sidebarTab === "messages" ? "#3b82f6" : "var(--color-background-secondary)",
          color: showPanel && sidebarTab === "messages" ? "#fff" : "var(--color-text-secondary)"
        }}>
          Messages{selectedMessage ? ` #${selectedMessage}` : ""}
        </button>
      )}
      {hasEncounters && (
        <button onClick={onEncountersBtn} style={{
          padding: "4px 10px", fontSize: 13, cursor: "pointer",
          border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
          background: showPanel && sidebarTab === "encounters" ? "#fbbf24" : "var(--color-background-secondary)",
          color: showPanel && sidebarTab === "encounters" ? "#000" : "var(--color-text-secondary)"
        }}>
          Encounters
        </button>
      )}
      <Legend show={showLegend} onToggle={onToggleLegend} />
      <button onClick={onHome} style={{
        cursor: "pointer", fontSize: 12, padding: "4px 10px",
        border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
        background: "var(--color-background-secondary)", color: "var(--color-text-secondary)"
      }}>
        Home
      </button>
    </div>
  );
}
