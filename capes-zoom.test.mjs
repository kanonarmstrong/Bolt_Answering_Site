/* Regression tests for the TPCapes scroll-zoom logic.
   Run: node --test capes-zoom.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const CZ = require('./capes-zoom.js');

test('initial scale is 1.0 at progress 0', () => {
  assert.equal(CZ.scaleFor(0), 1.0);
});

test('max scale is exactly 1.2 at progress 1 (20%)', () => {
  assert.equal(CZ.scaleFor(1), 1.2);
  assert.equal(CZ.MAX, 0.2);
});

test('scale never exceeds 1.2 (progress clamped)', () => {
  assert.equal(CZ.scaleFor(2), 1.2);
  assert.equal(CZ.scaleFor(999), 1.2);
  assert.equal(CZ.scaleFor(-1), 1.0);
});

test('scale is monotonic increasing in progress (subtle, mid = 1.1)', () => {
  assert.equal(CZ.scaleFor(0.5), 1.1);
  assert.ok(CZ.scaleFor(0.25) < CZ.scaleFor(0.75));
});

test('progress: section entering (top at viewport bottom) = 0', () => {
  const vh = 800, height = 400;
  assert.equal(CZ.clampProgress(vh, height, vh), 0); // top == vh
});

test('progress: section exited (bottom at viewport top) = 1', () => {
  const vh = 800, height = 400;
  assert.equal(CZ.clampProgress(-height, height, vh), 1); // top == -height
});

test('scrolling down (top decreases) increases progress -> scale; up decreases it', () => {
  const vh = 800, height = 400;
  const pEnter = CZ.clampProgress(600, height, vh);   // higher top (just entered)
  const pLater = CZ.clampProgress(100, height, vh);   // lower top (scrolled down)
  assert.ok(pLater > pEnter, 'scroll down increases progress');
  assert.ok(CZ.scaleFor(pLater) > CZ.scaleFor(pEnter), 'scroll down zooms in');
  assert.ok(CZ.scaleFor(pEnter) > CZ.scaleFor(CZ.clampProgress(750, height, vh)), 'scroll up zooms back out');
});

test('progress stays within [0,1] for out-of-range positions', () => {
  const vh = 800, height = 400;
  assert.equal(CZ.clampProgress(5000, height, vh), 0);   // far below viewport
  assert.equal(CZ.clampProgress(-5000, height, vh), 1);  // far above viewport
});
