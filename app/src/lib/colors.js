import { MAX_SELECTED_NODES } from "./constants";

export function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

// Van der Corput sequence: at every prefix length, the hues are spread as far
// apart as possible (e.g. 0°, 180°, 90°, 270°, 45°, 225°, ...). Colors only
// start crowding together once many nodes are selected.
export function vanDerCorput(n, base = 2) {
  let vdc = 0;
  let denom = 1;
  while (n > 0) {
    denom *= base;
    vdc += (n % base) / denom;
    n = Math.floor(n / base);
  }
  return vdc;
}

export function hueForNode(id, total) {
  return Math.round((id / Math.max(total, 1)) * 360);
}

export const NODE_COLOR_PALETTE = Array.from({ length: MAX_SELECTED_NODES }, (_, i) =>
  hslToHex(vanDerCorput(i) * 360, 75, 58)
);
