// UI end-to-end test: drives the real page (file input, selects, buttons) in headless Chrome.
// The folder picker is replaced with the origin-private file system (OPFS), so output files can be inspected.
// Usage: node test/browser/run-ui.js [--archives <folder with .zip/.cbz, searched recursively>]
//   --archives only reads the given archives; results stay in the throwaway browser profile.
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { consoleErrors, evaluate, navigate, waitFor, withChrome } from './cdp.js';

const SAMPLE = fileURLToPath(new URL('../fixtures/sample-manga.zip', import.meta.url));
const SAMPLE_PAGES_SPLIT = 4; // 3 images, one spread split in two
const CONVERSION_TIMEOUT_MS = 30 * 60 * 1000;
const ARCHIVE = /\.(zip|cbz)$/i;

const RESET_OUTPUT = `(async () => {
  const root = await navigator.storage.getDirectory();
  for await (const name of root.keys()) await root.removeEntry(name, { recursive: true });
  window.showDirectoryPicker = async () => root;
  return true;
})()`;

const LIST_OUTPUT = `(async () => {
  const root = await navigator.storage.getDirectory();
  const files = [];
  for await (const [name, handle] of root.entries()) {
    const file = await handle.getFile();
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    files.push({
      name,
      size: file.size,
      magic: new TextDecoder().decode(head.subarray(0, 4)).replace(/\\0/g, ''),
      pages: new DataView(head.buffer).getUint16(6, true),
    });
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
})()`;

const FINISHED_STATUS = `(() => {
  const text = document.getElementById('status').textContent;
  return /^(Готово|Ошибка|Отменено)/.test(text) ? text : null;
})()`;

function sampleCopies() {
  const dir = mkdtempSync(join(tmpdir(), 'manga2epub-ui-'));
  return ['Sample - Vol.01.zip', 'Sample - Vol.02.zip'].map((name) => {
    const path = join(dir, name);
    copyFileSync(SAMPLE, path);
    return path;
  });
}

function findArchives(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && ARCHIVE.test(entry.name))
    .map((entry) => resolve(entry.parentPath, entry.name))
    .sort();
}

async function setField(client, name, value) {
  await evaluate(
    client,
    `(() => {
      const input = document.getElementById('options').elements.namedItem(${JSON.stringify(name)});
      input.value = ${JSON.stringify(value)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`,
  );
}

/** Picks files through the real input and waits for the new summary (the old one is cleared first). */
async function selectArchives(client, files) {
  await evaluate(client, "document.getElementById('summary').textContent = '', true");
  const { result } = await client.send('Runtime.evaluate', { expression: "document.getElementById('pick-archive')" });
  await client.send('DOM.setFileInputFiles', { files, objectId: result.result.objectId });
  return waitFor(client, "document.getElementById('summary').textContent");
}

const summaryContains = (client, text) =>
  waitFor(client, `document.getElementById('summary').textContent.includes(${JSON.stringify(text)}) && document.getElementById('summary').textContent`);

async function convert(client) {
  await evaluate(client, RESET_OUTPUT);
  // The status of the previous run must not be mistaken for the result of this one.
  await evaluate(client, "document.getElementById('status').textContent = '', true");
  const startedAt = Date.now();
  await evaluate(client, "document.getElementById('start').click(), true");
  const status = await waitFor(client, FINISHED_STATUS, CONVERSION_TIMEOUT_MS);
  return { status, seconds: (Date.now() - startedAt) / 1000, files: await evaluate(client, LIST_OUTPUT) };
}

async function checkSeparateBooks(client) {
  await setField(client, 'batch', 'separate');
  assert.match(await selectArchives(client, sampleCopies()), /^Архивов: 2 → книг: 2/);
  const { status, files } = await convert(client);
  assert.match(status, /^Готово/, status);
  assert.deepEqual(files.map(({ name, magic, pages }) => ({ name, magic, pages })), [
    { name: 'Sample - Vol.01.xtc', magic: 'XTC', pages: SAMPLE_PAGES_SPLIT },
    { name: 'Sample - Vol.02.xtc', magic: 'XTC', pages: SAMPLE_PAGES_SPLIT },
  ]);
}

async function checkMergedBook(client) {
  await setField(client, 'batch', 'merge');
  await summaryContains(client, 'книг: 1');
  assert.equal(await evaluate(client, "document.getElementById('options').elements.namedItem('title').value"), 'Sample');
  const { status, files } = await convert(client);
  assert.match(status, /^Готово/, status);
  assert.deepEqual(files.map(({ name, pages }) => ({ name, pages })), [{ name: 'Sample.xtc', pages: SAMPLE_PAGES_SPLIT * 2 }]);
}

async function runRealArchives(client, dir) {
  const archives = findArchives(dir);
  assert.ok(archives.length > 0, `no .zip/.cbz in ${dir}`);
  await setField(client, 'batch', 'separate');
  console.log(await selectArchives(client, archives));
  const { status, seconds, files } = await convert(client);
  console.log(`\n${status}\n\nВремя: ${seconds.toFixed(1)} с`);
  console.table(files.map(({ name, size, pages }) => ({ name, pages, 'MB': (size / 1024 / 1024).toFixed(1) })));
  assert.match(status, /^Готово/, status);
  assert.doesNotMatch(status, /✗/, 'every archive must convert');
}

const { values } = parseArgs({ options: { archives: { type: 'string' } } });

await withChrome(async ({ client, baseUrl }) => {
  await navigate(client, `${baseUrl}/index.html`, "document.querySelector('select[name=device]')?.options.length > 0");
  await setField(client, 'format', 'xtc');
  await setField(client, 'device', 'xteink-x4');
  await setField(client, 'spreads', 'split');
  await checkSeparateBooks(client);
  await checkMergedBook(client);
  if (values.archives) await runRealArchives(client, values.archives);
  assert.deepEqual(consoleErrors(client), [], 'no console errors');
  console.log('browser UI: OK');
});
