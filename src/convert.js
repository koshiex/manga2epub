import { EpubBuilder } from './epub-builder.js';
import { XtcBuilder } from './xtc-builder.js';

const IN_FLIGHT_PER_WORKER = 3;
const DEFAULT_TITLE = 'manga';
const MAX_FILE_BASE_LENGTH = 150;
const FORBIDDEN_FILE_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

/** Output formats: file extension + builder with { addPage, finish, abort, pageCount, byteSize, maxPages }. */
const FORMATS = Object.freeze({
  epub: { extension: 'epub', create: (sink, meta) => EpubBuilder.create(sink, meta) },
  xtc: { extension: 'xtc', create: (sink, meta) => XtcBuilder.create(sink, meta, 'xtc') },
  xtch: { extension: 'xtch', create: (sink, meta) => XtcBuilder.create(sink, meta, 'xtch') },
});

export function volumeFileName(title, index, numbered, extension) {
  const base = title.trim().replace(FORBIDDEN_FILE_CHARS, '_').slice(0, MAX_FILE_BASE_LENGTH) || DEFAULT_TITLE;
  return numbered ? `${base} - ${String(index + 1).padStart(2, '0')}.${extension}` : `${base}.${extension}`;
}

const isoNow = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

/**
 * Sequence of output books. A new one starts when the next page would push the current one over the size limit
 * or past the page limit of the format.
 */
class VolumeSet {
  #meta;
  #createSink;
  #maxBytes;
  #format;
  #current = null;
  #finished = [];
  #finishedBytes = 0;
  #lastChapter = null;

  constructor({ meta, createSink, maxBytes, format }) {
    this.#meta = meta;
    this.#createSink = createSink;
    this.#maxBytes = maxBytes;
    this.#format = format;
  }

  get bytesWritten() {
    return this.#finishedBytes + (this.#current?.book.byteSize ?? 0);
  }

  async addPage(image, chapter) {
    if (chapter) this.#lastChapter = chapter;
    if (this.#current && this.#isFull(image)) await this.#closeCurrent();
    const isNewVolume = !this.#current;
    if (isNewVolume) this.#current = await this.#open();
    // A volume that starts mid-chapter repeats the chapter title so its TOC is not empty.
    await this.#current.book.addPage(image, chapter ?? (isNewVolume ? this.#lastChapter : null));
  }

  async finish() {
    if (this.#current) await this.#closeCurrent();
    if (this.#finished.length === 0) throw new Error('Ни одной страницы не удалось сконвертировать');
    return [...this.#finished];
  }

  async abort() {
    const current = this.#current;
    this.#current = null;
    await current?.book.abort();
  }

  #isFull(image) {
    const { book } = this.#current;
    if (book.pageCount >= book.maxPages) return true;
    return this.#maxBytes > 0 && book.pageCount > 0 && book.byteSize + image.bytes.length > this.#maxBytes;
  }

  async #open() {
    const index = this.#finished.length;
    // With a size limit every file is numbered upfront: the file name is needed before its content exists.
    const numbered = this.#maxBytes > 0 || index > 0;
    const name = volumeFileName(this.#meta.title, index, numbered, this.#format.extension);
    const title = numbered ? `${this.#meta.title}, том ${index + 1}` : this.#meta.title;
    const sink = await this.#createSink(name);
    try {
      const book = await this.#format.create(sink, {
        ...this.#meta,
        title,
        uid: `urn:uuid:${crypto.randomUUID()}`,
        modified: isoNow(),
      });
      return { name, book };
    } catch (err) {
      await sink.abort?.();
      throw err;
    }
  }

  async #closeCurrent() {
    const { name, book } = this.#current;
    await book.finish();
    this.#current = null;
    this.#finished.push({ name, pages: book.pageCount });
    this.#finishedBytes += book.byteSize;
  }
}

/**
 * Converts ordered pages into one or more books (options.format: 'epub' | 'xtc' | 'xtch').
 * pool.run({ source, opts }) → { images: [{ bytes, crc, mime, width, height }] } (usually a worker pool).
 * Up to pool.size × IN_FLIGHT_PER_WORKER pages are processed ahead; results are written strictly in order.
 * Broken pages are skipped with a warning; cancellation discards the unfinished volume.
 */
export async function convert({ pages, meta, options, createSink, pool, onProgress, onWarning, signal }) {
  const format = FORMATS[options.format ?? 'epub'];
  if (!format) throw new Error(`Неизвестный формат: ${options.format}`);
  const volumes = new VolumeSet({
    meta: { ...meta, title: meta.title?.trim() || DEFAULT_TITLE },
    createSink,
    maxBytes: options.volumeBytes,
    format,
  });
  const limit = Math.max(1, pool.size * IN_FLIGHT_PER_WORKER);
  const queue = [];
  let done = 0;

  const schedule = (page) => {
    const promise = pool.run({ source: page.source, opts: options.image });
    promise.catch(() => {}); // handled in settle(); avoids unhandled rejections after an abort
    queue.push({ page, promise });
  };

  const settle = async ({ page, promise }) => {
    try {
      return (await promise).images;
    } catch (err) {
      signal?.throwIfAborted();
      onWarning?.(`Пропущена ${page.path}: ${err.message}`);
      return [];
    }
  };

  const consume = async (task) => {
    const images = await settle(task);
    signal?.throwIfAborted();
    for (const [i, image] of images.entries()) await volumes.addPage(image, i === 0 ? task.page.chapter : null);
    done += 1;
    onProgress?.({ done, total: pages.length, bytes: volumes.bytesWritten });
  };

  try {
    for (const page of pages) {
      signal?.throwIfAborted();
      schedule(page);
      if (queue.length >= limit) await consume(queue.shift());
    }
    while (queue.length > 0) await consume(queue.shift());
    return await volumes.finish();
  } catch (err) {
    await volumes.abort().catch(() => {});
    throw err;
  }
}
