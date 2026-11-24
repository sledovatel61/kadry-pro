/**
 * export-root.mjs — перенос собранного Astro-сайта (site/pages-dist) в корень
 * репозитория для публикации на https://kadry-pro.ru/ через штатный деплой
 * GitHub Pages (source: main:/, build_type: legacy, без смены источника Pages).
 *
 * Что делает:
 *   1. проверяет, что site/pages-dist собран;
 *   2. очищает в корне только сгенерированные подпапки Astro (assets, articles,
 *      fonts, img, manage, styles, shablony/free, shablony/previews), чтобы не
 *      накапливались старые хэши бандлов;
 *   3. в корневой папке shablony/ закрывает публичный доступ к 44 платным PDF
 *      и старому email-bundle.zip (Гейт Г2), но СОХРАНЯЕТ все 20 бесплатных PDF
 *      по прежним адресам /shablony/<имя>.pdf (чтобы не ломать поиск и старые
 *      ссылки) вдобавок к новым /shablony/free/<имя>.pdf;
 *   4. сохраняет нетронутыми preview/, CNAME, .nojekyll, yandex_22774c0af65b478b.html,
 *      logo.png (нужен JSON-LD и build-images.mjs), images/maria-perepechay.png
 *      (нужен build-images.mjs), а также старые корневые ассеты (logo.jpg,
 *      style.css, script.js, shablony.css, trudovoy-spor.css);
 *   5. копирует содержимое site/pages-dist в корень репозитория;
 *   6. прогоняет автопроверку боевого корня (в т.ч. в режиме --check-only):
 *      - ни одна индексируемая страница не осталась под noindex;
 *      - в корневых HTML/CSS/JS и sitemap.xml нет ссылок на /preview;
 *      - canonical ведут на https://kadry-pro.ru/...;
 *      - зашит боевой PUBLIC_LEADS_ENDPOINT=https://kadry-leads.ats439.workers.dev;
 *      - все внутренние ссылки, статика и абсолютные URL kadry-pro.ru реально
 *        лежат в корне репозитория;
 *      - папка preview/ цела.
 *
 * Запуск (из site/):
 *   node scripts/export-root.mjs
 *   node scripts/export-root.mjs --check-only
 */
import { cp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const SITE = resolve(import.meta.dirname, '..');
const SRC = join(SITE, 'pages-dist');
const REPO = resolve(SITE, '..');

const EXPECTED_ENDPOINT =
  process.env.PUBLIC_LEADS_ENDPOINT || 'https://kadry-leads.ats439.workers.dev';
const CHECK_ONLY = process.argv.includes('--check-only');

/** Сгенерированные подпапки Astro в корне — пересоздаются начисто. */
const GENERATED_ROOT_DIRS = ['assets', 'articles', 'fonts', 'img', 'manage', 'styles'];

/** Служебные страницы, которые ОБЯЗАНЫ быть noindex на боевом сайте. */
const NOINDEX_PAGES = new Set([
  '404.html',
  'manage.html',
  'manage/index.html',
  'thank-you.html',
  'thank-you-paid.html',
  'bundle-download.html',
]);

/** Файл подтверждения Яндекс.Вебмастера — без мета-тегов. */
const VERIFICATION_FILE = 'yandex_22774c0af65b478b.html';

async function collectFiles(dir, prefix = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await collectFiles(join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out;
}

async function freeTemplateFilenames() {
  const raw = JSON.parse(await readFile(join(SITE, 'content/templates.json'), 'utf8'));
  const names = new Set();
  for (const item of raw.items ?? []) {
    if (item.free && typeof item.file === 'string') {
      const base = item.file.split('/').pop();
      if (base) names.add(base);
    }
  }
  return names;
}

async function cleanPaidRootTemplates(freeNames) {
  const rootShablony = join(REPO, 'shablony');
  if (!existsSync(rootShablony)) return { keptFree: 0, removedPaid: 0 };

  await rm(join(rootShablony, 'free'), { recursive: true, force: true });
  await rm(join(rootShablony, 'previews'), { recursive: true, force: true });

  let keptFree = 0;
  let removedPaid = 0;
  for (const entry of await readdir(rootShablony, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (name === 'free-bundle-20.zip') continue;
    if (name.toLowerCase().endsWith('.pdf') && freeNames.has(name)) {
      keptFree += 1;
      continue;
    }
    if (name.toLowerCase().endsWith('.pdf') || name === 'email-bundle.zip') {
      await rm(join(rootShablony, name), { force: true });
      removedPaid += 1;
    }
  }
  return { keptFree, removedPaid };
}

async function exportToRoot() {
  try {
    await stat(join(SRC, 'index.html'));
  } catch {
    console.error('✗ Нет site/pages-dist/index.html — сначала выполните npm run build:pages');
    process.exit(1);
  }

  for (const dir of GENERATED_ROOT_DIRS) {
    await rm(join(REPO, dir), { recursive: true, force: true });
  }

  const freeNames = await freeTemplateFilenames();
  const { keptFree, removedPaid } = await cleanPaidRootTemplates(freeNames);

  for (const entry of await readdir(SRC, { withFileTypes: true })) {
    const from = join(SRC, entry.name);
    const to = join(REPO, entry.name);
    if (entry.isDirectory()) {
      await mkdir(to, { recursive: true });
      await cp(from, to, { recursive: true });
    } else {
      await cp(from, to);
    }
  }

  console.log(
    `Корень обновлён из site/pages-dist (бесплатных старых PDF сохранено: ${keptFree}, закрыто платных файлов: ${removedPaid})`,
  );
}

async function verifyRoot() {
  const problems = [];
  const srcFiles = (await collectFiles(SRC)).sort();
  const freeNames = await freeTemplateFilenames();

  /* 1. Все файлы из pages-dist лежат в корне и совпадают по содержимому */
  for (const rel of srcFiles) {
    const rootPath = join(REPO, rel);
    if (!existsSync(rootPath)) {
      problems.push(`в корне нет файла из сборки: ${rel}`);
      continue;
    }
    const [a, b] = await Promise.all([readFile(join(SRC, rel)), readFile(rootPath)]);
    if (!a.equals(b)) problems.push(`файл в корне отличается от site/pages-dist: ${rel}`);
  }

  /* 2. Критичные сохраняемые файлы корня и /preview/ */
  for (const keep of [
    'CNAME',
    '.nojekyll',
    VERIFICATION_FILE,
    'robots.txt',
    'sitemap.xml',
    'logo.png',
    'images/maria-perepechay.png',
    'preview/index.html',
    'preview/manage/index.html',
  ]) {
    if (!existsSync(join(REPO, keep))) problems.push(`пропал обязательный файл: ${keep}`);
  }

  const cname = existsSync(join(REPO, 'CNAME'))
    ? (await readFile(join(REPO, 'CNAME'), 'utf8')).trim()
    : '';
  if (cname !== 'kadry-pro.ru') problems.push(`CNAME = «${cname}», ожидался kadry-pro.ru`);

  /* 3. SEO: robots.txt и sitemap.xml */
  const robots = await readFile(join(REPO, 'robots.txt'), 'utf8');
  if (!/Allow:\s*\/\s*$/m.test(robots)) problems.push('robots.txt не разрешает индексацию корня (Allow: /)');
  if (/Disallow:\s*\/\s*$/m.test(robots)) problems.push('robots.txt закрывает корень (Disallow: /)');
  if (robots.includes('/preview')) problems.push('robots.txt ссылается на /preview');
  if (!robots.includes('Sitemap: https://kadry-pro.ru/sitemap.xml')) {
    problems.push('robots.txt не содержит Sitemap: https://kadry-pro.ru/sitemap.xml');
  }

  const sitemap = await readFile(join(REPO, 'sitemap.xml'), 'utf8');
  if (sitemap.includes('/preview')) problems.push('sitemap.xml содержит /preview');
  const sitemapLocs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (sitemapLocs.length < 17) problems.push(`sitemap.xml содержит мало адресов: ${sitemapLocs.length}`);
  for (const loc of sitemapLocs) {
    if (!loc.startsWith('https://kadry-pro.ru/')) problems.push(`неверный адрес в sitemap.xml: ${loc}`);
  }

  /* 4. Проверка HTML/CSS/JS корня: отсутствие /preview, корректный robots/canonical, ссылки */
  const htmlFiles = srcFiles.filter((f) => f.endsWith('.html'));
  let indexableCount = 0;
  let endpointFound = false;

  for (const rel of srcFiles) {
    const ext = extname(rel).toLowerCase();
    if (!['.html', '.css', '.js', '.mjs'].includes(ext)) continue;
    const text = await readFile(join(REPO, rel), 'utf8');

    if (/\/preview(?:\/|["'\s?#]|$)/.test(text)) {
      problems.push(`${rel}: найдена ссылка на /preview в корневой сборке`);
    }
    if (ext === '.js' && text.includes(EXPECTED_ENDPOINT)) {
      endpointFound = true;
    }

    if (ext !== '.html' || rel === VERIFICATION_FILE) continue;

    if (NOINDEX_PAGES.has(rel)) {
      if (!/<meta name="robots" content="noindex,\s*nofollow">/i.test(text)) {
        problems.push(`${rel}: служебная страница должна иметь noindex, nofollow`);
      }
    } else {
      indexableCount += 1;
      if (/noindex/i.test(text)) {
        problems.push(`${rel}: БОЕВАЯ СТРАНИЦА ОСТАЛАСЬ ПОД NOINDEX`);
      }
      if (!/<meta name="robots" content="index,\s*follow">/i.test(text)) {
        problems.push(`${rel}: нет <meta name="robots" content="index, follow">`);
      }
      const expectedCanonical =
        rel === 'index.html' ? 'https://kadry-pro.ru/' : `https://kadry-pro.ru/${rel}`;
      if (!text.includes(`<link rel="canonical" href="${expectedCanonical}">`)) {
        problems.push(`${rel}: ожидался canonical ${expectedCanonical}`);
      }
    }

    /* Локальные пути и абсолютные ссылки на https://kadry-pro.ru/... */
    for (const m of text.matchAll(/(?:href|src)="(\/[^"#?]*)"/g)) {
      const href = decodeURIComponent(m[1]);
      if (href === '/') continue;
      const clean = href.replace(/^\/+/, '');
      const candidates = [
        join(REPO, clean),
        join(REPO, clean, 'index.html'),
        join(REPO, `${clean}.html`),
      ];
      if (!candidates.some((c) => existsSync(c))) {
        problems.push(`${rel}: битая корневая ссылка ${m[1]}`);
      }
    }
    for (const m of text.matchAll(/https:\/\/kadry-pro\.ru\/([a-zA-Z0-9._/-]+)/g)) {
      const clean = decodeURIComponent(m[1]).replace(/\/+$/, '');
      if (!clean) continue;
      const candidates = [
        join(REPO, clean),
        join(REPO, clean, 'index.html'),
        join(REPO, `${clean}.html`),
      ];
      if (!candidates.some((c) => existsSync(c))) {
        problems.push(`${rel}: битая абсолютная ссылка https://kadry-pro.ru/${m[1]}`);
      }
    }
  }

  if (!endpointFound) {
    problems.push(`в JS-бандлах корня не найден адрес воркера ${EXPECTED_ENDPOINT}`);
  }

  /* 5. Шаблоны в корне: 20 прежних бесплатных PDF на месте, платные закрыты */
  const rootShablonyEntries = await readdir(join(REPO, 'shablony'), { withFileTypes: true });
  const rootPdfs = rootShablonyEntries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.pdf'))
    .map((e) => e.name);
  for (const freeName of freeNames) {
    if (!rootPdfs.includes(freeName)) {
      problems.push(`потерян старый URL бесплатного PDF: /shablony/${freeName}`);
    }
  }
  const leakedPaid = rootPdfs.filter((name) => !freeNames.has(name));
  if (leakedPaid.length) {
    problems.push(`в /shablony/ остались платные PDF (${leakedPaid.length}): ${leakedPaid[0]}…`);
  }
  if (existsSync(join(REPO, 'shablony/email-bundle.zip'))) {
    problems.push('в /shablony/ остался закрытый архив email-bundle.zip');
  }

  console.log(
    `Автопроверка корня: файлов сборки ${srcFiles.length}, HTML ${htmlFiles.length} (индексируемых ${indexableCount}), URL в sitemap ${sitemapLocs.length}, старых бесплатных PDF ${rootPdfs.length}`,
  );
  if (problems.length) {
    console.error('✗ Найдены проблемы:');
    for (const p of problems) console.error(`  - ${p}`);
    return false;
  }
  console.log('✓ Корень готов к публикации: пути чистые, noindex отсутствует, воркер подключён, /preview/ сохранён');
  return true;
}

if (!CHECK_ONLY) {
  await exportToRoot();
}
const ok = await verifyRoot();
process.exit(ok ? 0 : 1);
