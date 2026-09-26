import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XT_MAX_PAGES, ditherToLevels, encodeXtg, encodeXth, xtcHead } from '../src/xt-format.js';

const HEADER = 56;
const METADATA = 56;
const CHAPTERS = 312;
const META = { title: 'Berserk', author: 'Miura', lang: 'ru', rtl: true };
const CREATED_AT = 1_700_000_000;
const PAGES = [
  { size: 100, width: 480, height: 800 },
  { size: 200, width: 480, height: 800 },
];

const flat = (value, width, height) => new Float32Array(width * height).fill(value);
const magic = (bytes) => bytes.subarray(0, 4).toString('latin1');

function cString(bytes, offset, length) {
  const field = bytes.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return new TextDecoder('utf-8', { fatal: true }).decode(field.subarray(0, end < 0 ? length : end));
}

const head = (overrides = {}) =>
  Buffer.from(xtcHead({ format: 'xtc', meta: META, pages: PAGES, chapters: [], createdAt: CREATED_AT, ...overrides }));

test('encodeXtg writes header and row-major MSB-first bits where 1 is white', () => {
  const levels = new Uint8Array(20).fill(1);
  levels[0] = 0;
  const page = Buffer.from(encodeXtg(levels, 10, 2));
  assert.equal(magic(page), 'XTG\0');
  assert.deepEqual([page.readUInt16LE(4), page.readUInt16LE(6), page[8], page[9]], [10, 2, 0, 0]);
  assert.equal(page.readUInt32LE(10), 4);
  assert.deepEqual([...page.subarray(22)], [0x7f, 0xc0, 0xff, 0xc0]);
});

test('encodeXth writes two column-major planes, columns right to left', () => {
  const levels = new Uint8Array(16).fill(3); // 2×8, all white
  levels[0] = 0; // x=0 y=0 black
  levels[2] = 1; // x=0 y=1 dark gray
  levels[4] = 2; // x=0 y=2 light gray
  const page = Buffer.from(encodeXth(levels, 2, 8));
  assert.equal(magic(page), 'XTH\0');
  assert.equal(page.readUInt32LE(10), 4);
  assert.deepEqual([...page.subarray(22)], [0x00, 0xa0, 0x00, 0xc0]);
});

test('ditherToLevels without dithering thresholds to black and white', () => {
  assert.deepEqual([...ditherToLevels(Float32Array.of(0, 100, 200, 255), 4, 1, 2, 'none')], [0, 0, 1, 1]);
});

test('ditherToLevels picks the nearest of four grays', () => {
  assert.deepEqual([...ditherToLevels(Float32Array.of(0, 100, 200, 255), 4, 1, 4, 'none')], [0, 1, 2, 3]);
});

for (const method of ['floyd', 'atkinson']) {
  test(`${method} keeps pure black and pure white clean`, () => {
    assert.ok(ditherToLevels(flat(0, 16, 16), 16, 16, 2, method).every((level) => level === 0));
    assert.ok(ditherToLevels(flat(255, 16, 16), 16, 16, 2, method).every((level) => level === 1));
  });

  test(`${method} renders mid gray as a mix of black and white`, () => {
    const levels = ditherToLevels(flat(128, 32, 32), 32, 32, 2, method);
    const whiteShare = levels.filter((level) => level === 1).length / levels.length;
    assert.ok(whiteShare > 0.3 && whiteShare < 0.7, `white share ${whiteShare}`);
  });
}

test('ditherToLevels does not modify the input', () => {
  const luminance = flat(128, 8, 8);
  ditherToLevels(luminance, 8, 8, 2, 'floyd');
  assert.ok(luminance.every((value) => value === 128));
});

test('xtcHead writes the container header', () => {
  const bytes = head({ chapters: [{ title: 'Глава 1', start: 0 }] });
  assert.equal(magic(bytes), 'XTC\0');
  assert.deepEqual([bytes[4], bytes[5]], [1, 0], 'version 1.0');
  assert.equal(bytes.readUInt16LE(6), 2);
  assert.deepEqual([bytes[8], bytes[9], bytes[10], bytes[11]], [1, 1, 0, 1], 'rtl, metadata, no thumbnails, chapters');
  assert.equal(bytes.readUInt32LE(12), 0);
  assert.equal(bytes.readBigUInt64LE(0x10), BigInt(METADATA));
  assert.equal(bytes.readBigUInt64LE(0x18), BigInt(CHAPTERS + 96));
  assert.equal(bytes.readBigUInt64LE(0x20), BigInt(CHAPTERS + 96 + 32));
  assert.equal(bytes.readBigUInt64LE(0x28), 0n);
  assert.equal(bytes.readBigUInt64LE(0x30), BigInt(CHAPTERS));
  assert.equal(bytes.length, CHAPTERS + 96 + 32);
});

test('xtcHead writes metadata where the firmware reads it', () => {
  const bytes = head({ chapters: [{ title: 'Глава 1', start: 0 }] });
  assert.equal(cString(bytes, 0x38, 128), 'Berserk');
  assert.equal(cString(bytes, 0xb8, 64), 'Miura');
  assert.equal(cString(bytes, METADATA + 0xe0, 16), 'ru');
  assert.equal(bytes.readUInt32LE(METADATA + 0xf0), CREATED_AT);
  assert.equal(bytes.readUInt16LE(METADATA + 0xf4), 0, 'cover is the first page');
  assert.equal(bytes.readUInt16LE(METADATA + 0xf6), 1);
});

test('xtcHead writes chapters with 1-based inclusive page range', () => {
  const pages = [...PAGES, ...PAGES];
  const bytes = head({ pages, chapters: [{ title: 'Глава 1', start: 0 }, { title: 'Глава 2', start: 2 }] });
  assert.equal(cString(bytes, CHAPTERS, 80), 'Глава 1');
  assert.deepEqual([bytes.readUInt16LE(CHAPTERS + 80), bytes.readUInt16LE(CHAPTERS + 82)], [1, 2]);
  assert.equal(cString(bytes, CHAPTERS + 96, 80), 'Глава 2');
  assert.deepEqual([bytes.readUInt16LE(CHAPTERS + 96 + 80), bytes.readUInt16LE(CHAPTERS + 96 + 82)], [3, 4]);
});

test('xtcHead writes page table with absolute offsets', () => {
  const bytes = head();
  const table = Number(bytes.readBigUInt64LE(0x18));
  const data = bytes.readBigUInt64LE(0x20);
  assert.equal(bytes.readBigUInt64LE(table), data);
  assert.deepEqual([bytes.readUInt32LE(table + 8), bytes.readUInt16LE(table + 12), bytes.readUInt16LE(table + 14)], [100, 480, 800]);
  assert.equal(bytes.readBigUInt64LE(table + 16), data + 100n);
  assert.equal(bytes.readUInt32LE(table + 24), 200);
});

test('xtcHead without chapters puts page table right after metadata', () => {
  const bytes = head();
  assert.equal(bytes[11], 0);
  assert.equal(bytes.readBigUInt64LE(0x30), 0n);
  assert.equal(bytes.readBigUInt64LE(0x18), BigInt(CHAPTERS));
  assert.equal(bytes.readUInt16LE(METADATA + 0xf6), 0);
});

test('xtcHead uses XTCH magic for grayscale books', () => {
  assert.equal(magic(head({ format: 'xtch' })), 'XTCH');
});

test('xtcHead marks left-to-right books', () => {
  assert.equal(head({ meta: { ...META, rtl: false } })[8], 0);
});

test('xtcHead truncates long UTF-8 text on a character boundary', () => {
  const bytes = head({ meta: { ...META, title: 'Я'.repeat(100) } });
  const title = cString(bytes, 0x38, 128);
  assert.equal(title, 'Я'.repeat(63));
  assert.equal(bytes[0x38 + 127], 0, 'field stays null-terminated');
});

test('xtcHead rejects more pages than the format can index', () => {
  const pages = Array.from({ length: XT_MAX_PAGES + 1 }, () => PAGES[0]);
  assert.throws(() => head({ pages }), /страниц/);
});
