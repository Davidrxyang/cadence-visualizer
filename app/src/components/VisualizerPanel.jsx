import { useRef, useCallback, useEffect } from "react";
import { renderFrame } from "../lib/canvasDraw";

// Canvas-only panel. Sidebar lives in CombinedSidebar (App.jsx level).
// Selection state is passed in via `selection`; per-canvas tooltip state lives in `panel`.
export default function VisualizerPanel({
  data, panel, frameIdx, nodeSize, selection, borderColor,
}) {
  const canvasRef = useRef(null);

  const draw = useCallback(() => {
    if (!data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    renderFrame(ctx, canvas.width, canvas.height, {
      data, frameIdx,
      selectedNodes: selection.selectedNodes,
      nodeColors: selection.nodeColors,
      nodeSize,
      filterMode: selection.filterMode,
      showEncounters: selection.showEncounters,
      encountersByNode: panel.encountersByNode,
      selectedMessage: selection.selectedMessage,
      carriers: panel.carriers,
      hideCarriers: selection.hideCarriers,
    });
  }, [data, panel, frameIdx, nodeSize, selection]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      draw();
    });
    ro.observe(canvas);
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    return () => ro.disconnect();
  }, [draw]);

  const handleCanvasClick = useCallback((e) => {
    if (!data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { meta, frames } = data;
    const W = canvas.width, H = canvas.height;
    const PAD = 20;
    const toScreen = (x, y) => [
      ((x - meta.x_min) / (meta.x_max - meta.x_min)) * (W - PAD * 2) + PAD,
      H - (((y - meta.y_min) / (meta.y_max - meta.y_min)) * (H - PAD * 2) + PAD),
    ];
    const frame = frames[frameIdx];
    let closest = null, closestDist = 10;
    for (const [idStr, [x, y]] of Object.entries(frame.nodes)) {
      const id = parseInt(idStr);
      if (selection.filterMode === "isolate" && selection.selectedNodes.size > 0 && !selection.selectedNodes.has(id)) continue;
      const [sx, sy] = toScreen(x, y);
      const d = Math.sqrt((sx - mx) ** 2 + (sy - my) ** 2);
      if (d < closestDist) { closestDist = d; closest = id; }
    }
    panel.setClickedNode(prev => prev === closest ? null : closest);
    if (closest !== null) panel.setTooltipPos({ x: e.clientX, y: e.clientY });
  }, [data, frameIdx, selection, panel]);

  return (
    <div style={{ flex: 1, minWidth: 0, position: "relative", border: borderColor ? `1.5px solid ${borderColor}` : undefined }} onClick={handleCanvasClick}>
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%", background: "var(--color-background-primary)" }}
      />
      {panel.clickedNode !== null && (
        <div style={{
          position: "fixed", left: panel.tooltipPos.x + 14, top: panel.tooltipPos.y - 10,
          background: "rgba(0,0,0,0.75)", color: "#fff",
          padding: "3px 8px", borderRadius: 4, fontSize: 12,
          pointerEvents: "none", zIndex: 20, whiteSpace: "nowrap",
        }}>
          Node {panel.clickedNode}
        </div>
      )}
    </div>
  );
}
