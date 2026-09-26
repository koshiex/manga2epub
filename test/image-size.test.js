import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageInfo } from '../src/image-size.js';
import { fixtureJpeg40x25, makePng } from './helpers.js';

const SOI = [0xff, 0xd8];
const SOF_COMPONENTS = [0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];

function sof(marker, width, height) {
  return [0xff, marker, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, ...SOF_COMPONENTS];
}

test('reads PNG dimensions', () => {
  assert.deepEqual(imageInfo(makePng(31, 17)), { mime: 'image/png', width: 31, height: 17 });
});

test('reads JPEG dimensions from a real encoder output', () => {
  assert.deepEqual(imageInfo(fixtureJpeg40x25()), { mime: 'image/jpeg', width: 40, height: 25 });
});

test('skips large APP segments and fill bytes before the frame header', () => {
  const app1 = [0xff, 0xe1, 0x10, 0x02, ...new Array(0x1000).fill(0)];
  const bytes = Uint8Array.from([...SOI, ...app1, 0xff, ...sof(0xc2, 600, 800)]);
  assert.deepEqual(imageInfo(bytes), { mime: 'image/jpeg', width: 600, height: 800 });
});

test('does not mistake a Huffman table marker for a frame header', () => {
  const dht = [0xff, 0xc4, 0x00, 0x04, 0x00, 0x00];
  const bytes = Uint8Array.from([...SOI, ...dht, ...sof(0xc0, 100, 200)]);
  assert.deepEqual(imageInfo(bytes), { mime: 'image/jpeg', width: 100, height: 200 });
});

test('returns null for unknown formats', () => {
  assert.equal(imageInfo(Uint8Array.from([1, 2, 3, 4])), null);
});

test('returns null for truncated JPEG', () => {
  assert.equal(imageInfo(Uint8Array.from([...SOI, 0xff, 0xe0, 0x00])), null);
});
