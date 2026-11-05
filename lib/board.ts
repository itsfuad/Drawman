// Pure board model: shapes, geometry, history and file validation. No React here so it stays testable.

export type ShapeType = "stroke" | "highlight" | "line" | "arrow" | "rect" | "ellipse";
export type Point = [x: number, y: number, pressure: number];
/** SVG-order affine matrix: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = [a: number, b: number, c: number, d: number, e: number, f: number];

export type Shape = {
  id: string;
  type: ShapeType;
  points: Point[]; // freehand: every sample; line/arrow/rect/ellipse: [start, end]
  color: string;
  size: number;
  simulatePressure?: boolean; // true for mouse/touch strokes (no real pressure data)
  matrix?: Matrix; // move/resize/rotate/skew/flip; points stay in local space
};

export type Box = { x: number; y: number; w: number; h: number };

export type History = { past: Shape[][]; present: Shape[]; future: Shape[][] };

const HISTORY_LIMIT = 100;
const SHAPE_TYPES = new Set<ShapeType>(["stroke", "highlight", "line", "arrow", "rect", "ellipse"]);

export const newId = () => crypto.randomUUID();

export function commit(h: History, next: Shape[]): History {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

export function undo(h: History): History {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo(h: History): History {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m ∘ n: apply n first, then m. */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export const applyMatrix = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

export const translation = (tx: number, ty: number): Matrix => [1, 0, 0, 1, tx, ty];
const about = (m: Matrix, cx: number, cy: number) => multiply(translation(cx, cy), multiply(m, translation(-cx, -cy)));
export const scaleAbout = (sx: number, sy: number, cx: number, cy: number) => about([sx, 0, 0, sy, 0, 0], cx, cy);
export const rotateAbout = (rad: number, cx: number, cy: number) =>
  about([Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0], cx, cy);
export const skewAbout = (kx: number, ky: number, cx: number, cy: number) => about([1, ky, kx, 1, 0, 0], cx, cy);

export function transformShapes(shapes: Shape[], ids: Set<string>, m: Matrix): Shape[] {
  return shapes.map((s) => (ids.has(s.id) ? { ...s, matrix: multiply(m, s.matrix ?? IDENTITY) } : s));
}

export const pick = (shapes: Shape[], ids: Set<string>) => shapes.filter((s) => ids.has(s.id));

/** Fresh ids + offset, so pasted copies never collide with originals. */
export function cloneShapes(shapes: Shape[], offset: number): Shape[] {
  const copies = shapes.map((s) => ({ ...s, id: newId() }));
  return transformShapes(copies, new Set(copies.map((s) => s.id)), translation(offset, offset));
}

export const HIGHLIGHT_SCALE = 4;

/** Rendered ink thickness: perfect-freehand `size` is a diameter, pen draws at 2x and highlighter at 4x the UI size. */
export const inkWidth = (s: Shape) => s.size * (s.type === "highlight" ? HIGHLIGHT_SCALE : s.type === "stroke" ? 2 : 1);

const KAPPA = 0.5523; // cubic Bézier circle approximation

/**
 * Shape geometry as world-space points. Freehand/line/arrow: the samples. Rect: 4 corners.
 * Ellipse: 13 Bézier control points (affine maps keep Béziers exact, so skew/rotate stay correct).
 */
export function worldPoints(s: Shape): Point[] {
  const [[x1, y1], [x2, y2] = [x1, y1]] = s.points;
  let local: Point[] = s.points;
  if (s.type === "rect") {
    local = [[x1, y1, 0.5], [x2, y1, 0.5], [x2, y2, 0.5], [x1, y2, 0.5]];
  } else if (s.type === "ellipse") {
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2;
    const kx = KAPPA * rx, ky = KAPPA * ry;
    local = [
      [cx + rx, cy], [cx + rx, cy + ky], [cx + kx, cy + ry], [cx, cy + ry],
      [cx - kx, cy + ry], [cx - rx, cy + ky], [cx - rx, cy], [cx - rx, cy - ky],
      [cx - kx, cy - ry], [cx, cy - ry], [cx + kx, cy - ry], [cx + rx, cy - ky], [cx + rx, cy],
    ].map(([x, y]): Point => [x, y, 0.5]);
  }
  const m = s.matrix;
  return m ? local.map(([x, y, p]): Point => [...applyMatrix(m, x, y), p]) : local;
}

function boxOf(points: Iterable<readonly number[]>, pad = 0): Box | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x - pad);
    minY = Math.min(minY, y - pad);
    maxX = Math.max(maxX, x + pad);
    maxY = Math.max(maxY, y + pad);
  }
  return minX === Infinity ? null : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function bounds(shapes: Shape[]): Box | null {
  const boxes = shapes.map((s) => boxOf(worldPoints(s), inkWidth(s) / 2)!);
  return boxOf(boxes.flatMap((b) => [[b.x, b.y], [b.x + b.w, b.y + b.h]]));
}

/** Axis-aligned box around a box's corners after a transform (live selection frame while dragging handles). */
export function transformBox(b: Box, m: Matrix): Box {
  const corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
  return boxOf(corners.map(([x, y]) => applyMatrix(m, x, y)))!;
}

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate";
export type HandleMods = { uniform: boolean; centered: boolean; skew: boolean };

const ROTATE_SNAP = Math.PI / 12; // 15°
const MIN_SCALE = 0.01; // never collapse to 0: a zero-size shape would make the next resize divide by zero

/** Transform produced by dragging a selection handle from p0 to p over box b. */
export function handleMatrix(h: Handle, b: Box, p0: { x: number; y: number }, p: { x: number; y: number }, mod: HandleMods): Matrix {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  if (h === "rotate") {
    let a = Math.atan2(p.y - cy, p.x - cx) - Math.atan2(p0.y - cy, p0.x - cx);
    if (mod.uniform) a = Math.round(a / ROTATE_SNAP) * ROTATE_SNAP;
    return rotateAbout(a, cx, cy);
  }
  const hx = h.includes("e") ? 1 : h.includes("w") ? -1 : 0;
  const hy = h.includes("s") ? 1 : h.includes("n") ? -1 : 0;
  const dx = p.x - p0.x, dy = p.y - p0.y;
  const ax = mod.centered ? cx : hx < 0 ? b.x + b.w : b.x; // fixed point: opposite side, or center
  const ay = mod.centered ? cy : hy < 0 ? b.y + b.h : b.y;
  const spanX = mod.centered ? b.w / 2 : b.w, spanY = mod.centered ? b.h / 2 : b.h;

  if (mod.skew && hx === 0) return skewAbout(dx / (hy * spanY), 0, cx, ay);
  if (mod.skew && hy === 0) return skewAbout(0, dy / (hx * spanX), ax, cy);

  const clamp = (v: number) => (v < 0 ? -1 : 1) * Math.max(Math.abs(v), MIN_SCALE);
  let sx = hx ? clamp((spanX + hx * dx) / spanX) : 1;
  let sy = hy ? clamp((spanY + hy * dy) / spanY) : 1;
  if (mod.uniform && hx && hy) sx = sy = Math.abs(sx) > Math.abs(sy) ? sx : sy;
  return scaleAbout(sx, sy, ax, ay);
}

/** Shift while drawing: square rect/ellipse, 45° lines. */
export function constrain(type: ShapeType, [x1, y1]: Point, end: Point): Point {
  const dx = end[0] - x1, dy = end[1] - y1;
  if (type === "rect" || type === "ellipse") {
    const d = Math.max(Math.abs(dx), Math.abs(dy));
    return [x1 + (dx < 0 ? -d : d), y1 + (dy < 0 ? -d : d), end[2]];
  }
  if (type === "line" || type === "arrow") {
    const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(dx, dy);
    return [x1 + len * Math.cos(a), y1 + len * Math.sin(a), end[2]];
  }
  return end;
}

export function boxFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function intersects(a: Box, b: Box): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

export function contains(b: Box, x: number, y: number): boolean {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

/** Validates untrusted JSON (file import / localStorage). Throws on anything malformed. */
export function parseBoard(raw: unknown): Shape[] {
  const shapes = (raw as { shapes?: unknown })?.shapes;
  if (!Array.isArray(shapes)) throw new Error("Not a Drawman board file");
  return shapes.map((s, i): Shape => {
    const ok =
      s &&
      typeof s.id === "string" &&
      SHAPE_TYPES.has(s.type) &&
      typeof s.color === "string" &&
      /^#[0-9a-f]{3,8}$/i.test(s.color) &&
      Number.isFinite(s.size) &&
      s.size > 0 &&
      s.size <= 200 &&
      Array.isArray(s.points) &&
      s.points.length > 0 &&
      s.points.every(
        (p: unknown) => Array.isArray(p) && p.length === 3 && p.every((n) => Number.isFinite(n)),
      ) &&
      (s.matrix === undefined ||
        (Array.isArray(s.matrix) && s.matrix.length === 6 && s.matrix.every((n: unknown) => Number.isFinite(n))));
    if (!ok) throw new Error(`Invalid shape at index ${i}`);
    return {
      id: s.id,
      type: s.type,
      points: s.points,
      color: s.color,
      size: s.size,
      ...(s.simulatePressure ? { simulatePressure: true } : {}),
      ...(s.matrix ? { matrix: s.matrix } : {}),
    };
  });
}

export const serializeBoard = (shapes: Shape[]) => JSON.stringify({ app: "drawman", version: 1, shapes });
