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
