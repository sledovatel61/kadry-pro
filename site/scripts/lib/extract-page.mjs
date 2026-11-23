/**
 * Одноразовый конвертер старых HTML-страниц в заготовки Astro.
 *
 * Читает эталонные файлы из корня репозитория (index.html, services.html, …)
 * и складывает:
 *   site/src/pages/_content/<page>.json  — заголовок, описание, JSON-LD-блоки;
 *   site/src/pages/_content/<page>.html  — «тело» страницы: ровно то содержимое,
 *                                          что было между шапкой и подвалом.
 *
 * Шапка, подвал, мобильное меню, прелоадер, фон, куки-баннер и счётчики
 * больше не копируются в каждую страницу — они живут в общих компонентах
 * (Header.astro, Footer.astro, Base.astro, CookieConsent Агента 02).
 *
 * Запуск из папки site/:  node scripts/lib/extract-page.mjs
 * Скрипт нужен только на время переезда; сборка его не вызывает.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = resolve(import.meta.dirname, '../../..');   // корень репозитория kadry-pro
const SITE = resolve(import.meta.dirname, '../..');      // папка site/
const OUT = join(SITE, 'src/pages/_content');

const PAGES = [
  'index', 'services', 'podbor', 'audit', 'lna', 'sout',
  'voinskiy-uchet', 'shtrafy-git', 'trudovoy-spor', 'about', 'cases', 'contact',
];

/** Узлы, которые переехали в общие компоненты и в странице не нужны. */
const DROP_SELECTORS = [
  '#bg-decor', '.preloader', 'nav.nav', '.mobile-menu', 'footer.footer',
  '.fixed-call', '.cookie-banner', 'script', 'noscript', 'meta', 'link',
];

/** Ссылки вида services.html → /services (build.format 'file' отдаёт тот же адрес). */
function rewriteLinks(html) {
  return html.replace(
    /href="(?:\.\/)?([a-z0-9-]+)\.html(\?[^"#]*)?"/g,
    (_m, name, query) => `href="/${name}${query ?? ''}"`,
  );
}

function readMeta(raw) {
  const dom = new JSDOM(raw);
  const d = dom.window.document;
  const jsonLd = [...d.querySelectorAll('script[type="application/ld+json"]')]
    .map((s) => {
      const text = (s.textContent ?? '').trim();
      try {
        return JSON.parse(text);
      } catch {
        return null;   // битый блок не тащим в новую страницу — его видно в отчёте
      }
    })
    .filter(Boolean);
  const robots = d.querySelector('meta[name="robots"]')?.getAttribute('content') ?? '';
  return {
    title: (d.title || '').trim(),
    description: d.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
    robots,
    jsonLd,
    brokenJsonLd: [...d.querySelectorAll('script[type="application/ld+json"]')].length - jsonLd.length,
  };
}

function readBody(raw) {
  const dom = new JSDOM(raw);
  const d = dom.window.document;
  const body = d.body;
  for (const sel of DROP_SELECTORS) body.querySelectorAll(sel).forEach((el) => el.remove());
  /* Пустые обёртки и комментарии-«якоря» под прелоадер оставляем как есть:
     они не мешают, зато диф с эталоном читается глазами. */
  const html = rewriteLinks(body.innerHTML)
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return html;
}

await mkdir(OUT, { recursive: true });
const report = [];
for (const slug of PAGES) {
  const raw = await readFile(join(ROOT, `${slug}.html`), 'utf8');
  const meta = readMeta(raw);
  const body = readBody(raw);
  await writeFile(join(OUT, `${slug}.json`), JSON.stringify({ slug, ...meta }, null, 2) + '\n');
  await writeFile(join(OUT, `${slug}.html`), body + '\n');
  report.push(`${slug.padEnd(16)} body ${String(body.length).padStart(6)} симв., JSON-LD ${meta.jsonLd.length}${meta.brokenJsonLd ? ` (битых ${meta.brokenJsonLd})` : ''}`);
}
console.log(report.join('\n'));
