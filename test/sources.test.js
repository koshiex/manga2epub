import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookTitle, buildBooks, buildPageList, commonTitle } from '../src/sources.js';

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

const archive = (title, paths) => ({ title, items: paths.map(item) });
const titles = (books) => books.map((book) => book.title);

test('bookTitle drops the file extension', () => {
  assert.equal(bookTitle('Berserk - Vol.01.cbz'), 'Berserk - Vol.01');
});

test('commonTitle cuts the shared prefix on a word boundary', () => {
  assert.equal(commonTitle(['Когда плачут чайки - Vol.01', 'Когда плачут чайки - Vol.02']), 'Когда плачут чайки');
});

test('commonTitle keeps a single name as is', () => {
  assert.equal(commonTitle(['Berserk - Vol.01']), 'Berserk - Vol.01');
});

test('commonTitle falls back to the first name when nothing is shared', () => {
  assert.equal(commonTitle(['Berserk', 'Naruto']), 'Berserk');
});

test('separate mode makes one book per archive in natural order', () => {
  const { books } = buildBooks([archive('B - Vol.10', ['01.jpg']), archive('B - Vol.2', ['01.jpg'])], 'separate');
  assert.deepEqual(titles(books), ['B - Vol.2', 'B - Vol.10']);
});

test('separate mode keeps chapters inside each archive', () => {
  const { books } = buildBooks([archive('Vol.01', ['Ch.1/01.jpg', 'Ch.2/01.jpg'])], 'separate');
  assert.deepEqual(chapters(books[0].pages), ['Ch.1', 'Ch.2']);
});

test('merge mode joins archives in order under a common title', () => {
  const { books } = buildBooks(
    [archive('Umineko - Vol.02', ['Ch.3/01.jpg', 'Ch.3/02.jpg']), archive('Umineko - Vol.01', ['Ch.1/01.jpg', 'Ch.2/01.jpg'])],
    'merge',
  );
  assert.deepEqual(titles(books), ['Umineko']);
  assert.deepEqual(paths(books[0].pages), ['Ch.1/01.jpg', 'Ch.2/01.jpg', 'Ch.3/01.jpg', 'Ch.3/02.jpg']);
  assert.deepEqual(chapters(books[0].pages), ['Ch.1', 'Ch.2', 'Ch.3', null]);
});

test('merge mode names chapters after flat archives', () => {
  const { books } = buildBooks([archive('Ch 1', ['01.jpg', '02.jpg']), archive('Ch 2', ['01.jpg'])], 'merge');
  assert.deepEqual(chapters(books[0].pages), ['Ch 1', null, 'Ch 2']);
});

test('buildBooks reports archives without pages', () => {
  const { books, empty } = buildBooks([archive('Vol.01', ['01.jpg']), archive('Extras', ['readme.txt'])], 'separate');
  assert.deepEqual(titles(books), ['Vol.01']);
  assert.deepEqual(empty, ['Extras']);
});
