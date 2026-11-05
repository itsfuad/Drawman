// Pure board model: shapes, geometry, history and file validation. No React here so it stays testable.

export type ShapeType = "stroke" | "highlight" | "line" | "arrow" | "rect" | "ellipse";
export type Point = [x: number, y: number, pressure: number];

export type Shape = {
  id: string;
  type: ShapeType;
  points: Point[]; // freehand: every sample; line/arrow/rect/ellipse: [start, end]
  color: string;
  size: number;
  simulatePressure?: boolean; // true for mouse/touch strokes (no real pressure data)
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

export function translate(shapes: Shape[], ids: Set<string>, dx: number, dy: number): Shape[] {
  return shapes.map((s) =>
    ids.has(s.id) ? { ...s, points: s.points.map(([x, y, p]): Point => [x + dx, y + dy, p]) } : s,
  );
}

/** Fresh ids + offset, so pasted copies never collide with originals. */
export function cloneShapes(shapes: Shape[], offset: number): Shape[] {
  const copies = shapes.map((s) => ({ ...s, id: newId() }));
  return translate(copies, new Set(copies.map((s) => s.id)), offset, offset);
}

export function bounds(shapes: Shape[]): Box | null {
  if (!shapes.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) {
    const pad = s.size / 2;
    for (const [x, y] of s.points) {
      minX = Math.min(minX, x - pad);
      minY = Math.min(minY, y - pad);
      maxX = Math.max(maxX, x + pad);
      maxY = Math.max(maxY, y + pad);
    }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
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
      );
    if (!ok) throw new Error(`Invalid shape at index ${i}`);
    return {
      id: s.id,
      type: s.type,
      points: s.points,
      color: s.color,
      size: s.size,
      ...(s.simulatePressure ? { simulatePressure: true } : {}),
    };
  });
}

export const serializeBoard = (shapes: Shape[]) => JSON.stringify({ app: "drawman", version: 1, shapes });
