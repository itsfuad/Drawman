// Run: npm test   (Node 22+ strips TS types natively)
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyMatrix, bounds, cloneShapes, commit, constrain, handleMatrix, IDENTITY, multiply, parseBoard, redo, rotateAbout,
  scaleAbout, serializeBoard, transformShapes, translation, undo, worldPoints, type History, type Matrix, type Shape,
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
