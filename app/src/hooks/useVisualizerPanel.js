import { useState, useMemo, useCallback } from "react";
import { MAX_SELECTED_NODES, ENCOUNTER_BUCKET_SECONDS } from "../lib/constants";
import { NODE_COLOR_PALETTE } from "../lib/colors";
import { formatDisplayTime } from "../lib/parse";

// All per-panel visualization state and derived values. Shared state (frameIdx,
// nodeSize, showAbsoluteTime) is passed in as arguments so memos stay reactive.
export function useVisualizerPanel(data, frameIdx, showAbsoluteTime, onScrub) {
  const [selectedNodes, setSelectedNodes] = useState(new Set());
  const [nodeColors, setNodeColors] = useState({});
  const [filterMode, setFilterMode] = useState("highlight");
  const [showPanel, setShowPanel] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [sidebarTab, setSidebarTab] = useState("nodes");
  const [nodeSearch, setNodeSearch] = useState("");
  const [showEncounters, setShowEncounters] = useState(true);
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [msgSearch, setMsgSearch] = useState("");
  const [onlyDelivered, setOnlyDelivered] = useState(false);
  const [hideCarriers, setHideCarriers] = useState(false);
  const [encSearch, setEncSearch] = useState("");
  const [expandedEncGroupT, setExpandedEncGroupT] = useState(null);
  const [encounterPopup, setEncounterPopup] = useState(null);
  const [clickedNode, setClickedNode] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const reset = useCallback(() => {
    setSelectedNodes(new Set());
    setNodeColors({});
    setSelectedMessage(null);
    setOnlyDelivered(false);
    setClickedNode(null);
    setEncSearch("");
    setExpandedEncGroupT(null);
    setEncounterPopup(null);
    setShowPanel(false);
    setShowLegend(false);
    setSidebarTab("nodes");
  }, []);

  // ── derived ────────────────────────────────────────────────────────────────

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
    if (!data?.transfers) return [];
    return Object.keys(data.transfers).sort((a, b) => Number(a) - Number(b));
  }, [data]);

  const filteredMessageIds = useMemo(() => {
    let ids = allMessageIds;
    if (onlyDelivered) ids = ids.filter(id => data?.deliveredPaths[id] !== undefined);
    const q = msgSearch.trim();
    if (!q) return ids;
    return ids.filter(id => id.includes(q));
  }, [allMessageIds, msgSearch, onlyDelivered, data]);

  const frameIdxMap = useMemo(() => {
    if (!data) return new Map();
    return new Map(data.frames.map((f, i) => [f.t, i]));
  }, [data]);

  const encountersByNode = useMemo(() => {
    if (!data?.encounters?.length) return {};
    const map = {};
    for (const enc of data.encounters) {
      (map[enc.n1] ??= []).push(enc);
      (map[enc.n2] ??= []).push(enc);
    }
    return map;
  }, [data]);

  const encounterTicks = useMemo(() => {
    if (!data?.encounters?.length || !selectedNodes.size) return new Set();
    const { bucket } = data.meta;
    const ticks = new Set();
    for (const nodeId of selectedNodes) {
      for (const enc of (encountersByNode[nodeId] ?? [])) {
        const tStart = Math.floor(enc.t / bucket) * bucket;
        for (let t = tStart; t < enc.t + enc.dur; t += bucket) {
          const idx = frameIdxMap.get(t);
          if (idx !== undefined) ticks.add(idx);
        }
      }
    }
    return ticks;
  }, [data, selectedNodes, encountersByNode, frameIdxMap]);

  const currentEncounters = useMemo(() => {
    if (!data?.encounters?.length || !selectedNodes.size) return [];
    const frameT = data.frames[frameIdx]?.t;
    if (frameT == null) return [];
    const seen = new Set();
    const result = [];
    for (const nodeId of selectedNodes) {
      for (const enc of (encountersByNode[nodeId] ?? [])) {
        if (frameT < enc.t || frameT >= enc.t + enc.dur) continue;
        const key = `${enc.t}-${enc.n1}-${enc.n2}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(enc);
      }
    }
    return result;
  }, [data, frameIdx, selectedNodes, encountersByNode]);

  const transfersByNodePair = useMemo(() => {
    if (!data?.transfers) return {};
    const map = {};
    for (const msgId of Object.keys(data.transfers)) {
      for (const xfer of data.transfers[msgId]) {
        const key = xfer.from < xfer.to ? `${xfer.from}-${xfer.to}` : `${xfer.to}-${xfer.from}`;
        (map[key] ??= []).push(xfer);
      }
    }
    return map;
  }, [data]);

  const getMessagesForEncounter = useCallback((enc) => {
    const key = enc.n1 < enc.n2 ? `${enc.n1}-${enc.n2}` : `${enc.n2}-${enc.n1}`;
    return (transfersByNodePair[key] ?? []).filter(x => x.t >= enc.t && x.t < enc.t + enc.dur);
  }, [transfersByNodePair]);

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
      formatDisplayTime(g.t, data.meta.t_min, showAbsoluteTime).toLowerCase().includes(q) ||
      String(g.t).includes(q)
    );
  }, [encounterGroups, encSearch, data, showAbsoluteTime]);

  const carriers = useMemo(() => {
    if (!selectedMessage || !data) return new Set();
    const frameT = data.frames[frameIdx]?.t;
    if (frameT == null) return new Set();
    const origin = data.messageOrigins[selectedMessage]?.origin;
    const result = new Set(origin != null ? [origin] : []);
    for (const xfer of (data.transfers[selectedMessage] ?? [])) {
      if (xfer.t > frameT) break;
      result.add(xfer.to);
    }
    return result;
  }, [selectedMessage, frameIdx, data]);

  const transferTicks = useMemo(() => {
    if (!selectedMessage || !data?.transfers[selectedMessage]) return new Set();
    const { bucket } = data.meta;
    const ticks = new Set();
    for (const xfer of data.transfers[selectedMessage]) {
      const bucketed = Math.floor(xfer.t / bucket) * bucket;
      const idx = frameIdxMap.get(bucketed);
      if (idx !== undefined) ticks.add(idx);
    }
    return ticks;
  }, [selectedMessage, data, frameIdxMap]);

  const deliveryFrameIdx = useMemo(() => {
    if (!selectedMessage || !data) return null;
    const dest = data.messageOrigins[selectedMessage]?.dest;
    if (dest == null) return null;
    const { bucket } = data.meta;
    for (const xfer of (data.transfers[selectedMessage] ?? [])) {
      if (xfer.to === dest) {
        const bucketed = Math.floor(xfer.t / bucket) * bucket;
        const exact = frameIdxMap.get(bucketed);
        if (exact !== undefined) return exact;
        const frames = data.frames;
        let lo = 0, hi = frames.length - 1, best = 0;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (frames[mid].t <= bucketed) { best = mid; lo = mid + 1; }
          else hi = mid - 1;
        }
        return best;
      }
    }
    return null;
  }, [selectedMessage, data, frameIdxMap]);

  const deliveryMetrics = useMemo(() => {
    if (!selectedMessage || !data) return null;
    const dest = data.messageOrigins[selectedMessage]?.dest;
    const created = data.messageOrigins[selectedMessage]?.created;
    if (dest == null || created == null) return null;
    const deliverXfer = (data.transfers[selectedMessage] ?? []).find(x => x.to === dest);
    if (!deliverXfer) return null;
    const path = data.deliveredPaths[selectedMessage];
    return { hops: path ? path.length - 1 : null, latencySeconds: deliverXfer.t - created };
  }, [selectedMessage, data]);

  const nodeCount = data ? Object.keys(data.frames[frameIdx]?.nodes ?? {}).length : 0;
  const hasEncounters = !!(data?.encounters?.length);
  const hasMessages = !!(data && allMessageIds.length);
  const msgInfo = selectedMessage ? data?.messageOrigins[selectedMessage] : null;
  const delivered = !!(msgInfo && carriers.has(msgInfo.dest));

  // ── node handlers ──────────────────────────────────────────────────────────

  const toggleNode = useCallback((id) => {
    setSelectedNodes(prev => {
      if (prev.has(id)) { const next = new Set(prev); next.delete(id); return next; }
      if (prev.size >= MAX_SELECTED_NODES) return prev;
      const next = new Set(prev);
      next.add(id);
      setNodeColors(c => c[id] ? c : { ...c, [id]: NODE_COLOR_PALETTE[(next.size - 1) % NODE_COLOR_PALETTE.length] });
      return next;
    });
  }, []);

  const setNodeColor = useCallback((id, color) => {
    setNodeColors(prev => ({ ...prev, [id]: color }));
  }, []);

  const selectAllNodes = useCallback((ids) => {
    setSelectedNodes(new Set(ids));
    setNodeColors(prev => {
      const next = { ...prev };
      ids.forEach((id, i) => { if (!next[id]) next[id] = NODE_COLOR_PALETTE[i % NODE_COLOR_PALETTE.length]; });
      return next;
    });
  }, []);

  const clearNodes = useCallback(() => {
    setSelectedNodes(new Set());
    setNodeColors({});
  }, []);

  const focusOnPathNodes = useCallback((pathNodeIds) => {
    const ids = pathNodeIds.slice(0, MAX_SELECTED_NODES);
    setSelectedNodes(new Set(ids));
    setNodeColors(() => {
      const next = {};
      ids.forEach((id, i) => { next[id] = NODE_COLOR_PALETTE[i % NODE_COLOR_PALETTE.length]; });
      return next;
    });
  }, []);

  // ── message handlers ───────────────────────────────────────────────────────

  const getRelevantNodesForMessage = useCallback((msgId) => {
    if (!data) return [];
    const path = data.deliveredPaths[msgId];
    if (path) return path;
    const origin = data.messageOrigins[msgId]?.origin;
    const ids = [];
    const seen = new Set();
    if (origin !== undefined) { ids.push(origin); seen.add(origin); }
    for (const xfer of (data.transfers[msgId] ?? [])) {
      if (!seen.has(xfer.to)) { seen.add(xfer.to); ids.push(xfer.to); }
    }
    return ids;
  }, [data]);

  const handleMessageClick = useCallback((id) => {
    setSelectedMessage(prev => {
      const next = prev === id ? null : id;
      if (next !== null) {
        const nodes = getRelevantNodesForMessage(next);
        if (nodes.length) focusOnPathNodes(nodes);
      }
      return next;
    });
  }, [getRelevantNodesForMessage, focusOnPathNodes]);

  const findFrameIdxForTime = useCallback((t) => {
    if (!data) return null;
    const { bucket } = data.meta;
    const bucketed = Math.floor(t / bucket) * bucket;
    const exact = frameIdxMap.get(bucketed);
    if (exact !== undefined) return exact;
    const frames = data.frames;
    let lo = 0, hi = frames.length - 1, best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (frames[mid].t <= bucketed) { best = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return best;
  }, [data, frameIdxMap]);

  const openEncounterPopup = useCallback((enc) => {
    setEncounterPopup(enc);
    const idx = findFrameIdxForTime(enc.t);
    if (idx !== null) onScrub(idx);
  }, [findFrameIdxForTime, onScrub]);

  const handlePopupMessageClick = useCallback((msgId) => {
    setEncounterPopup(null);
    setShowPanel(true);
    setSidebarTab("messages");
    handleMessageClick(msgId);
  }, [handleMessageClick]);

  // ── sidebar tab handlers ───────────────────────────────────────────────────

  const handleNodesBtn = useCallback(() => {
    setShowPanel(p => { if (p && sidebarTab === "nodes") return false; setSidebarTab("nodes"); return true; });
  }, [sidebarTab]);

  const handleMessagesBtn = useCallback(() => {
    setShowPanel(p => { if (p && sidebarTab === "messages") return false; setSidebarTab("messages"); return true; });
  }, [sidebarTab]);

  const handleEncountersBtn = useCallback(() => {
    setShowPanel(p => { if (p && sidebarTab === "encounters") return false; setSidebarTab("encounters"); return true; });
  }, [sidebarTab]);

  return {
    // raw state (needed by Header/VisualizerPanel for prop-drilling)
    selectedNodes, nodeColors, filterMode, setFilterMode,
    showPanel, showLegend, setShowLegend, sidebarTab,
    nodeSearch, setNodeSearch, showEncounters, setShowEncounters,
    selectedMessage, msgSearch, setMsgSearch, onlyDelivered, setOnlyDelivered,
    hideCarriers, setHideCarriers, encSearch, setEncSearch,
    expandedEncGroupT, setExpandedEncGroupT, encounterPopup, setEncounterPopup,
    clickedNode, setClickedNode, tooltipPos, setTooltipPos,
    // derived
    filteredNodeIds, filteredMessageIds,
    encountersByNode, encounterTicks, currentEncounters,
    filteredEncounterGroups, carriers, transferTicks,
    deliveryFrameIdx, deliveryMetrics,
    nodeCount, hasEncounters, hasMessages, msgInfo, delivered,
    // handlers
    reset, toggleNode, setNodeColor, selectAllNodes, clearNodes, focusOnPathNodes,
    handleMessageClick, openEncounterPopup, handlePopupMessageClick,
    handleNodesBtn, handleMessagesBtn, handleEncountersBtn, getMessagesForEncounter,
  };
}