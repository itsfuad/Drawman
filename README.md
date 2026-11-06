# Drawman

Whiteboard for drawing and teaching. Next.js 16 + shadcn/ui (Base UI) + perfect-freehand + zustand.

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # model unit tests (node --test)
```

## Features
- Pressure-sensitive pen (Pointer Events, coalesced samples), mouse and touch (velocity-simulated pressure)
- Stylus eraser end erases; touch ignored once a stylus is used (palm rejection)
- Tools: select (click / shift-click / marquee, drag to move), pen, highlighter, eraser, line, arrow, rectangle, ellipse
- Fill tool: click inside any closed area (even one made of separate lines); bridges gaps up to ~12px,
  click an existing fill to recolor it. Fills sit under ink and can be selected / transformed like shapes
- Text tool: click to type (Enter = new line, Esc / Ctrl+Enter / click away to finish); double-click text to edit.
  Text resizes, rotates and recolors like any shape
- Groups: Ctrl/⌘+G groups the selection, Ctrl/⌘+Shift+G ungroups; clicking any member selects the whole group
- Z-order is the real stacking order for everything, fills included; new fills go under the outline they fill
- Shift while drawing: square / circle, 45° lines
- Selection handles: resize (Shift uniform, Alt from center), rotate knob (Shift snaps 15°),
  skew edges (hold Ctrl/⌘ or toggle skew mode); flip, rotate 90°, bring to front / send to back
- Cut / copy / paste / delete, undo / redo (100 steps), clear (undoable)
- Images: add button, paste (Ctrl/⌘+V) or drag & drop; downscaled to 1600px and stored inline (webp).
  Images move, resize, rotate, group and stack like any shape
- Autosave to localStorage (warns once if storage is full), save/open compact `.drawman` files
  (gzip, coordinates rounded to 0.01px; old `.json` boards still open), export PNG
- Grid / dots / blank background; color + size apply to the current selection

## Shortcuts
V P H E F T L A R O tools · Ctrl/⌘ Z, Shift+Z / Y, C, X, V, A, S · Del delete · Esc deselect
Shift+H / Shift+V flip · ] front · [ back · Ctrl/⌘ G group, Shift+G ungroup

## Layout
- `lib/board.ts` pure model: shapes (local points + affine matrix), geometry, handle math, history, file validation (tested in `lib/board.test.ts`)
- `lib/fill.ts` raster flood fill -> vector contour (dilate, flood, trace, simplify; tested in `lib/fill.test.ts`)
- `lib/store.ts` zustand store, `lib/files.ts` save/open/export/autosave
- `components/board.tsx` SVG surface + pointer gestures, `components/shape-view.tsx` shape rendering, `components/toolbar.tsx` UI + shortcuts
