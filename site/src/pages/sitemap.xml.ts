/**
 * sitemap.xml — те же 14 адресов, что были в корневом sitemap.xml, но
 * собираются автоматически: дата lastmod берётся из даты сборки, поэтому
 * карта не отстаёт от сайта (раньше её правили руками и забывали).
 *
 * Служебные страницы (404, thank-you, thank-you-paid, bundle-download)
 * в карту не попадают. /consent.html добавит Агент 02 отдельным маршрутом
 * в своей зоне — здесь его нет, чтобы не пересекаться по файлам.
 */
import type { APIRoute } from 'astro';

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
];

export const GET: APIRoute = () => {
  const urls = PAGES.map(
    (page) => `  <url>
    <loc>${ORIGIN}${page.path}</loc>
    <lastmod>${LASTMOD}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`,
  ).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
