import { memo } from "react";
import { getStroke } from "perfect-freehand";
import type { Shape } from "@/lib/board";

// From the perfect-freehand README: outline polygon -> smooth SVG path.
function outlineToPath(points: number[][]): string {
  const len = points.length;
  if (len < 4) return "";
  const avg = (a: number, b: number) => ((a + b) / 2).toFixed(2);
  let [a, b] = points;
  const c = points[2];
  let d = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(2)},${b[1].toFixed(2)} ${avg(b[0], c[0])},${avg(b[1], c[1])} T`;
  for (let i = 2; i < len - 1; i++) {
    a = points[i];
    b = points[i + 1];
    d += `${avg(a[0], b[0])},${avg(a[1], b[1])} `;
  }
  return d + "Z";
}

const HIGHLIGHT_SCALE = 4;

type Paint = { stroke: string; strokeWidth: number };

/** Outline geometry; drawn once visibly and once as a fat transparent hit area. */
function geometry(s: Shape, paint: Paint) {
  const [[x1, y1], [x2, y2] = [x1, y1]] = s.points;
  const p = { ...paint, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (s.type) {
    case "stroke":
    case "highlight":
      return <polyline points={s.points.map(([x, y]) => `${x},${y}`).join(" ")} {...p} />;
    case "line":
      return <line x1={x1} y1={y1} x2={x2} y2={y2} {...p} />;
    case "arrow": {
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const head = s.size * 3 + 8;
      const wing = (side: number) =>
        `${x2 - head * Math.cos(angle + side * 0.5)},${y2 - head * Math.sin(angle + side * 0.5)}`;
      return <path d={`M${x1},${y1} L${x2},${y2} M${wing(1)} L${x2},${y2} L${wing(-1)}`} {...p} />;
    }
    case "rect":
      return <rect x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} rx={4} {...p} />;
    case "ellipse":
      return <ellipse cx={(x1 + x2) / 2} cy={(y1 + y2) / 2} rx={Math.abs(x2 - x1) / 2} ry={Math.abs(y2 - y1) / 2} {...p} />;
  }
}

function visible(s: Shape) {
  if (s.type !== "stroke" && s.type !== "highlight") return geometry(s, { stroke: s.color, strokeWidth: s.size });
  const hl = s.type === "highlight";
  const outline = getStroke(s.points, {
    size: hl ? s.size * HIGHLIGHT_SCALE : s.size * 2,
    thinning: hl ? 0 : 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: !hl && !!s.simulatePressure,
    last: true,
  });
  return <path d={outlineToPath(outline)} fill={s.color} opacity={hl ? 0.35 : 1} />;
}

export const ShapeView = memo(function ShapeView({ shape, hidden }: { shape: Shape; hidden?: boolean }) {
  const hitWidth = Math.max(shape.size * (shape.type === "highlight" ? HIGHLIGHT_SCALE : 2), 14);
  return (
    <g data-id={shape.id} opacity={hidden ? 0.2 : undefined}>
      {visible(shape)}
      {geometry(shape, { stroke: "transparent", strokeWidth: hitWidth })}
    </g>
  );
});
