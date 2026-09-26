# Development environment quirks

## `sips` fails inside the agent sandbox

`sips -s format jpeg in.png --out out.jpg` exits with code 13 ("Cannot write to file /var/folders/…"):
it writes a temp file into the system temp dir, which the sandbox blocks, whatever `TMPDIR` says.
Because of this, unit tests read the committed fixture `test/fixtures/page-40x25.jpg` instead of calling `sips`.
`node test/fixtures/make-sample.js`, which regenerates `sample-manga.zip`, must run outside the sandbox.

## Local HTTP servers cannot bind inside the sandbox

`python3 -m http.server` fails with `PermissionError: [Errno 1] Operation not permitted` on `bind`.
Run the server and `npm run test:browser` outside the sandbox. The browser runner starts its own Node
static server on a random `127.0.0.1` port and Chrome with `--remote-debugging-port=9333`.

## Headless Chrome smoke test

`test/browser/run-smoke.js` drives Chrome through CDP (Node's global `WebSocket`) and calls
`window.runSmoke()` from `test/browser/smoke.js`. The Chrome profile directory can be deleted only after
the Chrome process emits `exit`; deleting it right after `kill()` fails with `ENOTEMPTY`.
Set `CHROME_PATH` to use a binary other than `/Applications/Google Chrome.app`.
