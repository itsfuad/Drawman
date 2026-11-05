import { parseBoard, serializeBoard } from "./board";
import type { Mask } from "./fill";
import { useBoard } from "./store";

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");

export function saveFile() {
  download(new Blob([serializeBoard(useBoard.getState().present)], { type: "application/json" }), `board-${stamp()}.json`);
}

export async function openFile(file: File) {
  try {
    useBoard.getState().load(parseBoard(JSON.parse(await file.text())), true);
  } catch (err) {
    alert(`Could not open file: ${err instanceof Error ? err.message : err}`);
  }
}

const boardSvg = () => document.querySelector<SVGSVGElement>("svg[data-board]");

/** Renders the board SVG to a canvas, minus elements matching `strip`. */
function rasterize(svg: SVGSVGElement, strip: string, scale: number): Promise<CanvasRenderingContext2D> {
  const { width, height } = svg.getBoundingClientRect();
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll(strip).forEach((n) => n.remove());
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = Object.assign(document.createElement("canvas"), { width: width * scale, height: height * scale });
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      resolve(ctx);
    };
    img.onerror = () => reject(new Error("Could not render board"));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(clone));
  });
}

export async function exportPng() {
  const svg = boardSvg();
  if (!svg) return;
  const ctx = await rasterize(svg, "[data-ui]", 2); // 2x: crisp on hi-dpi screens and projectors
  ctx.canvas.toBlob((b) => b && download(b, `board-${stamp()}.png`));
}

const INK_ALPHA = 128; // highlighter (35% opacity) stays see-through for fills; pen ink is a wall

/**
 * Ink mask of everything except background, UI and existing fills, at 1px = 1 board unit.
 * shortcut: assumes board units == CSS pixels; needs the view transform once pan/zoom exists.
 */
export async function inkMask(): Promise<Mask | null> {
  const svg = boardSvg();
  if (!svg) return null;
  const ctx = await rasterize(svg, "[data-ui], [data-bg], [data-fill]", 1);
  const { width: w, height: h, data: rgba } = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  const data = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4 + 3] >= INK_ALPHA ? 1 : 0;
  return { data, w, h };
}

const STORAGE_KEY = "drawman:board";

/** Restores the last session, then autosaves every committed change. Returns the unsubscribe fn. */
export function persistBoard() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) useBoard.getState().load(parseBoard(JSON.parse(saved)), false);
  } catch {
    // Corrupt or blocked storage: start with an empty board.
  }
  return useBoard.subscribe((s, prev) => {
    if (s.present === prev.present) return;
    try {
      localStorage.setItem(STORAGE_KEY, serializeBoard(s.present));
    } catch {
      // Quota/private mode: the board still works, just without autosave.
    }
  });
}
