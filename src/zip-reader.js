import {
  CENTRAL_HEADER_SIZE,
  EOCD_SIZE,
  FLAG_ENCRYPTED,
  FLAG_UTF8,
  LOCAL_HEADER_SIZE,
  METHOD_DEFLATE,
  METHOD_STORE,
  SIG,
  U16_MAX,
  U32_MAX,
  ZIP64_EOCD_SIZE,
  ZIP64_EXTRA_ID,
  ZIP64_LOCATOR_SIZE,
  readU64,
  view,
} from './zip-format.js';

const MAX_COMMENT_SIZE = 0xffff;

async function readBytes(blob, start, end) {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

function tryDecode(encoding, bytes) {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Entry names without the UTF-8 flag have no declared encoding. Try UTF-8, then Shift_JIS
 * (Japanese raws), then CP866 (Russian Windows archivers). Cyrillic CP866 text almost always
 * contains bytes that are invalid in Shift_JIS, so the order is safe enough for sorting and titles.
 */
export function decodeName(bytes, flags) {
  if (flags & FLAG_UTF8) return new TextDecoder('utf-8').decode(bytes);
  return tryDecode('utf-8', bytes) ?? tryDecode('shift_jis', bytes) ?? new TextDecoder('ibm866').decode(bytes);
}

function findEocd(tail) {
  const dv = view(tail);
  for (let pos = tail.length - EOCD_SIZE; pos >= 0; pos--) {
    if (dv.getUint32(pos, true) === SIG.EOCD) return pos;
  }
  return -1;
}

async function readZip64Directory(blob, tail, eocdPos) {
  const locatorPos = eocdPos - ZIP64_LOCATOR_SIZE;
  const dv = view(tail);
  if (locatorPos < 0 || dv.getUint32(locatorPos, true) !== SIG.ZIP64_LOCATOR) {
    throw new Error('Повреждённый ZIP64: не найден локатор каталога');
  }
  const recordOffset = readU64(dv, locatorPos + 8);
  const record = view(await readBytes(blob, recordOffset, recordOffset + ZIP64_EOCD_SIZE));
  if (record.byteLength < ZIP64_EOCD_SIZE || record.getUint32(0, true) !== SIG.ZIP64_EOCD) {
    throw new Error('Повреждённый ZIP64: не найдена запись конца каталога');
  }
  return { count: readU64(record, 32), size: readU64(record, 40), offset: readU64(record, 48) };
}

async function readDirectoryLocation(blob) {
  const tailStart = Math.max(0, blob.size - (EOCD_SIZE + MAX_COMMENT_SIZE + ZIP64_LOCATOR_SIZE));
  const tail = await readBytes(blob, tailStart, blob.size);
  const eocdPos = findEocd(tail);
  if (eocdPos < 0) throw new Error('Это не ZIP-архив (или он повреждён). RAR/7z пересохраните в ZIP.');
  const dv = view(tail);
  const location = {
    count: dv.getUint16(eocdPos + 10, true),
    size: dv.getUint32(eocdPos + 12, true),
    offset: dv.getUint32(eocdPos + 16, true),
  };
  const isZip64 = location.count === U16_MAX || location.size === U32_MAX || location.offset === U32_MAX;
  return isZip64 ? readZip64Directory(blob, tail, eocdPos) : location;
}

/** ZIP64 extra field stores 64-bit values only for the fields that are saturated in the header. */
function applyZip64Extra(extra, fields) {
  const dv = view(extra);
  const result = { ...fields };
  for (let pos = 0; pos + 4 <= extra.length; ) {
    const id = dv.getUint16(pos, true);
    const length = dv.getUint16(pos + 2, true);
    if (id === ZIP64_EXTRA_ID) {
      let cursor = pos + 4;
      const end = cursor + length;
      for (const key of ['size', 'compressedSize', 'localOffset']) {
        if (fields[key] === U32_MAX && cursor + 8 <= end) {
          result[key] = readU64(dv, cursor);
          cursor += 8;
        }
      }
    }
    pos += 4 + length;
  }
  return result;
}

function parseCentralDirectory(directory, count) {
  const dv = view(directory);
  const entries = [];
  let pos = 0;
  for (let i = 0; i < count; i++) {
    if (pos + CENTRAL_HEADER_SIZE > directory.length || dv.getUint32(pos, true) !== SIG.CENTRAL) {
      throw new Error('Повреждённый центральный каталог ZIP');
    }
    const flags = dv.getUint16(pos + 8, true);
    const nameLength = dv.getUint16(pos + 28, true);
    const extraLength = dv.getUint16(pos + 30, true);
    const commentLength = dv.getUint16(pos + 32, true);
    const nameStart = pos + CENTRAL_HEADER_SIZE;
    const extraStart = nameStart + nameLength;
    const sizes = applyZip64Extra(directory.subarray(extraStart, extraStart + extraLength), {
      compressedSize: dv.getUint32(pos + 20, true),
      size: dv.getUint32(pos + 24, true),
      localOffset: dv.getUint32(pos + 42, true),
    });
    entries.push({
      name: decodeName(directory.subarray(nameStart, extraStart), flags),
      method: dv.getUint16(pos + 10, true),
      crc: dv.getUint32(pos + 16, true),
      encrypted: (flags & FLAG_ENCRYPTED) !== 0,
      ...sizes,
    });
    pos = extraStart + extraLength + commentLength;
  }
  return entries;
}

/** Lists archive entries reading only the tail and the central directory — the file is never loaded whole. */
export async function listZipEntries(blob) {
  const location = await readDirectoryLocation(blob);
  const directory = await readBytes(blob, location.offset, location.offset + location.size);
  return parseCentralDirectory(directory, location.count);
}

/** Returns a Blob with the uncompressed entry data. Stored entries are a zero-copy slice of the archive. */
export async function entryData(blob, entry) {
  if (entry.encrypted) throw new Error(`Зашифрованные файлы не поддерживаются: ${entry.name}`);
  const header = view(await readBytes(blob, entry.localOffset, entry.localOffset + LOCAL_HEADER_SIZE));
  if (header.byteLength < LOCAL_HEADER_SIZE || header.getUint32(0, true) !== SIG.LOCAL) {
    throw new Error(`Повреждённый локальный заголовок: ${entry.name}`);
  }
  const start = entry.localOffset + LOCAL_HEADER_SIZE + header.getUint16(26, true) + header.getUint16(28, true);
  const raw = blob.slice(start, start + entry.compressedSize);
  if (entry.method === METHOD_STORE) return raw;
  if (entry.method === METHOD_DEFLATE) {
    return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
  }
  throw new Error(`Метод сжатия ${entry.method} не поддерживается (${entry.name}). Пересохраните архив как обычный ZIP.`);
}
