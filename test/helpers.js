import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { crc32 as zlibCrc32, deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const text = (value) => new TextEncoder().encode(value);

export function tempDir() {
  return mkdtempSync(join(tmpdir(), 'manga2epub-'));
}

export function memorySink() {
  const chunks = [];
  let closed = false;
  let aborted = false;
  return {
    write: async (chunk) => {
      chunks.push(chunk instanceof Blob ? new Uint8Array(await chunk.arrayBuffer()) : Uint8Array.from(chunk));
    },
    close: async () => {
      closed = true;
    },
    abort: async () => {
      aborted = true;
    },
    get closed() {
      return closed;
    },
    get aborted() {
      return aborted;
    },
    bytes: () => Buffer.concat(chunks),
  };
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlibCrc32(body));
  return Buffer.concat([length, body, crc]);
}

const PNG_GRAYSCALE = 0;
const PNG_RGB = 2;

function encodePng(width, height, colorType, row) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = colorType;
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function makePng(width, height, value = 128) {
  const row = Buffer.alloc(width + 1, value);
  row[0] = 0; // filter: none
  return encodePng(width, height, PNG_GRAYSCALE, row);
}

/** colorAt(x) → [r, g, b]; every row is identical. */
export function makeRgbPng(width, height, colorAt) {
  const row = Buffer.alloc(width * 3 + 1);
  for (let x = 0; x < width; x++) row.set(colorAt(x), 1 + x * 3);
  return encodePng(width, height, PNG_RGB, row);
}

/** Real encoder output (macOS sips): JFIF + Exif segments before the frame header. */
export function fixtureJpeg40x25() {
  return readFileSync(new URL('./fixtures/page-40x25.jpg', import.meta.url));
}

/** Builds an archive with Info-ZIP so the reader is checked against a real third-party writer. */
export function systemZip(files, flags = []) {
  const dir = tempDir();
  const sourceDir = join(dir, 'src');
  for (const [name, data] of Object.entries(files)) {
    const path = join(sourceDir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
  }
  const archive = join(dir, 'archive.zip');
  execFileSync('zip', ['-q', '-r', ...flags, archive, '.'], { cwd: sourceDir });
  return archive;
}

export function saveTemp(name, bytes) {
  const path = join(tempDir(), name);
  writeFileSync(path, bytes);
  return path;
}
