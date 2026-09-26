// Regenerates sample-manga.zip for the browser smoke test (macOS: needs sips and Info-ZIP).
// Layout: Title/Ch 1/01.png (red, stored), Title/Ch 1/02.jpg (spread: blue left, green right),
// Title/Ch 2/01.png (gray), Title/Ch 2/notes.txt (not a page). Everything except 01.png is deflated.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makePng, makeRgbPng, tempDir } from '../helpers.js';

const RED = [220, 30, 30];
const GREEN = [30, 200, 30];
const BLUE = [30, 30, 220];

const work = tempDir();
const chapter1 = join(work, 'Title', 'Ch 1');
const chapter2 = join(work, 'Title', 'Ch 2');
mkdirSync(chapter1, { recursive: true });
mkdirSync(chapter2, { recursive: true });

writeFileSync(join(chapter1, '01.png'), makeRgbPng(800, 1200, () => RED));
const spreadPng = join(work, 'spread.png');
writeFileSync(spreadPng, makeRgbPng(1600, 1200, (x) => (x < 800 ? BLUE : GREEN)));
execFileSync('sips', ['-s', 'format', 'jpeg', spreadPng, '--out', join(chapter1, '02.jpg')], { stdio: 'ignore' });
writeFileSync(join(chapter2, '01.png'), makePng(600, 900, 90));
writeFileSync(join(chapter2, 'notes.txt'), 'not a page\n'.repeat(50));

const output = new URL('./sample-manga.zip', import.meta.url).pathname;
rmSync(output, { force: true });
execFileSync('zip', ['-q', '-0', output, 'Title/Ch 1/01.png'], { cwd: work });
execFileSync('zip', ['-q', '-9', '-r', output, 'Title', '-x', 'Title/Ch 1/01.png'], { cwd: work });
console.log(execFileSync('zipinfo', [output], { encoding: 'utf8' }));
