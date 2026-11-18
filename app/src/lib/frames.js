// Frames are position snapshots every `bucket` seconds (30 min), while simulator
// events (encounters, transfers, drops) happen at minute resolution. Every event is
// shown on its NEAREST frame: frame i covers times in
//   [frameCutoff(i - 1), frameCutoff(i))
// where the cutoff is the midpoint between consecutive frames. All snapping in the
// app goes through these helpers so ticks, canvas markers and counters agree.

// Exclusive upper time bound of frame i (midpoint to the next frame).
export function frameCutoff(frames, i) {
  return i + 1 < frames.length ? (frames[i].t + frames[i + 1].t) / 2 : Infinity;
}

// Inclusive lower time bound of frame i.
export function frameStart(frames, i) {
  return i > 0 ? frameCutoff(frames, i - 1) : -Infinity;
}

// Index of the frame nearest to time t (smallest i with t < frameCutoff(i)).
export function nearestFrameIdx(frames, t) {
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t < frameCutoff(frames, mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

// Nodes holding a message as of frame cutoff `cutoff`, from custody intervals
// [[node, start, end|null], ...] (half-open [start, end)).
export function carriersAt(intervals, cutoff) {
  const result = new Set();
  for (const [node, start, end] of intervals ?? []) {
    if (start < cutoff && (end === null || end >= cutoff)) result.add(node);
  }
  return result;
}
