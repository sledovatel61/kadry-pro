/**
 * RSS-лента раздела «Полезное» — `/articles/rss.xml` (Агент 03).
 *
 * Мария публикует разбор в `/manage/` — он сразу появляется здесь: подписчики и
 * сервисы рассылок видят новую статью без участия программиста.
 *
 * Что важно:
 *   • черновики и статьи без даты в ленту не попадают;
 *   • свежие сверху, максимум 20 (лента — не архив);
 *   • в описании — первые ~600 знаков чистого текста, цены уже числами из прайса;
 *   • `lastBuildDate` — дата последнего обновления файла статей.
 *
 * Ленту забирает `scripts/export-pages.mjs` отдельно: в sitemap её не кладём.
 */
import type { APIRoute } from 'astro';
import { articleUrl, categoryTitle } from '../../shared/articles-schema.ts';
import { plainText } from './_markdown.ts';
import { readArticles, publishedArticles } from './_data.ts';

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const origin = (site?.href ?? 'https://kadry-pro.ru/').replace(/\/+$/, '');

  /* Битый файл не должен ломать ленту: `_data` уже отдаёт пустой набор. */
  const items = publishedArticles().slice(0, 20);
  const updatedAt = readArticles().updated_at;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Кадры-Про — Полезное</title>
    <link>${origin}/articles.html</link>
    <description>Разборы кадрового законодательства 2026 года: штрафы ГИТ, трудовые споры, воинский учёт, охрана труда. Простым языком, с расчётами и ссылками на нормы.</description>
    <language>ru-RU</language>
    <managingEditor>m.perepechay@yandex.ru (Мария Перепечай)</managingEditor>
    <webMaster>m.perepechay@yandex.ru (Мария Перепечай)</webMaster>
    <atom:link href="${origin}/articles/rss.xml" rel="self" type="application/rss+xml" />
    ${updatedAt ? `<lastBuildDate>${rfc822(updatedAt)}</lastBuildDate>` : ''}
${items.map((article) => {
  const link = `${origin}${articleUrl(article.slug)}`;
  /* В описании — чистый текст без служебных токенов: подписчик читает абзац, а не код. */
  const text = plainText(article.body_md, 600).replace(/\{\{price:[^}]+\}\}/g, 'по запросу');
  return `    <item>
      <title>${esc(article.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${rfc822(article.published_at ?? updatedAt)}</pubDate>
      <category>${esc(categoryTitle(article.category))}</category>
      <description>${esc(article.excerpt)}</description>
      <content:encoded xmlns:content="http://purl.org/rss/1.0/modules/content/"><![CDATA[${text}]]></content:encoded>
    </item>`;
}).join('\n')}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=1800',
    },
  });
};

const esc = (value: string): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** `2026-11-21 09:30` (МСК) → RFC 822 для RSS. */
function rfc822(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(String(value ?? '').trim());
  if (!match) return new Date().toUTCString();
  const [, y, mo, d, h = '00', mi = '00'] = match;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) - 3, Number(mi)));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${days[date.getUTCDay()]}, ${p(date.getUTCDate())} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} `
    + `${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:00 +0300`;
}
