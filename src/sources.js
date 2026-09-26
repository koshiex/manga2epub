const IMAGE_EXTENSION = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;
const JUNK_SEGMENT = /^(__MACOSX|\..*|thumbs\.db)$/i;
const ROOT_CHAPTER_TITLE = 'Начало';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const segmentsOf = (path) => path.split('/').filter(Boolean);

function isPage(path) {
  return IMAGE_EXTENSION.test(path) && !segmentsOf(path).some((segment) => JUNK_SEGMENT.test(segment));
}

/** Natural order by path segments; on the same level files go before subfolders. */
function comparePaths(a, b) {
  const left = segmentsOf(a);
  const right = segmentsOf(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const leftIsFile = i === left.length - 1;
    const rightIsFile = i === right.length - 1;
    if (leftIsFile !== rightIsFile) return leftIsFile ? -1 : 1;
    const order = collator.compare(left[i], right[i]);
    if (order !== 0) return order;
  }
  return left.length - right.length;
}

function commonPrefixLength(dirs) {
  const [first, ...rest] = dirs;
  let length = first.length;
  for (const dir of rest) {
    let i = 0;
    while (i < length && i < dir.length && dir[i] === first[i]) i++;
    length = i;
  }
  return length;
}

/**
 * Turns raw archive/folder items ({ path, source }) into ordered pages ({ path, source, chapter }).
 * Every folder becomes a chapter when pages live in more than one folder.
 */
export function buildPageList(items) {
  const sorted = items.filter((item) => isPage(item.path)).sort((a, b) => comparePaths(a.path, b.path));
  const dirs = sorted.map((item) => segmentsOf(item.path).slice(0, -1));
  const hasChapters = new Set(dirs.map((dir) => dir.join('/'))).size > 1;
  const prefix = hasChapters ? commonPrefixLength(dirs) : 0;

  return sorted.map((item, i) => {
    const dir = dirs[i].join('/');
    const isChapterStart = hasChapters && (i === 0 || dir !== dirs[i - 1].join('/'));
    const title = dirs[i].slice(prefix).join(' / ') || ROOT_CHAPTER_TITLE;
    return { path: item.path, source: item.source, chapter: isChapterStart ? title : null };
  });
}

const TRAILING_SEPARATORS = /[\s\-–—_.,:]+$/u;
const LAST_WORD = /\s\S*$/u;

export const bookTitle = (fileName) => fileName.replace(/\.[^.]+$/, '');

/** Shared beginning of the names, cut on a word boundary: "X - Vol.01", "X - Vol.02" → "X". */
export function commonTitle(names) {
  const [first = '', ...rest] = names;
  let length = first.length;
  for (const name of rest) {
    let i = 0;
    while (i < length && name[i] === first[i]) i++;
    length = i;
  }
  if (length === first.length) return first;
  const shared = first.slice(0, length);
  const boundary = shared.search(LAST_WORD);
  return (boundary >= 0 ? shared.slice(0, boundary) : '').replace(TRAILING_SEPARATORS, '') || first;
}

/** In a merged book an archive without inner folders still starts its own chapter. */
function withChapterStart(book) {
  if (book.pages.some((page) => page.chapter)) return book.pages;
  const title = segmentsOf(book.pages[0].path).slice(0, -1).at(-1) ?? book.title;
  return book.pages.map((page, i) => (i === 0 ? { ...page, chapter: title } : page));
}

/**
 * archives: [{ title, items }] → { books: [{ title, pages }], empty: [titles without pages] }.
 * mode 'separate': one book per archive; 'merge': one book, archives in natural order become chapters.
 */
export function buildBooks(archives, mode) {
  const all = [...archives]
    .sort((a, b) => collator.compare(a.title, b.title))
    .map((archive) => ({ title: archive.title, pages: buildPageList(archive.items) }));
  const books = all.filter((book) => book.pages.length > 0);
  const empty = all.filter((book) => book.pages.length === 0).map((book) => book.title);
  if (mode !== 'merge' || books.length <= 1) return { books, empty };
  const merged = { title: commonTitle(books.map((book) => book.title)), pages: books.flatMap(withChapterStart) };
  return { books: [merged], empty };
}
