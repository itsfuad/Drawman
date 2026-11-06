// Run: npm test   (Node 22+ strips TS types natively)
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyMatrix, bounds, cloneShapes, commit, constrain, decodeFile, encodeFile, expandGroups, fitView, fontSize, groupShapes, handleMatrix, IDENTITY,
  clampView, invert, isView, MAX_ZOOM, MIN_ZOOM, zoomAt,
  insertFill, LINE_HEIGHT, multiply, parseBoard, redo, rotateAbout, scaleAbout, serializeBoard, transformShapes,
  translation, undo, ungroupShapes, worldPoints, type History, type Matrix, type Shape,
} from "./board.ts";

const dot = (id: string, x: number, y: number): Shape => ({ id, type: "stroke", points: [[x, y, 0.5]], color: "#000000", size: 4 });

test("history: commit / undo / redo", () => {
  let h: History = { past: [], present: [], future: [] };
  h = commit(h, [dot("a", 0, 0)]);
  h = commit(h, [dot("a", 0, 0), dot("b", 1, 1)]);
  assert.equal(h.present.length, 2);
  h = undo(h);
  assert.equal(h.present.length, 1);
  h = redo(h);
  assert.equal(h.present.length, 2);
  h = commit(undo(h), []);
  assert.deepEqual(h.future, [], "new commit drops redo stack");
  assert.equal(undo({ past: [], present: [], future: [] }).present.length, 0, "undo on empty is a no-op");
});

test("history is capped", () => {
  let h: History = { past: [], present: [], future: [] };
  for (let i = 0; i < 150; i++) h = commit(h, [dot(String(i), i, i)]);
  assert.equal(h.past.length, 100);
});

const close = (a: number[], b: number[]) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${a} ≉ ${b}`));
const mods = { uniform: false, centered: false, skew: false };

test("transformShapes touches only selected shapes", () => {
  const out = transformShapes([dot("a", 0, 0), dot("b", 5, 5)], new Set(["a"]), translation(10, 20));
  close(worldPoints(out[0])[0], [10, 20, 0.5]);
  assert.equal(out[1].matrix, undefined);
});

test("matrix algebra: flip twice and 4x90° are identity, scale keeps anchor", () => {
  const flip = scaleAbout(-1, 1, 50, 50);
  close(multiply(flip, flip), IDENTITY);
  const r = rotateAbout(Math.PI / 2, 10, 10);
  close(multiply(r, multiply(r, multiply(r, r))), IDENTITY);
  close(applyMatrix(scaleAbout(3, 2, 7, 9), 7, 9), [7, 9]);
  close(applyMatrix(multiply(translation(1, 0), scaleAbout(2, 2, 0, 0)), 1, 1), [3, 2]); // scale applied first
});

test("handleMatrix: corner scale, uniform, skew, rotate, min scale", () => {
  const box = { x: 0, y: 0, w: 100, h: 50 };
  close(applyMatrix(handleMatrix("se", box, { x: 100, y: 50 }, { x: 200, y: 100 }, mods), 100, 50), [200, 100]);
  close(applyMatrix(handleMatrix("se", box, { x: 100, y: 50 }, { x: 200, y: 100 }, mods), 0, 0), [0, 0]); // anchor fixed
  const u = handleMatrix("se", box, { x: 100, y: 50 }, { x: 300, y: 60 }, { ...mods, uniform: true });
  assert.equal(u[0], u[3]);
  const k = handleMatrix("s", box, { x: 50, y: 50 }, { x: 100, y: 50 }, { ...mods, skew: true });
  close(applyMatrix(k, 0, 50), [50, 50]); // bottom edge slides
  close(applyMatrix(k, 0, 0), [0, 0]); // top edge fixed
  const rot = handleMatrix("rotate", box, { x: 50, y: -30 }, { x: 130, y: 25 }, mods);
  close(applyMatrix(rot, 50, 25), [50, 25]); // center fixed
  const collapsed = handleMatrix("e", box, { x: 100, y: 25 }, { x: 0, y: 25 }, mods);
  assert.ok(collapsed.every(Number.isFinite) && Math.abs(collapsed[0]) >= 0.01);
});

test("constrain: square rect, 45° line", () => {
  assert.deepEqual(constrain("rect", [0, 0, 0.5], [30, -10, 0.5]), [30, -30, 0.5]);
  const [x, y] = constrain("line", [0, 0, 0.5], [100, 10, 0.5]);
  close([y], [0]);
  assert.ok(x > 99);
});

test("cloneShapes gives new ids and offset", () => {
  const [c] = cloneShapes([dot("a", 0, 0)], 16);
  assert.notEqual(c.id, "a");
  close(worldPoints(c)[0], [16, 16, 0.5]);
});

test("bounds includes stroke width", () => {
  assert.deepEqual(bounds([dot("a", 10, 10)]), { x: 6, y: 6, w: 8, h: 8 }); // pen ink is 2x size wide
  assert.equal(bounds([]), null);
});

test("parseBoard round-trips and rejects bad input", () => {
  const shapes = [dot("a", 1, 2), { ...dot("b", 3, 4), simulatePressure: true, matrix: [1, 0, 0.5, 1, 3, 4] as Matrix }];
  assert.deepEqual(parseBoard(JSON.parse(serializeBoard(shapes))), shapes);
  assert.throws(() => parseBoard({}));
  assert.throws(() => parseBoard({ shapes: [{ ...dot("a", 0, 0), type: "script" }] }));
  assert.throws(() => parseBoard({ shapes: [{ ...dot("a", 0, 0), color: "red;x" }] }));
  assert.throws(() => parseBoard({ shapes: [{ ...dot("a", 0, 0), points: [[0, "1", 0]] }] }));
  assert.throws(() => parseBoard({ shapes: [{ ...dot("a", 0, 0), matrix: [1, 0, 0, 1, 0] }] }));
  assert.throws(() => parseBoard({ shapes: [{ ...dot("a", 0, 0), matrix: [1, 0, 0, 1, 0, null] }] }));
});

const line = (id: string, x1: number, y1: number, x2: number, y2: number): Shape => ({
  id, type: "line", points: [[x1, y1, 0.5], [x2, y2, 0.5]], color: "#000000", size: 4,
});
const fillAt = (id: string, x: number, y: number, w: number): Shape => ({
  id, type: "fill", points: [[x, y, 0.5], [x + w, y, 0.5], [x + w, y + w, 0.5], [x, y + w, 0.5]], color: "#ff0000", size: 1,
});
const ids = (shapes: Shape[]) => shapes.map((s) => s.id).join(",");

test("insertFill: under the ink it overlaps, above overlapping fills, on top when alone", () => {
  const tri = [line("a", 0, 100, 50, 0), line("b", 50, 0, 100, 100), line("c", 100, 100, 0, 100)];
  assert.equal(ids(insertFill(tri, fillAt("f", 10, 30, 60))), "f,a,b,c");
  // big outline filled, then a small outline inside it filled: new fill must sit above the big fill
  const nested = [fillAt("big", 0, 0, 200), line("outer", 0, 0, 200, 200), line("inner", 50, 50, 100, 100)];
  assert.equal(ids(insertFill(nested, fillAt("small", 55, 55, 40))), "big,small,outer,inner");
  assert.equal(ids(insertFill([dot("a", 500, 500)], fillAt("f", 0, 0, 10))), "a,f");
});

test("parseBoard: v1 files keep fills under ink, v2 keeps stored order", () => {
  const shapes = [line("a", 0, 0, 10, 10), fillAt("f", 0, 0, 10)];
  assert.equal(ids(parseBoard({ version: 1, shapes })), "f,a");
  assert.equal(ids(parseBoard({ shapes })), "f,a", "files without a version are v1");
  assert.equal(ids(parseBoard(JSON.parse(serializeBoard(shapes)))), "a,f");
});

test("groups: expand, stack together, ungroup, paste gets a new group", () => {
  const shapes = [dot("a", 0, 0), dot("x", 1, 1), dot("b", 2, 2), dot("y", 3, 3)];
  const grouped = groupShapes(shapes, new Set(["a", "b"]), "g1");
  assert.equal(ids(grouped), "x,a,b,y", "members gathered at the topmost member");
  assert.deepEqual([...expandGroups(grouped, new Set(["a"]))].sort(), ["a", "b"]);
  assert.equal(ungroupShapes(grouped, new Set(["a", "b"])).filter((s) => s.group).length, 0);
  const copies = cloneShapes(grouped.filter((s) => s.group), 16);
  assert.ok(copies[0].group && copies[0].group === copies[1].group && copies[0].group !== "g1");
  assert.equal(parseBoard(JSON.parse(serializeBoard(grouped)))[1].group, "g1", "group survives save/load");
});

test("text: box from estimated metrics, validated on load", () => {
  // Node has no canvas, so widths use the fixed 0.55em estimate.
  const t: Shape = { id: "t", type: "text", points: [[10, 20, 0.5]], text: "ab\nabcd", color: "#000000", size: 4 };
  const size = fontSize(4);
  const [, ne, se] = worldPoints(t);
  assert.ok(Math.abs(ne[0] - (10 + 4 * size * 0.55)) < 1e-9, "width = longest line");
  assert.ok(Math.abs(se[1] - (20 + 2 * size * LINE_HEIGHT)) < 1e-9, "height = lines * line height");
  assert.equal(parseBoard(JSON.parse(serializeBoard([t])))[0].text, "ab\nabcd");
  assert.throws(() => parseBoard({ version: 2, shapes: [{ ...t, text: 5 }] }));
  assert.throws(() => parseBoard({ version: 2, shapes: [{ ...t, text: "x".repeat(10_001) }] }));
});

test("compact file: gzip round trip, smaller than JSON, legacy .json still opens", async () => {
  const stroke: Shape = {
    id: "s", type: "stroke", color: "#000000", size: 4, simulatePressure: true,
    points: Array.from({ length: 500 }, (_, i) => [i * 1.234567891, Math.sin(i / 7) * 80.987654321, 0.5]),
    matrix: [0.70710678118, 0.70710678118, -0.70710678118, 0.70710678118, 12.3456789, 9.87654321],
  };
  const blob = await encodeFile([stroke]);
  const legacy = JSON.stringify({ app: "drawman", version: 2, shapes: [stroke] });
  assert.ok(blob.size * 4 < legacy.length, `compact ${blob.size}B vs json ${legacy.length}B`);
  const [back] = await decodeFile(blob);
  back.points.forEach((p, i) => assert.ok(Math.abs(p[0] - stroke.points[i][0]) <= 0.005 && Math.abs(p[1] - stroke.points[i][1]) <= 0.005));
  assert.ok(Math.abs(back.matrix![0] - stroke.matrix![0]) < 1e-5);
  assert.equal((await decodeFile(new Blob([legacy])))[0].points.length, 500, "plain JSON file");
  await assert.rejects(decodeFile(new Blob(["not a board"])));
});

test("image src must be inline raster data", () => {
  const img = (src: string): unknown => ({ version: 2, shapes: [{ id: "i", type: "image", points: [[0, 0, 0.5], [10, 10, 0.5]], color: "#000000", size: 1, src }] });
  assert.equal(parseBoard(img("data:image/png;base64,iVBORw0KGgo=")).length, 1);
  assert.throws(() => parseBoard(img("https://example.com/track.png")), /Invalid shape/, "remote URL");
  assert.throws(() => parseBoard(img("data:image/svg+xml;base64,PHN2Zz4=")), /Invalid shape/, "svg can carry script");
  assert.throws(() => parseBoard(img("data:image/png;base64,abc\" onload=\"x")), /Invalid shape/, "attribute injection");
});

test("view: invert, zoomAt keeps the anchor, clamps, fitView centres", () => {
  const m: Matrix = multiply(translation(30, -7), scaleAbout(2, 2, 5, 9));
  const [x, y] = applyMatrix(invert(m), ...applyMatrix(m, 11, 13));
  assert.ok(Math.abs(x - 11) < 1e-9 && Math.abs(y - 13) < 1e-9, "round trip");

  const v = zoomAt(IDENTITY, 2, 100, 50);
  assert.deepEqual(applyMatrix(v, 100, 50), [100, 50], "anchor stays under the cursor");
  assert.equal(v[0], 2);
  assert.equal(zoomAt(v, 1000, 0, 0)[0], MAX_ZOOM);
  assert.equal(zoomAt(v, 1e-6, 0, 0)[0], MIN_ZOOM);

  const f = fitView({ x: 1000, y: 1000, w: 10, h: 0 }, 800, 600);
  assert.equal(f[0], 1, "never zooms in past 100%");
  assert.deepEqual(applyMatrix(f, 1005, 1000), [400, 300]);
  assert.ok(isView(f) && !isView([NaN, 0, 0, 1, 0, 0]) && !isView([0, 0, 0, 0, 0, 0]));
});

test("clampView: screen centre stays over content + home screen", () => {
  const far = translation(-5000, 0); // centre at world x=5400, far right of an empty board
  const c = clampView(far, null, 800, 600);
  assert.deepEqual(applyMatrix(invert(c), 400, 300), [800, 300], "pulled back to the home screen edge");
  const grown = clampView(far, { x: 0, y: 0, w: 6000, h: 10 }, 800, 600);
  assert.equal(grown, far, "content out there extends the area");
  const zoomed = clampView([2, 0, 0, 2, -20000, 0], null, 800, 600);
  assert.deepEqual(applyMatrix(invert(zoomed), 400, 300), [800, 150], "clamp works in world units at any zoom");
});
