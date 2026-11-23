/**
 * RSS-лента раздела «Полезное» — /articles/rss.xml.
 *
 * На страницах стоит <link rel="alternate" type="application/rss+xml"
 * href="/articles/rss.xml">, и автопроверка превью требует, чтобы каждый
 * локальный файл реально лежал на диске. Лента собирается из того же
 * content/articles.json, что и страницы статей.
 */
import type { APIRoute } from 'astro';
import { publishedArticles } from './_data.ts';

const SITE = 'https://kadry-pro.ru';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `YYYY-MM-DD HH:MM` (МСК) → `Sun, 23 Nov 2026 07:00:00 GMT` (RFC 822). */
function toRfc822(value: string | null): string {
  if (!value) return '';
  const date = new Date(value.trim().replace(' ', 'T') + ':00+03:00');
  return Number.isNaN(date.getTime()) ? '' : date.toUTCString();
}

export const GET: APIRoute = () => {
  const items = publishedArticles();
  const latest = items[0]?.updated_at ?? items[0]?.published_at ?? '';

  const entries = items
    .map((a) => {
      const link = `${SITE}/articles/${a.slug}.html`;
      const pub = toRfc822(a.published_at);
      return [
        '    <item>',
        `      <title>${esc(a.seo_title || a.title)}</title>`,
        `      <link>${link}</link>`,
        `      <guid isPermaLink="true">${link}</guid>`,
        `      <description>${esc(a.excerpt)}</description>`,
        pub ? `      <pubDate>${pub}</pubDate>` : '      <pubDate />',
        '    </item>',
      ].join('\n');
    })
    .join('\n');

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '  <channel>',
    '    <title>Кадры-Про — Полезное</title>',
    `    <link>${SITE}/articles.html</link>`,
    '    <description>Разборы законов, кадровых ситуаций и требований проверяющих органов. Мария Перепечай.</description>',
    '    <language>ru</language>',
    latest ? `    <lastBuildDate>${toRfc822(latest)}</lastBuildDate>` : '    <lastBuildDate />',
    entries,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
};
