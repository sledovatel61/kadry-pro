/**
 * Загрузка статей и прайса для страниц раздела «Полезное» (Агент 03).
 *
 * Почему отдельный модуль: `getStaticPaths()` исполняется вне фронтматтера
 * страницы, поэтому константы, вычисленные там, ему не видны. Здесь чтение
 * файлов собрано в одном месте, и страница, лента и `getStaticPaths` берут
 * данные одинаково.
 *
 * Имя начинается с подчёркивания — Astro не считает файл маршрутом.
 * Модуль серверный (node:fs), в клиентскую сборку не попадает.
 */
import { readFileSync } from 'node:fs';
import { parseArticlesFile, type ArticlesFile, type ArticleItem } from '../../shared/articles-schema.ts';
import { type PriceLookup, priceLookup } from './_markdown.ts';

const ARTICLES_URL = new URL('../../../content/articles.json', import.meta.url);
const PRICES_URL = new URL('../../../content/prices.json', import.meta.url);

/** Файл статей; битый файл — пустой, но валидный набор (сборка не падает). */
export function readArticles(): ArticlesFile {
  try {
    return parseArticlesFile(JSON.parse(readFileSync(ARTICLES_URL, 'utf8'))).file;
  } catch {
    return { version: 1, updated_at: '', items: [] };
  }
}

/** Только опубликованные, свежие сверху. */
export function publishedArticles(): ArticleItem[] {
  return readArticles().items
    .filter((a) => a.status === 'published' && a.published_at)
    .sort((a, b) => ((a.published_at ?? '') < (b.published_at ?? '') ? 1 : -1));
}

/**
 * Подстановка `{{price:id}}`. Прайс ведёт Агент 02: пока файла нет, токены честно
 * показывают «по запросу», а не выдуманное число.
 */
export function readPrices(): PriceLookup {
  try {
    return priceLookup(readFileSync(PRICES_URL, 'utf8'));
  } catch {
    return { price: () => null, title: (id: string) => id };
  }
}

export const MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** `2026-03-18 09:00` → «18 марта 2026». */
export function fmtDateRu(value: string | null): string {
  if (!value) return '';
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getUTCDate()} ${MONTHS_RU[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** ISO с московским поясом — так даты читают поисковики и соцсети. */
export function isoMoscow(value: string | null): string | undefined {
  if (!value) return undefined;
  const [date, time] = value.replace('T', ' ').split(' ');
  return `${date}T${time || '00:00'}:00+03:00`;
}
