/** Screen sizes in portrait pixels. width/height 0 = keep original image size. */
export const DEVICE_PRESETS = Object.freeze([
  { id: 'original', label: 'Без изменений (как в архиве)', width: 0, height: 0 },
  { id: 'xteink-x4', label: '480×800 — Xteink X4 / X4 Pro', width: 480, height: 800 },
  { id: 'xteink-x3', label: '528×792 — Xteink X3', width: 528, height: 792 },
  { id: '1072x1448', label: '1072×1448 — Kindle 6", Paperwhite 3/4, Kobo Clara, PocketBook Verse Pro', width: 1072, height: 1448 },
  { id: '1236x1648', label: '1236×1648 — Kindle Paperwhite 5 / Signature (2021)', width: 1236, height: 1648 },
  { id: '1264x1680', label: '1264×1680 — Kindle Oasis, Paperwhite 2024, Kobo Libra, PocketBook Era, Boox Leaf', width: 1264, height: 1680 },
  { id: '1404x1872', label: '1404×1872 — Kobo Elipsa, PocketBook InkPad 4', width: 1404, height: 1872 },
  { id: '1440x1920', label: '1440×1920 — Kobo Sage', width: 1440, height: 1920 },
  { id: '1860x2480', label: '1860×2480 — Kindle Scribe', width: 1860, height: 2480 },
  { id: 'custom', label: 'Своё разрешение…', width: 0, height: 0 },
]);

export const DEFAULT_PRESET_ID = '1264x1680';
/** Xteink formats store pages pre-rendered for a fixed screen, so "original size" falls back to this preset. */
export const DEFAULT_XTEINK_PRESET_ID = 'xteink-x4';
