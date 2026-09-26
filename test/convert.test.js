import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { convert, volumeFileName } from '../src/convert.js';
import { XT_MAX_PAGES } from '../src/xt-format.js';
import { entryData, listZipEntries } from '../src/zip-reader.js';
import { memorySink } from './helpers.js';

const META = { title: 'Berserk', author: '', lang: 'ru', rtl: true };
const PAGE_BYTES = 1000;

const page = (id, chapter = null, extra = {}) => ({ path: `${id}.jpg`, source: { id, ...extra }, chapter });

function fakePool({ delayOf = () => 0, failing = new Set(), pageBytes = PAGE_BYTES } = {}) {
  return {
    size: 2,
    run: async ({ source }) => {
      const delay = delayOf(source);
      if (delay > 0) await sleep(delay);
      if (failing.has(source.id)) throw new Error('broken image');
      return { images: [{ bytes: new Uint8Array(pageBytes).fill(source.id), mime: 'image/jpeg', width: 10, height: 20 }] };
    },
  };
}

function sinkFactory() {
  const sinks = new Map();
  const create = async (name) => {
    const sink = memorySink();
    sinks.set(name, sink);
    return sink;
  };
  return { sinks, create };
}

async function readBook(sink) {
  const blob = new Blob([sink.bytes()]);
  const entries = await listZipEntries(blob);
  const read = async (name) => new Uint8Array(await (await entryData(blob, entries.find((e) => e.name === name))).arrayBuffer());
  const images = entries.filter((e) => e.name.startsWith('OEBPS/img/'));
  return { images, read, text: async (name) => new TextDecoder().decode(await read(name)) };
}

function run(pages, { pool = fakePool(), volumeBytes = 0, format = 'epub', ...rest } = {}) {
  const { sinks, create } = sinkFactory();
  const result = convert({ pages, meta: META, options: { image: {}, volumeBytes, format }, createSink: create, pool, ...rest });
  return { sinks, result };
}

test('writes an XTC container when format is xtc', async () => {
  const { sinks, result } = run([page(1), page(2)], { format: 'xtc' });
  assert.deepEqual(await result, [{ name: 'Berserk.xtc', pages: 2 }]);
  assert.equal(sinks.get('Berserk.xtc').bytes().subarray(0, 4).toString('latin1'), 'XTC\0');
});

test('uses .xtch extension for grayscale Xteink books', async () => {
  const { result } = run([page(1)], { format: 'xtch' });
  assert.deepEqual(await result, [{ name: 'Berserk.xtch', pages: 1 }]);
});

test('starts a new file when the format page limit is reached', { timeout: 60_000 }, async () => {
  const pages = Array.from({ length: XT_MAX_PAGES + 1 }, (_, i) => page(i));
  const { result } = run(pages, { format: 'xtc', pool: fakePool({ pageBytes: 1 }) });
  assert.deepEqual(await result, [
    { name: 'Berserk.xtc', pages: XT_MAX_PAGES },
    { name: 'Berserk - 02.xtc', pages: 1 },
  ]);
});

test('keeps page order when workers finish out of order', async () => {
  const pages = [1, 2, 3, 4, 5].map((id) => page(id));
  const { sinks, result } = run(pages, { pool: fakePool({ delayOf: (source) => (6 - source.id) * 5 }) });
  await result;
  const book = await readBook(sinks.get('Berserk.epub'));
  const firstBytes = [];
  for (const entry of book.images) firstBytes.push((await book.read(entry.name))[0]);
  assert.deepEqual(firstBytes, [1, 2, 3, 4, 5]);
});

test('writes one unnumbered book when volume limit is off', async () => {
  const { sinks, result } = run([page(1), page(2)]);
  assert.deepEqual(await result, [{ name: 'Berserk.epub', pages: 2 }]);
  assert.deepEqual([...sinks.keys()], ['Berserk.epub']);
});

test('splits into numbered volumes by size limit', async () => {
  const pages = [1, 2, 3, 4, 5].map((id) => page(id));
  const { result } = run(pages, { volumeBytes: PAGE_BYTES * 3 });
  const volumes = await result;
  assert.ok(volumes.length > 1);
  assert.equal(
    volumes.reduce((sum, volume) => sum + volume.pages, 0),
    5,
  );
  volumes.forEach((volume, i) => assert.equal(volume.name, `Berserk - ${String(i + 1).padStart(2, '0')}.epub`));
});

test('repeats the current chapter at the start of the next volume', async () => {
  const pages = [page(1, 'Глава 1'), page(2), page(3)];
  const { sinks, result } = run(pages, { volumeBytes: PAGE_BYTES });
  const volumes = await result;
  assert.equal(volumes.length, 3);
  const nav = await (await readBook(sinks.get(volumes[2].name))).text('OEBPS/nav.xhtml');
  assert.match(nav, /Глава 1/);
});

test('numbers volume titles inside the book', async () => {
  const { sinks, result } = run([page(1), page(2)], { volumeBytes: PAGE_BYTES });
  const volumes = await result;
  const opf = await (await readBook(sinks.get(volumes[1].name))).text('OEBPS/content.opf');
  assert.match(opf, /<dc:title>Berserk, том 2<\/dc:title>/);
});

test('skips an unreadable page and reports a warning', async () => {
  const warnings = [];
  const { result } = run([page(1), page(2), page(3)], {
    pool: fakePool({ failing: new Set([2]) }),
    onWarning: (message) => warnings.push(message),
  });
  assert.deepEqual(await result, [{ name: 'Berserk.epub', pages: 2 }]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /2\.jpg/);
});

test('fails when no page could be converted', async () => {
  const { result } = run([page(1)], { pool: fakePool({ failing: new Set([1]) }), onWarning: () => {} });
  await assert.rejects(result, /Ни одной страницы/);
});

test('reports progress for every source page', async () => {
  const progress = [];
  const { result } = run([page(1), page(2)], { onProgress: ({ done, total }) => progress.push(`${done}/${total}`) });
  await result;
  assert.deepEqual(progress, ['1/2', '2/2']);
});

test('aborts and discards output when cancelled', async () => {
  const controller = new AbortController();
  const pages = [1, 2, 3, 4, 5, 6, 7, 8].map((id) => page(id));
  const { sinks, result } = run(pages, {
    pool: fakePool({ delayOf: () => 5 }),
    signal: controller.signal,
    onProgress: () => controller.abort(),
  });
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(sinks.get('Berserk.epub').aborted, true);
});

test('volumeFileName replaces characters forbidden in file names', () => {
  assert.equal(volumeFileName('a/b:c?', 0, false, 'epub'), 'a_b_c_.epub');
});

test('volumeFileName falls back to a default title', () => {
  assert.equal(volumeFileName('   ', 1, true, 'xtc'), 'manga - 02.xtc');
});
