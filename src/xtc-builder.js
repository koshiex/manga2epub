import { XT_MAX_PAGES, xtcHead, xtcHeadSize } from './xt-format.js';

const FOLD_BYTES = 32 * 1024 * 1024;

/**
 * Builds an XTC/XTCH book. The header and page table precede the data and depend on the final page count,
 * so page data is collected in a Blob (the browser may keep it outside the JS heap) and written on finish.
 */
export class XtcBuilder {
  #sink;
  #meta;
  #format;
  #pages = [];
  #chapters = [];
  #data = new Blob([]);
  #pending = [];
  #pendingBytes = 0;
  #dataBytes = 0;

  constructor(sink, meta, format) {
    this.#sink = sink;
    this.#meta = meta;
    this.#format = format;
  }

  /** meta: { title, author, lang, rtl }; format: 'xtc' (1-bit pages) or 'xtch' (2-bit pages). */
  static async create(sink, meta, format) {
    return new XtcBuilder(sink, meta, format);
  }

  get pageCount() {
    return this.#pages.length;
  }

  get byteSize() {
    return xtcHeadSize(this.#pages.length, this.#chapters.length) + this.#dataBytes;
  }

  get maxPages() {
    return XT_MAX_PAGES;
  }

  /** image: { bytes (XTG/XTH page with header), width, height }; chapter: title or null. */
  async addPage(image, chapter = null) {
    if (this.#pages.length >= XT_MAX_PAGES) throw new Error(`В файл XTC помещается не больше ${XT_MAX_PAGES} страниц`);
    if (chapter) this.#chapters.push({ title: chapter, start: this.#pages.length });
    this.#pages.push({ size: image.bytes.length, width: image.width, height: image.height });
    this.#pending.push(image.bytes);
    this.#pendingBytes += image.bytes.length;
    this.#dataBytes += image.bytes.length;
    if (this.#pendingBytes >= FOLD_BYTES) this.#fold();
  }

  async finish() {
    if (this.#pages.length === 0) throw new Error('В книге нет ни одной страницы');
    this.#fold();
    await this.#sink.write(xtcHead({ format: this.#format, meta: this.#meta, pages: this.#pages, chapters: this.#chapters }));
    await this.#sink.write(this.#data);
    await this.#sink.close();
  }

  async abort() {
    this.#pending = [];
    this.#data = new Blob([]);
    await this.#sink.abort?.();
  }

  #fold() {
    this.#data = new Blob([this.#data, ...this.#pending]);
    this.#pending = [];
    this.#pendingBytes = 0;
  }
}
