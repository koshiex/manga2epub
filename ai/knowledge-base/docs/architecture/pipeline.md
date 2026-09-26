# Conversion pipeline constraints

## Flow

`src/app.js` reads the ZIP central directory (`src/zip-reader.js`) or the folder file list and orders the pages
(`src/sources.js`). Then `src/convert.js` sends each page to `src/worker.js` through `src/pool.js`. The worker
decompresses the entry, resizes and encodes it, and computes the CRC. The main thread only writes results in order
through `src/epub-builder.js` → `src/zip-writer.js` → a sink from `src/sinks.js`.

## Constraints

- **The folder picker needs user activation.** `showDirectoryPicker()` is called before any other `await` in the
  click handler (`start()` → `openOutput()`). Transient activation expires after a few seconds, so slow work
  before the picker (for example, scanning pages) makes it throw `SecurityError`. Keep the picker first.
- **Volume file names are fixed before writing starts.** File System Access creates the file before its content
  exists. Because of this, any non-zero volume limit always gives numbered names (`Title - 01.epub`),
  even when the book fits into one volume.
- **Output order vs. parallelism.** `convert()` keeps at most `pool.size × IN_FLIGHT_PER_WORKER` pages in flight
  and consumes them in FIFO order. This bounds memory and keeps the page order when workers finish out of order.
- **The EPUB writer stores entries only.** Pages are already compressed images, so deflate gives almost nothing.
  `mimetype` must be the first entry: stored, with no extra field (see `test/epub.test.js`).
- **Entry name encoding.** ZIP names without the UTF-8 flag are decoded as UTF-8 → Shift_JIS → CP866
  (`decodeName`). Names are used only for sorting and chapter titles, so a wrong guess never breaks the book.
- **XTC needs the final page count before any page data.** The header and page table come first and depend on
  the page count, which is known only at the end (split spreads, skipped pages). `src/xtc-builder.js` collects
  page data in a Blob and writes header + Blob on `finish()`. Sinks accept Blob chunks for this reason.
- **XTC format details follow the CrossPoint firmware, not the community spec.** The spec gist (AI-generated)
  and other converters disagree on details. `src/xt-format.js` follows the CrossPoint parser (`lib/Xtc`):
  version bytes `[1, 0]`, chapter pages 1-based (the gist says 0-based), chapter offset as u64 at 0x30,
  title at 0x38 and author at 0xB8. XTG bit 1 = white (the xtctool README says the opposite).
  XTH stores the two gray levels swapped (value 1 = dark gray, 2 = light gray).
  The official Xteink firmware ignores chapters.
- **`file://` is not supported.** ES modules and module workers do not load from `file://`. `index.html` shows
  an inline warning with the command to start a local server.
