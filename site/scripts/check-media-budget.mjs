/**
 * check-media-budget.mjs — контроль веса картинок.
 *
 * Раньше портрет Марии весил 1,2 МБ одним PNG и грузился на главной целиком.
 * Теперь проверяем, что оптимизация не «откатилась» обратно:
 *   • каждая версия портрета (AVIF/WebP, 480/720/1080) — не больше 75 КБ;
 *   • AVIF не тяжелее WebP того же размера (иначе смысл формата теряется);
 *   • OG-картинка — ровно 1200×630 и не больше 300 КБ;
 *   • логотип — вектор и меньше 20 КБ;
 *   • суммарно всё в public/img — не больше 800 КБ.
 *
 * Запуск: node scripts/check-media-budget.mjs
 */
import { readdir, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import sharp from 'sharp';

const IMG_DIR = join(import.meta.dirname, '..', 'public', 'img');

const LIMITS = {
  portrait: 75 * 1024,
  og: 300 * 1024,
  logo: 20 * 1024,
  total: 800 * 1024,
};

const errors = [];
const rows = [];

const files = (await readdir(IMG_DIR)).sort();
let total = 0;

for (const file of files) {
  const path = join(IMG_DIR, file);
  const { size } = await stat(path);
  total += size;
  const name = basename(file);
  const ext = extname(file).slice(1);
  rows.push({ name, kb: Math.round(size / 1024) });

  if (name.startsWith('maria-') && size > LIMITS.portrait) {
    errors.push(`${name}: ${Math.round(size / 1024)} КБ — больше лимита 75 КБ`);
  }
  if (name === 'og-default.jpg') {
    const meta = await sharp(path).metadata();
    if (meta.width !== 1200 || meta.height !== 630) {
      errors.push(`og-default.jpg: ${meta.width}×${meta.height}, а нужно ровно 1200×630`);
    }
    if (size > LIMITS.og) errors.push(`og-default.jpg: ${Math.round(size / 1024)} КБ — больше 300 КБ`);
  }
  if (name.startsWith('logo') && ext === 'svg' && size > LIMITS.logo) {
    errors.push(`${name}: ${Math.round(size / 1024)} КБ — векторный логотип не должен быть тяжелее 20 КБ`);
  }
}

/* AVIF должен быть не тяжелее WebP при том же размере */
for (const width of [480, 720, 1080]) {
  const avif = rows.find((r) => r.name === `maria-${width}.avif`);
  const webp = rows.find((r) => r.name === `maria-${width}.webp`);
  if (!avif || !webp) {
    errors.push(`нет пары maria-${width}.avif / maria-${width}.webp`);
    continue;
  }
  if (avif.kb > webp.kb) {
    errors.push(`maria-${width}: AVIF (${avif.kb} КБ) тяжелее WebP (${webp.kb} КБ)`);
  }
}

if (total > LIMITS.total) {
  errors.push(`весь public/img весит ${Math.round(total / 1024)} КБ — больше лимита 800 КБ`);
}

console.log('Вес картинок (КБ):');
for (const r of rows) console.log(`  ${r.name.padEnd(24)} ${String(r.kb).padStart(4)}`);
console.log(`  ${'ИТОГО'.padEnd(24)} ${String(Math.round(total / 1024)).padStart(4)}`);

if (errors.length) {
  console.error(`\n✗ Превышения (${errors.length}):\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log('\n✓ Медиа-бюджет соблюдён');
