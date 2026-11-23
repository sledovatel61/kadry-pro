#!/usr/bin/env node
/**
 * Гейт статей: `site/content/articles.json` (Агент 03).
 *
 * Главная беда статей — не «битый JSON», а цена, написанная руками. Мария правит
 * прайс, а в тексте остаётся старое число, и сайт начинает обещать не то. Поэтому
 * гейт:
 *   1. проверяет схему (`articles-schema.ts`) — даты, категории, размеры;
 *   2. проверяет каждую `{{price:id}}` по прайсу `site/content/prices.json`:
 *      неизвестный id — ошибка, повторяющиеся короткие id — предупреждение;
 *   3. ищет хардкод цен в тексте («от 7 900 ₽») — подсказывает заменить на токен;
 *   4. проверяет, что slug не повторяется и что адрес статьи латиницей.
 *
 * Режимы:
 *   node scripts/check-articles.mjs            — проверка и сводка;
 *   node scripts/check-articles.mjs --strict   — падать на предупреждениях тоже;
 *   node scripts/check-articles.mjs --count    — только число опубликованных;
 *   node scripts/check-articles.mjs --json     — машинный результат;
 *   node scripts/check-articles.mjs --file P --prices Q
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArticlesFile, publishedArticles, ARTICLE_LIMITS } from '../src/shared/articles-schema.ts';
import { priceLookupFrom, knownPriceIds } from '../src/pages/articles/_markdown.ts';

const siteRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

function parseArgs(argv) {
  const out = {
    strict: false,
    count: false,
    json: false,
    file: resolve(siteRoot, 'content/articles.json'),
    prices: resolve(siteRoot, 'content/prices.json'),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--strict') out.strict = true;
    else if (arg === '--count') out.count = true;
    else if (arg === '--json') out.json = true;
    else if ((arg === '--file' || arg === '--articles') && argv[i + 1]) out.file = resolve(argv[++i]);
    else if (arg === '--prices' && argv[i + 1]) out.prices = resolve(argv[++i]);
    else if (arg === '--help') {
      console.log('Usage: node scripts/check-articles.mjs [--strict] [--count] [--json] [--file PATH] [--prices PATH]');
      process.exit(0);
    } else throw new Error(`Неизвестный параметр: ${arg}`);
  }
  return out;
}

const tokenRe = /\{\{price:([a-z0-9_.-]+)(?:\|[^}]*)?\}\}/gi;
const tokensIn = (md) => [...String(md ?? '').matchAll(tokenRe)].map((m) => m[1].toLowerCase());

/**
 * Цена, написанная руками вместо токена: «аудит — 9 900 ₽», «по цене 3 500 ₽».
 * Штрафы по КоАП («до 100 000 ₽») — не наш прайс, их трогать нельзя: исключаем
 * контекст «штраф», «до», «не более», «санкц». Оставляем остальное, чтобы Мария
 * видела, где текст может разойтись с прайсом.
 */
const HARDCODED_PRICE = /(?<![\d.,])\d{1,3}(?:[\s\u00a0]\d{3})+\s*(?:₽|руб)/gi;
const LEGAL_CONTEXT = /(?:штраф|санкц|до\s+\d|не\s+более|взыск|компенсац|ущерб|потерп)/i;

/** Вырезать фрагмент вокруг найденной суммы — по нему и решаем, «наш» это прайс или КоАП. */
function isHardcodedServicePrice(md, match) {
  const at = match.index ?? 0;
  const text = String(md);
  /* Смотрим и назад, и вперёд: «**50 000 ₽** за нарушение сроков» — штраф,
     хотя слово «штраф» стоит абзацем выше. */
  const context = text.slice(Math.max(0, at - 90), at + match[0].length + 90);
  if (LEGAL_CONTEXT.test(context)) return false;
  // наши цены — круглые суммы услуг: 1 000 … 99 900; миллионы и сотни тысяч — это штрафы
  const digits = Number(match[0].replace(/[^\d]/g, ''));
  return Number.isFinite(digits) && digits >= 1000 && digits <= 99900 && digits % 100 === 0;
}

/**
 * @param {string} filePath
 * @param {{ strict?: boolean, pricesPath?: string }} [options]
 */
export function checkArticlesFile(filePath, options = {}) {
  const strict = Boolean(options.strict);
  const pricesPath = options.pricesPath ?? resolve(siteRoot, 'content/prices.json');
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];

  if (!existsSync(filePath)) {
    return { ok: false, errors: [`файл не найден: ${filePath}`], warnings, published: 0, drafts: 0, total: 0, priceTokens: 0, knownPrices: 0 };
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (e) {
    return { ok: false, errors: [`битый JSON: ${e.message}`], warnings, published: 0, drafts: 0, total: 0, priceTokens: 0, knownPrices: 0 };
  }

  const parsed = parseArticlesFile(raw);
  errors.push(...parsed.errors.map((e) => `схема: ${e}`));

  /* Прайс ведёт Агент 02: без файла токены не проверить — это предупреждение. */
  let prices = null;
  if (existsSync(pricesPath)) {
    try {
      prices = priceLookupFrom(JSON.parse(readFileSync(pricesPath, 'utf8')));
    } catch (e) {
      warnings.push(`прайс не прочитан (${e.message}) — токены цен не проверены`);
    }
  } else {
    warnings.push(`прайса ещё нет (${pricesPath}) — токены цен не проверены`);
  }
  const known = prices ? new Set(knownPriceIds(JSON.parse(readFileSync(pricesPath, 'utf8')))) : null;

  const items = parsed.file.items;
  const allTokens = new Set();
  items.forEach((article, index) => {
    const at = `статья «${article.title}»`;
    const tokens = tokensIn(article.body_md);
    tokens.forEach((t) => allTokens.add(t));

    if (prices) {
      for (const token of tokens) {
        if (prices.price(token) === null && !(known && known.has(token))) {
          errors.push(`${at}: цена «{{price:${token}}}» не найдена в прайсе`);
        } else if (prices.price(token) === null) {
          warnings.push(`${at}: у «${token}» пустая цена — на сайте будет «по запросу»`);
        }
      }
    }

    const hardcoded = [...article.body_md.matchAll(HARDCODED_PRICE)]
      .filter((m) => isHardcodedServicePrice(article.body_md, m))
      .map((m) => m[0]);
    if (hardcoded.length) {
      warnings.push(`${at}: цена услуги написана руками (${hardcoded.slice(0, 3).join(', ')}) — лучше токен {{price:id}}, иначе прайс и статья разойдутся`);
    }

    if (article.status === 'published') {
      if (!article.updated_at) warnings.push(`${at}: нет даты обновления — на сайте не покажется «обновлено»`);
      const words = article.body_md.split(/\s+/).filter(Boolean).length;
      if (words < 250) warnings.push(`${at}: всего ${words} слов — для поиска коротковато, но публиковать можно`);
      if (index > 0) {
        const prev = items[index - 1];
        if (prev.title === article.title) errors.push(`повторяется заголовок «${article.title}»`);
      }
      if (article.body_md.length > ARTICLE_LIMITS.bodyMd[1]) errors.push(`${at}: текст длиннее ${ARTICLE_LIMITS.bodyMd[1]} знаков`);
    }

    if (/^#\s+/m.test(article.body_md)) {
      warnings.push(`${at}: в тексте есть «# заголовок» — на сайте название статьи уже стоит сверху, нужен «##»`);
    }
  });

  const slugs = new Set();
  for (const article of items) {
    if (slugs.has(article.slug)) errors.push(`повторяется slug «${article.slug}»`);
    slugs.add(article.slug);
  }

  const published = publishedArticles(parsed.file);
  if (published.length === 0) warnings.push('нет опубликованных статей — раздел «Полезное» будет пустым');
  if (strict && warnings.length) errors.push(`режим --strict: ${warnings.length} предупреждений`);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    published: published.length,
    drafts: items.length - published.length,
    total: items.length,
    priceTokens: allTokens.size,
    knownPrices: known ? known.size : 0,
  };
}

export function summarize(result) {
  const lines = [
    `Статьи: всего ${result.total}, опубликовано ${result.published}, черновиков ${result.drafts}.`,
    `Токенов цен в текстах: ${result.priceTokens}, известно цен в прайсе: ${result.knownPrices}.`,
  ];
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
  const result = checkArticlesFile(options.file, {
    strict: options.strict,
    pricesPath: options.prices,
  });
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else if (options.count) console.log(String(result.published));
  else console.log(summarize(result));
  process.exit(result.ok ? 0 : 1);
}
