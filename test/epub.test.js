import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EpubBuilder } from '../src/epub-builder.js';
import { memorySink, saveTemp } from './helpers.js';

const META = {
  uid: 'urn:uuid:00000000-0000-4000-8000-000000000000',
  title: 'Berserk <&> "1"',
  author: 'Miura',
  lang: 'ru',
  rtl: true,
  modified: '2026-09-26T00:00:00Z',
};
const XML_FILES = ['META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/nav.xhtml', 'OEBPS/toc.ncx', 'OEBPS/p00001.xhtml'];

const image = (width, height, mime = 'image/jpeg') => ({ bytes: Uint8Array.of(1, 2, 3), mime, width, height });

async function buildEpub(pages, overrides = {}) {
  const sink = memorySink();
  const epub = await EpubBuilder.create(sink, { ...META, ...overrides });
  for (const [img, chapter] of pages) await epub.addPage(img, chapter);
  await epub.finish();
  const path = saveTemp('book.epub', sink.bytes());
  const root = join(path, '..', 'x');
  execFileSync('unzip', ['-q', path, '-d', root]);
  const read = (name) => readFileSync(join(root, name), 'utf8');
  return { bytes: sink.bytes(), root, read };
}

test('starts with the uncompressed mimetype entry', async () => {
  const { bytes } = await buildEpub([[image(800, 1200)]]);
  assert.equal(bytes.readUInt16LE(8), 0);
  assert.equal(bytes.subarray(30, 58).toString(), 'mimetypeapplication/epub+zip');
});

test('produces well-formed XML documents', async () => {
  const { root } = await buildEpub([[image(800, 1200), 'Глава 1']]);
  for (const name of XML_FILES) {
    assert.doesNotThrow(() => execFileSync('xmllint', ['--noout', join(root, name)], { stdio: 'pipe' }), name);
  }
});

test('declares fixed layout, reading direction and cover image', async () => {
  const { read } = await buildEpub([[image(800, 1200)], [image(800, 1200)]]);
  const opf = read('OEBPS/content.opf');
  assert.match(opf, /<meta property="rendition:layout">pre-paginated<\/meta>/);
  assert.match(opf, /page-progression-direction="rtl"/);
  assert.match(opf, /id="i00001"[^>]*properties="cover-image"/);
  assert.equal(opf.match(/cover-image/g).length, 1);
  assert.match(opf, /<itemref idref="p00001"\/>\s*<itemref idref="p00002"\/>/);
});

test('uses left-to-right progression for comics', async () => {
  const { read } = await buildEpub([[image(800, 1200)]], { rtl: false });
  assert.match(read('OEBPS/content.opf'), /page-progression-direction="ltr"/);
});

test('escapes metadata in XML', async () => {
  const { read } = await buildEpub([[image(800, 1200)]]);
  assert.match(read('OEBPS/content.opf'), /Berserk &lt;&amp;&gt; &quot;1&quot;/);
});

test('lists chapters in navigation documents', async () => {
  const { read } = await buildEpub([
    [image(800, 1200), 'Глава 1'],
    [image(800, 1200)],
    [image(800, 1200), 'Глава 2'],
  ]);
  const nav = read('OEBPS/nav.xhtml');
  assert.match(nav, /<a href="p00001.xhtml">Глава 1<\/a>/);
  assert.match(nav, /<a href="p00003.xhtml">Глава 2<\/a>/);
  assert.equal(read('OEBPS/toc.ncx').match(/<navPoint /g).length, 2);
});

test('falls back to a single table of contents entry', async () => {
  const { read } = await buildEpub([[image(800, 1200)]]);
  assert.equal(read('OEBPS/toc.ncx').match(/<navPoint /g).length, 1);
});

test('sets page viewport to the image size', async () => {
  const { read } = await buildEpub([[image(800, 1200)]]);
  assert.match(read('OEBPS/p00001.xhtml'), /content="width=800, height=1200"/);
});

test('stores PNG pages with PNG extension and media type', async () => {
  const { read } = await buildEpub([[image(800, 1200, 'image/png')]]);
  assert.match(read('OEBPS/content.opf'), /href="img\/p00001.png" media-type="image\/png"/);
});

test('refuses to finish a book without pages', async () => {
  const epub = await EpubBuilder.create(memorySink(), META);
  await assert.rejects(epub.finish(), /страниц/);
});

test('reports page count and written size', async () => {
  const epub = await EpubBuilder.create(memorySink(), META);
  await epub.addPage(image(800, 1200));
  assert.equal(epub.pageCount, 1);
  assert.ok(epub.byteSize > 0);
});
