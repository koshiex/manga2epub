import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containSize, fitSize, planParts } from '../src/layout.js';

const whole = (sw, sh) => ({ sx: 0, sy: 0, sw, sh, rotate: false });

test('fitSize keeps original size when no limits are set', () => {
  assert.deepEqual(fitSize(1000, 1500, 0, 0), { width: 1000, height: 1500 });
});

test('fitSize shrinks proportionally into the screen box', () => {
  assert.deepEqual(fitSize(2000, 3000, 1264, 1680), { width: 1120, height: 1680 });
});

test('fitSize never upscales small pages', () => {
  assert.deepEqual(fitSize(800, 1000, 1264, 1680), { width: 800, height: 1000 });
});

test('containSize shrinks large pages into the screen', () => {
  assert.deepEqual(containSize(800, 1200, 480, 800), { width: 480, height: 720 });
});

test('containSize enlarges small pages to fill the screen', () => {
  assert.deepEqual(containSize(300, 400, 480, 800), { width: 480, height: 640 });
});

test('planParts leaves portrait pages untouched in every mode', () => {
  for (const spreads of ['keep', 'split', 'rotate']) {
    assert.deepEqual(planParts(1000, 1400, { spreads, rtl: true }), [whole(1000, 1400)]);
  }
});

test('planParts keeps spreads when asked', () => {
  assert.deepEqual(planParts(2000, 1400, { spreads: 'keep', rtl: true }), [whole(2000, 1400)]);
});

test('planParts splits spreads right half first for manga', () => {
  assert.deepEqual(planParts(2001, 1400, { spreads: 'split', rtl: true }), [
    { sx: 1000, sy: 0, sw: 1001, sh: 1400, rotate: false },
    { sx: 0, sy: 0, sw: 1000, sh: 1400, rotate: false },
  ]);
});

test('planParts splits spreads left half first for comics', () => {
  assert.deepEqual(planParts(2000, 1400, { spreads: 'split', rtl: false }), [
    { sx: 0, sy: 0, sw: 1000, sh: 1400, rotate: false },
    { sx: 1000, sy: 0, sw: 1000, sh: 1400, rotate: false },
  ]);
});

test('planParts rotates spreads when asked', () => {
  assert.deepEqual(planParts(2000, 1400, { spreads: 'rotate', rtl: true }), [{ ...whole(2000, 1400), rotate: true }]);
});
