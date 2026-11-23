/**
 * check-pages.mjs — проверка собранного статического сайта.
 *
 * Смотрит папку site/pages-dist (или site/dist) и проверяет то, что реально
 * ломает деньги и SEO:
 *   1. все прежние адреса на месте: /, services.html, podbor.html, audit.html,
 *      lna.html, sout.html, voinskiy-uchet.html, shtrafy-git.html,
 *      trudovoy-spor.html, about.html, cases.html, contact.html, 404.html;
 *   2. на каждой странице ровно один <h1>, есть canonical, title, description,
 *      og:image и JSON-LD;
 *   3. нет прямых тегов Яндекс.Метрики и GA4 (счётчики грузятся только после
 *      согласия — это проверяет check-analytics Агента 02, здесь страховка);
 *   4. нет ссылок, ведущих на старый чужой Telegram t.me/perepechay;
 *   5. нет @import с fonts.googleapis.com (шрифты локальные);
 *   6. нет «мёртвых» ссылок на .html-адреса, которых нет в сборке;
 *   7. нет пустых alt у содержательных картинок и «жирных» картинок без
 *      width/height (даёт сдвиг вёрстки).
 *
 * Запуск: node scripts/check-pages.mjs [--dir dist]
 * Код возврата 1 — есть ошибки, 0 — всё хорошо.
 */
import { readFile, readdir, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const dirArg = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : 'pages-dist';
const SITE = resolve(import.meta.dirname, '..');
const DIR = resolve(SITE, dirArg);

const REQUIRED = [
  'index.html', 'services.html', 'podbor.html', 'audit.html', 'lna.html',
  'sout.html', 'voinskiy-uchet.html', 'shtrafy-git.html', 'trudovoy-spor.html',
  'about.html', 'cases.html', 'contact.html', '404.html',
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
   разметке у неё нет; из общих проверок её исключаем. */
const SERVICE_FILES = new Set(['yandex_22774c0af65b478b.html']);
const htmlFiles = files.filter((f) => f.endsWith('.html') && !SERVICE_FILES.has(f));

/* 1. адреса */
for (const req of REQUIRED) {
  if (htmlFiles.includes(req)) ok.push(`адрес на месте: /${req}`);
  else fail(`пропал адрес /${req}`);
}

/* список всех адресов сборки — для проверки внутренних ссылок */
const addresses = new Set(['/', ...htmlFiles.map((f) => `/${f}`)]);
addresses.add('/sitemap.xml');

for (const file of htmlFiles) {
  const html = await readFile(join(DIR, file), 'utf8');
  const name = `/${file}`;

  /* 2. базовая разметка */
  const h1 = (html.match(/<h1[\s>]/g) || []).length;
  if (h1 === 0) fail(`${name}: нет <h1>`);
  if (h1 > 1) warn(`${name}: заголовков <h1> больше одного (${h1})`);

  if (!/<title>[^<]{5,}<\/title>/.test(html)) fail(`${name}: пустой или короткий <title>`);
  if (!/<meta name="description" content="[^"]{30,}"/.test(html)) fail(`${name}: нет описания (description)`);
  if (!/<link rel="canonical" href="https:\/\/kadry-pro\.ru\//.test(html) && file !== '404.html') {
    fail(`${name}: нет canonical на kadry-pro.ru`);
  }
  if (!/<meta property="og:image"/.test(html)) fail(`${name}: нет og:image`);
  if (!/<script type="application\/ld\+json">/.test(html) && file !== '404.html') {
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

  /* 6. внутренние ссылки на несуществующие страницы */
  const hrefs = [...html.matchAll(/href="(\/[^"#?]*)"/g)].map((m) => m[1]);
  for (const href of new Set(hrefs)) {
    if (href.startsWith('/_astro') || href.startsWith('/img') || href.startsWith('/fonts') || href.startsWith('/styles')) continue;
    if (/\/(favicon\.(ico|png|svg)|robots\.txt)$/.test(href)) continue;
    if (href === '/') continue;
    if (addresses.has(href)) continue;
    if (addresses.has(`${href}.html`)) continue;
    // Шаблоны, политика и согласие — зона Агента 02, они появятся в его ветке
    if (['/shablony', '/privacy', '/consent', '/thank-you', '/thank-you-paid', '/bundle-download'].includes(href.replace(/\.html$/, ''))) {
      continue;
    }
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

/* служебные файлы рядом со страницами */
for (const extra of ['robots.txt', 'sitemap.xml', 'CNAME']) {
  if (!files.includes(extra)) fail(`в сборке нет ${extra}`);
}
const cname = files.includes('CNAME') ? (await readFile(join(DIR, 'CNAME'), 'utf8')).trim() : '';
if (cname !== 'kadry-pro.ru') fail(`CNAME должен быть kadry-pro.ru, а он «${cname}»`);

/* медиа-бюджет портрета — грузится на главной и на «Обо мне» */
for (const f of ['img/maria-480.webp', 'img/maria-720.webp', 'img/maria-1080.webp', 'img/og-default.jpg']) {
  try {
    const { size } = await import('node:fs').then((fs) => fs.promises.stat(join(DIR, f)));
    if (size > 200 * 1024) warn(`${f}: ${Math.round(size / 1024)} КБ — тяжеловато`);
  } catch {
    fail(`в сборке нет ${f}`);
  }
}

const report = [];
report.push(`Проверено страниц: ${htmlFiles.length}`);
if (ok.length) report.push(`\n✓ В порядке (${ok.length}):\n  ${ok.join('\n  ')}`);
if (warnings.length) report.push(`\n⚠ Предупреждения (${warnings.length}):\n  ${warnings.join('\n  ')}`);
if (errors.length) report.push(`\n✗ Ошибки (${errors.length}):\n  ${errors.join('\n  ')}`);
report.push(`\nИтог: ${errors.length ? 'ЕСТЬ ОШИБКИ' : 'страницы в порядке'}`);
console.log(report.join('\n'));
process.exit(errors.length ? 1 : 0);
