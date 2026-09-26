import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { crc32 as zlibCrc32 } from 'node:zlib';
import { crc32 } from '../src/crc32.js';
import { text } from './helpers.js';

test('matches the standard CRC-32 check value', () => {
  assert.equal(crc32(text('123456789')), 0xcbf43926);
});

test('returns zero for empty input', () => {
  assert.equal(crc32(new Uint8Array()), 0);
});

test('matches zlib on random data', () => {
  const data = randomBytes(100_000);
  assert.equal(crc32(data), zlibCrc32(data));
});

test('supports incremental calculation', () => {
  const data = randomBytes(1000);
  const head = crc32(data.subarray(0, 300));
  assert.equal(crc32(data.subarray(300), head), crc32(data));
});
