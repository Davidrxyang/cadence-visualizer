import { useMemo } from "react";
import { MAX_SELECTED_NODES, ENCOUNTER_BUCKET_SECONDS } from "../lib/constants";
import { formatDuration, formatDisplayTime, formatElapsed } from "../lib/parse";
import EncountersPanel from "./EncountersPanel";
import EncounterPopup from "./EncounterPopup";

// Always-visible unified sidebar. In split mode shows a comparison row when a
// message is selected. Selection state is owned by App.jsx and passed in.
export default function CombinedSidebar({
  data1, data2, expName1, expName2,
  panel1, panel2,
  frameIdx, showAbsoluteTime,
  // shared selection
  selectedNodes, nodeColors, selectedMessage,
  filterMode, showEncounters, hideCarriers,
  sidebarTab, nodeSearch, msgSearch, onlyDelivered,
  encSearch, expandedEncGroupT,
  // setters
  setSidebarTab, setNodeSearch, setMsgSearch, setOnlyDelivered,
  setEncSearch, setExpandedEncGroupT, setFilterMode, setShowEncounters, setHideCarriers,
  // handlers
  toggleNode, setNodeColor, selectAllNodes, clearNodes, handleMessageClick,
}) {
  const data = data1;
  const tMin = data?.meta?.t_min;
  const splitMode = !!data2;
  const short = (n) => n ?? "";

  // ── shared lists (identical across experiments) ───────────────────────────

  const allNodeIds = useMemo(() => {
    if (!data) return [];
    return Array.from({ length: data.meta.node_count }, (_, i) => i);
  }, [data]);

  const filteredNodeIds = useMemo(() => {
    const q = nodeSearch.trim();
    if (!q) return allNodeIds;
    return allNodeIds.filter(id => String(id).includes(q));
  }, [allNodeIds, nodeSearch]);

  const allMessageIds = useMemo(() => {
    if (!data?.messageOrigins) return [];
    return Object.keys(data.messageOrigins).sort((a, b) => Number(a) - Number(b));
  }, [data]);

  const filteredMessageIds = useMemo(() => {
    let ids = allMessageIds;
    // "delivered only" shows messages delivered in EITHER experiment
    if (onlyDelivered) {
      ids = ids.filter(id =>
        data1?.deliveredPaths[id] !== undefined ||
        (data2 && data2.deliveredPaths[id] !== undefined)
      );
    }
    const q = msgSearch.trim();
    if (!q) return ids;
    return ids.filter(id => id.includes(q));
  }, [allMessageIds, msgSearch, onlyDelivered, data1, data2]);

  const encounterGroups = useMemo(() => {
    if (!data?.encounters?.length) return [];
    const map = {};
    for (const enc of data.encounters) {
      const bucket = Math.floor(enc.t / ENCOUNTER_BUCKET_SECONDS) * ENCOUNTER_BUCKET_SECONDS;
      (map[bucket] ??= []).push(enc);
    }
    return Object.keys(map).map(Number).sort((a, b) => a - b).map(t => ({ t, encounters: map[t] }));
  }, [data]);

  const filteredEncounterGroups = useMemo(() => {
    const q = encSearch.trim().toLowerCase();
    if (!q || !data) return encounterGroups;
    return encounterGroups.filter(g =>
      formatDisplayTime(g.t, tMin, showAbsoluteTime).toLowerCase().includes(q) ||
      String(g.t).includes(q)
    );
  }, [encounterGroups, encSearch, tMin, showAbsoluteTime]);

  if (!data) return null;

  const msgInfo = selectedMessage ? data.messageOrigins[selectedMessage] : null;
  const deliveredPath1 = selectedMessage ? data1.deliveredPaths[selectedMessage] : null;
  const deliveredPath2 = selectedMessage && data2 ? data2.deliveredPaths[selectedMessage] : null;

  return (
    <div style={{
      width: 280, flexShrink: 0,
      display: "flex", flexDirection: "column", overflow: "hidden",
      borderLeft: "0.5px solid var(--color-border-tertiary)",
      background: "var(--color-background-secondary)",
    }}>
      {/* ── Tab bar ──────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", flexShrink: 0,
        borderBottom: "0.5px solid var(--color-border-tertiary)",
      }}>
        {[
          ["nodes", selectedNodes.size > 0 ? `Nodes (${selectedNodes.size})` : "Nodes"],
          ["messages", selectedMessage ? `Msgs #${selectedMessage}` : "Messages"],
          ["encounters", "Encounters"],
        ].map(([tab, label]) => (
          <button key={tab} onClick={() => setSidebarTab(tab)} style={{
            flex: 1, padding: "7px 2px", fontSize: 11, cursor: "pointer",
            border: "none",
            borderBottom: sidebarTab === tab
              ? "2px solid var(--color-text-primary)"
              : "2px solid transparent",
            background: "none",
            color: sidebarTab === tab ? "var(--color-text-primary)" : "var(--color-text-secondary)",
            fontWeight: sidebarTab === tab ? 600 : 400,
            transition: "border-color 0.1s",
          }}>{label}</button>
        ))}
      </div>

      {/* ── Nodes tab ────────────────────────────────────────────────────── */}
      {sidebarTab === "nodes" && (
        <>
          <div style={{ padding: "10px 12px", borderBottom: "0.5px solid var(--color-border-tertiary)", display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              type="text" placeholder="Search node ID…" value={nodeSearch}
              onChange={e => setNodeSearch(e.target.value)}
              style={{ width: "100%", padding: "5px 8px", fontSize: 13, boxSizing: "border-box", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-primary)", color: "var(--color-text-primary)" }}
            />
            <div style={{ position: "relative", display: "flex", fontSize: 12, border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-primary)", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, bottom: 0, width: "50%", left: filterMode === "isolate" ? "50%" : "0%", background: "#ef4444", transition: "left 0.15s" }} />
              <button onClick={() => setFilterMode("highlight")} style={{ position: "relative", flex: 1, padding: "4px 0", cursor: "pointer", border: "none", background: "none", color: filterMode === "highlight" ? "#fff" : "var(--color-text-secondary)" }}>Highlight</button>
              <button onClick={() => setFilterMode("isolate")} style={{ position: "relative", flex: 1, padding: "4px 0", cursor: "pointer", border: "none", background: "none", color: filterMode === "isolate" ? "#fff" : "var(--color-text-secondary)" }}>Isolate</button>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => selectAllNodes(filteredNodeIds.slice(0, 10))} style={{ flex: 1, padding: "3px 0", fontSize: 11, cursor: "pointer", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-primary)", color: "var(--color-text-secondary)" }}>Select all</button>
              <button onClick={clearNodes} style={{ flex: 1, padding: "3px 0", fontSize: 11, cursor: "pointer", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-primary)", color: "var(--color-text-secondary)" }}>Clear</button>
            </div>
            <span style={{ fontSize: 11, color: "var(--color-text-secondary)", opacity: 0.6 }}>{selectedNodes.size}/{MAX_SELECTED_NODES} selected</span>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
            {filteredNodeIds.map(id => {
              const isSelected = selectedNodes.has(id);
              const color = nodeColors[id] ?? "#ef4444";
              return (
                <label key={id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", borderRadius: "var(--border-radius-md)", cursor: "pointer", fontSize: 13, background: isSelected ? `${color}1f` : "transparent", color: isSelected ? color : "var(--color-text-secondary)" }}>
                  <input type="checkbox" checked={isSelected} onChange={() => toggleNode(id)} disabled={!isSelected && selectedNodes.size >= MAX_SELECTED_NODES} style={{ accentColor: color }} />
                  {isSelected && (
                    <input type="color" value={color} onClick={e => e.stopPropagation()} onChange={e => setNodeColor(id, e.target.value)} title="Change color" style={{ width: 14, height: 14, padding: 0, border: "none", borderRadius: 2, cursor: "pointer", background: "none", flexShrink: 0 }} />
                  )}
                  Node {id}
                </label>
              );
            })}
          </div>

          {selectedNodes.size > 0 && panel1.hasEncounters && (
            <div style={{ borderTop: "0.5px solid var(--color-border-tertiary)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(251,191,36,0.9)" }}>Encounters</span>
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--color-text-secondary)", cursor: "pointer" }}>
                  <input type="checkbox" checked={showEncounters} onChange={e => setShowEncounters(e.target.checked)} style={{ accentColor: "#fbbf24" }} />
                  show
                </label>
              </div>
              {showEncounters && (
                panel1.currentEncounters.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {panel1.currentEncounters.map((enc, i) => (
                      <div key={i} onClick={() => panel1.openEncounterPopup(enc)} style={{ fontSize: 12, padding: "3px 6px", borderRadius: "var(--border-radius-md)", cursor: "pointer", background: "rgba(251,191,36,0.1)", color: "rgba(251,191,36,0.9)" }}>
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
      )}

      {/* ── Messages tab ─────────────────────────────────────────────────── */}
      {sidebarTab === "messages" && (
        <>
          <div style={{ padding: "10px 12px", borderBottom: "0.5px solid var(--color-border-tertiary)", display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
            <input
              type="text" placeholder="Search message ID…" value={msgSearch}
              onChange={e => setMsgSearch(e.target.value)}
              style={{ width: "100%", padding: "5px 8px", fontSize: 13, boxSizing: "border-box", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-primary)", color: "var(--color-text-primary)" }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-text-secondary)", cursor: "pointer" }}>
              <input type="checkbox" checked={onlyDelivered} onChange={e => setOnlyDelivered(e.target.checked)} style={{ accentColor: "#22c55e" }} />
              Delivered only
            </label>

            {/* ── Selected message detail panel ─────────────────────── */}
            {selectedMessage && msgInfo && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px", borderRadius: "var(--border-radius-md)", background: "rgba(59,130,246,0.08)", border: "0.5px solid rgba(59,130,246,0.2)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, color: "#3b82f6", fontWeight: 600 }}>Msg #{selectedMessage}</span>
                  <button onClick={() => handleMessageClick(selectedMessage)} style={{ padding: "1px 6px", fontSize: 10, cursor: "pointer", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-primary)", color: "var(--color-text-secondary)" }}>Clear</button>
                </div>
                <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                  Node {msgInfo.origin} → Node {msgInfo.dest}
                </span>
                <span style={{ fontSize: 11, color: "var(--color-text-secondary)", opacity: 0.7 }}>
                  Created: {formatDisplayTime(msgInfo.created, tMin, showAbsoluteTime)}
                </span>

                {/* Hide-carriers toggle applies in both single and split mode */}
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--color-text-secondary)", cursor: "pointer" }}>
                  <input type="checkbox" checked={hideCarriers} onChange={e => setHideCarriers(e.target.checked)} />
                  Hide carriers, focus selected nodes
                </label>

                {splitMode ? (
                  // Stacked comparison: one row per experiment
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 2 }}>
                    {[
                      { name: expName1, p: panel1, path: deliveredPath1, expColor: "#3b82f6" },
                      { name: expName2, p: panel2, path: deliveredPath2, expColor: "#22c55e" },
                    ].map(({ name, p, path, expColor }, idx) => (
                      <div key={idx} style={{ display: "flex", flexDirection: "column", gap: 2, padding: "6px 8px", borderRadius: "var(--border-radius-md)", background: "rgba(255,255,255,0.04)", border: "0.5px solid var(--color-border-tertiary)" }}>
                        <span style={{ fontSize: 10, fontWeight: 600, color: expColor, opacity: 0.9 }} title={name}>
                          {short(name)}
                        </span>
                        <span style={{ fontSize: 11, color: p?.delivered ? expColor : "var(--color-text-secondary)" }}>
                          {p?.delivered ? "✓ Delivered" : "In transit"}
                          {p?.carriers?.size != null && (
                            <span style={{ color: "var(--color-text-secondary)", fontWeight: 400 }}> · {p.carriers.size} carriers</span>
                          )}
                        </span>
                        {p?.deliveryMetrics ? (
                          <>
                            <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                              {p.deliveryMetrics.hops != null ? `${p.deliveryMetrics.hops} hop${p.deliveryMetrics.hops === 1 ? "" : "s"} · ` : ""}
                              {formatDuration(p.deliveryMetrics.latencySeconds)} latency
                            </span>
                            <span style={{ fontSize: 11, color: "var(--color-text-secondary)", opacity: 0.7 }}>
                              Delivered: {formatDisplayTime(p.deliveryMetrics.deliveredAt, tMin, showAbsoluteTime)}
                            </span>
                          </>
                        ) : (
                          <span style={{ fontSize: 11, color: "var(--color-text-secondary)", opacity: 0.4 }}>no transfers</span>
                        )}
                        {path && (
                          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 2 }}>
                            {path.map((nid, i) => (
                              <span key={i} style={{ fontSize: 10, color: nodeColors[nid] ?? "var(--color-text-primary)", fontWeight: nodeColors[nid] ? 600 : 400 }}>
                                {nid}{i < path.length - 1 ? <span style={{ opacity: 0.4, margin: "0 1px" }}>→</span> : ""}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  // Single experiment detail
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: panel1.delivered ? "#3b82f6" : "var(--color-text-secondary)" }}>
                        {panel1.delivered ? "✓ Delivered" : "In transit"}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                        {panel1.carriers.size} carriers
                      </span>
                    </div>
                    {panel1.deliveryMetrics && (
                      <>
                        <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                          {panel1.deliveryMetrics.hops != null ? `${panel1.deliveryMetrics.hops} hop${panel1.deliveryMetrics.hops === 1 ? "" : "s"} · ` : ""}
                          {formatDuration(panel1.deliveryMetrics.latencySeconds)} latency
                        </span>
                        <span style={{ fontSize: 11, color: "var(--color-text-secondary)", opacity: 0.7 }}>
                          Delivered: {formatDisplayTime(panel1.deliveryMetrics.deliveredAt, tMin, showAbsoluteTime)}
                        </span>
                      </>
                    )}
                    {deliveredPath1 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                          Path ({deliveredPath1.length} node{deliveredPath1.length === 1 ? "" : "s"}):
                        </span>
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 3, fontSize: 11 }}>
                          {deliveredPath1.map((nid, i) => (
                            <span key={i} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                              <span style={{ color: nodeColors[nid] ?? "var(--color-text-primary)", fontWeight: 600 }}>{nid}</span>
                              {i < deliveredPath1.length - 1 && <span style={{ color: "var(--color-text-secondary)", opacity: 0.5 }}>→</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
            {filteredMessageIds.map(id => {
              const info = data.messageOrigins[id];
              const isDelivered1 = data1.deliveredPaths[id] !== undefined;
              const isDelivered2 = data2 ? data2.deliveredPaths[id] !== undefined : false;
              return (
                <div key={id} onClick={() => handleMessageClick(id)} style={{ padding: "5px 8px", borderRadius: "var(--border-radius-md)", cursor: "pointer", background: selectedMessage === id ? "rgba(59,130,246,0.15)" : "transparent", display: "flex", flexDirection: "column", gap: 1 }}>
                  <span style={{ fontSize: 13, color: selectedMessage === id ? "#3b82f6" : "var(--color-text-primary)", display: "flex", alignItems: "center", gap: 5 }}>
                    #{id}
                    {splitMode ? (
                      <>
                        {isDelivered1 && <span style={{ fontSize: 9, color: "#3b82f6" }} title={`Delivered in ${short(expName1)}`}>✓</span>}
                        {isDelivered2 && <span style={{ fontSize: 9, color: "#22c55e" }} title={`Delivered in ${short(expName2)}`}>✓</span>}
                      </>
                    ) : (
                      isDelivered1 && <span style={{ fontSize: 10, color: "#3b82f6" }}>✓</span>
                    )}
                  </span>
                  {info && <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{info.origin} → {info.dest}</span>}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Encounters tab ───────────────────────────────────────────────── */}
      {sidebarTab === "encounters" && (
        <EncountersPanel
          encSearch={encSearch}
          onSearchChange={setEncSearch}
          groups={filteredEncounterGroups}
          expandedT={expandedEncGroupT}
          onToggleExpand={t => setExpandedEncGroupT(prev => prev === t ? null : t)}
          onEncounterClick={panel1.openEncounterPopup}
          tMin={tMin}
          showAbsoluteTime={showAbsoluteTime}
        />
      )}

      {/* ── Encounter popup ──────────────────────────────────────────────── */}
      <EncounterPopup
        encounter={panel1.encounterPopup}
        getMessages={panel1.getMessagesForEncounter}
        onClose={() => panel1.setEncounterPopup(null)}
        onMessageClick={(msgId) => {
          panel1.setEncounterPopup(null);
          setSidebarTab("messages");
          handleMessageClick(msgId);
        }}
        tMin={tMin}
        showAbsoluteTime={showAbsoluteTime}
      />
    </div>
  );
}
