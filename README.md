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
- Shift while drawing: square / circle, 45° lines
- Selection handles: resize (Shift uniform, Alt from center), rotate knob (Shift snaps 15°),
  skew edges (hold Ctrl/⌘ or toggle skew mode); flip, rotate 90°, bring to front / send to back
- Cut / copy / paste / delete, undo / redo (100 steps), clear (undoable)
- Autosave to localStorage, save/open `.json` board files, export PNG
- Grid / dots / blank background; color + size apply to the current selection

## Shortcuts
V P H E L A R O tools · Ctrl/⌘ Z, Shift+Z / Y, C, X, V, A, S · Del delete · Esc deselect
Shift+H / Shift+V flip · ] front · [ back

## Layout
- `lib/board.ts` pure model: shapes (local points + affine matrix), geometry, handle math, history, file validation (tested in `lib/board.test.ts`)
- `lib/store.ts` zustand store, `lib/files.ts` save/open/export/autosave
- `components/board.tsx` SVG surface + pointer gestures, `components/shape-view.tsx` shape rendering, `components/toolbar.tsx` UI + shortcuts
