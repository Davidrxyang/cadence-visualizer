import { formatDisplayTime } from "../lib/parse";

export default function Timeline({
  playing, onTogglePlay,
  frames, frameIdx, onScrub, tMin, showAbsoluteTime,
  showEncounters, encounterTicks,
  transferTicks1, transferTicks2,
  deliveryFrameIdx1, deliveryFrameIdx2,
  dayMarkers,
}) {
  const lastIdx = frames.length - 1;
  const pct = (idx) => `${(idx / lastIdx) * 100}%`;
  const fmt = (t) => formatDisplayTime(t, tMin, showAbsoluteTime);

  const EXP_COLORS = [
    { rgb: [59, 130, 246], hex: "#3b82f6" },   // blue  — exp 1
    { rgb: [249, 115, 22], hex: "#f97316" },    // orange — exp 2
  ];

  const xferRows = [
    { ticks: transferTicks1 ?? new Set(), color: EXP_COLORS[0].rgb },
    { ticks: transferTicks2 ?? new Set(), color: EXP_COLORS[1].rgb },
  ].filter(r => r.ticks.size > 0);

  const deliveryBars = [
    { idx: deliveryFrameIdx1, color: EXP_COLORS[0], label: "Exp 1 delivery" },
    { idx: deliveryFrameIdx2, color: EXP_COLORS[1], label: "Exp 2 delivery" },
  ].filter(d => d.idx !== null && d.idx !== undefined);

  return (
    <div style={{
      padding: "10px 12px", borderTop: "0.5px solid var(--color-border-tertiary)",
      display: "flex", alignItems: "center", gap: 12
    }}>
      <button
        onClick={onTogglePlay}
        style={{
          width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center",
          border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)",
          background: "var(--color-background-secondary)", cursor: "pointer", flexShrink: 0
        }}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? "⏸" : "▶"}
      </button>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
        {showEncounters && encounterTicks.size > 0 && (
          <div style={{ position: "relative", height: 8 }}>
            {[...encounterTicks].map(idx => (
              <div key={idx} onClick={() => onScrub(idx)}
                title={fmt(frames[idx].t)}
                style={{
                  position: "absolute", cursor: "pointer",
                  left: pct(idx),
                  top: 1, width: 6, height: 6, borderRadius: 1, transform: "translateX(-50%)",
                  background: idx === frameIdx ? "rgba(251,191,36,1)" : "rgba(251,191,36,0.65)",
                }}
              />
            ))}
          </div>
        )}
        {xferRows.map(({ ticks, color }, ri) => (
          <div key={ri} style={{ position: "relative", height: 8 }}>
            {[...ticks].map(idx => (
              <div key={idx} onClick={() => onScrub(idx)}
                title={fmt(frames[idx].t)}
                style={{
                  position: "absolute", cursor: "pointer",
                  left: pct(idx),
                  top: 1, width: 6, height: 6, borderRadius: 1, transform: "translateX(-50%)",
                  background: idx === frameIdx
                    ? `rgba(${color.join(",")},1)`
                    : `rgba(${color.join(",")},0.65)`,
                }}
              />
            ))}
          </div>
        ))}
        <div style={{ position: "relative" }}>
          <input
            type="range" min={0} max={lastIdx} step={1} value={frameIdx}
            onChange={e => onScrub(Number(e.target.value))}
            style={{ width: "100%" }} aria-label="Timeline scrubber"
          />
          {deliveryBars.map(({ idx, color, label }) => (
            <div
              key={label}
              onClick={() => onScrub(idx)}
              title={`${label} · ${fmt(frames[idx].t)}`}
              style={{
                position: "absolute",
                left: pct(idx),
                top: "50%", transform: "translate(-50%, -50%)",
                width: 3, height: 18,
                background: idx === frameIdx
                  ? `rgba(${color.rgb.join(",")},1)`
                  : `rgba(${color.rgb.join(",")},0.85)`,
                borderRadius: 2,
                cursor: "pointer",
                pointerEvents: "all",
                zIndex: 2,
              }}
            />
          ))}
        </div>
        {dayMarkers.length > 0 && (
          <div style={{ position: "relative", height: 14 }}>
            {dayMarkers.map(({ idx, day }) => (
              <div key={day} onClick={() => onScrub(idx)}
                title={fmt(frames[idx].t)}
                style={{
                  position: "absolute", left: pct(idx), top: 0, cursor: "pointer",
                  transform: "translateX(-50%)",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 1
                }}
              >
                <div style={{ width: 1, height: 6, background: "rgba(255,255,255,0.25)" }} />
                <span style={{ fontSize: 9, color: "var(--color-text-secondary)", opacity: 0.6 }}>{day}d</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
