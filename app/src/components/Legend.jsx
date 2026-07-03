function LegendRow({ preview, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 16, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {preview}
      </div>
      <span style={{ fontSize: 12, color: "var(--color-text-primary)" }}>{label}</span>
    </div>
  );
}

function TrianglePreview({ fill }) {
  return (
    <div style={{ position: "relative", width: 14, height: 14 }}>
      <div style={{
        position: "absolute", top: 0, left: 0, width: 0, height: 0,
        borderLeft: "7px solid transparent", borderRight: "7px solid transparent",
        borderBottom: "12px solid rgba(255,255,255,0.95)",
      }} />
      <div style={{
        position: "absolute", top: 2, left: 2, width: 0, height: 0,
        borderLeft: "5px solid transparent", borderRight: "5px solid transparent",
        borderBottom: `9px solid ${fill}`,
      }} />
    </div>
  );
}

export default function Legend({ show, onToggle, splitMode }) {
  return (
    <div style={{ position: "relative" }}>
      <button onClick={onToggle} style={{
        padding: "4px 10px", fontSize: 13, cursor: "pointer",
        border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
        background: show ? "var(--color-text-secondary)" : "var(--color-background-secondary)",
        color: show ? "var(--color-background-primary)" : "var(--color-text-secondary)"
      }}>
        Legend
      </button>
      {show && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 30,
          width: 280, padding: "12px 14px", borderRadius: "var(--border-radius-md)",
          border: "0.5px solid var(--color-border-secondary)",
          background: "var(--color-background-secondary)",
          boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
          display: "flex", flexDirection: "column", gap: 10
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Nodes
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <LegendRow
                preview={<div style={{ width: 10, height: 10, borderRadius: "50%", background: "hsl(200,80%,60%)" }} />}
                label="Node (no filter active)"
              />
              <LegendRow
                preview={<div style={{ width: 10, height: 10, borderRadius: "50%", background: "rgba(100,100,100,0.5)" }} />}
                label="Unselected node (filter active)"
              />
              <LegendRow
                preview={<div style={{ width: 12, height: 12, borderRadius: "50%", background: "#22c55e", border: "1.5px solid rgba(255,255,255,0.7)" }} />}
                label="Selected node (your chosen color)"
              />
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Encounters
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <LegendRow
                preview={<div style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid rgba(251,191,36,0.9)" }} />}
                label="Encounter between two selected nodes"
              />
              <LegendRow
                preview={<div style={{ width: 6, height: 6, borderRadius: 1, background: "rgba(251,191,36,0.9)" }} />}
                label="Encounter tick on timeline"
              />
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Messages
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <LegendRow
                preview={<TrianglePreview fill="#000000" />}
                label="Message carrier (not in your selection)"
              />
              <LegendRow
                preview={<TrianglePreview fill="#22c55e" />}
                label="Message carrier (also a selected node)"
              />
              <LegendRow
                preview={
                  <div style={{ position: "relative", width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ position: "absolute", width: 16, height: 16, borderRadius: "50%", background: "rgba(34,197,94,0.25)" }} />
                    <TrianglePreview fill="#000000" />
                  </div>
                }
                label="Destination — message delivered (✓ dest)"
              />
              <LegendRow
                preview={<span style={{ fontSize: 10, color: "var(--color-text-secondary)" }}>"origin"</span>}
                label="Label marking the message's origin node"
              />
              {!splitMode ? (
                <>
                  <LegendRow
                    preview={<div style={{ width: 6, height: 6, borderRadius: 1, background: "rgba(59,130,246,0.9)" }} />}
                    label="Transfer tick on timeline"
                  />
                  <LegendRow
                    preview={<div style={{ width: 3, height: 14, borderRadius: 2, background: "#22c55e" }} />}
                    label="Delivery marker on timeline"
                  />
                </>
              ) : (
                <>
                  <LegendRow
                    preview={<div style={{ width: 6, height: 6, borderRadius: 1, background: "rgba(59,130,246,0.9)" }} />}
                    label="Exp 1 transfer tick on timeline (blue)"
                  />
                  <LegendRow
                    preview={<div style={{ width: 3, height: 14, borderRadius: 2, background: "#3b82f6" }} />}
                    label="Exp 1 delivery marker (blue)"
                  />
                  <LegendRow
                    preview={<div style={{ width: 6, height: 6, borderRadius: 1, background: "rgba(249,115,22,0.9)" }} />}
                    label="Exp 2 transfer tick on timeline (orange)"
                  />
                  <LegendRow
                    preview={<div style={{ width: 3, height: 14, borderRadius: 2, background: "#f97316" }} />}
                    label="Exp 2 delivery marker (orange)"
                  />
                  <LegendRow
                    preview={<span style={{ fontSize: 11, color: "#3b82f6", fontWeight: 600 }}>✓</span>}
                    label="Exp 1 delivered (blue in message list)"
                  />
                  <LegendRow
                    preview={<span style={{ fontSize: 11, color: "#f97316", fontWeight: 600 }}>✓</span>}
                    label="Exp 2 delivered (orange in message list)"
                  />
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
