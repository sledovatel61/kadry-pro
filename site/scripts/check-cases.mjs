#!/usr/bin/env node
/**
 * Гейт кейсов: `site/content/cases.json` (Агент 03).
 *
 * Кейс — это обещание конкретного результата: «21 филиал», «10 дней», «50 вахтовиков».
 * Поэтому гейт проверяет не только схему, но и то, что результат вообще измерим
 * (в нём есть число), и что кейсы не повторяются.
 *
 * Режимы:
 *   node scripts/check-cases.mjs             — проверка и сводка по направлениям;
 *   node scripts/check-cases.mjs --strict    — падать, если опубликованный кейс без цифр;
 *   node scripts/check-cases.mjs --count     — только число опубликованных;
 *   node scripts/check-cases.mjs --json      — машинный результат;
 *   node scripts/check-cases.mjs --file P    — другой файл (для тестов).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCasesFile, publishedCases, caseCounts, CASE_AREAS_TITLE } from '../src/shared/cases-schema.ts';

const siteRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

function parseArgs(argv) {
  const out = {
    strict: false,
    count: false,
    json: false,
    file: resolve(siteRoot, 'content/cases.json'),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--strict') out.strict = true;
    else if (arg === '--count') out.count = true;
    else if (arg === '--json') out.json = true;
    else if ((arg === '--file' || arg === '--cases') && argv[i + 1]) out.file = resolve(argv[++i]);
    else if (arg === '--help') {
      console.log('Usage: node scripts/check-cases.mjs [--strict] [--count] [--json] [--file PATH]');
      process.exit(0);
    } else throw new Error(`Неизвестный параметр: ${arg}`);
  }
  return out;
}

const HAS_NUMBER = /\d/;

/**
 * @param {string} filePath
 * @param {{ strict?: boolean }} [options]
 */
export function checkCasesFile(filePath, options = {}) {
  const strict = Boolean(options.strict);
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];

  if (!existsSync(filePath)) {
    return { ok: false, errors: [`файл не найден: ${filePath}`], warnings, published: 0, drafts: 0, total: 0, byArea: {} };
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (e) {
    return { ok: false, errors: [`битый JSON: ${e.message}`], warnings, published: 0, drafts: 0, total: 0, byArea: {} };
  }

  const parsed = parseCasesFile(raw);
  errors.push(...parsed.errors.map((e) => `схема: ${e}`));

  const items = parsed.file.cases;
  items.forEach((item, index) => {
    const measured = item.results.filter((r) => HAS_NUMBER.test(r));
    if (item.status === 'published' && measured.length === 0) {
      const text = `кейс «${item.title}» (${index + 1}-й): ни одного результата с числом — такой кейс продаёт хуже, чем мог бы`;
      if (strict) errors.push(text);
      else warnings.push(text);
    }
    if (!item.client) warnings.push(`кейс «${item.title}»: не заполнен клиент — на странице будет пустая строка`);
  });

  const slugs = new Set();
  for (const item of items) {
    if (slugs.has(item.slug)) errors.push(`повторяется slug «${item.slug}»`);
    slugs.add(item.slug);
  }

  const published = publishedCases(parsed.file);
  const counts = caseCounts(parsed.file);
  /** @type {Record<string, number>} */
  const byArea = {};
  for (const [area, count] of Object.entries(counts)) {
    if (count > 0) byArea[CASE_AREAS_TITLE[area] ?? area] = count;
  }

  if (published.length === 0) warnings.push('опубликованных кейсов нет — страница «Кейсы» останется с прежним текстом');

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    published: published.length,
    drafts: items.length - published.length,
    total: items.length,
    byArea,
  };
}

export function summarize(result) {
  const lines = [`Кейсы: всего ${result.total}, опубликовано ${result.published}, черновиков ${result.drafts}.`];
  const areas = Object.entries(result.byArea);
  if (areas.length) lines.push(`По направлениям: ${areas.map(([k, v]) => `${k} — ${v}`).join(', ')}.`);
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
  const result = checkCasesFile(options.file, options);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else if (options.count) console.log(String(result.published));
  else console.log(summarize(result));
  process.exit(result.ok ? 0 : 1);
}
