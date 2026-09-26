/** Scales width×height down to fit into maxWidth×maxHeight. Never upscales; zero limits keep the size. */
export function fitSize(width, height, maxWidth, maxHeight) {
  if (!maxWidth || !maxHeight) return { width, height };
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Scales width×height up or down to the largest size that fits into the box (for fixed-size screens). */
export function containSize(width, height, boxWidth, boxHeight) {
  const scale = Math.min(boxWidth / width, boxHeight / height);
  return {
    width: Math.min(boxWidth, Math.max(1, Math.round(width * scale))),
    height: Math.min(boxHeight, Math.max(1, Math.round(height * scale))),
  };
}

/**
 * Decides how a source image becomes output pages.
 * Landscape images are treated as double-page spreads: kept, rotated or split in reading order.
 */
export function planParts(width, height, { spreads, rtl }) {
  const whole = { sx: 0, sy: 0, sw: width, sh: height, rotate: false };
  if (width <= height || spreads === 'keep') return [whole];
  if (spreads === 'rotate') return [{ ...whole, rotate: true }];
  const half = Math.floor(width / 2);
  const left = { sx: 0, sy: 0, sw: half, sh: height, rotate: false };
  const right = { sx: half, sy: 0, sw: width - half, sh: height, rotate: false };
  return rtl ? [right, left] : [left, right];
}
