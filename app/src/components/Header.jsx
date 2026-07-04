import Legend from "./Legend";

export default function Header({
  expNames, timeLabel, showAbsoluteTime, onShowAbsoluteTimeChange,
  nodeCount, frameIdx, frameCount,
  nodeSize, onNodeSizeChange, speed, onSpeedChange,
  showLegend, onToggleLegend, onHome, splitMode,
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, padding: "8px 12px",
      borderBottom: "0.5px solid var(--color-border-tertiary)", flexWrap: "wrap",
      flexShrink: 0,
    }}>
      {expNames && expNames.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {expNames.map((n, i) => (
            <span key={i} style={{
              fontSize: 13, fontWeight: 500,
              color: i === 0 ? "#3b82f6" : "#22c55e",
              maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
            }} title={n}>
              {n.replace(/^japan - /, "")}
            </span>
          ))}
        </div>
      )}
      <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{timeLabel}</span>
      <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--color-text-secondary)", cursor: "pointer" }}>
        <input type="checkbox" checked={showAbsoluteTime} onChange={e => onShowAbsoluteTimeChange(e.target.checked)} />
        actual date
      </label>
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
      <Legend show={showLegend} onToggle={onToggleLegend} splitMode={splitMode} />
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
