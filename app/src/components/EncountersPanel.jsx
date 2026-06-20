import { formatTime } from "../lib/parse";

export default function EncountersPanel({
  encSearch, onSearchChange,
  groups, expandedT, onToggleExpand, onEncounterClick,
}) {
  return (
    <>
      <div style={{ padding: "10px 12px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
        <input
          type="text" placeholder="Search by time…" value={encSearch}
          onChange={e => onSearchChange(e.target.value)}
          style={{
            width: "100%", padding: "5px 8px", fontSize: 13, boxSizing: "border-box",
            border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
            background: "var(--color-background-primary)", color: "var(--color-text-primary)"
          }}
        />
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px", display: "flex", flexDirection: "column", gap: 1 }}>
        {groups.map(group => (
          <div key={group.t}>
            <div
              onClick={() => onToggleExpand(group.t)}
              style={{
                padding: "5px 8px", borderRadius: "var(--border-radius-md)", cursor: "pointer",
                background: expandedT === group.t ? "rgba(251,191,36,0.12)" : "transparent",
                fontSize: 12, color: "var(--color-text-primary)",
                display: "flex", flexDirection: "column", gap: 1
              }}
            >
              <span style={{ whiteSpace: "nowrap" }}>time: {formatTime(group.t)}</span>
              <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                encounters: {group.encounters.length}
              </span>
            </div>
            {expandedT === group.t && (
              <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "2px 8px 6px 16px" }}>
                {group.encounters.map((enc, i) => (
                  <div
                    key={i}
                    onClick={() => onEncounterClick(enc)}
                    style={{
                      fontSize: 12, padding: "3px 6px", borderRadius: "var(--border-radius-md)", cursor: "pointer",
                      background: "rgba(251,191,36,0.08)", color: "rgba(251,191,36,0.9)",
                      display: "flex", flexDirection: "column", gap: 1
                    }}
                  >
                    <span style={{ whiteSpace: "nowrap" }}>Node {enc.n1} ↔ Node {enc.n2}</span>
                    <span style={{ fontSize: 11, opacity: 0.7, whiteSpace: "nowrap" }}>{formatTime(enc.t)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {groups.length === 0 && (
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)", opacity: 0.5, padding: 8 }}>
            No matches
          </span>
        )}
      </div>
    </>
  );
}
