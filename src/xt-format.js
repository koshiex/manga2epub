/**
 * Xteink XTC/XTCH containers with XTG (1-bit) / XTH (2-bit) pages. All numbers are little-endian.
 * Layout follows the CrossPoint Reader firmware parser (lib/Xtc): 56-byte header, 256-byte metadata,
 * 96-byte chapter entries with 1-based pages, 16-byte page table entries, pages with a 22-byte header.
 */
export const XT_MAX_PAGES = 0xffff;

const MAGIC = Object.freeze({ xtc: 0x00435458, xtch: 0x48435458, xtg: 0x00475458, xth: 0x00485458 });
const PAGE_HEADER_SIZE = 22;
const CONTAINER_HEADER_SIZE = 56;
const METADATA_SIZE = 256;
const CHAPTER_SIZE = 96;
const PAGE_ENTRY_SIZE = 16;
const TITLE_SIZE = 128;
const AUTHOR_SIZE = 64;
const LANGUAGE_OFFSET = 0xe0;
const LANGUAGE_SIZE = 16;
const CREATED_OFFSET = 0xf0;
const COVER_OFFSET = 0xf4;
const CHAPTER_COUNT_OFFSET = 0xf6;
const CHAPTER_NAME_SIZE = 80;
const READ_LTR = 0;
const READ_RTL = 1;
const MAX_LUMINANCE = 255;
// Level index in luminance order (0 = black … 3 = white) → XTH value; Xteink LUT swaps the two grays.
const GRAY4_TO_XTH = [3, 1, 2, 0];

const DIFFUSION = Object.freeze({
  none: [],
  floyd: [
    [1, 0, 7 / 16],
    [-1, 1, 3 / 16],
    [0, 1, 5 / 16],
    [1, 1, 1 / 16],
  ],
  // Atkinson spreads only 3/4 of the error: keeps blacks deep and whites clean, good for line art.
  atkinson: [
    [1, 0, 1 / 8],
    [2, 0, 1 / 8],
    [-1, 1, 1 / 8],
    [0, 1, 1 / 8],
    [1, 1, 1 / 8],
    [0, 2, 1 / 8],
  ],
});

const encoder = new TextEncoder();

export const DITHER_METHODS = Object.freeze(Object.keys(DIFFUSION));

/** Quantizes 0..255 luminance to levelCount levels (0 = black) with optional error diffusion. */
export function ditherToLevels(luminance, width, height, levelCount, method) {
  const kernel = DIFFUSION[method];
  if (!kernel) throw new Error(`Неизвестный дизеринг: ${method}`);
  const work = Float32Array.from(luminance);
  const levels = new Uint8Array(width * height);
  const step = MAX_LUMINANCE / (levelCount - 1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const level = Math.min(levelCount - 1, Math.max(0, Math.round(work[i] / step)));
      levels[i] = level;
      const error = work[i] - level * step;
      if (error === 0) continue;
      for (const [dx, dy, weight] of kernel) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny < height) work[ny * width + nx] += error * weight;
      }
    }
  }
  return levels;
}

function pageWithHeader(magic, width, height, dataSize) {
  const page = new Uint8Array(PAGE_HEADER_SIZE + dataSize);
  const view = new DataView(page.buffer);
  view.setUint32(0, magic, true);
  view.setUint16(4, width, true);
  view.setUint16(6, height, true);
  view.setUint32(10, dataSize, true); // colorMode, compression and md5 stay 0
  return page;
}

/** levels: 0 = black, 1 = white. Row-major, MSB = leftmost pixel, bit 1 = white. */
export function encodeXtg(levels, width, height) {
  const stride = Math.ceil(width / 8);
  const page = pageWithHeader(MAGIC.xtg, width, height, stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (levels[y * width + x]) page[PAGE_HEADER_SIZE + y * stride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return page;
}

/** levels: 0 = black … 3 = white. Two bit planes, columns right to left, 8 vertical pixels per byte. */
export function encodeXth(levels, width, height) {
  const planeSize = Math.ceil((width * height) / 8);
  const page = pageWithHeader(MAGIC.xth, width, height, planeSize * 2);
  let bit = 0;
  for (let x = width - 1; x >= 0; x--) {
    for (let y = 0; y < height; y++, bit++) {
      const value = GRAY4_TO_XTH[levels[y * width + x]];
      const mask = 0x80 >> (bit & 7);
      const byte = PAGE_HEADER_SIZE + (bit >> 3);
      if (value & 2) page[byte] |= mask;
      if (value & 1) page[byte + planeSize] |= mask;
    }
  }
  return page;
}

/** Writes UTF-8 text truncated on a character boundary; the field always stays null-terminated. */
function writeText(bytes, offset, size, text) {
  const encoded = encoder.encode(text ?? '');
  let length = Math.min(encoded.length, size - 1);
  while (length > 0 && (encoded[length] & 0xc0) === 0x80) length--;
  bytes.set(encoded.subarray(0, length), offset);
}

function writeMetadata(bytes, view, { meta, chapters, createdAt }) {
  const base = CONTAINER_HEADER_SIZE;
  writeText(bytes, base, TITLE_SIZE, meta.title);
  writeText(bytes, base + TITLE_SIZE, AUTHOR_SIZE, meta.author);
  writeText(bytes, base + LANGUAGE_OFFSET, LANGUAGE_SIZE, meta.lang);
  view.setUint32(base + CREATED_OFFSET, createdAt, true);
  view.setUint16(base + COVER_OFFSET, 0, true);
  view.setUint16(base + CHAPTER_COUNT_OFFSET, chapters.length, true);
}

function writeChapters(bytes, view, offset, chapters, pageCount) {
  chapters.forEach((chapter, i) => {
    const entry = offset + i * CHAPTER_SIZE;
    const end = i + 1 < chapters.length ? chapters[i + 1].start - 1 : pageCount - 1;
    writeText(bytes, entry, CHAPTER_NAME_SIZE, chapter.title);
    view.setUint16(entry + CHAPTER_NAME_SIZE, chapter.start + 1, true);
    view.setUint16(entry + CHAPTER_NAME_SIZE + 2, end + 1, true);
  });
}

function writePageTable(view, offset, pages, dataOffset) {
  let position = dataOffset;
  pages.forEach((page, i) => {
    const entry = offset + i * PAGE_ENTRY_SIZE;
    view.setBigUint64(entry, BigInt(position), true);
    view.setUint32(entry + 8, page.size, true);
    view.setUint16(entry + 12, page.width, true);
    view.setUint16(entry + 14, page.height, true);
    position += page.size;
  });
}

export function xtcHeadSize(pageCount, chapterCount) {
  return CONTAINER_HEADER_SIZE + METADATA_SIZE + chapterCount * CHAPTER_SIZE + pageCount * PAGE_ENTRY_SIZE;
}

/**
 * Everything that precedes page data: header, metadata, chapters, page table.
 * pages: [{ size, width, height }] in order; chapters: [{ title, start }] with 0-based start page.
 */
export function xtcHead({ format, meta, pages, chapters, createdAt = Math.floor(Date.now() / 1000) }) {
  if (pages.length === 0 || pages.length > XT_MAX_PAGES) {
    throw new Error(`В файл XTC помещается от 1 до ${XT_MAX_PAGES} страниц, получено ${pages.length}`);
  }
  const chapterOffset = CONTAINER_HEADER_SIZE + METADATA_SIZE;
  const tableOffset = chapterOffset + chapters.length * CHAPTER_SIZE;
  const dataOffset = xtcHeadSize(pages.length, chapters.length);
  const bytes = new Uint8Array(dataOffset);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, format === 'xtch' ? MAGIC.xtch : MAGIC.xtc, true);
  bytes[4] = 1; // version 1.0
  view.setUint16(6, pages.length, true);
  bytes[8] = meta.rtl ? READ_RTL : READ_LTR;
  bytes[9] = 1; // has metadata
  bytes[11] = chapters.length > 0 ? 1 : 0;
  view.setBigUint64(0x10, BigInt(CONTAINER_HEADER_SIZE), true);
  view.setBigUint64(0x18, BigInt(tableOffset), true);
  view.setBigUint64(0x20, BigInt(dataOffset), true);
  view.setBigUint64(0x30, BigInt(chapters.length > 0 ? chapterOffset : 0), true);
  writeMetadata(bytes, view, { meta, chapters, createdAt });
  writeChapters(bytes, view, chapterOffset, chapters, pages.length);
  writePageTable(view, tableOffset, pages, dataOffset);
  return bytes;
}
