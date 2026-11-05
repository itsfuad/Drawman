import { parseBoard, serializeBoard } from "./board";
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

export function exportPng() {
  const svg = document.querySelector<SVGSVGElement>("svg[data-board]");
  if (!svg) return;
  const { width, height } = svg.getBoundingClientRect();
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll("[data-ui]").forEach((n) => n.remove()); // drop selection box / marquee
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  const img = new Image();
  img.onload = () => {
    const scale = 2; // crisp on hi-dpi screens and projectors
    const canvas = Object.assign(document.createElement("canvas"), { width: width * scale, height: height * scale });
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    canvas.toBlob((b) => b && download(b, `board-${stamp()}.png`));
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(clone));
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
