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
 *   • следит за коридором 65–115 КБ: если файл выпал из него, подбирает
 *     качество за несколько проходов и печатает итог.
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
const MIN_KB = 65;
const MAX_KB = 115;

await mkdir(OUT, { recursive: true });

const sources = (await readdir(SRC)).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
if (!sources.length) {
  console.error(`✗ В ${SRC} нет исходников (jpg/png)`);
  process.exit(1);
}

/**
 * Подбирает качество так, чтобы файл попал в коридор MIN_KB…MAX_KB.
 * Кодировщики монотонны по качеству, поэтому хватает нескольких шагов.
 */
async function encode(pipeline, encodeOpts) {
  let quality = encodeOpts.args.quality;
  let last;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const buf = await pipeline.clone()[encodeOpts.fn]({ ...encodeOpts.args, quality }).toBuffer();
    const kb = buf.length / 1024;
    last = { buf, kb, quality };
    if (kb >= MIN_KB && kb <= MAX_KB) return last;
    if (kb > MAX_KB) quality = Math.max(20, Math.round(quality * 0.86));
    else quality = Math.min(96, Math.round(quality * 1.12));
    if (last.quality === quality) break;
  }
  return last;
}

let failed = 0;

for (const file of sources) {
  const name = parse(file).name;
  const srcPath = join(SRC, file);
  const meta = await sharp(srcPath).metadata();
  const base = sharp(srcPath).resize({ width: WIDTH, kernel: 'lanczos3', withoutEnlargement: false });

  for (const [ext, fn, args] of [
    ['avif', 'avif', { quality: 52, effort: 7, chromaSubsampling: '4:2:0' }],
    ['webp', 'webp', { quality: 76, effort: 5, smartSubsample: true }],
  ]) {
    const { buf, kb, quality } = await encode(base, { fn, args });
    const outPath = join(OUT, `${name}.${ext}`);
    await writeFile(outPath, buf);
    const ok = kb >= MIN_KB && kb <= MAX_KB;
    if (!ok) failed += 1;
    console.log(
      `  ${ok ? '✓' : '✗'} ${`${name}.${ext}`.padEnd(22)} ${String(Math.round(kb)).padStart(4)} КБ  ` +
        `(q=${quality}, ${WIDTH}×${Math.round((meta.height / meta.width) * WIDTH)})`,
    );
  }
}

if (failed) {
  console.error(`\n✗ ${failed} файл(ов) вне коридора ${MIN_KB}–${MAX_KB} КБ`);
  process.exit(1);
}
console.log(`\n✓ Фоны готовы: ${sources.length} исходника × 2 формата, все в коридоре ${MIN_KB}–${MAX_KB} КБ`);
