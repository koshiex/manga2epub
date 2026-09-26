// Browser smoke test: serves the project, drives headless Chrome over CDP, checks the real pipeline.
// Usage: npm run test:browser   (CHROME_PATH overrides the Chrome binary)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9333;
const POLL_ATTEMPTS = 50;
const POLL_DELAY_MS = 200;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.zip': 'application/zip',
};

function serveProject() {
  const server = createServer(async (req, res) => {
    const path = resolve(ROOT, `.${decodeURIComponent(new URL(req.url, 'http://x').pathname)}`);
    if (!path.startsWith(ROOT + sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(path);
      res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((ready) => server.listen(0, '127.0.0.1', () => ready(server)));
}

async function pageSocketUrl() {
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      const page = targets.find((target) => target.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome is still starting
    }
    await sleep(POLL_DELAY_MS);
  }
  throw new Error('Chrome did not expose a debuggable page');
}

async function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const events = [];
  let nextId = 1;
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) pending.get(message.id)?.(message);
    else events.push(message);
  };
  await new Promise((ready) => {
    socket.onopen = ready;
  });
  const send = (method, params = {}) =>
    new Promise((done) => {
      const id = nextId++;
      pending.set(id, done);
      socket.send(JSON.stringify({ id, method, params }));
    });
  return { send, events, close: () => socket.close() };
}

async function evaluate(client, expression) {
  const { result } = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails, null, 2));
  return result.result.value;
}

function checkProcessed({ volumes, warnings, book }) {
  assert.deepEqual(volumes, [{ name: 'Smoke.epub', pages: 4 }]);
  assert.deepEqual(warnings, []);
  assert.equal(book.first, 'mimetype');
  assert.deepEqual(book.chapters, ['Ch 1', 'Ch 2']);
  assert.equal(book.images.length, 4, 'spread must become two pages');
  for (const image of book.images) {
    assert.match(image.name, /\.jpg$/);
    assert.deepEqual([image.width, image.height], [400, 600], image.name);
    const [r, g, b] = image.rgb;
    assert.ok(Math.abs(r - g) <= 3 && Math.abs(g - b) <= 3, `${image.name} must be gray, got ${image.rgb}`);
  }
  const [, rightHalf, leftHalf] = book.images;
  assert.ok(rightHalf.rgb[0] > leftHalf.rgb[0] + 50, 'right (green, brighter) half must come first for manga');
}

function checkPassthrough({ volumes, book }) {
  assert.deepEqual(volumes, [{ name: 'Smoke.epub', pages: 3 }]);
  assert.deepEqual(
    book.images.map((image) => [image.name.replace('OEBPS/img/', ''), image.width, image.height]),
    [
      ['p00001.png', 800, 1200],
      ['p00002.jpg', 1600, 1200],
      ['p00003.png', 600, 900],
    ],
  );
  const [r, g] = book.images[0].rgb;
  assert.ok(r > 200 && g < 50, 'passthrough must keep original colors');
}

function checkXtc({ volumes, warnings, book }, { format, magic, pageMagic, pageSize }) {
  assert.deepEqual(volumes, [{ name: `Smoke.${format}`, pages: 4 }]);
  assert.deepEqual(warnings, []);
  assert.equal(book.magic, magic);
  assert.equal(book.direction, 1, 'manga reads right to left');
  assert.equal(book.title, 'Smoke');
  assert.deepEqual(book.chapters, ['Ch 1', 'Ch 2']);
  assert.deepEqual(
    book.pages,
    Array.from({ length: 4 }, () => ({ size: pageSize, width: 480, height: 800, magic: pageMagic })),
  );
}

async function main() {
  const server = await serveProject();
  const profile = mkdtempSync(join(tmpdir(), 'manga2epub-chrome-'));
  const chrome = spawn(
    CHROME,
    ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'],
    { stdio: 'ignore' },
  );
  try {
    const client = await connect(await pageSocketUrl());
    await client.send('Runtime.enable');
    await client.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/test/browser/smoke.html` });
    for (let i = 0; i < POLL_ATTEMPTS && (await evaluate(client, 'typeof window.runSmoke')) !== 'function'; i++) {
      await sleep(POLL_DELAY_MS);
    }
    const result = await evaluate(client, 'runSmoke()');
    console.log(JSON.stringify(result, null, 2));
    checkProcessed(result.processed);
    checkPassthrough(result.passthrough);
    checkXtc(result.xtc, { format: 'xtc', magic: 'XTC', pageMagic: 'XTG', pageSize: 22 + 480 * 800 / 8 });
    assert.equal(result.xtc.book.topRowWhite, true, '800×1200 page is centered: 40 white rows on top');
    assert.equal(result.xtc.book.middleRowInked, true, 'red page must dither to some black pixels');
    checkXtc(result.xtch, { format: 'xtch', magic: 'XTCH', pageMagic: 'XTH', pageSize: 22 + 2 * 480 * 800 / 8 });
    assert.equal(result.deviceOptions, 10, 'app UI must initialise');
    const errors = client.events.filter(
      (event) => event.method === 'Runtime.exceptionThrown' || (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error'),
    );
    assert.deepEqual(errors, [], 'no console errors');
    client.close();
    console.log('browser smoke: OK');
  } finally {
    const exited = new Promise((done) => chrome.once('exit', done));
    chrome.kill();
    await exited;
    server.close();
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  }
}

await main();
