# manga2epub

Local converter from a ZIP/CBZ archive (or a folder) with manga pages (JPG/PNG/WebP/…) to a fixed-layout EPUB 3
or to Xteink XTC/XTCH for e-ink readers.
Everything runs in the browser: nothing is uploaded, and the archive is never loaded into memory as a whole.

## Run

```sh
python3 -m http.server 8000 --bind 127.0.0.1   # or: npm start
```

Open http://127.0.0.1:8000. A local server is required: browsers do not load ES modules and workers from `file://`.

## What it does

- Reads only the ZIP central directory, then streams pages one by one (ZIP64 supported, stored and deflate entries).
- Every subfolder becomes a chapter in the table of contents.
- Several archives at once (multi-select, drag and drop, or a folder that contains only ZIP/CBZ files):
  one book per archive, or one merged book where archives become chapters.
- Optional processing in Web Workers: resize to the reader screen, grayscale, JPEG quality,
  double-page spreads (keep / split in reading order / rotate).
- Without processing, JPG/PNG are copied byte for byte.
- Reading direction: right-to-left (manga) or left-to-right.
- Optional split into volumes by size.
- Chrome/Edge write the EPUB straight into a chosen folder (constant memory).
  Firefox/Safari build the file in memory and download it — use volumes for huge archives.

## Xteink (X4, X4 Pro, X3)

Xteink readers have too little memory to display manga well from EPUB. Choose the XTC or XTCH format instead:
pages are pre-rendered for the exact screen (X4/X4 Pro 480×800, X3 528×792) and dithered.

- **XTC**: 1-bit black and white. Smaller files, faster page turns.
- **XTCH**: 4 gray levels. Better halftones.

Splitting spreads is recommended on such a small screen. One file holds at most 65535 pages; longer books continue in the next file.
Copy the `.xtc`/`.xtch` file to the microSD card or upload it over Wi-Fi.

Not supported: RAR/CBR, 7z, encrypted ZIP. Kindle does not read EPUB natively — use KOReader or convert with Calibre/KCC.

## Tests

```sh
npm test              # unit tests (Node 22+, uses unzip/xmllint)
npm run test:browser  # headless Chrome: pipeline smoke test + UI end-to-end test
node test/browser/run-ui.js --archives <folder>  # also convert real archives through the UI and print stats
node test/fixtures/make-sample.js  # regenerate the smoke-test archive (macOS: sips + zip)
```
