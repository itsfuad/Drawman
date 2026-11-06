import { memo } from "react";
import { getStroke } from "perfect-freehand";
import {
  firstBaseline, fontSize, HIGHLIGHT_SCALE, inkWidth, LINE_HEIGHT, TEXT_FONT, worldPoints, type Point, type Shape,
} from "@/lib/board";

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

type Paint = { stroke: string; strokeWidth: number };

const xy = ([x, y]: Point) => `${x},${y}`;

/** Outline geometry from world points; drawn once visibly and once as a fat transparent hit area. */
function geometry(s: Shape, pts: Point[], paint: Paint) {
  const p = { ...paint, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (s.type) {
    case "stroke":
    case "highlight":
      return <polyline points={pts.map(xy).join(" ")} {...p} />;
    case "line":
      return <line x1={pts[0][0]} y1={pts[0][1]} x2={pts[1][0]} y2={pts[1][1]} {...p} />;
    case "arrow": {
      // Head is built in world space so skew/scale never distort it.
      const [[x1, y1], [x2, y2]] = pts;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const head = s.size * 3 + 8;
      const wing = (side: number) =>
        `${x2 - head * Math.cos(angle + side * 0.5)},${y2 - head * Math.sin(angle + side * 0.5)}`;
      return <path d={`M${x1},${y1} L${x2},${y2} M${wing(1)} L${x2},${y2} L${wing(-1)}`} {...p} />;
    }
    case "rect":
      return <polygon points={pts.map(xy).join(" ")} {...p} />;
    case "fill": // filled with its own paint: the colour when visible, transparent as a hit area
    case "text": // only drawn as the hit box; glyphs come from visible()
      return <polygon points={pts.map(xy).join(" ")} {...p} fill={paint.stroke} />;
    case "ellipse": {
      const [start, ...rest] = pts.map(xy);
      const curves = [0, 3, 6, 9].map((i) => `C${rest[i]} ${rest[i + 1]} ${rest[i + 2]}`).join(" ");
      return <path d={`M${start} ${curves} Z`} {...p} />;
    }
  }
}

function visible(s: Shape, pts: Point[]) {
  if (s.type === "text") {
    // Glyphs can't be built from world points, so text takes its matrix as an SVG transform.
    const size = fontSize(s.size);
    const [[x, y]] = s.points;
    const base = firstBaseline(size);
    return (
      <text
        transform={s.matrix && `matrix(${s.matrix.join(" ")})`}
        fill={s.color}
        fontSize={size}
        fontFamily={TEXT_FONT}
        style={{ whiteSpace: "pre" }}
      >
        {(s.text ?? "").split("\n").map((line, i) => (
          <tspan key={i} x={x} y={y + base + i * size * LINE_HEIGHT}>
            {line}
          </tspan>
        ))}
      </text>
    );
  }
  if (s.type !== "stroke" && s.type !== "highlight") return geometry(s, pts, { stroke: s.color, strokeWidth: inkWidth(s) });
  const hl = s.type === "highlight";
  const outline = getStroke(pts, {
    size: s.size * (hl ? HIGHLIGHT_SCALE : 2),
    thinning: hl ? 0 : 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: !hl && !!s.simulatePressure,
    last: true,
  });
  return <path d={outlineToPath(outline)} fill={s.color} opacity={hl ? 0.35 : 1} />;
}

export const ShapeView = memo(function ShapeView({ shape, hidden }: { shape: Shape; hidden?: boolean }) {
  const pts = worldPoints(shape);
  const fill = shape.type === "fill";
  const solid = fill || shape.type === "text"; // hit area is the filled box, not a fat outline
  return (
    <g data-id={shape.id} data-fill={fill || undefined} opacity={hidden ? 0.2 : undefined}>
      {visible(shape, pts)}
      {geometry(shape, pts, { stroke: "transparent", strokeWidth: solid ? 1 : Math.max(inkWidth(shape), 14) })}
    </g>
  );
});
