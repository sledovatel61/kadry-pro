/**
 * build-bg.mjs — атмосферные фоновые фактуры: JPEG-мастер → WebP + AVIF.
 *
 * Фоны первого экрана, внутренних шапок и CTA раньше рисовались CSS-кругами
 * radial-gradient: у них был видимый край, они давали «мутные круглые пятна» и
 * обрывались по границе секции резкой линией. Теперь это изображения — мягкие,
 * с уходом в темноту по краям, поэтому шва между картинкой и фоном страницы нет.
 *
 * Исходники (site/assets-src/bg/*.jpg) сгенерированы как фоновые ассеты сборки:
 * без текста, букв, лиц и клипарта — только свет, глубина и материал. JPEG здесь
 * мастер, а не PNG: у фактур нет ни резких контуров, ни прозрачности, зато PNG
 * тянул бы 2–3 МБ на файл.
 *
 * Что делает скрипт:
 *   • приводит картинку к ширине 1920 (высота — по пропорциям исходника);
 *   • сначала подбирает WebP: он задаёт «пол» по весу, потому что WebP тяжелее
 *     AVIF на этой фактуре;
 *   • потом AVIF, но не «до упора», а так, чтобы он остался ЛЕГЧЕ WebP —
 *     иначе теряется смысл формата;
 *   • и то и другое держит в коридоре 70–115 КБ на файл.
 *
 * Запуск (из папки site/): npm run images:bg
 */
import sharp from 'sharp';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join, parse } from 'node:path';

const SRC = join(import.meta.dirname, '..', 'assets-src', 'bg');
const OUT = join(import.meta.dirname, '..', 'public', 'img', 'bg');

const WIDTH = 1920;
/** Коридор веса одного файла, КБ. */
const MIN_KB = 70;
const MAX_KB = 115;

/**
 * Целевой вес по файлу. Общий лимит public/img — 1600 КБ, и семь фактур в двух
 * форматах легко его перебирают, поэтому героям «главной» задан вес пониже:
 * это мягкие размытые фактуры, им лишнее качество не нужно.
 * Ключ — имя файла без расширения; нет ключа — работает общий расчёт от MAX_KB.
 */
const TARGETS = {
  'bg-home-problems': { webp: 88, avif: 74 },
  'bg-home-calc': { webp: 88, avif: 74 },
  'bg-home-services': { webp: 88, avif: 76 },
  'bg-home-knowledge': { webp: 96, avif: 80 },
};

/* --only=имя,имя — пересобрать только выбранные исходники (остальные не трогаем). */
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',')) : null;

await mkdir(OUT, { recursive: true });

let sources = (await readdir(SRC)).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
if (only) sources = sources.filter((f) => only.has(parse(f).name));
if (!sources.length) {
  console.error(`✗ В ${SRC} нет исходников (jpg/png)`);
  process.exit(1);
}

const kbOf = (buf) => buf.length / 1024;

/**
 * Подбор качества бинарным спуском к целевому весу.
 * encode(quality) → Buffer; weight(kb) → насколько «хорошо» (меньше = ближе).
 */
async function search(encode, target, { min = 1, max = 100, steps = 7 } = {}) {
  let lo = min;
  let hi = max;
  let best = null;
  for (let i = 0; i < steps && lo <= hi; i += 1) {
    const q = Math.round((lo + hi) / 2);
    const buf = await encode(q);
    const kb = kbOf(buf);
    /* Лучший = самый близкий к цели, НО при равенстве предпочитаем тот, что
       не выше цели: лучше недобрать полкилобайта, чем выпасть из коридора. */
    const score = (c) => (c.kb > c.target ? 1 : 0) * 1000 + Math.abs(c.kb - c.target);
    if (!best || score({ kb, target }) < score({ kb: best.kb, target })) best = { buf, kb, quality: q };
    if (kb < target) lo = q + 1;
    else hi = q - 1;
  }
  return best;
}

let failed = 0;

for (const file of sources) {
  const name = parse(file).name;
  const srcPath = join(SRC, file);
  const meta = await sharp(srcPath).metadata();
  const heightOut = Math.round((meta.height / meta.width) * WIDTH);
  const base = sharp(srcPath).resize({ width: WIDTH, kernel: 'lanczos3' });

  const target = TARGETS[name] ?? {};

  /* Шаг 1 — WebP. Если у файла есть свой целевой вес, целимся в него; иначе —
     в MAX_KB - 2, чтобы потом AVIF точно оказался легче. */
  const webpTarget = Math.min(MAX_KB - 2, target.webp ?? MAX_KB - 2);
  const webp = await search(
    (q) => base.clone().webp({ quality: q, effort: 6, smartSubsample: true }).toBuffer(),
    webpTarget,
    { min: 60, max: 100 },
  );

  /* Шаг 2 — AVIF. Если задан свой вес — берём его; иначе примерно 90 % от WebP:
     заметно легче, но не в ущерб плавности градиентов. */
  const avifTarget = target.avif
    ? Math.min(MAX_KB - 4, Math.max(MIN_KB + 1, target.avif))
    : Math.min(MAX_KB - 6, Math.max(MIN_KB + 2, webp.kb * 0.9));
  const avif = await search(
    (q) => base.clone().avif({ quality: q, effort: 6, chromaSubsampling: '4:2:0' }).toBuffer(),
    avifTarget,
    { min: 55, max: 100 },
  );

  const checks = [
    ['webp', webp],
    ['avif', avif],
  ];

  for (const [ext, res] of checks) {
    await writeFile(join(OUT, `${name}.${ext}`), res.buf);
  }

  const inRange = (kb) => kb >= MIN_KB && kb <= MAX_KB;
  const problems = [];
  if (!inRange(webp.kb)) problems.push(`WebP ${webp.kb.toFixed(0)} КБ вне ${MIN_KB}–${MAX_KB}`);
  if (!inRange(avif.kb)) problems.push(`AVIF ${avif.kb.toFixed(0)} КБ вне ${MIN_KB}–${MAX_KB}`);
  if (avif.kb >= webp.kb) problems.push(`AVIF ${avif.kb.toFixed(0)} КБ не легче WebP ${webp.kb.toFixed(0)} КБ`);
  if (problems.length) failed += 1;

  console.log(
    `  ${problems.length ? '✗' : '✓'} ${name.padEnd(20)} ` +
      `webp ${String(Math.round(webp.kb)).padStart(3)} КБ (q=${webp.quality}) · ` +
      `avif ${String(Math.round(avif.kb)).padStart(3)} КБ (q=${avif.quality}) · ` +
      `${WIDTH}×${heightOut}` +
      (problems.length ? `\n      ${problems.join('; ')}` : ''),
  );
}

if (failed) {
  console.error(`\n✗ ${failed} исходник(ов) не уложились в требования (${MIN_KB}–${MAX_KB} КБ, AVIF < WebP)`);
  process.exit(1);
}
console.log(`\n✓ Фоны готовы: ${sources.length} исходников × 2 формата, все в коридоре ${MIN_KB}–${MAX_KB} КБ, AVIF легче WebP`);
