import { convert } from './convert.js';
import { WorkerPool } from './pool.js';
import { DEFAULT_PRESET_ID, DEFAULT_XTEINK_PRESET_ID, DEVICE_PRESETS } from './presets.js';
import { downloadOutput, pickDirectoryOutput, revokeDownloads, supportsDirectoryOutput } from './sinks.js';
import { buildPageList } from './sources.js';
import { DITHER_METHODS } from './xt-format.js';
import { listZipEntries } from './zip-reader.js';

const STORAGE_KEY = 'manga2epub:options';
const PERSISTED_FIELDS = [
  'format', 'author', 'lang', 'direction', 'device', 'width', 'height', 'grayscale', 'quality', 'dither', 'spreads', 'volumeMb',
];
const FORMATS = ['epub', 'xtc', 'xtch'];
const SPREAD_MODES = ['keep', 'split', 'rotate'];
const DEFAULT_DITHER = 'floyd';
const MAX_WORKERS = 8;
const MAX_LOG_LINES = 200;
const MB = 1024 * 1024;
const BYTE_UNITS = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
const REQUIRED_APIS = ['DecompressionStream', 'OffscreenCanvas', 'Worker', 'createImageBitmap'];

const $ = (id) => document.getElementById(id);
const form = $('options');
const field = (name) => form.elements.namedItem(name);
const ui = {
  drop: $('drop'),
  archive: $('pick-archive'),
  folder: $('pick-folder'),
  summary: $('summary'),
  start: $('start'),
  cancel: $('cancel'),
  progress: $('progress'),
  status: $('status'),
  log: $('log'),
  mode: $('mode'),
  customSize: $('custom-size'),
  quality: $('quality-value'),
  outputHint: $('output-hint'),
  unsupported: $('unsupported'),
};

let source = null; // { name, pages }
let running = null; // { controller, pool }
let logLines = 0;

function formatBytes(bytes) {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${BYTE_UNITS[unit]}`;
}

function formatDuration(seconds) {
  const total = Math.round(seconds);
  return total < 60 ? `${total} с` : `${Math.floor(total / 60)} мин ${total % 60} с`;
}

const clampInt = (value, min, max) => Math.min(max, Math.max(min, Number.parseInt(value, 10) || 0));
const stripExtension = (name) => name.replace(/\.[^.]+$/, '');

function setStatus(text, failed = false) {
  ui.status.textContent = text;
  ui.status.classList.toggle('failed', failed);
}

function log(message) {
  logLines += 1;
  if (logLines > MAX_LOG_LINES) {
    ui.log.lastElementChild.textContent = `…и ещё ${logLines - MAX_LOG_LINES} предупреждений`;
    return;
  }
  ui.log.append(Object.assign(document.createElement('li'), { textContent: message }));
  if (logLines === MAX_LOG_LINES) ui.log.append(document.createElement('li'));
}

function clearLog() {
  logLines = 0;
  ui.log.replaceChildren();
}

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const presetById = (id) => DEVICE_PRESETS.find((preset) => preset.id === id);

function screenSize(data, isXteink) {
  const preset = presetById(data.get('device')) ?? DEVICE_PRESETS[0];
  if (preset.id === 'custom') {
    return { maxWidth: clampInt(data.get('width'), 100, 10_000), maxHeight: clampInt(data.get('height'), 100, 10_000) };
  }
  // Xteink pages are rendered for a fixed screen, "original size" has no meaning there.
  const effective = isXteink && preset.width === 0 ? presetById(DEFAULT_XTEINK_PRESET_ID) : preset;
  return { maxWidth: effective.width, maxHeight: effective.height };
}

function imageOptions(data, format, rtl) {
  const isXteink = format !== 'epub';
  const spreads = pick(data.get('spreads'), SPREAD_MODES, 'keep');
  const screen = screenSize(data, isXteink);
  if (isXteink) {
    const dither = pick(data.get('dither'), DITHER_METHODS, DEFAULT_DITHER);
    return { target: format === 'xtc' ? 'xtg' : 'xth', process: true, ...screen, dither, spreads, rtl };
  }
  const grayscale = data.has('grayscale');
  return {
    target: 'jpeg',
    process: screen.maxWidth > 0 || grayscale || spreads !== 'keep',
    ...screen,
    grayscale,
    quality: clampInt(data.get('quality'), 50, 100) / 100,
    spreads,
    rtl,
  };
}

function readOptions() {
  const data = new FormData(form);
  const format = pick(data.get('format'), FORMATS, 'epub');
  const rtl = data.get('direction') !== 'ltr';
  return {
    meta: {
      title: String(data.get('title') ?? '').trim(),
      author: String(data.get('author') ?? '').trim(),
      lang: String(data.get('lang') ?? '').trim() || 'ru',
      rtl,
    },
    options: {
      format,
      image: imageOptions(data, format, rtl),
      volumeBytes: clampInt(data.get('volumeMb'), 0, 4000) * MB,
    },
  };
}

function saveOptions() {
  const values = Object.fromEntries(
    PERSISTED_FIELDS.map((name) => {
      const input = field(name);
      return [name, input.type === 'checkbox' ? input.checked : input.value];
    }),
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
}

function loadSavedOptions() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {};
  } catch {
    return {}; // corrupted storage: fall back to defaults
  }
}

function restoreOptions() {
  const saved = loadSavedOptions();
  for (const name of PERSISTED_FIELDS.filter((key) => key in saved)) {
    const input = field(name);
    if (input.type === 'checkbox') input.checked = Boolean(saved[name]);
    else input.value = String(saved[name]);
  }
  if (!field('device').value) field('device').value = DEFAULT_PRESET_ID;
}

function describeMode({ format, image }) {
  if (format !== 'epub') {
    const colors = format === 'xtc' ? 'чёрно-белые' : '4 оттенка серого';
    return `Страницы рендерятся ровно под экран ${image.maxWidth}×${image.maxHeight}: ${colors}, с дизерингом.`;
  }
  return image.process
    ? 'Картинки будут перекодированы в JPEG под выбранный экран.'
    : 'Картинки копируются как есть: быстро и без потерь качества.';
}

function refreshForm(event) {
  const isXteink = field('format').value !== 'epub';
  if (isXteink && event?.target === field('format') && field('device').value === 'original') {
    field('device').value = DEFAULT_XTEINK_PRESET_ID;
  }
  form.querySelectorAll('[data-only]').forEach((element) => {
    element.hidden = element.dataset.only !== (isXteink ? 'xt' : 'epub');
  });
  ui.customSize.hidden = field('device').value !== 'custom';
  ui.quality.textContent = field('quality').value;
  ui.mode.textContent = describeMode(readOptions().options);
}

function useSource(name, items) {
  const pages = buildPageList(items);
  if (pages.length === 0) throw new Error('Картинок не найдено (нужны jpg, png, webp, gif, bmp или avif)');
  const bytes = pages.reduce((sum, page) => sum + (page.source.entry?.size ?? page.source.file.size), 0);
  const chapters = pages.filter((page) => page.chapter).length;
  source = { name, pages };
  field('title').value = name;
  ui.summary.textContent = `${name}: ${pages.length} стр., ${chapters > 0 ? `${chapters} глав` : 'без глав'}, ${formatBytes(bytes)}`;
  ui.summary.hidden = false;
  ui.start.disabled = false;
  setStatus('');
}

async function loadArchive(file) {
  setStatus(`Читаю оглавление ${file.name}…`);
  const entries = await listZipEntries(file);
  if (entries.some((entry) => entry.encrypted)) throw new Error('Архив зашифрован паролем — такие не поддерживаются');
  const items = entries
    .filter((entry) => !entry.name.endsWith('/'))
    .map((entry) => ({ path: entry.name, source: { file, entry } }));
  useSource(stripExtension(file.name), items);
}

function loadFolder(files) {
  const items = [...files].map((file) => ({ path: file.webkitRelativePath || file.name, source: { file } }));
  useSource(items[0]?.path.split('/')[0] ?? 'manga', items);
}

async function guard(action) {
  try {
    await action();
  } catch (err) {
    setStatus(`Ошибка: ${err.message}`, true);
  }
}

function setBusy(busy) {
  ui.start.hidden = busy;
  ui.cancel.hidden = !busy;
  ui.progress.hidden = !busy;
  ui.archive.disabled = busy;
  ui.folder.disabled = busy;
  form.querySelectorAll('fieldset').forEach((fieldset) => {
    fieldset.disabled = busy;
  });
}

function showProgress({ done, total, bytes }, startedAt) {
  const seconds = Math.max((performance.now() - startedAt) / 1000, 0.001);
  const rate = done / seconds;
  ui.progress.value = done / total;
  setStatus(
    `${done} / ${total} стр. · записано ${formatBytes(bytes)} · ${rate.toFixed(1)} стр/с · осталось ≈ ${formatDuration((total - done) / Math.max(rate, 0.001))}`,
  );
}

async function openOutput() {
  if (!supportsDirectoryOutput()) return downloadOutput();
  try {
    return await pickDirectoryOutput();
  } catch (err) {
    if (err.name === 'AbortError') return null; // user closed the folder picker
    throw err;
  }
}

async function start() {
  if (!source || running || !form.reportValidity()) return;
  const { meta, options } = readOptions();
  const createSink = await openOutput();
  if (!createSink) return;

  revokeDownloads();
  clearLog();
  const workers = Math.min(MAX_WORKERS, Math.max(1, (navigator.hardwareConcurrency || 2) - 1));
  running = { controller: new AbortController(), pool: new WorkerPool(new URL('./worker.js', import.meta.url), workers) };
  setBusy(true);
  const startedAt = performance.now();
  try {
    const volumes = await convert({
      pages: source.pages,
      meta,
      options,
      createSink,
      pool: running.pool,
      signal: running.controller.signal,
      onProgress: (progress) => showProgress(progress, startedAt),
      onWarning: log,
    });
    const files = volumes.map((volume) => `${volume.name} — ${volume.pages} стр.`).join('\n');
    setStatus(`Готово за ${formatDuration((performance.now() - startedAt) / 1000)}:\n${files}`);
  } catch (err) {
    setStatus(err.name === 'AbortError' ? 'Отменено, недописанный файл удалён' : `Ошибка: ${err.message}`, err.name !== 'AbortError');
  } finally {
    running.pool.terminate();
    running = null;
    setBusy(false);
  }
}

function cancel() {
  running?.controller.abort();
  running?.pool.terminate();
}

function onDrop(event) {
  event.preventDefault();
  ui.drop.classList.remove('over');
  if (running) return;
  const entry = event.dataTransfer.items?.[0]?.webkitGetAsEntry?.();
  if (entry?.isDirectory) {
    setStatus('Папку выберите кнопкой «Папку с картинками»', true);
    return;
  }
  const [file] = event.dataTransfer.files;
  if (file) guard(() => loadArchive(file));
}

function checkSupport() {
  const missing = REQUIRED_APIS.filter((name) => !(name in globalThis));
  if (missing.length === 0) return;
  ui.unsupported.textContent = `Браузер слишком старый, нет: ${missing.join(', ')}. Нужен свежий Chrome, Edge, Firefox или Safari.`;
  ui.unsupported.hidden = false;
}

function init() {
  field('device').append(...DEVICE_PRESETS.map((preset) => new Option(preset.label, preset.id)));
  field('device').value = DEFAULT_PRESET_ID;
  restoreOptions();
  refreshForm();
  checkSupport();
  ui.outputHint.textContent = supportsDirectoryOutput()
    ? 'Файлы пишутся потоком прямо в выбранную папку — память не растёт.'
    : 'Этот браузер не умеет писать в папку: книга соберётся в памяти и скачается. Для огромных архивов лучше Chrome/Edge или разбиение на тома.';

  form.addEventListener('input', refreshForm);
  form.addEventListener('change', saveOptions);
  ui.archive.addEventListener('change', async () => {
    const [file] = ui.archive.files;
    if (file) await guard(() => loadArchive(file));
    ui.archive.value = ''; // picking the same file again must fire "change" again
  });
  ui.folder.addEventListener('change', async () => {
    const files = [...ui.folder.files];
    if (files.length > 0) await guard(() => loadFolder(files));
    ui.folder.value = '';
  });
  ui.start.addEventListener('click', () => guard(start));
  ui.cancel.addEventListener('click', cancel);
  ui.drop.addEventListener('dragover', (event) => {
    event.preventDefault();
    ui.drop.classList.add('over');
  });
  ui.drop.addEventListener('dragleave', () => ui.drop.classList.remove('over'));
  ui.drop.addEventListener('drop', onDrop);
  // A file dropped next to the zone must not navigate away from the page.
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => event.preventDefault());
}

init();
