import { useState, useMemo, useCallback } from "react";
import { frameCutoff, nearestFrameIdx, carriersAt } from "../lib/frames";

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

  // Events up to (but excluding) this time are "visible" at the current frame —
  // each event is shown from its nearest frame onward (see lib/frames.js).
  const cutoff = data?.frames?.length ? frameCutoff(data.frames, frameIdx) : null;

  // Each encounter is annotated with the frame range [i0, i1] it spans after
  // snapping its start and end to the nearest frames, so even a 60s encounter
  // shows up on exactly one frame.
  const encountersByNode = useMemo(() => {
    if (!data?.encounters?.length) return {};
    const map = {};
    for (const raw of data.encounters) {
      const enc = {
        ...raw,
        i0: nearestFrameIdx(data.frames, raw.t),
        i1: nearestFrameIdx(data.frames, raw.t + raw.dur),
      };
      (map[enc.n1] ??= []).push(enc);
      (map[enc.n2] ??= []).push(enc);
    }
    return map;
  }, [data]);

  // Carriers come from server-computed custody intervals, which replay every
  // transfer and drop in order — so a node that drops a message and later
  // re-receives it is shown correctly.
  const carriers = useMemo(() => {
    if (!selectedMessage || cutoff == null) return new Set();
    return carriersAt(data.custody?.[selectedMessage], cutoff);
  }, [selectedMessage, cutoff, data]);

  const encounterTicks = useMemo(() => {
    if (!data?.encounters?.length || !selectedNodes?.size) return new Set();
    const ticks = new Set();
    for (const nodeId of selectedNodes) {
      for (const enc of (encountersByNode[nodeId] ?? [])) {
        for (let i = enc.i0; i <= enc.i1; i++) ticks.add(i);
      }
    }
    return ticks;
  }, [data, selectedNodes, encountersByNode]);

  const currentEncounters = useMemo(() => {
    if (!data?.encounters?.length || !selectedNodes?.size) return [];
    const seen = new Set();
    const result = [];
    for (const nodeId of selectedNodes) {
      for (const enc of (encountersByNode[nodeId] ?? [])) {
        if (frameIdx < enc.i0 || frameIdx > enc.i1) continue;
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
    const ticks = new Set();
    for (const xfer of data.transfers[selectedMessage]) {
      ticks.add(nearestFrameIdx(data.frames, xfer.t));
    }
    return ticks;
  }, [selectedMessage, data]);

  const deliveryFrameIdx = useMemo(() => {
    if (!selectedMessage || !data) return null;
    const dest = data.messageOrigins[selectedMessage]?.dest;
    if (dest == null) return null;
    const deliverXfer = (data.transfers[selectedMessage] ?? []).find(x => x.to === dest);
    return deliverXfer ? nearestFrameIdx(data.frames, deliverXfer.t) : null;
  }, [selectedMessage, data]);

  const messageTransferCount = useMemo(() => {
    if (!selectedMessage || cutoff == null) return 0;
    let count = 0;
    for (const x of (data.transfers[selectedMessage] ?? [])) {
      if (x.t >= cutoff) break;
      count++;
    }
    return count;
  }, [selectedMessage, cutoff, data]);

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

  // Prefix-sum array for bandwidth running total — recomputed only when data changes
  const bwPrefixSums = useMemo(() => {
    const bws = data?.bandwidths;
    if (!bws?.length) return null;
    const ts = new Float64Array(bws.length);
    const sums = new Float64Array(bws.length);
    let running = 0;
    for (let i = 0; i < bws.length; i++) {
      running += bws[i].bw;
      ts[i] = bws[i].t;
      sums[i] = running;
    }
    return { ts, sums };
  }, [data]);

  const totalMessageCopies = useMemo(() => {
    const loads = data?.epochLoads;
    if (!loads?.length || cutoff == null) return null;
    let lo = 0, hi = loads.length - 1, result = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (loads[mid].t < cutoff) { result = loads[mid].load; lo = mid + 1; }
      else hi = mid - 1;
    }
    return result;
  }, [data, cutoff]);

  const totalMessageTransfers = useMemo(() => {
    if (!bwPrefixSums || cutoff == null) return 0;
    const { ts, sums } = bwPrefixSums;
    let lo = 0, hi = ts.length - 1, idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ts[mid] < cutoff) { idx = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return idx >= 0 ? Math.round(sums[idx]) : 0;
  }, [bwPrefixSums, cutoff]);

  const findFrameIdxForTime = useCallback((t) => {
    if (!data) return null;
    return nearestFrameIdx(data.frames, t);
  }, [data]);

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
  const delivered = deliveryFrameIdx !== null && frameIdx >= deliveryFrameIdx;

  return {
    encountersByNode, carriers, encounterTicks, currentEncounters,
    transferTicks, deliveryFrameIdx, deliveryMetrics,
    getMessagesForEncounter, openEncounterPopup, handlePopupMessageClick,
    nodeCount, hasEncounters, msgInfo, delivered,
    totalMessageCopies, totalMessageTransfers, messageTransferCount,
    clickedNode, setClickedNode, tooltipPos, setTooltipPos,
    encounterPopup, setEncounterPopup,
  };
}
