"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  bounds, boxFromPoints, constrain, contains, handleMatrix, intersects, newId, pick, transformBox, translation,
  type Box, type Handle, type Matrix, type Point, type Shape,
} from "@/lib/board";
import { persistBoard } from "@/lib/files";
import { useBoard } from "@/lib/store";
import { ShapeView } from "./shape-view";

// Gesture data lives in a ref so pointerup never reads a state update React has not rendered yet.
type Gesture =
  | { kind: "draw"; shape: Shape }
  | { kind: "transform"; handle: Handle | "move"; frame: Box; x: number; y: number; m: Matrix | null }
  | { kind: "marquee"; x: number; y: number; additive: boolean; box: Box | null }
  | { kind: "erase"; ids: Set<string> };

const PEN_ERASER_BUTTONS = 32; // stylus eraser end / barrel eraser button
const FRAME_PAD = 6;
const ROTATE_KNOB = 28; // distance of the rotate knob from the frame
const SCALE_CURSORS: Record<Exclude<Handle, "rotate">, string> = {
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
  n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
};

const padBox = (b: Box, n: number): Box => ({ x: b.x - n, y: b.y - n, w: b.w + 2 * n, h: b.h + 2 * n });
const MIN_HANDLE_FRAME = 48; // handles spread at least this far so a dot-sized selection stays draggable in its middle

/** Same center, grown to a minimum size. Handle math is delta-based, so only the handle layout uses this. */
function atLeast(b: Box, n: number): Box {
  const w = Math.max(b.w, n), h = Math.max(b.h, n);
  return { x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, w, h };
}

function handlePositions(f: Box): [Handle, number, number][] {
  const { x, y, w, h } = f;
  // Knob goes below the frame when it would sit under the top toolbar.
  const knobY = y < 140 ? y + h + ROTATE_KNOB : y - ROTATE_KNOB; // 140: clears both top bars
  return [
    ["nw", x, y], ["n", x + w / 2, y], ["ne", x + w, y], ["e", x + w, y + h / 2],
    ["se", x + w, y + h], ["s", x + w / 2, y + h], ["sw", x, y + h], ["w", x, y + h / 2],
    ["rotate", x + w / 2, knobY],
  ];
}

export function Board() {
  const shapes = useBoard((s) => s.present);
  const selected = useBoard((s) => s.selected);
  const background = useBoard((s) => s.background);
  const tool = useBoard((s) => s.tool);
  const skewMode = useBoard((s) => s.skewMode);

  const svgRef = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const penSeen = useRef(false);
  const pointer = useRef<number | null>(null); // the one pointer driving the gesture; others (palm, 2nd finger) are ignored
  const [draft, setDraft] = useState<Shape | null>(null);
  const [live, setLive] = useState<Matrix | null>(null); // in-progress transform of the selection
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [erasing, setErasing] = useState<Set<string>>(new Set());

  useEffect(persistBoard, []);

  const toPoint = (e: { clientX: number; clientY: number; pressure: number; pointerType: string }): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    // Pens can report 0 on touch-down/lift; floor it so the stroke tapers instead of vanishing. Mouse is a flat 0.5.
    return [e.clientX - r.left, e.clientY - r.top, e.pointerType === "pen" ? Math.max(e.pressure, 0.1) : 0.5];
  };

  const samples = (e: PointerEvent) => {
    const coalesced = e.nativeEvent.getCoalescedEvents?.();
    return coalesced?.length ? coalesced : [e.nativeEvent];
  };

  const idAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest("[data-id]")?.getAttribute("data-id");

  function onPointerDown(e: PointerEvent<SVGSVGElement>) {
    if (pointer.current !== null) return;
    if (e.pointerType === "pen") penSeen.current = true;
    else if (e.pointerType === "touch" && penSeen.current) return; // palm rejection once a stylus is in use
    const eraserTip = (e.buttons & PEN_ERASER_BUTTONS) !== 0;
    if (e.button !== 0 && !eraserTip) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointer.current = e.pointerId;

    const p = toPoint(e);
    const [x, y] = p;
    const s = useBoard.getState();
    const active = eraserTip ? "eraser" : s.tool;

    if (active === "eraser") {
      const id = idAt(e.clientX, e.clientY);
      gesture.current = { kind: "erase", ids: new Set(id ? [id] : []) };
      setErasing(gesture.current.ids);
    } else if (active === "select") {
      const handle = (e.target as Element).closest("[data-handle]")?.getAttribute("data-handle") as Handle | null;
      const current = bounds(pick(s.present, s.selected));
      if (handle && current) {
        gesture.current = { kind: "transform", handle, frame: padBox(current, FRAME_PAD), x, y, m: null };
        return;
      }
      const id = (e.target as Element).closest("[data-id]")?.getAttribute("data-id");
      let sel = s.selected;
      if (id && e.shiftKey) {
        sel = new Set(sel);
        if (!sel.delete(id)) sel.add(id);
        s.select(sel);
      } else if (id && !sel.has(id)) {
        sel = new Set([id]);
        s.select(sel);
      }
      const box = bounds(pick(s.present, sel));
      if (box && ((id && sel.has(id)) || (!id && contains(box, x, y)))) {
        gesture.current = { kind: "transform", handle: "move", frame: padBox(box, FRAME_PAD), x, y, m: null };
      } else {
        gesture.current = { kind: "marquee", x, y, additive: e.shiftKey, box: null };
        if (!e.shiftKey) s.select([]);
      }
    } else {
      const freehand = active === "pen" || active === "highlight";
      const shape: Shape = {
        id: newId(),
        type: active === "pen" ? "stroke" : active,
        points: freehand ? [p] : [p, p],
        color: s.color,
        size: s.size,
        ...(active === "pen" && e.pointerType !== "pen" ? { simulatePressure: true } : {}),
      };
      gesture.current = { kind: "draw", shape };
      setDraft(shape);
    }
  }

  function onPointerMove(e: PointerEvent<SVGSVGElement>) {
    const g = gesture.current;
    if (!g || e.pointerId !== pointer.current) return;
    const [x, y] = toPoint(e);
    if (g.kind === "draw") {
      const d = g.shape;
      const freehand = d.type === "stroke" || d.type === "highlight";
      const end = e.shiftKey ? constrain(d.type, d.points[0], toPoint(e)) : toPoint(e);
      g.shape = { ...d, points: freehand ? [...d.points, ...samples(e).map(toPoint)] : [d.points[0], end] };
      setDraft(g.shape);
    } else if (g.kind === "transform") {
      const mods = { uniform: e.shiftKey, centered: e.altKey, skew: useBoard.getState().skewMode || e.ctrlKey || e.metaKey };
      g.m = g.handle === "move" ? translation(x - g.x, y - g.y) : handleMatrix(g.handle, g.frame, g, { x, y }, mods);
      setLive(g.m);
    } else if (g.kind === "marquee") {
      g.box = boxFromPoints(g, { x, y });
      setMarquee(g.box);
    } else {
      const hits = samples(e).map((ev) => idAt(ev.clientX, ev.clientY)).filter((id): id is string => !!id);
      if (hits.some((id) => !g.ids.has(id))) {
        g.ids = new Set([...g.ids, ...hits]);
        setErasing(g.ids);
      }
    }
  }

  function endGesture(e: PointerEvent<SVGSVGElement>, commit: boolean) {
    if (e.pointerId !== pointer.current) return;
    pointer.current = null;
    const g = gesture.current;
    gesture.current = null;
    const s = useBoard.getState();
    // pointercancel (palm, OS gesture) drops the gesture without committing.
    if (commit && g?.kind === "draw") {
      const [[x1, y1], [x2, y2] = [x1, y1]] = g.shape.points;
      const freehand = g.shape.type === "stroke" || g.shape.type === "highlight";
      if (freehand || Math.hypot(x2 - x1, y2 - y1) >= 2) s.add(g.shape); // a bare click with a shape tool is invisible
    } else if (commit && g?.kind === "transform" && g.m) {
      s.transformSelected(g.m);
    } else if (commit && g?.kind === "marquee" && g.box) {
      const box = g.box;
      const hit = s.present.filter((sh) => intersects(bounds([sh])!, box)).map((sh) => sh.id);
      s.select(g.additive ? [...s.selected, ...hit] : hit);
    } else if (commit && g?.kind === "erase") {
      s.remove(g.ids);
    }
    setDraft(null);
    setLive(null);
    setMarquee(null);
    setErasing(new Set());
  }

  const selBox = bounds(pick(shapes, selected));
  const frame = selBox && (live ? transformBox(padBox(selBox, FRAME_PAD), live) : padBox(selBox, FRAME_PAD));
  const liveTransform = live ? `matrix(${live.join(" ")})` : undefined;

  return (
    <svg
      ref={svgRef}
      data-board
      xmlns="http://www.w3.org/2000/svg"
      className="absolute inset-0 size-full touch-none select-none"
      style={{ cursor: tool === "select" ? "default" : "crosshair" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endGesture(e, true)}
      onPointerCancel={(e) => endGesture(e, false)}
      onLostPointerCapture={(e) => endGesture(e, true)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <defs>
        <pattern id="bg-grid" width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M32 0H0V32" fill="none" stroke="#e4e4e7" strokeWidth="1" />
        </pattern>
        <pattern id="bg-dots" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="12" cy="12" r="1.2" fill="#d4d4d8" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="#ffffff" />
      {background !== "blank" && <rect width="100%" height="100%" fill={`url(#bg-${background})`} />}

      {shapes.map((s) =>
        // Cheap live preview: wrap in the matrix; the committed shape re-renders with true stroke widths on release.
        liveTransform && selected.has(s.id) ? (
          <g key={s.id} transform={liveTransform}>
            <ShapeView shape={s} />
          </g>
        ) : (
          <ShapeView key={s.id} shape={s} hidden={erasing.has(s.id)} />
        ),
      )}
      {draft && <ShapeView shape={draft} />}

      {frame && (
        <g data-ui>
          <rect
            x={frame.x}
            y={frame.y}
            width={frame.w}
            height={frame.h}
            rx={4}
            fill="rgb(59 130 246 / 0.04)"
            stroke="#3b82f6"
            strokeWidth={1.5}
            strokeDasharray={live ? undefined : "5 4"}
            pointerEvents="none"
          />
          {tool === "select" &&
            handlePositions(atLeast(frame, MIN_HANDLE_FRAME)).map(([h, x, y]) => {
              const edge = h.length === 1;
              const cursor = h === "rotate" ? "grab" : skewMode && edge ? (h === "n" || h === "s" ? "ew-resize" : "ns-resize") : SCALE_CURSORS[h];
              return (
                <g key={h} data-handle={h} style={{ cursor }}>
                  {h === "rotate" && (
                    <line x1={x} y1={y} x2={x} y2={y < frame.y ? frame.y : frame.y + frame.h} stroke="#3b82f6" strokeWidth={1} pointerEvents="none" />
                  )}
                  <circle cx={x} cy={y} r={12} fill="transparent" />
                  {h === "rotate" ? (
                    <circle cx={x} cy={y} r={5} fill="#ffffff" stroke="#3b82f6" strokeWidth={1.5} />
                  ) : (
                    <rect
                      x={x - 4}
                      y={y - 4}
                      width={8}
                      height={8}
                      rx={2}
                      fill={skewMode && edge ? "#3b82f6" : "#ffffff"}
                      stroke="#3b82f6"
                      strokeWidth={1.5}
                      transform={skewMode && edge ? `rotate(45 ${x} ${y})` : undefined}
                    />
                  )}
                </g>
              );
            })}
        </g>
      )}
      {marquee && (
        <rect data-ui {...{ x: marquee.x, y: marquee.y, width: marquee.w, height: marquee.h }} fill="rgb(59 130 246 / 0.08)" stroke="#3b82f6" strokeWidth={1} pointerEvents="none" />
      )}
    </svg>
  );
}
