import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { openAsBlob } from 'node:fs';
import { ZipWriter } from '../src/zip-writer.js';
import { decodeName, entryData, listZipEntries } from '../src/zip-reader.js';
import { memorySink, saveTemp, systemZip, text } from './helpers.js';

const ZIP64_ENTRY_COUNT = 70_000;

async function writeZip(files) {
  const sink = memorySink();
  const zip = new ZipWriter(sink);
  for (const [name, data] of files) await zip.add(name, data);
  await zip.close();
  return sink;
}

async function readEntry(blob, entry) {
  return Buffer.from(await (await entryData(blob, entry)).arrayBuffer());
}

test('ZipWriter output passes unzip integrity check', async () => {
  const sink = await writeZip([
    ['mimetype', text('application/epub+zip')],
    ['OEBPS/a.txt', text('hello')],
  ]);
  const path = saveTemp('out.zip', sink.bytes());
  assert.doesNotThrow(() => execFileSync('unzip', ['-tq', path]));
});

test('ZipWriter stores first entry uncompressed without extra field', async () => {
  const bytes = (await writeZip([['mimetype', text('application/epub+zip')]])).bytes();
  assert.equal(bytes.readUInt16LE(8), 0, 'method must be store');
  assert.equal(bytes.readUInt16LE(28), 0, 'extra field must be empty');
  assert.equal(bytes.subarray(30, 58).toString(), 'mimetypeapplication/epub+zip');
});

test('ZipWriter closes the sink', async () => {
  const sink = await writeZip([['a', text('a')]]);
  assert.equal(sink.closed, true);
});

test('round-trips entries through the reader', async () => {
  const payload = randomBytes(5000);
  const sink = await writeZip([
    ['a.txt', text('hello')],
    ['dir/b.bin', payload],
  ]);
  const blob = new Blob([sink.bytes()]);
  const entries = await listZipEntries(blob);
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ['a.txt', 'dir/b.bin'],
  );
  assert.deepEqual(await readEntry(blob, entries[1]), payload);
});

test('switches to ZIP64 when entry count exceeds 65535', { timeout: 60_000 }, async () => {
  const files = Array.from({ length: ZIP64_ENTRY_COUNT }, (_, i) => [`f${i}`, Uint8Array.of(i & 0xff)]);
  const sink = await writeZip(files);
  const path = saveTemp('many.zip', sink.bytes());
  assert.doesNotThrow(() => execFileSync('unzip', ['-tq', path]));
  const entries = await listZipEntries(new Blob([sink.bytes()]));
  assert.equal(entries.length, ZIP64_ENTRY_COUNT);
});

test('reads stored and deflated entries from an Info-ZIP archive', async () => {
  const repeated = 'a'.repeat(5000);
  const random = randomBytes(300);
  const blob = await openAsBlob(systemZip({ 'ch1/a.txt': repeated, 'b.bin': random }, ['-9']));
  const entries = await listZipEntries(blob);
  const a = entries.find((entry) => entry.name === 'ch1/a.txt');
  const b = entries.find((entry) => entry.name === 'b.bin');
  assert.equal(a.method, 8);
  assert.equal((await readEntry(blob, a)).toString(), repeated);
  assert.deepEqual(await readEntry(blob, b), random);
});

test('reads an Info-ZIP archive with forced ZIP64 fields', async () => {
  const random = randomBytes(1000);
  const blob = await openAsBlob(systemZip({ 'x/page.bin': random }, ['-fz', '-0']));
  const entry = (await listZipEntries(blob)).find((item) => item.name === 'x/page.bin');
  assert.equal(entry.size, 1000);
  assert.deepEqual(await readEntry(blob, entry), random);
});

test('rejects a file that is not a ZIP', async () => {
  await assert.rejects(listZipEntries(new Blob([randomBytes(100)])), /ZIP/);
});

test('rejects unsupported compression methods', async () => {
  const blob = new Blob([(await writeZip([['a', text('a')]])).bytes()]);
  const [entry] = await listZipEntries(blob);
  await assert.rejects(entryData(blob, { ...entry, method: 12 }), /не поддерживается/);
});

test('rejects encrypted entries', async () => {
  const blob = new Blob([(await writeZip([['a', text('a')]])).bytes()]);
  const [entry] = await listZipEntries(blob);
  await assert.rejects(entryData(blob, { ...entry, encrypted: true }), /Зашифрован/);
});

test('decodeName honours the UTF-8 flag', () => {
  assert.equal(decodeName(text('Глава 1/01.jpg'), 0x0800), 'Глава 1/01.jpg');
});

test('decodeName falls back to Shift_JIS for Japanese names', () => {
  assert.equal(decodeName(Uint8Array.of(0x91, 0xe6, 0x31, 0x98, 0x62), 0), '第1話');
});

test('decodeName falls back to CP866 for Russian Windows names', () => {
  assert.equal(decodeName(Uint8Array.of(0x83, 0xab, 0xa0, 0xa2, 0xa0), 0), 'Глава');
});
