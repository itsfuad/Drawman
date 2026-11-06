// Pure board model: shapes, geometry, history and file validation. No React here so it stays testable.

export type ShapeType = "stroke" | "highlight" | "line" | "arrow" | "rect" | "ellipse" | "fill" | "text" | "image";
export type Point = [x: number, y: number, pressure: number];
/** SVG-order affine matrix: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = [a: number, b: number, c: number, d: number, e: number, f: number];

export type Shape = {
  id: string;
  type: ShapeType;
  points: Point[]; // freehand: samples; line/arrow/rect/ellipse/image: [start, end]; fill: closed contour; text: [top-left]
  color: string;
  size: number;
  simulatePressure?: boolean; // true for mouse/touch strokes (no real pressure data)
  matrix?: Matrix; // move/resize/rotate/skew/flip; points stay in local space
  group?: string; // shapes sharing a group id select and move as one
  text?: string; // type "text" only
  src?: string; // type "image" only: data URL, so boards stay self-contained
};

export type Box = { x: number; y: number; w: number; h: number };

export type History = { past: Shape[][]; present: Shape[]; future: Shape[][] };

const HISTORY_LIMIT = 100;
const SHAPE_TYPES = new Set<ShapeType>(["stroke", "highlight", "line", "arrow", "rect", "ellipse", "fill", "text", "image"]);
// Only inline raster data: no remote URLs (tracking, broken boards) and no script-capable SVG.
const IMAGE_SRC = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;
const MAX_IMAGE_SRC = 20_000_000;
const FILE_VERSION = 2;

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

/** Fresh ids (and group ids) + offset, so pasted copies never collide with or join the originals. */
export function cloneShapes(shapes: Shape[], offset: number): Shape[] {
  const regroup = new Map<string, string>();
  const copies = shapes.map((s) => {
    if (s.group && !regroup.has(s.group)) regroup.set(s.group, newId());
    return { ...s, id: newId(), group: s.group && regroup.get(s.group) };
  });
  return transformShapes(copies, new Set(copies.map((s) => s.id)), translation(offset, offset));
}

export const HIGHLIGHT_SCALE = 4;

/** Rendered ink thickness: perfect-freehand `size` is a diameter, pen draws at 2x and highlighter at 4x the UI size. Fills have a 1px seam stroke. */
export const inkWidth = (s: Shape) =>
  s.type === "fill" || s.type === "text" || s.type === "image"
    ? 1
    : s.size * (s.type === "highlight" ? HIGHLIGHT_SCALE : s.type === "stroke" ? 2 : 1);

// System fonts only: PNG export and the fill mask draw the SVG through an <img>, which cannot load page web fonts.
export const TEXT_FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const LINE_HEIGHT = 1.25;
export const fontSize = (size: number) => 12 + size * 2; // UI sizes 2/4/8/16 -> 16/20/28/44 px

let measurer: CanvasRenderingContext2D | null | undefined;

/** Canvas text metrics in the browser; null under Node, where callers fall back to fixed estimates (unit tests). */
function metrics(text: string, size: number): TextMetrics | null {
  measurer ??= typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  if (!measurer) return null;
  measurer.font = `${size}px ${TEXT_FONT}`;
  return measurer.measureText(text);
}

export const textWidth = (line: string, size: number) => metrics(line, size)?.width ?? line.length * size * 0.55;

/** First baseline below the block top, using the CSS line-box model so SVG text sits where the textarea showed it. */
export function firstBaseline(size: number): number {
  const m = metrics("Hg", size);
  if (!m) return size * 0.95;
  return (LINE_HEIGHT * size - m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2 + m.fontBoundingBoxAscent;
}

/** Local size of a text block; never narrower than half an em so an empty/space line stays clickable. */
export function textBox(text: string, size: number) {
  const lines = text.split("\n");
  return { w: Math.max(size / 2, ...lines.map((l) => textWidth(l, size))), h: lines.length * size * LINE_HEIGHT };
}

const KAPPA = 0.5523; // cubic Bézier circle approximation

/**
 * Shape geometry as world-space points. Freehand/line/arrow: the samples. Rect, image and text: 4 corners.
 * Ellipse: 13 Bézier control points (affine maps keep Béziers exact, so skew/rotate stay correct).
 */
export function worldPoints(s: Shape): Point[] {
  const [[x1, y1], [x2, y2] = [x1, y1]] = s.points;
  let local: Point[] = s.points;
  if (s.type === "rect" || s.type === "image") {
    local = [[x1, y1, 0.5], [x2, y1, 0.5], [x2, y2, 0.5], [x1, y2, 0.5]];
  } else if (s.type === "text") {
    const { w, h } = textBox(s.text ?? "", fontSize(s.size));
    local = [[x1, y1, 0.5], [x1 + w, y1, 0.5], [x1 + w, y1 + h, 0.5], [x1, y1 + h, 0.5]];
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

/**
 * Inserts a new fill under the ink it overlaps (lowest overlapping non-fill), but above any fill it overlaps,
 * so filling inside an already-filled shape stays visible. No overlap: on top.
 */
export function insertFill(shapes: Shape[], fill: Shape): Shape[] {
  const box = bounds([fill])!;
  const overlaps = (s: Shape) => intersects(bounds([s])!, box);
  const underInk = shapes.findIndex((s) => s.type !== "fill" && overlaps(s));
  const aboveFills = shapes.findLastIndex((s) => s.type === "fill" && overlaps(s)) + 1;
  const at = Math.max(underInk < 0 ? shapes.length : underInk, aboveFills);
  return [...shapes.slice(0, at), fill, ...shapes.slice(at)];
}

/** Selection grown to whole groups. */
export function expandGroups(shapes: Shape[], ids: Set<string>): Set<string> {
  const groups = new Set(shapes.filter((s) => s.group && ids.has(s.id)).map((s) => s.group));
  return new Set([...ids, ...shapes.filter((s) => s.group && groups.has(s.group)).map((s) => s.id)]);
}

/** Puts the shapes in one group, stacked together at the topmost member's z position. */
export function groupShapes(shapes: Shape[], ids: Set<string>, group: string): Shape[] {
  const top = shapes.findLastIndex((s) => ids.has(s.id));
  const members = pick(shapes, ids).map((s) => ({ ...s, group }));
  const below = shapes.slice(0, top + 1).filter((s) => !ids.has(s.id));
  return [...below, ...members, ...shapes.slice(top + 1)];
}

export const ungroupShapes = (shapes: Shape[], ids: Set<string>) =>
  shapes.map((s) => (ids.has(s.id) && s.group ? { ...s, group: undefined } : s));

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
  const { shapes, version } = (raw ?? {}) as { shapes?: unknown; version?: unknown };
  if (!Array.isArray(shapes)) throw new Error("Not a Drawman board file");
  const parsed = shapes.map((s, i): Shape => {
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
        (Array.isArray(s.matrix) && s.matrix.length === 6 && s.matrix.every((n: unknown) => Number.isFinite(n)))) &&
      (s.group === undefined || (typeof s.group === "string" && s.group.length <= 64)) &&
      (s.type !== "text" || (typeof s.text === "string" && s.text.length <= 10_000)) &&
      (s.type !== "image" || (typeof s.src === "string" && s.src.length <= MAX_IMAGE_SRC && IMAGE_SRC.test(s.src)));
    if (!ok) throw new Error(`Invalid shape at index ${i}`);
    return {
      id: s.id,
      type: s.type,
      points: s.points,
      color: s.color,
      size: s.size,
      ...(s.simulatePressure ? { simulatePressure: true } : {}),
      ...(s.matrix ? { matrix: s.matrix } : {}),
      ...(s.group ? { group: s.group } : {}),
      ...(s.type === "text" ? { text: s.text } : {}),
      ...(s.type === "image" ? { src: s.src } : {}),
    };
  });
  // v1 drew every fill under all ink whatever the stored order; reorder so old boards look the same.
  const v1 = !(typeof version === "number" && version >= 2);
  return v1 ? [...parsed.filter((s) => s.type === "fill"), ...parsed.filter((s) => s.type !== "fill")] : parsed;
}

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/** JSON board with coordinates rounded to 0.01px (pointer samples carry ~15 noise digits); matrices keep 5 places. */
export const serializeBoard = (shapes: Shape[]) =>
  JSON.stringify({
    app: "drawman",
    version: FILE_VERSION,
    shapes: shapes.map((s) => ({
      ...s,
      points: s.points.map(([x, y, p]) => [round(x, 2), round(y, 2), round(p, 3)]),
      ...(s.matrix ? { matrix: s.matrix.map((v) => round(v, 5)) } : {}),
    })),
  });

const MAX_BOARD_BYTES = 100_000_000; // decompressed cap: a few KB of gzip can expand to gigabytes

/** Compact .drawman file: gzip of the rounded JSON board. */
export const encodeFile = (shapes: Shape[]) =>
  new Response(new Blob([serializeBoard(shapes)]).stream().pipeThrough(new CompressionStream("gzip"))).blob();

/** Reads a .drawman (gzip) or legacy .json board. Throws on malformed, invalid or oversized input. */
export async function decodeFile(file: Blob): Promise<Shape[]> {
  const [b0, b1] = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const gzipped = b0 === 0x1f && b1 === 0x8b;
  const reader = (gzipped ? file.stream().pipeThrough(new DecompressionStream("gzip")) : file.stream()).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    total += r.value.length;
    if (total > MAX_BOARD_BYTES) {
      await reader.cancel();
      throw new Error("Board file is too large");
    }
    chunks.push(r.value);
  }
  return parseBoard(JSON.parse(await new Blob(chunks as BlobPart[]).text())); // stream chunks are typed ArrayBufferLike
}
