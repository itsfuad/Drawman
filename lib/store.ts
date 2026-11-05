import { create } from "zustand";
import {
  bounds, cloneShapes, commit, IDENTITY, pick, redo, rotateAbout, scaleAbout, transformShapes, undo,
  type History, type Matrix, type Shape,
} from "./board";

export type Tool = "select" | "pen" | "highlight" | "eraser" | "line" | "arrow" | "rect" | "ellipse";
export type Background = "blank" | "grid" | "dots";

type State = History & {
  selected: Set<string>;
  clipboard: Shape[];
  tool: Tool;
  color: string;
  size: number;
  background: Background;
  skewMode: boolean; // edge handles skew instead of scale (Ctrl/⌘ does the same while dragging)
  setTool: (tool: Tool) => void;
  setBackground: (b: Background) => void;
  /** Applies to the current selection too, so restyling selected shapes is one step. */
  setStyle: (style: { color?: string; size?: number }) => void;
  select: (ids: Iterable<string>) => void;
  add: (shape: Shape) => void;
  remove: (ids: Set<string>) => void;
  transformSelected: (m: Matrix) => void;
  flipSelected: (axis: "x" | "y") => void;
  rotateSelected: (degrees: number) => void;
  reorderSelected: (to: "front" | "back") => void;
  toggleSkewMode: () => void;
  load: (shapes: Shape[], recordHistory: boolean) => void;
  undo: () => void;
  redo: () => void;
  copy: () => void;
  cut: () => void;
  paste: () => void;
  clear: () => void;
};

const PASTE_OFFSET = 16;

export const useBoard = create<State>()((set, get) => {
  const apply = (next: Shape[], selected = get().selected) => set((s) => ({ ...commit(s, next), selected }));
  const selectionCenter = () => {
    const b = bounds(pick(get().present, get().selected));
    return b && ([b.x + b.w / 2, b.y + b.h / 2] as const);
  };
  const travel = (step: typeof undo) =>
    set((s) => {
      const h = step(s);
      const ids = new Set(h.present.map((x) => x.id));
      return { ...h, selected: new Set([...s.selected].filter((id) => ids.has(id))) };
    });

  return {
    past: [],
    present: [],
    future: [],
    selected: new Set(),
    clipboard: [],
    tool: "pen",
    color: "#18181b",
    size: 4,
    background: "grid",
    skewMode: false,

    setTool: (tool) => set({ tool, selected: tool === "select" ? get().selected : new Set() }),
    setBackground: (background) => set({ background }),
    setStyle: (style) => {
      set(style);
      const { selected, present } = get();
      if (selected.size) apply(present.map((s) => (selected.has(s.id) ? { ...s, ...style } : s)));
    },
    select: (ids) => set({ selected: new Set(ids) }),
    add: (shape) => apply([...get().present, shape]),
    remove: (ids) => {
      if (ids.size) apply(get().present.filter((s) => !ids.has(s.id)), new Set());
    },
    transformSelected: (m) => {
      const { present, selected } = get();
      const identity = m.every((v, i) => v === IDENTITY[i]);
      // A non-finite matrix would be autosaved as null and fail to load: refuse it rather than lose the board.
      if (selected.size && !identity && m.every(Number.isFinite)) apply(transformShapes(present, selected, m));
    },
    flipSelected: (axis) => {
      const c = selectionCenter();
      if (c) get().transformSelected(scaleAbout(axis === "x" ? -1 : 1, axis === "y" ? -1 : 1, ...c));
    },
    rotateSelected: (degrees) => {
      const c = selectionCenter();
      if (c) get().transformSelected(rotateAbout((degrees * Math.PI) / 180, ...c));
    },
    reorderSelected: (to) => {
      const { present, selected } = get();
      if (!selected.size) return;
      const moved = pick(present, selected);
      const rest = present.filter((s) => !selected.has(s.id));
      apply(to === "front" ? [...rest, ...moved] : [...moved, ...rest]);
    },
    toggleSkewMode: () => set({ skewMode: !get().skewMode }),
    load: (shapes, recordHistory) =>
      recordHistory ? apply(shapes, new Set()) : set({ past: [], present: shapes, future: [], selected: new Set() }),
    undo: () => travel(undo),
    redo: () => travel(redo),
    copy: () => {
      const { present, selected } = get();
      if (selected.size) set({ clipboard: pick(present, selected) });
    },
    cut: () => {
      get().copy();
      get().remove(get().selected);
    },
    paste: () => {
      const copies = cloneShapes(get().clipboard, PASTE_OFFSET);
      if (!copies.length) return;
      // Clipboard becomes the copies so repeated pastes cascade instead of stacking.
      set({ clipboard: copies, tool: "select" });
      apply([...get().present, ...copies], new Set(copies.map((s) => s.id)));
    },
    clear: () => {
      if (get().present.length) apply([], new Set()); // undoable, so no confirm dialog needed
    },
  };
});
