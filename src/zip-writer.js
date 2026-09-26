import { crc32 } from './crc32.js';
import {
  CENTRAL_HEADER_SIZE,
  EOCD_SIZE,
  LOCAL_HEADER_SIZE,
  METHOD_STORE,
  SIG,
  U16_MAX,
  U32_MAX,
  ZIP64_EOCD_SIZE,
  ZIP64_EXTRA_ID,
  ZIP64_LOCATOR_SIZE,
  view,
} from './zip-format.js';

const VERSION = 20;
const VERSION_ZIP64 = 45;
const ZIP64_OFFSET_EXTRA_SIZE = 12;
const ZIP64_RECORD_REMAINDER = ZIP64_EOCD_SIZE - 12;

const encoder = new TextEncoder();

function dosDateTime(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function writeCommonFields(dv, pos, entry, stamp) {
  dv.setUint16(pos, 0, true); // flags: names are ASCII, sizes known upfront
  dv.setUint16(pos + 2, METHOD_STORE, true);
  dv.setUint16(pos + 4, stamp.time, true);
  dv.setUint16(pos + 6, stamp.date, true);
  dv.setUint32(pos + 8, entry.crc, true);
  dv.setUint32(pos + 12, entry.size, true);
  dv.setUint32(pos + 16, entry.size, true);
  dv.setUint16(pos + 20, entry.name.length, true);
}

function localHeader(entry, stamp) {
  const bytes = new Uint8Array(LOCAL_HEADER_SIZE + entry.name.length);
  const dv = view(bytes);
  dv.setUint32(0, SIG.LOCAL, true);
  dv.setUint16(4, VERSION, true);
  writeCommonFields(dv, 6, entry, stamp);
  bytes.set(entry.name, LOCAL_HEADER_SIZE);
  return bytes;
}

function centralHeader(entry, stamp) {
  const isZip64 = entry.offset >= U32_MAX;
  const extraSize = isZip64 ? ZIP64_OFFSET_EXTRA_SIZE : 0;
  const bytes = new Uint8Array(CENTRAL_HEADER_SIZE + entry.name.length + extraSize);
  const dv = view(bytes);
  const version = isZip64 ? VERSION_ZIP64 : VERSION;
  dv.setUint32(0, SIG.CENTRAL, true);
  dv.setUint16(4, version, true);
  dv.setUint16(6, version, true);
  writeCommonFields(dv, 8, entry, stamp);
  dv.setUint16(30, extraSize, true);
  dv.setUint32(42, isZip64 ? U32_MAX : entry.offset, true);
  bytes.set(entry.name, CENTRAL_HEADER_SIZE);
  if (isZip64) {
    const extraPos = CENTRAL_HEADER_SIZE + entry.name.length;
    dv.setUint16(extraPos, ZIP64_EXTRA_ID, true);
    dv.setUint16(extraPos + 2, 8, true);
    dv.setBigUint64(extraPos + 4, BigInt(entry.offset), true);
  }
  return bytes;
}

function zip64Trailer({ count, size, offset }) {
  const bytes = new Uint8Array(ZIP64_EOCD_SIZE + ZIP64_LOCATOR_SIZE);
  const dv = view(bytes);
  dv.setUint32(0, SIG.ZIP64_EOCD, true);
  dv.setBigUint64(4, BigInt(ZIP64_RECORD_REMAINDER), true);
  dv.setUint16(12, VERSION_ZIP64, true);
  dv.setUint16(14, VERSION_ZIP64, true);
  dv.setBigUint64(24, BigInt(count), true);
  dv.setBigUint64(32, BigInt(count), true);
  dv.setBigUint64(40, BigInt(size), true);
  dv.setBigUint64(48, BigInt(offset), true);
  dv.setUint32(ZIP64_EOCD_SIZE, SIG.ZIP64_LOCATOR, true);
  dv.setBigUint64(ZIP64_EOCD_SIZE + 8, BigInt(offset + size), true);
  dv.setUint32(ZIP64_EOCD_SIZE + 16, 1, true);
  return bytes;
}

function endOfDirectory({ count, size, offset }, isZip64) {
  const bytes = new Uint8Array(EOCD_SIZE);
  const dv = view(bytes);
  dv.setUint32(0, SIG.EOCD, true);
  dv.setUint16(8, isZip64 ? U16_MAX : count, true);
  dv.setUint16(10, isZip64 ? U16_MAX : count, true);
  dv.setUint32(12, isZip64 ? U32_MAX : size, true);
  dv.setUint32(16, isZip64 ? U32_MAX : offset, true);
  return bytes;
}

function concat(chunks) {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}

/**
 * Streaming ZIP writer (store only — pages are already compressed images).
 * Sink: { write(Uint8Array): Promise, close(): Promise }. Switches to ZIP64 when offsets or counts overflow.
 */
export class ZipWriter {
  #sink;
  #stamp;
  #offset = 0;
  #entries = [];

  constructor(sink, date = new Date()) {
    this.#sink = sink;
    this.#stamp = dosDateTime(date);
  }

  get size() {
    return this.#offset;
  }

  async add(name, bytes, crc = crc32(bytes)) {
    if (bytes.length >= U32_MAX) throw new Error(`Слишком большой файл для EPUB: ${name}`);
    const entry = { name: encoder.encode(name), crc, size: bytes.length, offset: this.#offset };
    await this.#write(localHeader(entry, this.#stamp));
    await this.#write(bytes);
    this.#entries.push(entry);
  }

  async close() {
    const offset = this.#offset;
    await this.#write(concat(this.#entries.map((entry) => centralHeader(entry, this.#stamp))));
    const directory = { count: this.#entries.length, size: this.#offset - offset, offset };
    const isZip64 = directory.count >= U16_MAX || directory.offset >= U32_MAX || directory.size >= U32_MAX;
    if (isZip64) await this.#write(zip64Trailer(directory));
    await this.#write(endOfDirectory(directory, isZip64));
    await this.#sink.close();
  }

  async abort() {
    await this.#sink.abort?.();
  }

  async #write(chunk) {
    await this.#sink.write(chunk);
    this.#offset += chunk.length;
  }
}
