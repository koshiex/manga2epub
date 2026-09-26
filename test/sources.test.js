import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPageList } from '../src/sources.js';

const item = (path) => ({ path, source: { id: path } });
const paths = (pages) => pages.map((page) => page.path);
const chapters = (pages) => pages.map((page) => page.chapter);

test('keeps only images and drops system junk', () => {
  const pages = buildPageList(
    ['a/01.jpg', 'a/readme.txt', '__MACOSX/a/._01.jpg', 'a/.hidden.png', 'a/Thumbs.db', 'a/02.PNG', 'a/03.webp', 'a/'].map(item),
  );
  assert.deepEqual(paths(pages), ['a/01.jpg', 'a/02.PNG', 'a/03.webp']);
});

test('sorts page numbers naturally', () => {
  assert.deepEqual(paths(buildPageList(['p10.jpg', 'p2.jpg', 'p1.jpg'].map(item))), ['p1.jpg', 'p2.jpg', 'p10.jpg']);
});

test('puts files before subfolders on the same level', () => {
  const pages = buildPageList(['vol/ch1/01.jpg', 'vol/cover.jpg', 'vol/ch2/01.jpg'].map(item));
  assert.deepEqual(paths(pages), ['vol/cover.jpg', 'vol/ch1/01.jpg', 'vol/ch2/01.jpg']);
});

test('creates no chapters when all pages share one folder', () => {
  const pages = buildPageList(['Title/01.jpg', 'Title/02.jpg'].map(item));
  assert.deepEqual(chapters(pages), [null, null]);
});

test('marks first page of every folder as chapter relative to common root', () => {
  const pages = buildPageList(
    ['Title/Vol 1/Ch 1/01.jpg', 'Title/Vol 1/Ch 1/02.jpg', 'Title/Vol 1/Ch 2/01.jpg', 'Title/Vol 2/Ch 3/01.jpg'].map(item),
  );
  assert.deepEqual(chapters(pages), ['Vol 1 / Ch 1', null, 'Vol 1 / Ch 2', 'Vol 2 / Ch 3']);
});

test('names pages above chapter folders as the beginning', () => {
  const pages = buildPageList(['cover.jpg', 'ch1/01.jpg'].map(item));
  assert.deepEqual(chapters(pages), ['Начало', 'ch1']);
});

test('keeps the source reference for each page', () => {
  const [page] = buildPageList([item('01.jpg')]);
  assert.deepEqual(page.source, { id: '01.jpg' });
});
