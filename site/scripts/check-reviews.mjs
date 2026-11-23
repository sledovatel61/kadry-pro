#!/usr/bin/env node
/**
 * Гейт отзывов: `site/content/reviews.json` (Агент 03).
 *
 * Отзывы — единственный блок сайта, где соврать нельзя. Поэтому гейт проверяет
 * три вещи, а не только «файл читается»:
 *   1. схема: id, автор, текст, оценка, дата — по правилам `reviews-schema.ts`;
 *   2. нет выдуманных отзывов: поля `demo`, `example`, `sample` и «рыбных»
 *      формулировок в опубликованных отзывах быть не должно;
 *   3. стартовое состояние честное: пустой файл — это нормально, и гейт так и говорит.
 *
 * Режимы:
 *   node scripts/check-reviews.mjs            — проверка и сводка;
 *   node scripts/check-reviews.mjs --strict   — падать, если остался демо-отзыв;
 *   node scripts/check-reviews.mjs --count    — только число опубликованных;
 *   node scripts/check-reviews.mjs --json     — машинный результат;
 *   node scripts/check-reviews.mjs --file P   — другой файл (для тестов).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReviewsFile, publishedReviews } from '../src/shared/reviews-schema.ts';

const siteRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

function parseArgs(argv) {
  const out = {
    strict: false,
    count: false,
    json: false,
    file: resolve(siteRoot, 'content/reviews.json'),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--strict') out.strict = true;
    else if (arg === '--count') out.count = true;
    else if (arg === '--json') out.json = true;
    else if ((arg === '--file' || arg === '--reviews') && argv[i + 1]) out.file = resolve(argv[++i]);
    else if (arg === '--help') {
      console.log('Usage: node scripts/check-reviews.mjs [--strict] [--count] [--json] [--file PATH]');
      process.exit(0);
    } else throw new Error(`Неизвестный параметр: ${arg}`);
  }
  return out;
}

/** Признаки «примерного» отзыва, который нельзя показывать как настоящий. */
const FAKE_MARKERS = [
  /\bdemo\b/i,
  /\bsample\b/i,
  /\bexample\b/i,
  /\btest\s*review\b/i,
  /lorem\s+ipsum/i,
  /здесь\s+будет\s+отзыв/i,
  /текст\s+отзыва\s+клиента/i,
  /рыбный\s+текст/i,
];

/**
 * Проверить файл отзывов.
 * @param {string} filePath
 * @param {{ strict?: boolean }} [options]
 */
export function checkReviewsFile(filePath, options = {}) {
  const strict = Boolean(options.strict);
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  /** @type {string[]} */
  const demo = [];

  if (!existsSync(filePath)) {
    return {
      ok: false,
      errors: [`файл не найден: ${filePath}`],
      warnings,
      demo,
      published: 0,
      hidden: 0,
      total: 0,
    };
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (e) {
    return { ok: false, errors: [`битый JSON: ${e.message}`], warnings, demo, published: 0, hidden: 0, total: 0 };
  }

  const parsed = parseReviewsFile(raw);
  errors.push(...parsed.errors.map((e) => `схема: ${e}`));

  const items = parsed.file.items;
  for (const item of items) {
    const record = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (item));
    const flags = ['demo', 'example', 'sample', 'is_demo', 'isExample'];
    for (const flag of flags) {
      if (record[flag] === true) demo.push(`${item.id} (${flag})`);
    }
    const haystack = `${item.text} ${item.author}`;
    if (FAKE_MARKERS.some((re) => re.test(haystack))) demo.push(`${item.id} (похож на образец)`);
  }

  if (strict && demo.length) errors.push(`в файле остались ненастоящие отзывы: ${demo.join(', ')}`);

  const published = publishedReviews(parsed.file);
  const hidden = items.length - published.length;

  if (items.length === 0) {
    warnings.push('отзывов пока нет — это честное стартовое состояние, блок на сайте скажет «пока нет отзывов»');
  }
  if (published.length > 0 && published.length < 3) {
    warnings.push(`опубликовано всего ${published.length} — блок на сайте показывается, но лучше дождаться нескольких`);
  }

  /* Повтор id — отдельная беда: в схеме он может пройти, а ключ в KV затрётся. */
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) errors.push(`повторяется id «${item.id}»`);
    seen.add(item.id);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    demo,
    published: published.length,
    hidden,
    total: items.length,
  };
}

export function summarize(result) {
  const lines = [];
  lines.push(`Отзывы: всего ${result.total}, опубликовано ${result.published}, скрыто ${result.hidden}.`);
  if (result.total === 0) lines.push('Файл пуст — выдуманных отзывов нет, это правильное стартовое состояние.');
  for (const warning of result.warnings) lines.push(`• ${warning}`);
  for (const error of result.errors) lines.push(`✗ ${error}`);
  if (result.ok) lines.push('Проверка пройдена.');
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  const result = checkReviewsFile(options.file, options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (options.count) {
    console.log(String(result.published));
  } else {
    console.log(summarize(result));
  }
  process.exit(result.ok ? 0 : 1);
}
