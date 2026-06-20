import { formatTime } from "../lib/parse";

export default function EncounterPopup({ encounter, getMessages, onClose, onMessageClick }) {
  if (!encounter) return null;
  const msgs = getMessages(encounter);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 360, maxHeight: "70vh", overflowY: "auto",
          background: "var(--color-background-secondary)",
          border: "0.5px solid var(--color-border-secondary)",
          borderRadius: "var(--border-radius-lg)",
          padding: "16px 18px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          display: "flex", flexDirection: "column", gap: 10
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "rgba(251,191,36,0.9)" }}>
            Encounter: Node {encounter.n1} ↔ Node {encounter.n2}
          </span>
          <button onClick={onClose} style={{
            border: "none", background: "none", color: "var(--color-text-secondary)",
            cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0
          }}>×</button>
        </div>
        <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
          {formatTime(encounter.t)} · duration {encounter.dur}s
        </span>

        <div style={{ borderTop: "0.5px solid var(--color-border-tertiary)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)" }}>
            Messages transferred during this encounter
          </span>
          {msgs.length === 0 ? (
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)", opacity: 0.6 }}>None</span>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {msgs.map((m, i) => (
                <div
                  key={i}
                  onClick={() => onMessageClick(m.id)}
                  style={{
                    padding: "5px 8px", borderRadius: "var(--border-radius-md)", cursor: "pointer",
                    background: "rgba(59,130,246,0.1)", display: "flex", flexDirection: "column", gap: 1
                  }}
                >
                  <span style={{ fontSize: 12, color: "#3b82f6", fontWeight: 600 }}>#{m.id}</span>
                  <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                    {m.from} → {m.to} at {formatTime(m.t)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
