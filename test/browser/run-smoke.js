// Browser smoke test: serves the project, drives headless Chrome over CDP, checks the real pipeline.
// Usage: npm run test:browser
import assert from 'node:assert/strict';
import { consoleErrors, evaluate, navigate, withChrome } from './cdp.js';

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

await withChrome(async ({ client, baseUrl }) => {
  await navigate(client, `${baseUrl}/test/browser/smoke.html`, "typeof window.runSmoke === 'function'");
  const result = await evaluate(client, 'runSmoke()');
  console.log(JSON.stringify(result, null, 2));
  checkProcessed(result.processed);
  checkPassthrough(result.passthrough);
  checkXtc(result.xtc, { format: 'xtc', magic: 'XTC', pageMagic: 'XTG', pageSize: 22 + 480 * 800 / 8 });
  assert.equal(result.xtc.book.topRowWhite, true, '800×1200 page is centered: 40 white rows on top');
  assert.equal(result.xtc.book.middleRowInked, true, 'red page must dither to some black pixels');
  checkXtc(result.xtch, { format: 'xtch', magic: 'XTCH', pageMagic: 'XTH', pageSize: 22 + 2 * 480 * 800 / 8 });
  assert.equal(result.deviceOptions, 10, 'app UI must initialise');
  assert.deepEqual(consoleErrors(client), [], 'no console errors');
  console.log('browser smoke: OK');
});
