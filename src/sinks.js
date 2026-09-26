const WRITE_BUFFER_BYTES = 8 * 1024 * 1024;
const BLOB_FLUSH_BYTES = 64 * 1024 * 1024;
const OUTPUT_MIME = 'application/octet-stream';

const downloadUrls = [];

export const supportsDirectoryOutput = () => typeof window.showDirectoryPicker === 'function';

/** Many tiny writes (ZIP headers) are slow on FileSystemWritableFileStream — batch them. */
function buffered(target) {
  let chunks = [];
  let pending = 0;
  const flush = async () => {
    if (pending === 0) return;
    const merged = new Uint8Array(pending);
    let pos = 0;
    for (const chunk of chunks) {
      merged.set(chunk, pos);
      pos += chunk.length;
    }
    chunks = [];
    pending = 0;
    await target.write(merged);
  };
  return {
    write: async (chunk) => {
      if (chunk instanceof Blob) {
        await flush();
        await target.write(chunk); // streamed by the browser, never copied into the JS heap
        return;
      }
      chunks.push(chunk);
      pending += chunk.length;
      if (pending >= WRITE_BUFFER_BYTES) await flush();
    },
    close: async () => {
      await flush();
      await target.close();
    },
    abort: async () => {
      chunks = [];
      pending = 0;
      await target.abort();
    },
  };
}

async function uniqueFileName(dir, name) {
  const dot = name.lastIndexOf('.');
  const [base, extension] = [name.slice(0, dot), name.slice(dot)];
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${base} (${n})${extension}`;
    try {
      await dir.getFileHandle(candidate);
    } catch (err) {
      if (err.name === 'NotFoundError') return candidate;
      throw err;
    }
  }
}

/** Streams straight to a user-chosen folder (Chromium). Memory use does not depend on book size. */
export async function pickDirectoryOutput() {
  const dir = await window.showDirectoryPicker({ id: 'manga2epub', mode: 'readwrite' });
  return async (name) => {
    const handle = await dir.getFileHandle(await uniqueFileName(dir, name), { create: true });
    return buffered(await handle.createWritable());
  };
}

export function revokeDownloads() {
  downloadUrls.splice(0).forEach((url) => URL.revokeObjectURL(url));
}

/**
 * Fallback for Firefox/Safari: collects the book into a Blob and triggers a download.
 * Chunks are folded into the Blob every BLOB_FLUSH_BYTES so the browser can move data out of the JS heap.
 */
export function downloadOutput() {
  return async (name) => {
    let blob = new Blob([], { type: OUTPUT_MIME });
    let chunks = [];
    let pending = 0;
    const flush = () => {
      blob = new Blob([blob, ...chunks], { type: OUTPUT_MIME });
      chunks = [];
      pending = 0;
    };
    return {
      write: async (chunk) => {
        chunks.push(chunk);
        pending += chunk instanceof Blob ? chunk.size : chunk.length;
        if (pending >= BLOB_FLUSH_BYTES) flush();
      },
      close: async () => {
        flush();
        const url = URL.createObjectURL(blob);
        downloadUrls.push(url);
        const link = Object.assign(document.createElement('a'), { href: url, download: name });
        link.click();
      },
      abort: async () => {
        chunks = [];
        blob = null;
      },
    };
  };
}
