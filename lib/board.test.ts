// Run: npm test   (Node 22+ strips TS types natively)
import assert from "node:assert/strict";
import { test } from "node:test";
import { bounds, cloneShapes, commit, parseBoard, redo, serializeBoard, translate, undo, type History, type Shape } from "./board.ts";

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

test("translate moves only selected shapes", () => {
  const out = translate([dot("a", 0, 0), dot("b", 5, 5)], new Set(["a"]), 10, 20);
  assert.deepEqual(out[0].points[0], [10, 20, 0.5]);
  assert.deepEqual(out[1].points[0], [5, 5, 0.5]);
});

test("cloneShapes gives new ids and offset", () => {
  const [c] = cloneShapes([dot("a", 0, 0)], 16);
  assert.notEqual(c.id, "a");
  assert.deepEqual(c.points[0], [16, 16, 0.5]);
});

test("bounds includes stroke width", () => {
  assert.deepEqual(bounds([dot("a", 10, 10)]), { x: 8, y: 8, w: 4, h: 4 });
  assert.equal(bounds([]), null);
});

test("parseBoard round-trips and rejects bad input", () => {
  const shapes = [dot("a", 1, 2), { ...dot("b", 3, 4), simulatePressure: true }];
  assert.deepEqual(parseBoard(JSON.parse(serializeBoard(shapes))), shapes);
  assert.throws(() => parseBoard({}));
  assert.throws(() => parseBoard({ shapes: [{ ...dot("a", 0, 0), type: "script" }] }));
  assert.throws(() => parseBoard({ shapes: [{ ...dot("a", 0, 0), color: "red;x" }] }));
  assert.throws(() => parseBoard({ shapes: [{ ...dot("a", 0, 0), points: [[0, "1", 0]] }] }));
});
