import {
  CONTAINER_XML,
  MIMETYPE,
  STYLE_CSS,
  navXhtml,
  packageOpf,
  pageXhtml,
  tocNcx,
} from './epub-templates.js';
import { ZipWriter } from './zip-writer.js';

const ID_DIGITS = 5;
const encoder = new TextEncoder();

/**
 * Streams a fixed-layout EPUB 3 (with EPUB 2 NCX for older readers): one image per page.
 * Pages are written as they arrive; package documents go last, so memory stays flat.
 */
export class EpubBuilder {
  #zip;
  #meta;
  #pages = [];
  #toc = [];

  constructor(zip, meta) {
    this.#zip = zip;
    this.#meta = meta;
  }

  /** meta: { uid, title, author, lang, rtl, modified } */
  static async create(sink, meta) {
    const zip = new ZipWriter(sink);
    await zip.add('mimetype', encoder.encode(MIMETYPE));
    await zip.add('META-INF/container.xml', encoder.encode(CONTAINER_XML));
    await zip.add('OEBPS/style.css', encoder.encode(STYLE_CSS));
    return new EpubBuilder(zip, meta);
  }

  get pageCount() {
    return this.#pages.length;
  }

  get byteSize() {
    return this.#zip.size;
  }

  get maxPages() {
    return Number.POSITIVE_INFINITY;
  }

  /** image: { bytes, crc?, mime, width, height }; chapter: TOC title for this page or null. */
  async addPage(image, chapter = null) {
    const number = this.#pages.length + 1;
    const id = String(number).padStart(ID_DIGITS, '0');
    const extension = image.mime === 'image/png' ? 'png' : 'jpg';
    const page = {
      id: `p${id}`,
      imageId: `i${id}`,
      xhtml: `p${id}.xhtml`,
      image: `img/p${id}.${extension}`,
      mime: image.mime,
      width: image.width,
      height: image.height,
    };
    await this.#zip.add(`OEBPS/${page.image}`, image.bytes, image.crc);
    await this.#zip.add(`OEBPS/${page.xhtml}`, encoder.encode(pageXhtml(page, number)));
    this.#pages.push(page);
    if (chapter) this.#toc.push({ title: chapter, href: page.xhtml });
  }

  async finish() {
    if (this.#pages.length === 0) throw new Error('В книге нет ни одной страницы');
    const toc = this.#toc.length > 0 ? this.#toc : [{ title: this.#meta.title, href: this.#pages[0].xhtml }];
    await this.#zip.add('OEBPS/content.opf', encoder.encode(packageOpf(this.#meta, this.#pages)));
    await this.#zip.add('OEBPS/nav.xhtml', encoder.encode(navXhtml(this.#meta, toc)));
    await this.#zip.add('OEBPS/toc.ncx', encoder.encode(tocNcx(this.#meta, toc)));
    await this.#zip.close();
  }

  async abort() {
    await this.#zip.abort();
  }
}
