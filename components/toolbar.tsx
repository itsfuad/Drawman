"use client";

import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
import {
  ArrowUpRight, BringToFront, Circle, ClipboardPaste, Copy, Delete, Download, Eraser, FlipHorizontal2, FlipVertical2,
  FolderOpen, Grid3x3, Group, Highlighter, ImageDown, Italic, Minus, MousePointer2, PaintBucket, PenLine, Redo2, RotateCcw,
  RotateCw, Scissors, SendToBack, Square, Trash2, Type, Undo2, Ungroup,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { exportPng, openFile, saveFile } from "@/lib/files";
import { useBoard, type Background, type Tool } from "@/lib/store";
import { cn } from "@/lib/utils";

const TOOLS: { tool: Tool; key: string; label: string; icon: ReactNode }[] = [
  { tool: "select", key: "v", label: "Select", icon: <MousePointer2 /> },
  { tool: "pen", key: "p", label: "Pen", icon: <PenLine /> },
  { tool: "highlight", key: "h", label: "Highlighter", icon: <Highlighter /> },
  { tool: "eraser", key: "e", label: "Eraser", icon: <Eraser /> },
  { tool: "fill", key: "f", label: "Fill closed area", icon: <PaintBucket /> },
  { tool: "text", key: "t", label: "Text", icon: <Type /> },
  { tool: "line", key: "l", label: "Line", icon: <Minus /> },
  { tool: "arrow", key: "a", label: "Arrow", icon: <ArrowUpRight /> },
  { tool: "rect", key: "r", label: "Rectangle", icon: <Square /> },
  { tool: "ellipse", key: "o", label: "Ellipse", icon: <Circle /> },
];

const COLORS = ["#18181b", "#71717a", "#e11d48", "#ea580c", "#ca8a04", "#16a34a", "#2563eb", "#7c3aed"];
const SIZES = [2, 4, 8, 16];
const BACKGROUNDS: Background[] = ["grid", "dots", "blank"];

const isMac = typeof navigator !== "undefined" && /Mac|iP(hone|ad)/.test(navigator.platform);
const mod = (k: string) => (isMac ? `⌘${k}` : `Ctrl+${k}`);

function Tip({ label, kbd, children }: { label: string; kbd?: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="bottom">
        {label}
        {kbd && <kbd className="ml-1 rounded bg-background/20 px-1 font-mono text-[10px]">{kbd}</kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

function Bar({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "absolute left-1/2 z-10 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-xl border bg-background/90 p-1 shadow-sm backdrop-blur",
        className,
      )}
    >
      {children}
    </div>
  );
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.("input, textarea, [contenteditable]")) return;
      const s = useBoard.getState();
      const k = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        const actions: Record<string, () => void> = {
          z: e.shiftKey ? s.redo : s.undo,
          y: s.redo,
          c: s.copy,
          x: s.cut,
          v: s.paste,
          s: saveFile,
          g: e.shiftKey ? s.ungroupSelected : s.groupSelected,
          a: () => {
            s.setTool("select");
            s.select(s.present.map((sh) => sh.id));
          },
        };
        if (actions[k]) {
          e.preventDefault();
          actions[k]();
        }
        return;
      }
      if (e.altKey) return;
      const selectionKeys: Record<string, () => void> = {
        H: () => s.flipSelected("x"),
        V: () => s.flipSelected("y"),
        "]": () => s.reorderSelected("front"),
        "[": () => s.reorderSelected("back"),
      };
      if (selectionKeys[e.key]) selectionKeys[e.key](); // e.key is "H" (not "h") only with Shift held
      else if (k === "delete" || k === "backspace") s.remove(s.selected);
      else if (k === "escape") s.select([]);
      else {
        const t = TOOLS.find((t) => t.key === k);
        if (t) s.setTool(t.tool);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function Toolbar() {
  useShortcuts();
  const s = useBoard();
  const fileInput = useRef<HTMLInputElement>(null);
  const hasSelection = s.selected.size > 0;

  return (
    <>
      <Bar className="top-3">
        {TOOLS.map((t) => (
          <Tip key={t.tool} label={t.label} kbd={t.key.toUpperCase()}>
            <Button
              size="icon"
              variant={s.tool === t.tool ? "default" : "ghost"}
              aria-label={t.label}
              aria-pressed={s.tool === t.tool}
              onClick={() => s.setTool(t.tool)}
            >
              {t.icon}
            </Button>
          </Tip>
        ))}
        <Separator orientation="vertical" className="mx-1 h-5" />
        <Popover>
          <Tip label="Color & size">
            <PopoverTrigger
              render={
                <Button size="icon" variant="ghost" aria-label="Color and size">
                  <span
                    className="rounded-full ring-1 ring-foreground/15"
                    style={{ background: s.color, width: 6 + s.size, height: 6 + s.size, maxWidth: 18, maxHeight: 18 }}
                  />
                </Button>
              }
            />
          </Tip>
          <PopoverContent className="w-auto gap-3">
            <div className="grid grid-cols-5 gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  aria-label={`Color ${c}`}
                  aria-pressed={s.color === c}
                  className="size-7 rounded-full outline-offset-2 transition hover:scale-110 focus-visible:outline-2 focus-visible:outline-ring aria-pressed:outline-2 aria-pressed:outline-foreground"
                  style={{ background: c }}
                  onClick={() => s.setStyle({ color: c })}
                />
              ))}
              <label
                className="relative size-7 cursor-pointer overflow-hidden rounded-full bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)] transition hover:scale-110"
                title="Custom color"
              >
                <input
                  type="color"
                  value={s.color}
                  // Live preview for the next stroke only; restyle the selection once on close so dragging the picker doesn't flood history.
                  onChange={(e) => useBoard.setState({ color: e.target.value })}
                  onBlur={(e) => s.setStyle({ color: e.target.value })}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  aria-label="Custom color"
                />
              </label>
            </div>
            <Separator />
            <div className="flex justify-between gap-1">
              {SIZES.map((n) => (
                <Button
                  key={n}
                  size="icon"
                  variant={s.size === n ? "secondary" : "ghost"}
                  aria-label={`Size ${n}`}
                  onClick={() => s.setStyle({ size: n })}
                >
                  <span className="rounded-full bg-foreground" style={{ width: n + 2, height: n + 2 }} />
                </Button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </Bar>

      {hasSelection && s.tool === "select" && (
        <Bar className="top-16">
          <Tip label="Flip horizontal" kbd="Shift+H">
            <Button size="icon" variant="ghost" aria-label="Flip horizontal" onClick={() => s.flipSelected("x")}>
              <FlipHorizontal2 />
            </Button>
          </Tip>
          <Tip label="Flip vertical" kbd="Shift+V">
            <Button size="icon" variant="ghost" aria-label="Flip vertical" onClick={() => s.flipSelected("y")}>
              <FlipVertical2 />
            </Button>
          </Tip>
          <Tip label="Rotate 90° left">
            <Button size="icon" variant="ghost" aria-label="Rotate left" onClick={() => s.rotateSelected(-90)}>
              <RotateCcw />
            </Button>
          </Tip>
          <Tip label="Rotate 90° right">
            <Button size="icon" variant="ghost" aria-label="Rotate right" onClick={() => s.rotateSelected(90)}>
              <RotateCw />
            </Button>
          </Tip>
          <Tip label="Skew mode: edge handles slant" kbd={`hold ${isMac ? "⌘" : "Ctrl"}`}>
            <Button
              size="icon"
              variant={s.skewMode ? "default" : "ghost"}
              aria-label="Skew mode"
              aria-pressed={s.skewMode}
              onClick={s.toggleSkewMode}
            >
              <Italic />
            </Button>
          </Tip>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <Tip label="Bring to front" kbd="]">
            <Button size="icon" variant="ghost" aria-label="Bring to front" onClick={() => s.reorderSelected("front")}>
              <BringToFront />
            </Button>
          </Tip>
          <Tip label="Send to back" kbd="[">
            <Button size="icon" variant="ghost" aria-label="Send to back" onClick={() => s.reorderSelected("back")}>
              <SendToBack />
            </Button>
          </Tip>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <Tip label="Group" kbd={mod("G")}>
            <Button size="icon" variant="ghost" aria-label="Group" disabled={s.selected.size < 2} onClick={s.groupSelected}>
              <Group />
            </Button>
          </Tip>
          <Tip label="Ungroup" kbd={mod("Shift+G")}>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Ungroup"
              disabled={!s.present.some((sh) => sh.group && s.selected.has(sh.id))}
              onClick={s.ungroupSelected}
            >
              <Ungroup />
            </Button>
          </Tip>
        </Bar>
      )}

      <Bar className="bottom-3">
        <Tip label="Undo" kbd={mod("Z")}>
          <Button size="icon" variant="ghost" aria-label="Undo" disabled={!s.past.length} onClick={s.undo}>
            <Undo2 />
          </Button>
        </Tip>
        <Tip label="Redo" kbd={mod("Shift+Z")}>
          <Button size="icon" variant="ghost" aria-label="Redo" disabled={!s.future.length} onClick={s.redo}>
            <Redo2 />
          </Button>
        </Tip>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <Tip label="Cut" kbd={mod("X")}>
          <Button size="icon" variant="ghost" aria-label="Cut" disabled={!hasSelection} onClick={s.cut}>
            <Scissors />
          </Button>
        </Tip>
        <Tip label="Copy" kbd={mod("C")}>
          <Button size="icon" variant="ghost" aria-label="Copy" disabled={!hasSelection} onClick={s.copy}>
            <Copy />
          </Button>
        </Tip>
        <Tip label="Paste" kbd={mod("V")}>
          <Button size="icon" variant="ghost" aria-label="Paste" disabled={!s.clipboard.length} onClick={s.paste}>
            <ClipboardPaste />
          </Button>
        </Tip>
        <Tip label="Delete selection" kbd="Del">
          <Button size="icon" variant="ghost" aria-label="Delete selection" disabled={!hasSelection} onClick={() => s.remove(s.selected)}>
            <Delete />
          </Button>
        </Tip>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <Tip label={`Background: ${s.background}`}>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Change background"
            onClick={() => s.setBackground(BACKGROUNDS[(BACKGROUNDS.indexOf(s.background) + 1) % BACKGROUNDS.length])}
          >
            <Grid3x3 />
          </Button>
        </Tip>
        <Tip label="Open board">
          <Button size="icon" variant="ghost" aria-label="Open board" onClick={() => fileInput.current?.click()}>
            <FolderOpen />
          </Button>
        </Tip>
        <Tip label="Save board" kbd={mod("S")}>
          <Button size="icon" variant="ghost" aria-label="Save board" onClick={saveFile}>
            <Download />
          </Button>
        </Tip>
        <Tip label="Export PNG">
          <Button size="icon" variant="ghost" aria-label="Export PNG" onClick={exportPng}>
            <ImageDown />
          </Button>
        </Tip>
        <Tip label="Clear board (undoable)">
          <Button size="icon" variant="ghost" aria-label="Clear board" disabled={!s.present.length} onClick={s.clear} className="hover:text-destructive">
            <Trash2 />
          </Button>
        </Tip>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) openFile(file);
            e.target.value = ""; // allow re-opening the same file
          }}
        />
      </Bar>
    </>
  );
}
