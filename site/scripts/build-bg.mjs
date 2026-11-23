/**
 * build-bg.mjs — атмосферные фоновые фактуры: PNG-исходник → AVIF + WebP.
 *
 * Фоны первого экрана и CTA раньше рисовались CSS-кругами radial-gradient:
 * у них был видимый край, они давали «мутные круглые пятна» и обрывались по
 * границе секции с резкой линией. Теперь это настоящие изображения — мягкие,
 * с уходом в темноту по краям, поэтому шва между картинкой и фоном страницы нет.
 *
 * Исходники (site/assets-src/bg/*.jpg) сгенерированы как фоновые ассеты сборки:
 * без текста, букв, лиц и клипарта — только свет, глубина и материал. JPEG здесь
 * мастер, а не PNG: у фактур нет резких контуров и прозрачности, зато JPEG
 * заметно меньше и не тянет за собой 2–3 МБ в репозитории.
 *
 * Что делает скрипт:
 *   • приводит каждую картинку к ширине 1920 (высота — по пропорциям исходника);
 *   • сохраняет AVIF (качество 52) и WebP (качество 76) в site/public/img/bg/;
 *   • следит за коридором 65–110 КБ: если файл выпал из него, подбирает
 *     качество за несколько проходов и печатает итог.
 *
 * Запуск (из папки site/):
 *   npm run images:bg                                  — пересобрать все сцены;
 *   npm run images:bg -- bg-process-aurora bg-footer-night
 *                                                      — только указанные.
 */
import sharp from 'sharp';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join, parse } from 'node:path';

const SRC = join(import.meta.dirname, '..', 'assets-src', 'bg');
const OUT = join(import.meta.dirname, '..', 'public', 'img', 'bg');

const WIDTH = 1920;
/** Коридор веса одного файла, КБ. */
const MIN_KB = 65;
const MAX_KB = 110;

await mkdir(OUT, { recursive: true });

/* Можно пересобрать не всё, а только нужные сцены:
 *   npm run images:bg -- bg-process-aurora bg-footer-night
 * Это важно, когда фоны ведут разные агенты: пересборка «всего» переписала бы
 * чужие файлы другим весом (у каждого набора свои настройки кодировщика),
 * и в diff попали бы правки не твоей зоны. Без аргументов собирается всё. */
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));

let sources = (await readdir(SRC)).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
if (only.length) {
  const wanted = new Set(only.map((n) => n.replace(/\.(jpe?g|png)$/i, '')));
  sources = sources.filter((f) => wanted.has(parse(f).name));
  const missing = [...wanted].filter((n) => !sources.some((f) => parse(f).name === n));
  if (missing.length) {
    console.error(`✗ Нет исходников для: ${missing.join(', ')}`);
    process.exit(1);
  }
}
if (!sources.length) {
  console.error(`✗ В ${SRC} нет исходников (jpg/png)`);
  process.exit(1);
}

/**
 * Подбирает качество под целевой вес.
 *
 * Кривая «качество → вес» у гладких сцен ступенчатая: у ночного неба q=92 даёт
 * 62 КБ, q=94 — 70 КБ, q=96 — 102 КБ. Поэтому идём бинарным поиском по шкале
 * качества 20…96, каждый раз замеряя реальный вес, и запоминаем лучший
 * результат — тот, что ближе всех к targetKb, но не тяжелее потолка.
 * Кэш не нужен: за проход кодировщик вызывается ~7 раз, это секунды.
 */
async function encodeAt(pipeline, encodeOpts, quality) {
  const buf = await pipeline.clone()[encodeOpts.fn]({ ...encodeOpts.args, quality }).toBuffer();
  return { buf, kb: buf.length / 1024, quality };
}

async function encode(pipeline, encodeOpts, targetKb, maxKb) {
  let lo = 20;
  /* Потолок 100, а не 96: у гладкой сцены подвала WebP на q=96 даёт 69 КБ,
     и до цели 90 КБ он дотягивается только на q=98. */
  let hi = 100;
  let best = null;
  let fallback = null;

  for (let attempt = 0; attempt < 8 && lo <= hi; attempt += 1) {
    const quality = Math.round((lo + hi) / 2);
    const res = await encodeAt(pipeline, encodeOpts, quality);

    /* Запоминаем последний результат — он нужен, если коридор недостижим. */
    fallback = res;

    if (res.kb > maxKb) {
      hi = quality - 1;
      continue;
    }
    /* Лучший — самый тяжёлый из тех, что влезли в потолок: больше деталей. */
    if (!best || res.kb > best.kb) best = res;
    if (res.kb >= targetKb) hi = quality - 1;
    else lo = quality + 1;
  }

  return best ?? fallback;
}

/**
 * WebP кодируем первым: он задаёт потолок для AVIF.
 *
 * Если подбирать форматы независимо, гладкая сцена (ночное небо, дымка)
 * отлично сжимается в WebP и при этом «не влезает» в коридор снизу — подбор
 * поднимает качество AVIF до упора, и AVIF выходит тяжелее WebP. Бюджет
 * требует обратного, поэтому AVIF целимся в потолок 0.92 × вес WebP.
 */
/* Целимся не в минимум, а в середину коридора: у сцены подвала шаг AVIF
   ступенчатый (62 КБ → 70 КБ → 88 КБ), и «худой» WebP оставляет AVIF окно,
   в которое он не попадает. Средняя цель даёт ему место. */
const WEBP_TARGET_KB = 88;

let failed = 0;

for (const file of sources) {
  const name = parse(file).name;
  const srcPath = join(SRC, file);
  const meta = await sharp(srcPath).metadata();
  const base = sharp(srcPath).resize({ width: WIDTH, kernel: 'lanczos3', withoutEnlargement: false });

  const webpOpts = { fn: 'webp', args: { quality: 76, effort: 5, smartSubsample: true } };
  const avifOpts = { fn: 'avif', args: { quality: 52, effort: 7, chromaSubsampling: '4:2:0' } };

  /* WebP — в коридоре и у середины: под AVIF должно остаться место. */
  /* Потолок WebP чуть ниже общего: 110 КБ — уже край коридора. */
  const webp = await encode(base, webpOpts, WEBP_TARGET_KB, MAX_KB - 5);
  /* AVIF — строго легче WebP: потолок 0.92 от веса WebP, но не ниже 65 КБ. */
  const avifCeiling = Math.max(MIN_KB, Math.min(MAX_KB, Math.floor(webp.kb * 0.92)));
  const avif = await encode(base, avifOpts, Math.max(MIN_KB, avifCeiling - 6), avifCeiling);

  for (const [ext, res] of [['avif', avif], ['webp', webp]]) {
    const { buf, kb, quality } = res;
    const outPath = join(OUT, `${name}.${ext}`);
    await writeFile(outPath, buf);
    const ok = kb >= MIN_KB && kb <= MAX_KB;
    if (!ok) failed += 1;
    console.log(
      `  ${ok ? '✓' : '✗'} ${`${name}.${ext}`.padEnd(22)} ${String(Math.round(kb)).padStart(4)} КБ  ` +
        `(q=${quality}, ${WIDTH}×${Math.round((meta.height / meta.width) * WIDTH)})`,
    );
  }
  /* Бюджет проверяет AVIF < WebP у каждого фона. */
  if (avif.kb >= webp.kb) {
    failed += 1;
    console.error(`  ✗ ${name}: AVIF (${Math.round(avif.kb)} КБ) не легче WebP (${Math.round(webp.kb)} КБ)`);
  }
}

if (failed) {
  console.error(`\n✗ ${failed} файл(ов) вне коридора ${MIN_KB}–${MAX_KB} КБ`);
  process.exit(1);
}
console.log(`\n✓ Фоны готовы: ${sources.length} исходника × 2 формата, все в коридоре ${MIN_KB}–${MAX_KB} КБ`);
