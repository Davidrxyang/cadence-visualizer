export function parseJSONL(text) {
  const lines = text.trim().split("\n");
  let meta = null;
  const frames = [];
  const encounters = [];
  const messageOrigins = {};
  const transfersRaw = [];
  const deliveredPaths = {};

  for (const line of lines) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line);
    if (obj.__meta__) {
      meta = obj;
    } else if (obj.__enc__) {
      encounters.push({ t: obj.t, n1: obj.n1, n2: obj.n2, x: obj.x, y: obj.y, dur: obj.dur });
    } else if (obj.__msgorigin__) {
      messageOrigins[obj.id] = { origin: obj.origin, created: obj.created, dest: obj.dest };
    } else if (obj.__xfer__) {
      transfersRaw.push({ id: obj.id, t: obj.t, from: obj.from, to: obj.to });
    } else if (obj.__delivered__) {
      deliveredPaths[obj.id] = obj.path;
    } else {
      const nodes = {};
      const n = obj.n;
      for (let i = 0; i < n.length; i += 3) {
        nodes[n[i]] = [n[i + 1], n[i + 2]];
      }
      frames.push({ t: obj.t, nodes });
    }
  }

  const transfers = {};
  for (const xfer of transfersRaw) {
    (transfers[xfer.id] ??= []).push(xfer);
  }

  return { meta, frames, encounters, messageOrigins, transfers, deliveredPaths };
}

export function formatTime(unix) {
  return new Date(unix * 1000).toLocaleString();
}

export function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h ${m}m ${s}s`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

// Time elapsed since the start of the experiment, formatted as "Day N, HH:MM:SS"
// (or just "HH:MM:SS" on day 0).
export function formatElapsed(seconds) {
  const days = Math.floor(seconds / 86400);
  const hrs = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const pad = n => String(n).padStart(2, "0");
  const clock = `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  return days > 0 ? `Day ${days}, ${clock}` : clock;
}

// Either the real calendar date/time or time elapsed since the experiment's
// first frame, depending on the user's "show actual date" preference.
export function formatDisplayTime(unix, tMin, showAbsolute) {
  return showAbsolute ? formatTime(unix) : formatElapsed(unix - tMin);
}
