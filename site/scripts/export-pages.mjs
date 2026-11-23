/**
 * export-pages.mjs — готовит папку для GitHub Pages.
 *
 * Astro собирает сайт в site/dist. Публикуем не её напрямую, а копию в
 * site/pages-dist — так рабочая сборка не мешается с тем, что уходит на хостинг,
 * и в артефакт попадает ровно то, что нужно.
 *
 * Что делает:
 *   1. чистит pages-dist;
 *   2. копирует dist целиком;
 *   3. кладёт .nojekyll (без него GitHub Pages прячет файлы, начинающиеся с «_»,
 *      и стили из _astro/ перестают загружаться);
 *   4. проверяет, что index.html, 404.html и 13 прежних адресов на месте;
 *   5. печатает размер выгрузки и число файлов.
 *
 * Запуск: npm run build:pages (сборка Astro + выгрузка) или
 *         node scripts/export-pages.mjs (если dist уже собран).
 */
import { cp, mkdir, rm, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const SITE = join(import.meta.dirname, '..');
const SRC = join(SITE, 'dist');
const OUT = join(SITE, 'pages-dist');

async function dirSize(dir) {
  let total = 0;
  let count = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await dirSize(path);
      total += nested.total;
      count += nested.count;
    } else {
      total += (await stat(path)).size;
      count += 1;
    }
  }
  return { total, count };
}

try {
  await stat(join(SRC, 'index.html'));
} catch {
  console.error('Нет site/dist/index.html — сначала соберите сайт: npm run build');
  process.exit(1);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await cp(SRC, OUT, { recursive: true });

/* GitHub Pages без .nojekyll выбрасывает папку _astro — сайт остаётся без стилей */
await writeFile(join(OUT, '.nojekyll'), '');

const REQUIRED = [
  'index.html', 'services.html', 'podbor.html', 'audit.html', 'lna.html',
  'sout.html', 'voinskiy-uchet.html', 'shtrafy-git.html', 'trudovoy-spor.html',
  'about.html', 'cases.html', 'contact.html', '404.html',
  'sitemap.xml', 'robots.txt', 'CNAME',
];

const present = new Set(await readdir(OUT));
const missing = REQUIRED.filter((f) => !present.has(f));

if (missing.length) {
  console.error(`✗ В выгрузке нет файлов: ${missing.join(', ')}`);
  process.exit(1);
}

const { total, count } = await dirSize(OUT);
console.log(`Выгрузка готова: site/pages-dist`);
console.log(`  файлов: ${count}`);
console.log(`  объём: ${(total / 1024 / 1024).toFixed(2)} МБ`);
console.log(`  адресов: ${REQUIRED.length} (включая 404.html, sitemap.xml, robots.txt, CNAME)`);
