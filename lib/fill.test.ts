import assert from "node:assert/strict";
import { test } from "node:test";
import { fillRegion, type Mask } from "./fill.ts";

/** Mask with a square ring outline (thickness t) from (a,a) to (b,b), optional gap on the top edge. */
function ring(size: number, a: number, b: number, t: number, gap = 0): Mask {
  const data = new Uint8Array(size * size);
  for (let y = a; y <= b; y++)
    for (let x = a; x <= b; x++) {
      const edge = x < a + t || x > b - t || y < a + t || y > b - t;
      const inGap = gap && y < a + t && Math.abs(x - (a + b) / 2) < gap / 2;
      if (edge && !inGap) data[y * size + x] = 1;
    }
  return { data, w: size, h: size };
}

test("ring interior fills and stays inside the outline", () => {
  const pts = fillRegion(ring(100, 20, 80, 3), 50, 50)!;
  assert.ok(pts && pts.length >= 4);
  for (const [x, y] of pts) assert.ok(x >= 20 && x <= 81 && y >= 20 && y <= 81, `${x},${y} outside`);
});

test("filled square simplifies to about 4 corners", () => {
  const pts = fillRegion(ring(100, 20, 80, 3), 50, 50)!;
  assert.ok(pts.length <= 8, `got ${pts.length} points`);
});

test("small gap is bridged", () => {
  assert.ok(fillRegion(ring(100, 20, 80, 3, 3), 50, 50));
});

test("open area and seed on ink return null", () => {
  assert.equal(fillRegion(ring(100, 20, 80, 3, 30), 50, 50), null, "big gap leaks");
  assert.equal(fillRegion(ring(100, 20, 80, 3), 5, 5), null, "outside leaks to border");
  assert.equal(fillRegion(ring(100, 20, 80, 3), 21, 50), null, "seed on ink");
});
