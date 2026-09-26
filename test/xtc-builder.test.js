import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XT_MAX_PAGES, encodeXtg } from '../src/xt-format.js';
import { XtcBuilder } from '../src/xtc-builder.js';
import { memorySink } from './helpers.js';

const META = { title: 'Berserk', author: '', lang: 'ru', rtl: true };
const PAGE_SIZE = 22 + 2 * 8;

const page = () => ({ bytes: encodeXtg(new Uint8Array(16 * 8).fill(1), 16, 8), mime: 'application/x-xtg', width: 16, height: 8 });

async function build(pages, format = 'xtc') {
  const sink = memorySink();
  const book = await XtcBuilder.create(sink, META, format);
  for (const [image, chapter] of pages) await book.addPage(image, chapter);
  await book.finish();
  return { bytes: sink.bytes(), sink };
}

test('page table points at every page header', async () => {
  const { bytes } = await build([[page(), 'Ch 1'], [page()]]);
  const table = Number(bytes.readBigUInt64LE(0x18));
  for (let i = 0; i < 2; i++) {
    const offset = Number(bytes.readBigUInt64LE(table + i * 16));
    assert.equal(bytes.subarray(offset, offset + 4).toString('latin1'), 'XTG\0');
  }
  assert.equal(bytes.length, Number(bytes.readBigUInt64LE(0x20)) + 2 * PAGE_SIZE);
});

test('writes chapters passed with pages', async () => {
  const { bytes } = await build([[page(), 'Ch 1'], [page()], [page(), 'Ch 2']]);
  assert.equal(bytes[11], 1);
  assert.equal(bytes.readUInt16LE(56 + 0xf6), 2);
});

test('uses XTCH container for grayscale pages', async () => {
  const { bytes } = await build([[page()]], 'xtch');
  assert.equal(bytes.subarray(0, 4).toString('latin1'), 'XTCH');
});

test('closes the sink', async () => {
  const { sink } = await build([[page()]]);
  assert.equal(sink.closed, true);
});

test('refuses to finish without pages', async () => {
  const book = await XtcBuilder.create(memorySink(), META, 'xtc');
  await assert.rejects(book.finish(), /страниц/);
});

test('reports page count, size and page limit', async () => {
  const book = await XtcBuilder.create(memorySink(), META, 'xtc');
  await book.addPage(page());
  assert.equal(book.pageCount, 1);
  assert.ok(book.byteSize >= PAGE_SIZE);
  assert.equal(book.maxPages, XT_MAX_PAGES);
});

test('abort discards the output', async () => {
  const sink = memorySink();
  const book = await XtcBuilder.create(sink, META, 'xtc');
  await book.addPage(page());
  await book.abort();
  assert.equal(sink.aborted, true);
});
