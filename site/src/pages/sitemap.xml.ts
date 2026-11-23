/**
 * sitemap.xml — прежние 14 адресов плюс consent.html и опубликованные статьи
 * раздела «Полезное» (/articles/*.html). lastmod берётся из даты сборки, поэтому
 * карта не отстаёт от сайта (раньше её правили руками и забывали).
 *
 * Служебные страницы (404, thank-you, thank-you-paid, bundle-download, manage)
 * в карту не попадают.
 */
import type { APIRoute } from 'astro';
import { publishedArticles } from './articles/_data.ts';
import { articleUrl } from '../shared/articles-schema.ts';

const ORIGIN = 'https://kadry-pro.ru';

/** lastmod — дата сборки в формате YYYY-MM-DD (в UTC, как требует Google). */
const LASTMOD = new Date().toISOString().slice(0, 10);

const PAGES: { path: string; changefreq: string; priority: string }[] = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/shablony.html', changefreq: 'weekly', priority: '0.9' },
  { path: '/services.html', changefreq: 'weekly', priority: '0.9' },
  { path: '/shtrafy-git.html', changefreq: 'monthly', priority: '0.8' },
  { path: '/lna.html', changefreq: 'monthly', priority: '0.8' },
  { path: '/sout.html', changefreq: 'monthly', priority: '0.8' },
  { path: '/voinskiy-uchet.html', changefreq: 'monthly', priority: '0.8' },
  { path: '/audit.html', changefreq: 'monthly', priority: '0.8' },
  { path: '/podbor.html', changefreq: 'monthly', priority: '0.8' },
  { path: '/trudovoy-spor.html', changefreq: 'monthly', priority: '0.8' },
  { path: '/about.html', changefreq: 'monthly', priority: '0.7' },
  { path: '/cases.html', changefreq: 'monthly', priority: '0.7' },
  { path: '/contact.html', changefreq: 'monthly', priority: '0.7' },
  { path: '/privacy.html', changefreq: 'yearly', priority: '0.3' },
  { path: '/consent.html', changefreq: 'yearly', priority: '0.3' },
];

export const GET: APIRoute = () => {
  const articleUrls = publishedArticles().map((article) => {
    const lastmod = article.updated_at ?? article.published_at ?? '';
    return {
      path: articleUrl(article.slug),
      lastmod: /^\d{4}-\d{2}-\d{2}/.test(lastmod) ? lastmod.slice(0, 10) : LASTMOD,
    };
  });

  const urls = [
    ...PAGES.map((page) => ({ path: page.path, lastmod: LASTMOD, meta: page })),
    ...articleUrls.map((a) => ({ path: a.path, lastmod: a.lastmod, meta: { changefreq: 'monthly', priority: '0.7' } })),
  ]
    .map(
      (entry) => `  <url>
    <loc>${ORIGIN}${entry.path}</loc>
    <lastmod>${entry.lastmod}</lastmod>
    <changefreq>${entry.meta.changefreq}</changefreq>
    <priority>${entry.meta.priority}</priority>
  </url>`,
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
