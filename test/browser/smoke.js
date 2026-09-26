// Runs inside a real browser: real workers, OffscreenCanvas, DecompressionStream. Driven by run-smoke.js.
import { convert } from '../../src/convert.js';
import { WorkerPool } from '../../src/pool.js';
import { buildPageList } from '../../src/sources.js';
import { entryData, listZipEntries } from '../../src/zip-reader.js';

const APP_INIT_DELAY_MS = 500;

function memorySink() {
  const chunks = [];
  return {
    write: async (chunk) => {
      chunks.push(chunk);
    },
    close: async () => {},
    abort: async () => {},
    blob: () => new Blob(chunks),
  };
}

async function centerPixel(blob) {
  const bitmap = await createImageBitmap(blob);
  const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  const [r, g, b] = ctx.getImageData(bitmap.width >> 1, bitmap.height >> 1, 1, 1).data;
  return { width: bitmap.width, height: bitmap.height, rgb: [r, g, b] };
}

async function describeBook(blob) {
  const entries = await listZipEntries(blob);
  const images = [];
  for (const entry of entries.filter((item) => item.name.startsWith('OEBPS/img/'))) {
    images.push({ name: entry.name, ...(await centerPixel(await entryData(blob, entry))) });
  }
  const nav = await (await entryData(blob, entries.find((item) => item.name === 'OEBPS/nav.xhtml'))).text();
  const chapters = [...nav.matchAll(/<a href="[^"]+">([^<]+)<\/a>/g)].map((match) => match[1]);
  return { first: entries[0].name, images, chapters };
}

const XTG_ROW_BYTES = 480 / 8;
const readText = (bytes) => new TextDecoder().decode(bytes).replace(/\0+$/, '');

/** Parses the XTC container the way the reader firmware does: header → page table → page headers. */
async function describeXtc(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const pageCount = view.getUint16(6, true);
  const table = Number(view.getBigUint64(0x18, true));
  const pages = Array.from({ length: pageCount }, (_, i) => {
    const entry = table + i * 16;
    const offset = Number(view.getBigUint64(entry, true));
    return {
      offset,
      size: view.getUint32(entry + 8, true),
      width: view.getUint16(entry + 12, true),
      height: view.getUint16(entry + 14, true),
      magic: readText(bytes.subarray(offset, offset + 4)),
    };
  });
  const chapterOffset = Number(view.getBigUint64(0x30, true));
  const chapters = Array.from({ length: view.getUint16(56 + 0xf6, true) }, (_, i) => {
    const entry = chapterOffset + i * 96;
    return readText(bytes.subarray(entry, entry + 80));
  });
  const first = pages[0];
  const row = (y) => bytes.subarray(first.offset + 22 + y * XTG_ROW_BYTES, first.offset + 22 + (y + 1) * XTG_ROW_BYTES);
  return {
    magic: readText(bytes.subarray(0, 4)),
    direction: bytes[8],
    title: readText(bytes.subarray(0x38, 0x38 + 128)),
    chapters,
    pages: pages.map(({ offset, ...page }) => page),
    // Only meaningful for 1-bit pages: row-major, bit 1 = white.
    topRowWhite: first.magic === 'XTG' ? row(0).every((byte) => byte === 0xff) : null,
    middleRowInked: first.magic === 'XTG' ? row(400).some((byte) => byte !== 0xff) : null,
  };
}

async function runXtc(image, format) {
  const { volumes, warnings, blob } = await convertSample(image, format);
  return { volumes, warnings, book: await describeXtc(blob) };
}

async function runConversion(image) {
  const { volumes, warnings, blob } = await convertSample(image, 'epub');
  return { volumes, warnings, book: await describeBook(blob) };
}

async function convertSample(image, format) {
  const response = await fetch('../fixtures/sample-manga.zip');
  const file = new File([await response.blob()], 'sample-manga.zip');
  const entries = await listZipEntries(file);
  const pages = buildPageList(
    entries.filter((entry) => !entry.name.endsWith('/')).map((entry) => ({ path: entry.name, source: { file, entry } })),
  );
  const pool = new WorkerPool(new URL('../../src/worker.js', import.meta.url), 2);
  const sinks = [];
  const warnings = [];
  try {
    const volumes = await convert({
      pages,
      meta: { title: 'Smoke', author: '', lang: 'ru', rtl: true },
      options: { image, volumeBytes: 0, format },
      createSink: async () => {
        const sink = memorySink();
        sinks.push(sink);
        return sink;
      },
      pool,
      onWarning: (message) => warnings.push(message),
    });
    return { volumes, warnings, blob: sinks[0].blob() };
  } finally {
    pool.terminate();
  }
}

async function appDeviceOptions() {
  const frame = Object.assign(document.createElement('iframe'), { src: '../../index.html' });
  const loaded = new Promise((resolve) => {
    frame.onload = resolve;
  });
  document.body.append(frame);
  await loaded;
  await new Promise((resolve) => setTimeout(resolve, APP_INIT_DELAY_MS));
  return frame.contentDocument.querySelector('select[name=device]').options.length;
}

const XTEINK_X4 = { maxWidth: 480, maxHeight: 800 };

window.runSmoke = async () => ({
  processed: await runConversion({ process: true, maxWidth: 400, maxHeight: 600, grayscale: true, quality: 0.85, spreads: 'split', rtl: true }),
  passthrough: await runConversion({ process: false, maxWidth: 0, maxHeight: 0, grayscale: false, quality: 0.85, spreads: 'keep', rtl: true }),
  xtc: await runXtc({ target: 'xtg', process: true, ...XTEINK_X4, dither: 'floyd', spreads: 'split', rtl: true }, 'xtc'),
  xtch: await runXtc({ target: 'xth', process: true, ...XTEINK_X4, dither: 'atkinson', spreads: 'split', rtl: true }, 'xtch'),
  deviceOptions: await appDeviceOptions(),
});
