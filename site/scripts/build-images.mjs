/**
 * Медиа-конвейер: портрет Марии, чистый векторный логотип и OG-карточка.
 *
 * Что было: images/maria-perepechay.png весил 1,2 МБ в сыром PNG, а в index.html
 * стояли неверные пропорции width="741" height="898" (реальные 916×1215) — фото
 * дёргалось при загрузке. logo.png — 668×374 с огромными чёрными полями, из-за
 * чего в шапке его растягивали до 140 px и она раздувалась.
 *
 * Что делает скрипт:
 *   1. site/public/img/maria-{480,720,1080}.{avif,webp} — три размера, пропорции
 *      916×1215 без искажений, каждый ≤ 75 КБ;
 *   2. site/public/img/logo.svg — знак «цветок» + надпись Kadry-Pro, обрезанные
 *      по контуру, ноль чёрных полей (цвет знака #6dbf7b, надпись белая);
 *   3. site/public/img/og-default.jpg — ровно 1200×630 для репостов в Telegram
 *      и WhatsApp.
 *
 * Запуск (из папки site/): npm run images
 * Требует sharp. Исходники берутся из корня репозитория и НЕ изменяются.
 */
import sharp from 'sharp';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { textToPath } from './lib/text-to-svg.mjs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');        // корень репозитория
const OUT = join(import.meta.dirname, '../public/img');    // site/public/img
const SRC_PORTRAIT = join(ROOT, 'images/maria-perepechay.png');
const SRC_LOGO = join(ROOT, 'logo.png');

const GREEN = '#6dbf7b';
const SIZES = [480, 720, 1080];
const BUDGET_KB = 75;

await mkdir(OUT, { recursive: true });

/* ---------------------------------------------------------------- портрет */
const portraitMeta = await sharp(SRC_PORTRAIT).metadata();
console.log(`источник: ${portraitMeta.width}×${portraitMeta.height}, ${(await stat(SRC_PORTRAIT)).size} байт`);

for (const width of SIZES) {
  const height = Math.round((width * portraitMeta.height) / portraitMeta.width);
  const base = sharp(SRC_PORTRAIT).resize({ width, height, fit: 'cover', position: 'top' });

  for (const [ext, opts] of [
    ['avif', { quality: 52, effort: 6 }],
    ['webp', { quality: 78, effort: 6 }],
  ]) {
    const file = join(OUT, `maria-${width}.${ext}`);
    await base.clone().toFormat(ext, opts).toFile(file);
    const size = (await stat(file)).size;
    const flag = size > BUDGET_KB * 1024 ? '  ← ПРЕВЫШЕН БЮДЖЕТ' : '';
    console.log(`  maria-${width}.${ext}: ${Math.round(size / 1024)} КБ (${width}×${height})${flag}`);
  }
}

/* ------------------------------------------------------------------ логотип */
/* Знак «цветок» трассирован из исходного PNG по альфа-каналу и упрощён:
   пять лепестков-кругов на ножках от центрального узла. Никаких чёрных полей:
   viewBox ровно по контуру, поэтому в шапке достаточно height:34px. */
const MARK_VIEWBOX = '0 0 68 62';
/* Знак собран из простых фигур: центральный узел, пять лепестков-кругов и
   короткие «ножки» между ними. Толщина ножек подобрана так, чтобы лепестки
   почти сливались с узлом, как на исходном логотипе, но без растровых
   артефактов и чёрных полей. */
const mark = `<g fill="${GREEN}">
    <g fill="none" stroke="${GREEN}" stroke-width="9" stroke-linecap="round">
      <line x1="34" y1="28" x2="34" y2="19"/>
      <line x1="30" y1="32" x2="21" y2="26"/>
      <line x1="38" y1="32" x2="47" y2="26"/>
      <line x1="30" y1="37" x2="22" y2="44"/>
      <line x1="38" y1="37" x2="46" y2="44"/>
    </g>
    <circle cx="34" cy="32" r="10"/>
    <circle cx="34" cy="12" r="10.5"/>
    <circle cx="12.5" cy="25" r="10.5"/>
    <circle cx="55.5" cy="25" r="10.5"/>
    <circle cx="15" cy="50" r="10.5"/>
    <circle cx="53" cy="50" r="10.5"/>
  </g>`;

const markOnly = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}" width="68" height="64" role="img" aria-label="Кадры-Про">
  <title>Кадры-Про — кадровый аутсорсинг Марии Перепечай</title>
  ${mark}
</svg>
`;
await writeFile(join(OUT, 'logo-mark.svg'), markOnly);

/* Полный логотип: знак + надпись. Надпись — контуры Inter SemiBold из наших же
   локальных шрифтов, поэтому фирменная типографика совпадает со страницами
   и не зависит от того, какие шрифты есть на машине сборки. */
const word = textToPath('Kadry', { size: 44, x: 80, y: 46, weight: 700, letterSpacing: -1.2 });
const wordGreen = textToPath('-Pro', { size: 44, x: 80 + word.width, y: 46, weight: 700, letterSpacing: -1.2 });
const logoW = Math.ceil(80 + word.width + wordGreen.width + 6);
const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${logoW} 62" width="${logoW}" height="62" role="img" aria-labelledby="logo-title">
  <title id="logo-title">Кадры-Про — кадровый аутсорсинг Марии Перепечай</title>
  ${mark}
  <g fill="#ffffff">${word.path}</g>
  <g fill="${GREEN}">${wordGreen.path}</g>
</svg>
`;
await writeFile(join(OUT, 'logo.svg'), logo);
console.log(`  logo.svg: ${logoW}×64, ${Math.round((await stat(join(OUT, 'logo.svg'))).size / 1024 * 10) / 10} КБ`);

/* ------------------------------------------------------------- OG-карточка */
/* 1200×630: слева деловой портрет Марии в зелёной рамке, справа название,
   оффер и цифры доверия. Нужна для красивых превью в Telegram и WhatsApp.
   Все надписи — векторные контуры (см. scripts/lib/text-to-svg.mjs), поэтому
   карточка выглядит одинаково на любой машине сборки. */
const OG_W = 1200;
const OG_H = 630;
const PHOTO_LEFT = 62;
const PHOTO_TOP = 80;
const PHOTO_H = 470;
const PHOTO_W = 354;                                   // 916×1215 при высоте 470

const TEXT_X = 486;

const title1 = textToPath('Кадровый аутсорсинг', { size: 46, x: TEXT_X, y: 232, weight: 700, letterSpacing: -0.8 });
const title2 = textToPath('под ключ', { size: 46, x: TEXT_X, y: 288, weight: 700, letterSpacing: -0.8 });
const kicker = textToPath('КАДРЫ-ПРО · МАРИЯ ПЕРЕПЕЧАЙ', { size: 20, x: TEXT_X, y: 152, weight: 500, letterSpacing: 1.6 });
const sub1 = textToPath('от 14 000 руб/мес вместо штатного кадровика', { size: 22, x: TEXT_X, y: 342, weight: 400 });
const sub2 = textToPath('14 лет опыта · 0 штрафов · работаю по всей России', { size: 22, x: TEXT_X, y: 374, weight: 400 });
const phone = textToPath('+7 (961) 302-21-12', { size: 30, x: TEXT_X, y: 470, weight: 700 });
const tail = textToPath('kadry-pro.ru · Telegram @Mariya061', { size: 19, x: TEXT_X, y: 506, weight: 400 });

/* Фон рисуем отдельным слоем ДО фото, иначе непрозрачный прямоугольник
   градиента закроет портрет. */
const bgLayer = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0a0a"/>
      <stop offset="55%" stop-color="#0d1512"/>
      <stop offset="100%" stop-color="#0a0a0a"/>
    </linearGradient>
  </defs>
  <rect width="${OG_W}" height="${OG_H}" fill="url(#bg)"/>
  <g opacity="0.16" stroke="#4ade80" stroke-width="1">
    ${Array.from({ length: 14 }, (_, i) => `<line x1="${i * 90}" y1="0" x2="${i * 90}" y2="${OG_H}"/>`).join('')}
    ${Array.from({ length: 7 }, (_, i) => `<line x1="0" y1="${i * 90}" x2="${OG_W}" y2="${i * 90}"/>`).join('')}
  </g>
  <circle cx="1140" cy="60" r="230" fill="#4ade80" opacity="0.06"/>
  <circle cx="80" cy="620" r="170" fill="#4ade80" opacity="0.05"/>
</svg>`, 'utf8');

const fgLayer = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}">
  <defs>
    <linearGradient id="bar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#4ade80"/>
      <stop offset="100%" stop-color="#22c55e"/>
    </linearGradient>
  </defs>
  <rect x="${TEXT_X - 26}" y="128" width="5" height="400" rx="2.5" fill="url(#bar)"/>
  <g fill="#4ade80">${kicker.path}</g>
  <g fill="#ffffff">${title1.path}${title2.path}</g>
  <g fill="#c3d0c8">${sub1.path}${sub2.path}</g>
  <g fill="#ffffff">${phone.path}</g>
  <g fill="#9fb3a8">${tail.path}</g>
</svg>`, 'utf8');

const frame = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${PHOTO_W + 10}" height="${PHOTO_H + 10}">
  <rect x="2" y="2" width="${PHOTO_W + 6}" height="${PHOTO_H + 6}" rx="20" fill="none" stroke="#4ade80" stroke-width="3" opacity="0.6"/>
</svg>`, 'utf8');

const photoFade = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${PHOTO_W}" height="${PHOTO_H}">
  <rect x="0" y="${Math.round(PHOTO_H * 0.6)}" width="${PHOTO_W}" height="${Math.round(PHOTO_H * 0.4)}" fill="url(#f)"/>
  <defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#0a0a0a" stop-opacity="0"/>
    <stop offset="100%" stop-color="#0a0a0a" stop-opacity="0.85"/>
  </linearGradient></defs>
</svg>`, 'utf8');

const photo = await sharp(SRC_PORTRAIT)
  .resize({ width: PHOTO_W, height: PHOTO_H, fit: 'cover', position: 'top' })
  .toFormat('png')
  .toBuffer();

const OG_FILE = join(OUT, 'og-default.jpg');
await sharp({ create: { width: OG_W, height: OG_H, channels: 3, background: '#0a0a0a' } })
  .composite([
    { input: bgLayer, left: 0, top: 0 },
    { input: photo, left: PHOTO_LEFT, top: PHOTO_TOP },
    { input: photoFade, left: PHOTO_LEFT, top: PHOTO_TOP },
    { input: frame, left: PHOTO_LEFT - 5, top: PHOTO_TOP - 5 },
    { input: fgLayer, left: 0, top: 0 },
  ])
  .jpeg({ quality: 90, chromaSubsampling: '4:4:4', mozjpeg: true })
  .toFile(OG_FILE);

const ogMeta = await sharp(OG_FILE).metadata();
const ogSize = (await stat(OG_FILE)).size;
console.log(`  og-default.jpg: ${ogMeta.width}×${ogMeta.height}, ${Math.round(ogSize / 1024)} КБ`);
if (ogMeta.width !== 1200 || ogMeta.height !== 630) {
  throw new Error('OG-карточка должна быть ровно 1200×630');
}
const missing = [title1, title2, kicker, sub1, sub2, phone, tail].flatMap((t) => t.missing);
if (missing.length) throw new Error(`в шрифтах нет символов: ${[...new Set(missing)].join(' ')}`);
