/**
 * check-pages.mjs — проверка собранного статического сайта.
 *
 * Смотрит папку site/pages-dist (или site/dist) и проверяет то, что реально
 * ломает деньги и SEO:
 *   1. все прежние адреса на месте: /, services.html, podbor.html, audit.html,
 *      lna.html, sout.html, voinskiy-uchet.html, shtrafy-git.html,
 *      trudovoy-spor.html, about.html, cases.html, contact.html, 404.html,
 *      shablony.html, privacy.html, consent.html, thank-you.html,
 *      thank-you-paid.html, bundle-download.html, articles.html, manage.html
 *      и manage/index.html (кабинет доступен и по /manage/, и по /manage.html);
 *   2. на каждой странице ровно один <h1>, есть canonical, title, description,
 *      og:image и JSON-LD (служебная noindex-страница /manage от этих требований
 *      освобождена);
 *   3. нет прямых тегов Яндекс.Метрики и GA4 (счётчики грузятся только после
 *      согласия — это проверяет check-analytics Агента 02, здесь страховка);
 *   4. нет ссылок, ведущих на старый чужой Telegram t.me/perepechay;
 *   5. нет @import с fonts.googleapis.com (шрифты локальные);
 *   6. нет «мёртвых» ссылок: .html-адресы сверяются со списком страниц,
 *      а статические файлы (.pdf, .zip, .xml, .jpg и т.п.) — с диском
 *      через fs.existsSync, чтобы не считать их страницами;
 *   7. нет пустых alt у содержательных картинок и «жирных» картинок без
 *      width/height (даёт сдвиг вёрстки);
 *   8. опубликованные статьи из site/content/articles.json отрендерились в
 *      /articles/<slug>.html и попали в sitemap.xml вместе с /consent.html.
 *
 * Запуск: node scripts/check-pages.mjs [--dir dist]
 * Код возврата 1 — есть ошибки, 0 — всё хорошо.
 */
import { readFile, readdir, access, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const dirArg = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : 'pages-dist';
const SITE = resolve(import.meta.dirname, '..');
const DIR = resolve(SITE, dirArg);

const REQUIRED = [
  'index.html', 'services.html', 'podbor.html', 'shablony.html', 'audit.html',
  'lna.html', 'sout.html', 'voinskiy-uchet.html', 'shtrafy-git.html',
  'trudovoy-spor.html', 'about.html', 'cases.html', 'contact.html',
  'privacy.html', 'consent.html', 'thank-you.html', 'thank-you-paid.html',
  'bundle-download.html', '404.html', 'articles.html', 'manage.html',
  'manage/index.html',
];

const errors = [];
const warnings = [];
const ok = [];

const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

try {
  await access(DIR);
} catch {
  console.error(`Нет папки ${DIR}. Сначала соберите сайт: npm run build && npm run build:pages`);
  process.exit(1);
}

const files = await readdir(DIR);
/* Файл подтверждения Яндекс.Вебмастера — служебная заглушка, требований к
   разметке у неё нет; кабинет /manage — служебная noindex-страница.
   Их итоговые имена складываются ниже из путей с подпапками. */
const SERVICE_FILES = new Set(['yandex_22774c0af65b478b.html', 'manage.html', 'manage/index.html']);
/* Утилитарные страницы: обычные title/description/og:image у них есть,
   но JSON-LD не обязателен — это не продающие страницы. */
const NO_JSONLD = new Set([
  'privacy.html', 'consent.html', 'thank-you.html', 'thank-you-paid.html',
  'bundle-download.html', '404.html',
]);

/* Собираем все .html рекурсивно (вложенные статьи и manage/index.html). */
async function collectHtml(dir, prefix = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === '_astro' || entry.name.startsWith('.')) continue;
      out.push(...(await collectHtml(join(dir, entry.name), rel)));
    } else if (entry.name.endsWith('.html')) {
      out.push(rel);
    }
  }
  return out;
}

const htmlFiles = (await collectHtml(DIR)).sort();

/* 1. адреса */
for (const req of REQUIRED) {
  if (htmlFiles.includes(req)) ok.push(`адрес на месте: /${req}`);
  else fail(`пропал адрес /${req}`);
}

/* список всех адресов сборки — для проверки внутренних ссылок */
const addresses = new Set(['/', '/sitemap.xml', '/robots.txt']);
for (const file of htmlFiles) {
  addresses.add(`/${file}`);
  if (file.endsWith('index.html')) {
    addresses.add(`/${file.replace(/index\.html$/, '')}`);
    addresses.add(`/${file.replace(/index\.html$/, '').replace(/\/$/, '')}`);
  }
  if (file.endsWith('.html')) addresses.add(`/${file.replace(/\.html$/, '')}`);
}

/* Статические файлы: проверяем наличие на диске, а не как страницы. */
const STATIC_EXT = /\.(pdf|zip|xml|jpg|jpeg|png|webp|avif|svg|ico|css|js|mjs|woff2?|ttf|txt|json)$/i;
function staticExists(href) {
  const path = decodeURIComponent(href.replace(/^\//, '').split(/[?#]/)[0]);
  return existsSync(join(DIR, path));
}

for (const file of htmlFiles) {
  const html = await readFile(join(DIR, file), 'utf8');
  const name = `/${file}`;
  const isService = SERVICE_FILES.has(file);

  /* 2. базовая разметка (служебная noindex-страница /manage освобождена
        от требований canonical / og:image / JSON-LD — так и задумано) */
  const h1 = (html.match(/<h1[\s>]/g) || []).length;
  if (h1 === 0 && !isService) fail(`${name}: нет <h1>`);
  if (h1 > 1) warn(`${name}: заголовков <h1> больше одного (${h1})`);

  if (!isService && !/<title>[^<]{5,}<\/title>/.test(html)) fail(`${name}: пустой или короткий <title>`);
  if (!isService && !/<meta name="description" content="[^"]{30,}"/.test(html)) fail(`${name}: нет описания (description)`);
  if (!isService && !/<link rel="canonical" href="https:\/\/kadry-pro\.ru\//.test(html) && file !== '404.html') {
    fail(`${name}: нет canonical на kadry-pro.ru`);
  }
  if (!isService && !/<meta property="og:image"/.test(html)) fail(`${name}: нет og:image`);
  if (!isService && !NO_JSONLD.has(file) && !/<script type="application\/ld\+json">/.test(html)) {
    warn(`${name}: нет JSON-LD разметки`);
  }

  /* 3. счётчики до согласия */
  if (/mc\.yandex\.ru\/(metrika|watch)/.test(html)) fail(`${name}: прямой пиксель/скрипт Яндекс.Метрики в разметке (должен грузиться только после согласия)`);
  if (/googletagmanager\.com/.test(html)) fail(`${name}: прямой скрипт Google Analytics в разметке (должен грузиться только после согласия)`);

  /* 4. старый Telegram */
  if (/t\.me\/perepechay|t\.me\/\+79613022112/.test(html)) {
    fail(`${name}: осталась старая ссылка Telegram (нужен только https://t.me/Mariya061)`);
  }

  /* 5. Google Fonts */
  if (/fonts\.googleapis\.com/.test(html)) fail(`${name}: остался @import/ссылка на Google Fonts`);

  /* 6. внутренние ссылки: страницы — по списку адресов, статика — по диску */
  const hrefs = [...html.matchAll(/(?:href|src)="(\/[^"#?]*)"/g)].map((m) => m[1]);
  for (const href of new Set(hrefs)) {
    if (href.startsWith('/_astro') || href.startsWith('/img') || href.startsWith('/fonts') || href.startsWith('/styles')) continue;
    if (/\.(woff2?|ttf)$/.test(href)) continue;
    if (/\/(favicon\.(ico|png|svg)|robots\.txt)$/.test(href)) continue;
    if (href === '/') continue;
    if (STATIC_EXT.test(href)) {
      if (!staticExists(href)) fail(`${name}: ссылка ${href} — файла нет в сборке`);
      continue;
    }
    if (addresses.has(href)) continue;
    if (addresses.has(`${href}.html`)) continue;
    if (href.endsWith('/') && addresses.has(href.slice(0, -1))) continue;
    warn(`${name}: ссылка ${href} — такой страницы в этой сборке нет`);
  }

  /* 7. картинки */
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    const tag = m[0];
    if (!/\balt=/.test(tag)) warn(`${name}: <img> без alt: ${tag.slice(0, 90)}`);
    if (!/\bwidth=/.test(tag) && !/\bclass="(logo|hero-photo)/.test(tag)) {
      warn(`${name}: <img> без width/height (сдвиг вёрстки): ${tag.slice(0, 90)}`);
    }
  }
}

/* 8. статьи: каждая опубликованная в articles.json должна быть в сборке и в sitemap */
let publishedCount = 0;
try {
  const articlesFile = JSON.parse(readFileSync(join(SITE, 'content/articles.json'), 'utf8'));
  const published = (articlesFile.items ?? []).filter((a) => a.status === 'published' && a.published_at);
  publishedCount = published.length;
  const sitemap = existsSync(join(DIR, 'sitemap.xml')) ? await readFile(join(DIR, 'sitemap.xml'), 'utf8') : '';
  for (const article of published) {
    const rel = `articles/${article.slug}.html`;
    if (!htmlFiles.includes(rel)) fail(`статья не отрендерилась: /${rel}`);
    else ok.push(`статья на месте: /${rel}`);
    if (sitemap && !sitemap.includes(`/articles/${article.slug}.html`)) {
      fail(`sitemap.xml: нет статьи /articles/${article.slug}.html`);
    }
  }
  if (sitemap && !sitemap.includes('/consent.html')) fail('sitemap.xml: нет /consent.html');
} catch (error) {
  fail(`не удалось прочитать site/content/articles.json: ${error.message}`);
}

/* служебные файлы рядом со страницами */
for (const extra of ['robots.txt', 'sitemap.xml', 'CNAME']) {
  if (!files.includes(extra)) fail(`в сборке нет ${extra}`);
}
const cname = files.includes('CNAME') ? (await readFile(join(DIR, 'CNAME'), 'utf8')).trim() : '';
if (cname !== 'kadry-pro.ru') fail(`CNAME должен быть kadry-pro.ru, а он «${cname}»`);

/* медиа-бюджет портрета — грузится на главной и на «Обо мне» */
for (const f of ['img/maria-480.webp', 'img/maria-720.webp', 'img/maria-1080.webp', 'img/og-default.jpg']) {
  try {
    const { size } = await stat(join(DIR, f));
    if (size > 200 * 1024) warn(`${f}: ${Math.round(size / 1024)} КБ — тяжеловато`);
  } catch {
    fail(`в сборке нет ${f}`);
  }
}

const report = [];
report.push(`Проверено страниц: ${htmlFiles.length} (опубликованных статей: ${publishedCount})`);
if (ok.length) report.push(`\n✓ В порядке (${ok.length}):\n  ${ok.join('\n  ')}`);
if (warnings.length) report.push(`\n⚠ Предупреждения (${warnings.length}):\n  ${warnings.join('\n  ')}`);
if (errors.length) report.push(`\n✗ Ошибки (${errors.length}):\n  ${errors.join('\n  ')}`);
report.push(`\nИтог: ${errors.length ? 'ЕСТЬ ОШИБКИ' : warnings.length ? 'страницы в порядке, есть предупреждения' : 'страницы в порядке'}`);
console.log(report.join('\n'));
process.exit(errors.length ? 1 : 0);
