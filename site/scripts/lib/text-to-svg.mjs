/**
 * Текст → векторные контуры для OG-карточки.
 *
 * Зачем не обычный <text>: контейнер сборки может не иметь системных шрифтов,
 * а рисунок должен совпадать у всех. Поэтому надписи набираются нашими же
 * локальными сабсетами Inter (site/public/fonts/*.woff2) и превращаются в пути.
 *
 * Буквы берутся из двух сабсетов — кириллического и латинского: в каждом
 * свой набор глифов, поэтому для символа выбирается тот, где он реально есть.
 * Символ, которого нет ни там, ни там (например ₽ или тире), заменяется
 * вызывающей стороной заранее.
 */
import * as fontkitModule from 'fontkit';

/* fontkit в ESM отдаёт либо default, либо именованные экспорты — берём то, что есть. */
const fontkit = fontkitModule.default ?? fontkitModule;
import { join } from 'node:path';

const FONTS_DIR = join(import.meta.dirname, '../../public/fonts');
const cache = new Map();

function load(weight) {
  if (!cache.has(weight)) {
    cache.set(weight, {
      cyr: fontkit.openSync(join(FONTS_DIR, `inter-cyrillic-${weight}.woff2`)),
      lat: fontkit.openSync(join(FONTS_DIR, `inter-latin-${weight}.woff2`)),
    });
  }
  return cache.get(weight);
}

/** Глиф для символа: сначала кириллический сабсет, потом латинский. */
function glyphFor(fonts, char) {
  const fromCyr = fonts.cyr.glyphsForString(char)[0];
  if (fromCyr && fromCyr.id !== 0) return { font: fonts.cyr, glyph: fromCyr };
  const fromLat = fonts.lat.glyphsForString(char)[0];
  if (fromLat && fromLat.id !== 0) return { font: fonts.lat, glyph: fromLat };
  return null;
}

/**
 * Возвращает { path, width } — контуры текста в единицах SVG.
 * @param {string} text
 * @param {object} opts
 * @param {number} opts.size размер шрифта (px, единицы SVG)
 * @param {number} [opts.x=0] левый край
 * @param {number} [opts.y=0] базовая линия
 * @param {number} [opts.weight=400]
 * @param {number} [opts.letterSpacing=0]
 */
export function textToPath(text, { size, x = 0, y = 0, weight = 400, letterSpacing = 0 } = {}) {
  const fonts = load(weight);
  const scale = size / fonts.cyr.unitsPerEm;
  let penX = 0;
  const parts = [];
  const missing = [];

  for (const char of text) {
    const found = glyphFor(fonts, char);
    if (!found) {
      missing.push(char);
      penX += size * 0.5;                            // пробел-заменитель
      continue;
    }
    const { glyph } = found;
    const d = glyph.path.toSVG();
    if (d) {
      const tx = (x + penX * scale).toFixed(2);
      parts.push(`<path transform="translate(${tx} ${y}) scale(${scale.toFixed(5)} ${(-scale).toFixed(5)})" d="${d}"/>`);
    }
    penX += glyph.advanceWidth + letterSpacing / scale;
  }

  return { path: parts.join(''), width: penX * scale, missing };
}

/** Сколько ширины займёт строка — чтобы центрировать и переносить. */
export function measure(text, { size, weight = 400, letterSpacing = 0 } = {}) {
  return textToPath(text, { size, weight, letterSpacing }).width;
}
