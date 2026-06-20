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
