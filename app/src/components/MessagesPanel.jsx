import { formatDuration } from "../lib/parse";

export default function MessagesPanel({
  msgSearch, onSearchChange,
  onlyDelivered, onOnlyDeliveredChange,
  selectedMessage, msgInfo, carriers, delivered,
  hideCarriers, onHideCarriersChange,
  deliveredPath, deliveryMetrics, nodeColors, onClearSelected,
  filteredMessageIds, messageOrigins, deliveredPaths, onMessageClick,
}) {
  return (
    <>
      <div style={{ padding: "10px 12px", borderBottom: "0.5px solid var(--color-border-tertiary)", display: "flex", flexDirection: "column", gap: 8 }}>
        <input
          type="text" placeholder="Search message ID…" value={msgSearch}
          onChange={e => onSearchChange(e.target.value)}
          style={{
            width: "100%", padding: "5px 8px", fontSize: 13, boxSizing: "border-box",
            border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
            background: "var(--color-background-primary)", color: "var(--color-text-primary)"
          }}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-text-secondary)", cursor: "pointer" }}>
          <input type="checkbox" checked={onlyDelivered} onChange={e => onOnlyDeliveredChange(e.target.checked)} style={{ accentColor: "#22c55e" }} />
          Delivered only
        </label>
        {selectedMessage && msgInfo && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "6px 8px", borderRadius: "var(--border-radius-md)", background: "rgba(59,130,246,0.1)" }}>
            <span style={{ fontSize: 12, color: "#3b82f6", fontWeight: 600 }}>Msg #{selectedMessage}</span>
            <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>Origin: Node {msgInfo.origin}</span>
            <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>Dest: Node {msgInfo.dest}</span>
            <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>Carriers: {carriers.size}</span>
            <span style={{ fontSize: 11, color: delivered ? "#22c55e" : "var(--color-text-secondary)" }}>
              {delivered ? "✓ Delivered" : "In transit"}
            </span>
            {deliveryMetrics && (
              <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                {deliveryMetrics.hops != null ? `${deliveryMetrics.hops} hop${deliveryMetrics.hops === 1 ? "" : "s"} · ` : ""}
                {formatDuration(deliveryMetrics.latencySeconds)} latency
              </span>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--color-text-secondary)", cursor: "pointer" }}>
              <input type="checkbox" checked={hideCarriers} onChange={e => onHideCarriersChange(e.target.checked)} />
              Hide carriers, focus selected nodes only
            </label>
            {deliveredPath && (
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                  Path ({deliveredPath.length} node{deliveredPath.length === 1 ? "" : "s"}):
                </span>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 3, fontSize: 11 }}>
                  {deliveredPath.map((nid, i) => (
                    <span key={i} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                      <span style={{ color: nodeColors[nid] ?? "var(--color-text-primary)", fontWeight: 600 }}>
                        {nid}
                      </span>
                      {i < deliveredPath.length - 1 && (
                        <span style={{ color: "var(--color-text-secondary)", opacity: 0.5 }}>→</span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <button onClick={onClearSelected} style={{
              marginTop: 2, padding: "2px 0", fontSize: 11, cursor: "pointer",
              border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
              background: "var(--color-background-primary)", color: "var(--color-text-secondary)"
            }}>Clear</button>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
        {filteredMessageIds.map(id => {
          const info = messageOrigins[id];
          const isDelivered = deliveredPaths[id] !== undefined;
          return (
            <div
              key={id}
              onClick={() => onMessageClick(id)}
              style={{
                padding: "5px 8px", borderRadius: "var(--border-radius-md)", cursor: "pointer",
                background: selectedMessage === id ? "rgba(59,130,246,0.15)" : "transparent",
                display: "flex", flexDirection: "column", gap: 1
              }}
            >
              <span style={{ fontSize: 13, color: selectedMessage === id ? "#3b82f6" : "var(--color-text-primary)", display: "flex", alignItems: "center", gap: 6 }}>
                #{id}
                {isDelivered && <span style={{ fontSize: 10, color: "#22c55e" }} title="Delivered">✓</span>}
              </span>
              {info && (
                <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                  {info.origin} → {info.dest}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
