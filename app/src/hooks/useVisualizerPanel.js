import { useState, useMemo, useCallback } from "react";

// Per-canvas derived state. Selection is owned externally (App.jsx) and shared
// between both canvases in split mode. This hook computes only the values that
// depend on the specific experiment's data + the shared selection.
export function useVisualizerPanel(data, frameIdx, onScrub, selection, onMessageClick) {
  const {
    selectedNodes, selectedMessage, filterMode: _filterMode,
    showEncounters: _showEncounters, hideCarriers: _hideCarriers,
  } = selection ?? {};

  // Per-canvas only
  const [clickedNode, setClickedNode] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [encounterPopup, setEncounterPopup] = useState(null);

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

  const encounterTicks = useMemo(() => {
    if (!data?.encounters?.length || !selectedNodes?.size) return new Set();
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
    if (!data?.encounters?.length || !selectedNodes?.size) return [];
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
    return { hops: path ? path.length - 1 : null, latencySeconds: deliverXfer.t - created, deliveredAt: deliverXfer.t };
  }, [selectedMessage, data]);

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
    if (onMessageClick) onMessageClick(msgId);
  }, [onMessageClick]);

  const nodeCount = data ? Object.keys(data.frames[frameIdx]?.nodes ?? {}).length : 0;
  const hasEncounters = !!(data?.encounters?.length);
  const msgInfo = selectedMessage ? data?.messageOrigins[selectedMessage] : null;
  const delivered = !!(msgInfo && carriers.has(msgInfo.dest));

  return {
    encountersByNode, carriers, encounterTicks, currentEncounters,
    transferTicks, deliveryFrameIdx, deliveryMetrics,
    getMessagesForEncounter, openEncounterPopup, handlePopupMessageClick,
    nodeCount, hasEncounters, msgInfo, delivered,
    clickedNode, setClickedNode, tooltipPos, setTooltipPos,
    encounterPopup, setEncounterPopup,
  };
}
