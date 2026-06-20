import { CARRIER_RESERVED_COLOR } from "./constants";
import { hueForNode } from "./colors";

export function drawTriangle(ctx, cx, cy, r, fillColor, strokeColor, lineWidth) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r * Math.sin((2 * Math.PI) / 3), cy - r * Math.cos((2 * Math.PI) / 3));
  ctx.lineTo(cx + r * Math.sin((4 * Math.PI) / 3), cy - r * Math.cos((4 * Math.PI) / 3));
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

// Renders one frame of the visualization onto the given 2D canvas context.
export function renderFrame(ctx, W, H, opts) {
  const {
    data, frameIdx, selectedNodes, nodeColors, nodeSize, filterMode,
    showEncounters, encountersByNode, selectedMessage, carriers, hideCarriers,
  } = opts;
  const { meta, frames } = data;

  const toScreen = (x, y) => {
    const sx = ((x - meta.x_min) / (meta.x_max - meta.x_min)) * (W - 40) + 20;
    const sy = H - (((y - meta.y_min) / (meta.y_max - meta.y_min)) * (H - 40) + 20);
    return [sx, sy];
  };

  ctx.clearRect(0, 0, W, H);

  // grid
  ctx.strokeStyle = "rgba(128,128,128,0.1)";
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 10; i++) {
    const x = 20 + (i / 10) * (W - 40);
    const y = 20 + (i / 10) * (H - 40);
    ctx.beginPath(); ctx.moveTo(x, 20); ctx.lineTo(x, H - 20); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(20, y); ctx.lineTo(W - 20, y); ctx.stroke();
  }

  const total = meta.node_count;
  const hasSelection = selectedNodes.size > 0;
  const hasMessage = !!selectedMessage && carriers.size > 0;
  // A carrier is drawn as a triangle unless hideCarriers is on AND it's not part of the
  // selected-node set — i.e. hiding only ever applies to non-selected carriers.
  const carrierVisible = (id) => hasMessage && carriers.has(id) && (selectedNodes.has(id) || !hideCarriers);

  const bgColor = (id) => {
    if (hasSelection && filterMode === "isolate") return null;
    if (hasMessage) return "rgba(80,80,80,0.35)";
    const hue = hueForNode(id, total);
    if (hasSelection) return "rgba(100,100,100,0.3)";
    return `hsl(${hue},80%,60%)`;
  };

  const frame = frames[frameIdx];
  const entries = Object.entries(frame.nodes);

  // pass 1: background nodes
  for (const [idStr, [x, y]] of entries) {
    const id = parseInt(idStr);
    if (hasSelection && selectedNodes.has(id)) continue;
    if (carrierVisible(id)) continue;
    const color = bgColor(id);
    if (!color) continue;
    const [sx, sy] = toScreen(x, y);
    ctx.beginPath(); ctx.arc(sx, sy, nodeSize, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
  }

  // pass 2: message carriers — always triangles with a white border.
  // Selected carriers keep their custom node color; everyone else gets the reserved black.
  if (hasMessage) {
    const msgInfo = data.messageOrigins[selectedMessage];
    for (const [idStr, [x, y]] of entries) {
      const id = parseInt(idStr);
      if (!carrierVisible(id)) continue;
      const [sx, sy] = toScreen(x, y);
      const isSelected = selectedNodes.has(id);
      const isOrigin = msgInfo?.origin === id;
      const isDelivered = msgInfo?.dest === id;
      const fillColor = isSelected ? (nodeColors[id] ?? "#ef4444") : CARRIER_RESERVED_COLOR;
      const r = nodeSize * 2.4;

      if (isDelivered) {
        ctx.beginPath(); ctx.arc(sx, sy, nodeSize * 4.5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(34,197,94,0.18)"; ctx.fill();
      }

      drawTriangle(ctx, sx, sy, r, fillColor, "rgba(255,255,255,0.95)", 2.5);

      if (isDelivered) {
        ctx.font = "bold 11px sans-serif";
        ctx.fillStyle = "#22c55e";
        ctx.fillText("✓ dest", sx + r + 4, sy + 4);
      } else if (isOrigin) {
        ctx.font = "11px sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fillText("origin", sx + r + 4, sy + 4);
      }
    }
  }

  // pass 3: selected nodes (per-node custom color) — carriers already drawn as triangles above
  if (hasSelection) {
    for (const [idStr, [x, y]] of entries) {
      const id = parseInt(idStr);
      if (!selectedNodes.has(id)) continue;
      if (carrierVisible(id)) continue;
      const [sx, sy] = toScreen(x, y);
      ctx.beginPath(); ctx.arc(sx, sy, nodeSize * 2, 0, Math.PI * 2);
      ctx.fillStyle = nodeColors[id] ?? "#ef4444"; ctx.fill();
      ctx.beginPath(); ctx.arc(sx, sy, nodeSize * 2, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }

  // pass 4: encounter markers (amber)
  if (showEncounters && hasSelection) {
    const frameT = frames[frameIdx].t;
    const drawn = new Set();
    for (const nodeId of selectedNodes) {
      for (const enc of (encountersByNode[nodeId] ?? [])) {
        if (frameT < enc.t || frameT >= enc.t + enc.dur) continue;
        const key = `${enc.t}-${enc.n1}-${enc.n2}`;
        if (drawn.has(key)) continue;
        drawn.add(key);
        const [ex, ey] = toScreen(enc.x, enc.y);
        const posA = frame.nodes[enc.n1];
        const posB = frame.nodes[enc.n2];
        if (posA && posB) {
          const [ax, ay] = toScreen(posA[0], posA[1]);
          const [bx, by] = toScreen(posB[0], posB[1]);
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
          ctx.strokeStyle = "rgba(251,191,36,0.4)"; ctx.lineWidth = 1.5; ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(ex, ey, 10, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(251,191,36,0.9)"; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.arc(ex, ey, 3, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(251,191,36,0.9)"; ctx.fill();
        ctx.font = "11px sans-serif";
        ctx.fillStyle = "rgba(251,191,36,0.95)";
        ctx.fillText(`${enc.n1}↔${enc.n2}`, ex + 14, ey + 4);
      }
    }
  }

  // pass 5: message transfer markers (blue)
  if (hasMessage && !hideCarriers) {
    const frameT = frames[frameIdx].t;
    const { bucket } = meta;
    for (const xfer of (data.transfers[selectedMessage] ?? [])) {
      const xferBucket = Math.floor(xfer.t / bucket) * bucket;
      if (xferBucket < frameT) continue;
      if (xferBucket > frameT) break;
      const posA = frame.nodes[xfer.from];
      const posB = frame.nodes[xfer.to];
      if (!posA || !posB) continue;
      const [ax, ay] = toScreen(posA[0], posA[1]);
      const [bx, by] = toScreen(posB[0], posB[1]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      ctx.strokeStyle = "rgba(59,130,246,0.6)"; ctx.lineWidth = 2; ctx.stroke();
      const mx2 = (ax + bx) / 2, my2 = (ay + by) / 2;
      ctx.beginPath(); ctx.arc(mx2, my2, 8, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(59,130,246,0.95)"; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(mx2, my2, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(59,130,246,0.95)"; ctx.fill();
      ctx.font = "11px sans-serif";
      ctx.fillStyle = "rgba(59,130,246,0.95)";
      ctx.fillText(`${xfer.from}→${xfer.to}`, mx2 + 12, my2 + 4);
    }
  }
}
