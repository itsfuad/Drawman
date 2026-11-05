import { create } from "zustand";
import { cloneShapes, commit, redo, translate, undo, type History, type Shape } from "./board";

export type Tool = "select" | "pen" | "highlight" | "eraser" | "line" | "arrow" | "rect" | "ellipse";
export type Background = "blank" | "grid" | "dots";

type State = History & {
  selected: Set<string>;
  clipboard: Shape[];
  tool: Tool;
  color: string;
  size: number;
  background: Background;
  setTool: (tool: Tool) => void;
  setBackground: (b: Background) => void;
  /** Applies to the current selection too, so restyling selected shapes is one step. */
  setStyle: (style: { color?: string; size?: number }) => void;
  select: (ids: Iterable<string>) => void;
  add: (shape: Shape) => void;
  remove: (ids: Set<string>) => void;
  moveSelected: (dx: number, dy: number) => void;
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
    moveSelected: (dx, dy) => {
      const { present, selected } = get();
      if (dx || dy) apply(translate(present, selected, dx, dy));
    },
    load: (shapes, recordHistory) =>
      recordHistory ? apply(shapes, new Set()) : set({ past: [], present: shapes, future: [], selected: new Set() }),
    undo: () => travel(undo),
    redo: () => travel(redo),
    copy: () => {
      const { present, selected } = get();
      if (selected.size) set({ clipboard: present.filter((s) => selected.has(s.id)) });
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
