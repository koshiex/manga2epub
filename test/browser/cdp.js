// Minimal headless Chrome driver over the DevTools protocol (Node's global WebSocket, no dependencies).
// CHROME_PATH overrides the Chrome binary.
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
const STARTUP_ATTEMPTS = 50;
const POLL_DELAY_MS = 200;
const DEFAULT_WAIT_MS = 60_000;
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
  for (let i = 0; i < STARTUP_ATTEMPTS; i++) {
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

export async function evaluate(client, expression) {
  const { result } = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails, null, 2));
  return result.result.value;
}

/** Polls the expression until it returns a truthy value and returns that value. */
export async function waitFor(client, expression, timeoutMs = DEFAULT_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(client, expression);
    if (value) return value;
    await sleep(POLL_DELAY_MS);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

export async function navigate(client, url, readyExpression) {
  await client.send('Page.navigate', { url });
  await waitFor(client, readyExpression);
}

export function consoleErrors(client) {
  return client.events.filter(
    (event) => event.method === 'Runtime.exceptionThrown' || (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error'),
  );
}

/** Starts a static server for the project and a throwaway headless Chrome, runs the scenario, cleans up. */
export async function withChrome(scenario) {
  const server = await serveProject();
  const profile = mkdtempSync(join(tmpdir(), 'manga2epub-chrome-'));
  const chrome = spawn(
    CHROME,
    ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'],
    { stdio: 'ignore' },
  );
  let client = null;
  try {
    client = await connect(await pageSocketUrl());
    await client.send('Runtime.enable');
    return await scenario({ client, baseUrl: `http://127.0.0.1:${server.address().port}` });
  } finally {
    client?.close();
    const exited = new Promise((done) => chrome.once('exit', done));
    chrome.kill();
    await exited;
    server.close();
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  }
}
