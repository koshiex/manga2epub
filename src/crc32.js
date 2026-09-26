const POLYNOMIAL = 0xedb88320;

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? POLYNOMIAL ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (ZIP flavour). Pass the previous result to continue a running checksum. */
export function crc32(bytes, previous = 0) {
  let crc = ~previous;
  for (let i = 0; i < bytes.length; i++) crc = TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return ~crc >>> 0;
}
