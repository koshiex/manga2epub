import { crc32 } from './crc32.js';
import { imageInfo } from './image-size.js';
import { containSize, fitSize, planParts } from './layout.js';
import { ditherToLevels, encodeXtg, encodeXth } from './xt-format.js';
import { entryData } from './zip-reader.js';

const PASSTHROUGH_MIME = new Set(['image/jpeg', 'image/png']);
const JPEG_MIME = 'image/jpeg';
const WHITE = '#fff';
const XT_TARGETS = Object.freeze({
  xtg: { levelCount: 2, encode: encodeXtg, mime: 'application/x-xtg' },
  xth: { levelCount: 4, encode: encodeXth, mime: 'application/x-xth' },
});

/** One job = one source page → one or two output images (split spreads). */
self.onmessage = async ({ data }) => {
  const { id, source, opts } = data;
  try {
    const images = await convertPage(source, opts);
    self.postMessage({ id, images }, images.map((image) => image.bytes.buffer));
  } catch (err) {
    self.postMessage({ id, error: err?.message ?? String(err) });
  }
};

async function convertPage(source, opts) {
  const blob = source.entry ? await entryData(source.file, source.entry) : source.file;
  const target = opts.target ?? 'jpeg';
  if (target === 'jpeg' && !opts.process) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const info = imageInfo(bytes);
    if (info && PASSTHROUGH_MIME.has(info.mime)) return [{ bytes, crc: crc32(bytes), ...info }];
    // WebP/GIF/BMP/AVIF are not safe for e-ink readers: re-encode as JPEG without other changes.
  }
  const bitmap = await createImageBitmap(blob);
  try {
    const images = [];
    for (const part of planParts(bitmap.width, bitmap.height, opts)) {
      images.push(target === 'jpeg' ? await renderJpeg(bitmap, part, opts) : renderXt(bitmap, part, opts, XT_TARGETS[target]));
    }
    return images;
  } finally {
    bitmap.close();
  }
}

const rotatedSize = (part) => (part.rotate ? { width: part.sh, height: part.sw } : { width: part.sw, height: part.sh });

function whiteCanvas(width, height, willReadFrequently) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently });
  ctx.fillStyle = WHITE; // transparent PNG areas must not turn black
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

/** Draws the part into the rectangle (x, y, width, height); rotated parts are turned 90° clockwise. */
function drawPart(ctx, bitmap, part, { x, y, width, height }) {
  ctx.save();
  ctx.translate(x, y);
  if (part.rotate) {
    ctx.translate(width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(bitmap, part.sx, part.sy, part.sw, part.sh, 0, 0, height, width);
  } else {
    ctx.drawImage(bitmap, part.sx, part.sy, part.sw, part.sh, 0, 0, width, height);
  }
  ctx.restore();
}

async function renderJpeg(bitmap, part, opts) {
  const source = rotatedSize(part);
  const { width, height } = fitSize(source.width, source.height, opts.maxWidth, opts.maxHeight);
  const { canvas, ctx } = whiteCanvas(width, height, Boolean(opts.grayscale));
  drawPart(ctx, bitmap, part, { x: 0, y: 0, width, height });
  if (opts.grayscale) toGrayscale(ctx, width, height);
  const encoded = await canvas.convertToBlob({ type: JPEG_MIME, quality: opts.quality });
  const bytes = new Uint8Array(await encoded.arrayBuffer());
  return { bytes, crc: crc32(bytes), mime: JPEG_MIME, width, height };
}

/** Xteink pages are pre-rendered for the exact screen: the image is centered on white and dithered. */
function renderXt(bitmap, part, opts, target) {
  const { maxWidth: screenWidth, maxHeight: screenHeight } = opts;
  if (!(screenWidth > 0 && screenHeight > 0)) throw new Error('Для XTC нужен размер экрана');
  const source = rotatedSize(part);
  const { width, height } = containSize(source.width, source.height, screenWidth, screenHeight);
  const { ctx } = whiteCanvas(screenWidth, screenHeight, true);
  const x = Math.floor((screenWidth - width) / 2);
  const y = Math.floor((screenHeight - height) / 2);
  drawPart(ctx, bitmap, part, { x, y, width, height });
  const levels = ditherToLevels(luminanceOf(ctx, screenWidth, screenHeight), screenWidth, screenHeight, target.levelCount, opts.dither);
  return { bytes: target.encode(levels, screenWidth, screenHeight), mime: target.mime, width: screenWidth, height: screenHeight };
}

function luminanceOf(ctx, width, height) {
  const px = ctx.getImageData(0, 0, width, height).data;
  const luminance = new Float32Array(width * height);
  for (let i = 0; i < luminance.length; i++) {
    luminance[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]; // BT.601
  }
  return luminance;
}

/** In-place pixel loop on purpose: allocating a copy per page would double peak memory. */
function toGrayscale(ctx, width, height) {
  const image = ctx.getImageData(0, 0, width, height);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    const luma = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8; // BT.601
    px[i] = luma;
    px[i + 1] = luma;
    px[i + 2] = luma;
  }
  ctx.putImageData(image, 0, 0);
}
