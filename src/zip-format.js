/** Shared ZIP constants (APPNOTE.TXT). */
export const SIG = Object.freeze({
  LOCAL: 0x04034b50,
  CENTRAL: 0x02014b50,
  EOCD: 0x06054b50,
  ZIP64_EOCD: 0x06064b50,
  ZIP64_LOCATOR: 0x07064b50,
});

export const METHOD_STORE = 0;
export const METHOD_DEFLATE = 8;
export const FLAG_ENCRYPTED = 0x0001;
export const FLAG_UTF8 = 0x0800;
export const ZIP64_EXTRA_ID = 0x0001;

export const U16_MAX = 0xffff;
export const U32_MAX = 0xffffffff;

export const LOCAL_HEADER_SIZE = 30;
export const CENTRAL_HEADER_SIZE = 46;
export const EOCD_SIZE = 22;
export const ZIP64_EOCD_SIZE = 56;
export const ZIP64_LOCATOR_SIZE = 20;

export const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
export const readU64 = (dataView, pos) => Number(dataView.getBigUint64(pos, true));
