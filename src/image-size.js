const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_HEADER_SIZE = 24;
const JPEG_FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const JPEG_FRAME_HEADER_SIZE = 9;

const readU16 = (bytes, pos) => (bytes[pos] << 8) | bytes[pos + 1];
const readU32 = (bytes, pos) => ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0;

function isStandaloneMarker(marker) {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9);
}

function pngInfo(bytes) {
  if (bytes.length < PNG_HEADER_SIZE || !PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return null;
  return { mime: 'image/png', width: readU32(bytes, 16), height: readU32(bytes, 20) };
}

function jpegInfo(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let pos = 2;
  while (pos + JPEG_FRAME_HEADER_SIZE <= bytes.length) {
    if (bytes[pos] !== 0xff) return null;
    const marker = bytes[pos + 1];
    if (marker === 0xff) {
      pos += 1; // fill byte
    } else if (JPEG_FRAME_MARKERS.has(marker)) {
      return { mime: 'image/jpeg', width: readU16(bytes, pos + 7), height: readU16(bytes, pos + 5) };
    } else if (isStandaloneMarker(marker)) {
      pos += 2;
    } else {
      pos += 2 + readU16(bytes, pos + 2);
    }
  }
  return null;
}

/** Returns { mime, width, height } for PNG/JPEG bytes, or null when the format is unknown or broken. */
export function imageInfo(bytes) {
  return pngInfo(bytes) ?? jpegInfo(bytes);
}
