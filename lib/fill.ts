// Raster flood fill -> vector contour. Pure: works on a w*h ink mask (1 = ink), no DOM.

export type Mask = { data: Uint8Array; w: number; h: number };

/** Square dilation by r pixels (separable max filter). */
export function dilate({ data, w, h }: Mask, r: number): Mask {
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let last = -Infinity; // x of the most recent ink pixel to the left
    for (let x = 0; x < w + r; x++) {
      if (x < w && data[y * w + x]) last = x;
      const t = x - r;
      if (t >= 0 && t < w && last >= t - r) tmp[y * w + t] = 1;
    }
  }
  for (let x = 0; x < w; x++) {
    let last = -Infinity;
    for (let y = 0; y < h + r; y++) {
      if (y < h && tmp[y * w + x]) last = y;
      const t = y - r;
      if (t >= 0 && t < h && last >= t - r) out[t * w + x] = 1;
    }
  }
  return { data: out, w, h };
}

/** 4-connected flood from (sx, sy) over empty pixels. Null if the seed is on a wall or the region leaks to the edge. */
export function flood(walls: Mask, sx: number, sy: number): Mask | null {
  const { data, w, h } = walls;
  if (sx < 0 || sy < 0 || sx >= w || sy >= h || data[sy * w + sx]) return null;
  const region = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;
  stack[top++] = sy * w + sx;
  region[sy * w + sx] = 1;
  while (top) {
    const i = stack[--top];
    const x = i % w, y = (i - x) / w;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return null; // not a closed area
    for (const n of [i - 1, i + 1, i - w, i + w]) {
      if (!data[n] && !region[n]) {
        region[n] = 1;
        stack[top++] = n;
      }
    }
  }
  return { data: region, w, h };
}

// Clockwise neighbours (y down), starting west.
const DX = [-1, -1, 0, 1, 1, 1, 0, -1];
const DY = [0, -1, -1, -1, 0, 1, 1, 1];

/** Outer boundary of the region via Moore-neighbour tracing, as pixel centres. */
export function traceOuter({ data, w, h }: Mask): [number, number][] {
  const startIdx = data.indexOf(1);
  if (startIdx < 0) return [];
  const sx = startIdx % w, sy = (startIdx - sx) / w;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] === 1;
  const out: [number, number][] = [[sx, sy]];
  let x = sx, y = sy, back = 0; // first pixel in scan order: its west neighbour is empty
  for (let guard = 4 * w * h; guard > 0; guard--) {
    let found = -1;
    for (let k = 1; k <= 8; k++) {
      const d = (back + k) % 8;
      if (on(x + DX[d], y + DY[d])) {
        found = d;
        break;
      }
    }
    if (found < 0) break; // single isolated pixel
    const prev = (found + 7) % 8; // last empty neighbour checked becomes the new backtrack
    const bx = x + DX[prev], by = y + DY[prev];
    x += DX[found];
    y += DY[found];
    back = DX.findIndex((dx, d) => dx === bx - x && DY[d] === by - y);
    if (x === sx && y === sy) break;
    out.push([x, y]);
  }
  return out.map(([px, py]) => [px + 0.5, py + 0.5]);
}

/** Ramer–Douglas–Peucker polyline simplification. */
export function simplify(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const len = Math.hypot(bx - ax, by - ay);
  let maxD = -1, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i];
    const d = len ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len : Math.hypot(px - ax, py - ay);
    if (d > maxD) [maxD, idx] = [d, i];
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}

const GAP = 6; // closes gaps up to ~2*GAP px in hand-drawn outlines (areas narrower than that can't be filled)

/**
 * Closed area around (x, y) as a simplified polygon, or null if the area is open / the seed is on ink.
 * shortcut: outer contour only, so islands inside the area get painted over; upgrade to even-odd rings if needed.
 */
export function fillRegion(ink: Mask, x: number, y: number): [number, number][] | null {
  // Exact pass first so closed outlines keep sharp corners; gap closing rounds acute corners off, so only fall back to it.
  for (const gap of [1, GAP]) {
    const region = flood(dilate(ink, gap), Math.floor(x), Math.floor(y));
    if (!region) continue;
    // Grow back under the strokes so no white halo shows between fill and ink.
    const pts = traceOuter(dilate(region, gap + 1));
    return simplify([...pts, pts[0]], 1).slice(0, -1);
  }
  return null;
}
