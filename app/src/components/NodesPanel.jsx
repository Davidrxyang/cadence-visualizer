import { MAX_SELECTED_NODES } from "../lib/constants";

export default function NodesPanel({
  nodeSearch, onSearchChange,
  filterMode, onFilterModeChange,
  onSelectAll, onClear,
  selectedNodes, filteredNodeIds, nodeColors, onToggleNode, onSetNodeColor,
  hasEncounters, showEncounters, onShowEncountersChange, currentEncounters, onEncounterClick,
}) {
  return (
    <>
      <div style={{ padding: "10px 12px", borderBottom: "0.5px solid var(--color-border-tertiary)", display: "flex", flexDirection: "column", gap: 8 }}>
        <input
          type="text" placeholder="Search node ID…" value={nodeSearch}
          onChange={e => onSearchChange(e.target.value)}
          style={{
            width: "100%", padding: "5px 8px", fontSize: 13, boxSizing: "border-box",
            border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
            background: "var(--color-background-primary)", color: "var(--color-text-primary)"
          }}
        />
        <div style={{
          position: "relative", display: "flex", fontSize: 12,
          border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
          background: "var(--color-background-primary)", overflow: "hidden"
        }}>
          <div style={{
            position: "absolute", top: 0, bottom: 0, width: "50%",
            left: filterMode === "isolate" ? "50%" : "0%",
            background: "#ef4444", transition: "left 0.15s"
          }} />
          <button onClick={() => onFilterModeChange("highlight")} style={{
            position: "relative", flex: 1, padding: "4px 0", cursor: "pointer",
            border: "none", background: "none",
            color: filterMode === "highlight" ? "#fff" : "var(--color-text-secondary)"
          }}>Highlight</button>
          <button onClick={() => onFilterModeChange("isolate")} style={{
            position: "relative", flex: 1, padding: "4px 0", cursor: "pointer",
            border: "none", background: "none",
            color: filterMode === "isolate" ? "#fff" : "var(--color-text-secondary)"
          }}>Isolate</button>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={onSelectAll} style={{
            flex: 1, padding: "3px 0", fontSize: 11, cursor: "pointer",
            border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
            background: "var(--color-background-primary)", color: "var(--color-text-secondary)"
          }}>Select all</button>
          <button onClick={onClear} style={{
            flex: 1, padding: "3px 0", fontSize: 11, cursor: "pointer",
            border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
            background: "var(--color-background-primary)", color: "var(--color-text-secondary)"
          }}>Clear</button>
        </div>
        <span style={{ fontSize: 11, color: "var(--color-text-secondary)", opacity: 0.6 }}>
          {selectedNodes.size}/{MAX_SELECTED_NODES} selected
        </span>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
        {filteredNodeIds.map(id => {
          const isSelected = selectedNodes.has(id);
          const color = nodeColors[id] ?? "#ef4444";
          return (
            <label key={id} style={{
              display: "flex", alignItems: "center", gap: 8, padding: "4px 6px",
              borderRadius: "var(--border-radius-md)", cursor: "pointer", fontSize: 13,
              background: isSelected ? `${color}1f` : "transparent",
              color: isSelected ? color : "var(--color-text-secondary)"
            }}>
              <input
                type="checkbox" checked={isSelected} onChange={() => onToggleNode(id)}
                disabled={!isSelected && selectedNodes.size >= MAX_SELECTED_NODES}
                style={{ accentColor: color }}
              />
              {isSelected && (
                <input
                  type="color" value={color}
                  onClick={e => e.stopPropagation()}
                  onChange={e => onSetNodeColor(id, e.target.value)}
                  title="Change color"
                  style={{
                    width: 14, height: 14, padding: 0, border: "none",
                    borderRadius: 2, cursor: "pointer", background: "none", flexShrink: 0
                  }}
                />
              )}
              Node {id}
            </label>
          );
        })}
      </div>

      {selectedNodes.size > 0 && hasEncounters && (
        <div style={{ borderTop: "0.5px solid var(--color-border-tertiary)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(251,191,36,0.9)" }}>Encounters</span>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--color-text-secondary)", cursor: "pointer" }}>
              <input type="checkbox" checked={showEncounters} onChange={e => onShowEncountersChange(e.target.checked)} style={{ accentColor: "#fbbf24" }} />
              show
            </label>
          </div>
          {showEncounters && (
            currentEncounters.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {currentEncounters.map((enc, i) => (
                  <div key={i}
                    onClick={() => onEncounterClick(enc)}
                    style={{
                      fontSize: 12, padding: "3px 6px", borderRadius: "var(--border-radius-md)", cursor: "pointer",
                      background: "rgba(251,191,36,0.1)", color: "rgba(251,191,36,0.9)"
                    }}>
                    {enc.n1} ↔ {enc.n2}
                  </div>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: 12, color: "var(--color-text-secondary)", opacity: 0.5 }}>none at this time</span>
            )
          )}
        </div>
      )}
    </>
  );
}
