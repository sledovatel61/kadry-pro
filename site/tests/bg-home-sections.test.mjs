import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';

/**
 * Тесты атмосферных фонов секций главной.
 *
 * Владелец остался доволен первым экраном и попросил такую же глубину ниже:
 * «Знакомые проблемы?», «Рассчитайте выгоду», счётчики, «Что я делаю»,
 * «Полезные материалы», отзывы — и попросил ПРИОТКРЫТЬ скрим в середине
 * секций, чтобы фактура читалась глазами.
 *
 * Что проверяем:
 *   • четыре новые фактуры есть в двух форматах и весят 70–115 КБ;
 *   • AVIF строго легче WebP (иначе смысл формата теряется);
 *   • у каждой секции верхний и нижний край скрима — ровно цвет страницы:
 *     значит горизонтального шва между секциями нет;
 *   • в середине скрим прозрачный (0,22…0,38) — иначе картинку не видно;
 *   • #contact-form больше не глухой;
 *   • секции главной получили id, на которые опирается CSS;
 *   • первый экран не тронут: ни .hero, ни bg-hero-main в этом файле.
 */

const ROOT = new URL('../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');

const style = read('src/styles/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
const aurora = read('src/styles/aurora-backgrounds.css').replace(/\/\*[\s\S]*?\*\//g, '');
const home = read('src/styles/bg-home-sections.css');
const homePlain = home.replace(/\/\*[\s\S]*?\*\//g, '');
const base = read('src/layouts/Base.astro');
const index = read('src/pages/index.astro');
/* В index.astro разметка лежит в экранированной строке: id=\\"materials\\". */
const BS2 = '\\' + '"';

/** Секция → файл фактуры. */
const SCENES = [
  ['#problems', 'bg-home-problems'],
  ['#calculator', 'bg-home-calc'],
  ['#stats', 'bg-home-services'],
  ['#services-overview', 'bg-home-services'],
  ['#materials', 'bg-home-knowledge'],
  ['#reviews-home', 'bg-home-knowledge'],
];

/** Блок правила без учёта вложенных скобок в комментариях (комментарии вырезаны). */
function ruleBody(selector, from = homePlain) {
  const i = from.indexOf(`${selector} {`);
  if (i === -1) return null;
  return from.slice(i + selector.length + 2, from.indexOf('}', i));
}

/** Разбирает вертикальный (180deg) градиент в список [позиция, альфа]. */
function verticalStops(body) {
  const gradients = [...body.matchAll(/linear-gradient\(\s*180deg([^;]*?)\)\s*(?:;|$)/gms)];
  if (!gradients.length) return [];
  const g = gradients[gradients.length - 1][1];
  return [...g.matchAll(/(rgb\(var\(--bg-scrim\)\)|rgba\(var\(--bg-scrim\),\s*[\d.]+\))\s*([\d.]+%)/g)].map(
    (m) => ({
      at: parseFloat(m[2]),
      alpha: m[1].startsWith('rgb(') ? 1 : parseFloat(m[1].split(',')[1]),
    }),
  );
}

test('четыре новые фактуры лежат в двух форматах и в коридоре 70–115 КБ', () => {
  for (const name of ['bg-home-problems', 'bg-home-calc', 'bg-home-services', 'bg-home-knowledge']) {
    const sizes = {};
    for (const ext of ['avif', 'webp']) {
      const path = new URL(`public/img/bg/${name}.${ext}`, ROOT);
      assert.ok(existsSync(path), `нет файла ${name}.${ext}`);
      const kb = statSync(path).size / 1024;
      assert.ok(kb >= 70 && kb <= 115, `${name}.${ext}: ${kb.toFixed(0)} КБ вне коридора 70–115 КБ`);
      sizes[ext] = kb;
    }
    assert.ok(sizes.avif < sizes.webp, `${name}: AVIF (${sizes.avif.toFixed(0)}) не легче WebP (${sizes.webp.toFixed(0)})`);
  }
});

test('конвейер сборки фонов требует AVIF легче WebP и коридор 70–115 КБ', () => {
  const script = read('scripts/build-bg.mjs');
  assert.match(script, /const MIN_KB = 70;/, 'нижняя граница коридора не 70 КБ');
  assert.match(script, /const MAX_KB = 115;/, 'верхняя граница коридора не 115 КБ');
  assert.match(script, /avif\.kb >= webp\.kb/, 'нет проверки «AVIF легче WebP»');
});

test('bg-home-sections.css подключён после aurora-backgrounds', () => {
  assert.match(base, /import '\.\.\/styles\/bg-home-sections\.css'/, 'файл не подключён');
  const order = [...base.matchAll(/import '\.\.\/styles\/([\w-]+\.css)'/g)].map((m) => m[1]);
  const iAurora = order.indexOf('aurora-backgrounds.css');
  const iHome = order.indexOf('bg-home-sections.css');
  assert.ok(iAurora !== -1 && iHome !== -1, 'нет одного из файлов стилей фонов');
  assert.ok(iHome > iAurora, 'bg-home-sections должен идти после aurora-backgrounds');
});

test('первый экран не тронут: ни .hero, ни bg-hero-main в новом файле', () => {
  assert.ok(!/\.hero\b/.test(homePlain), 'новый файл вмешивается в .hero — первый экран трогать нельзя');
  assert.ok(!/bg-hero-main/.test(homePlain), 'новый файл переиспользует bg-hero-main');
  assert.ok(!/#hero\b/.test(homePlain), 'новый файл трогает #hero');
  // и старые стили первого экрана тоже не переписаны этим раундом
  assert.match(aurora, /bg-hero-main\.avif/, 'фон первого экрана пропал из aurora-backgrounds.css');
});

/**
 * Все объявления для селектора, склеенные в строку.
 *
 * Нужен именно такой сбор, потому что свойств у секции несколько правил:
 * общий слой (`::after { content… }`), картинка (`image-set`), позиция.
 * Сравниваем селектор ТОЧНО, а не вхождением: `#problems` входит и в
 * `#problems::before`, и в `#problems > .container`.
 */
function declsFor(selector, from = homePlain) {
  const chunks = [];
  for (const m of from.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(',').map((x) => x.trim().replace(/\s+/g, ' '));
    if (selectors.includes(selector)) chunks.push(m[2]);
  }
  return chunks.length ? chunks.join(' ') : null;
}

test('у каждой секции своя фактура через image-set с AVIF и WebP', () => {
  for (const [sel, name] of SCENES) {
    const body = declsFor(`${sel}::after`);
    assert.ok(body, `нет правила ${sel}::after`);
    assert.match(body, new RegExp(`${name}\\.avif`), `${sel}: нет AVIF-версии ${name}`);
    assert.match(body, new RegExp(`${name}\\.webp`), `${sel}: нет WebP-версии ${name}`);
    assert.match(body, /image-set\(/, `${sel}: нет image-set — браузер не выберет формат`);
  }
});

test('края скрима — ровно цвет страницы: ни одного горизонтального шва', () => {
  for (const [sel] of SCENES) {
    const stops = verticalStops(ruleBody(`${sel}::before`) ?? '');
    assert.ok(stops.length >= 4, `${sel}: скрим не разобран`);
    assert.equal(stops[0].at, 0, `${sel}: скрим не начинается с 0%`);
    assert.equal(stops[0].alpha, 1, `${sel}: верхний край не полностью в цвет страницы`);
    const last = stops[stops.length - 1];
    assert.equal(last.at, 100, `${sel}: скрим не заканчивается на 100%`);
    assert.equal(last.alpha, 1, `${sel}: нижний край не полностью в цвет страницы`);

    // у самой кромки (первые 10% и последние 10%) скрим должен быть почти глухим
    const nearTop = stops.filter((s) => s.at <= 10).at(-1);
    const nearBottom = stops.filter((s) => s.at >= 90)[0];
    assert.ok(nearTop.alpha >= 0.8, `${sel}: на 10% сверху скрим ${nearTop.alpha} — картинка будет обрезана линией`);
    assert.ok(nearBottom.alpha >= 0.8, `${sel}: на 90% снизу скрим ${nearBottom.alpha} — картинка будет обрезана линией`);
  }
});

test('в середине секции скрим прозрачный: фактура читается глазами', () => {
  for (const [sel] of SCENES) {
    const stops = verticalStops(ruleBody(`${sel}::before`) ?? '');
    const middle = stops.filter((s) => s.at >= 25 && s.at <= 75);
    assert.ok(middle.length >= 1, `${sel}: нет точек скрима в диапазоне 25–75%`);
    for (const stop of middle) {
      assert.ok(
        stop.alpha >= 0.22 && stop.alpha <= 0.38,
        `${sel}: в середине скрим ${stop.alpha} на ${stop.at}% — нужно 0,22…0,38`,
      );
    }
  }
});

test('#contact-form больше не глухой: фактура bg-cta-aurora видна', () => {
  const body = ruleBody('#contact-form::after');
  assert.ok(body, 'нет правила #contact-form::after');
  const stops = verticalStops(body);
  assert.ok(stops.length >= 4, 'скрим формы не разобран');
  assert.equal(stops[0].alpha, 1, 'верх формы не в цвет страницы');
  assert.equal(stops.at(-1).alpha, 1, 'низ формы не в цвет страницы');

  const middle = stops.filter((s) => s.at >= 25 && s.at <= 75);
  assert.ok(middle.length >= 1, 'нет средних точек скрима формы');
  for (const stop of middle) {
    assert.ok(stop.alpha <= 0.38, `#contact-form: середина ${stop.alpha} — картинка всё ещё спрятана`);
    assert.ok(stop.alpha >= 0.22, `#contact-form: середина ${stop.alpha} — текст на форме рискует читаемостью`);
  }
  // фактура под формой действительно подключена
  assert.match(aurora, /#contact-form::before\s*\{[^}]*bg-cta-aurora/, 'под формой нет фактуры bg-cta-aurora');
});

test('карточки и контент лежат выше слоёв фона', () => {
  for (const [sel] of SCENES) {
    const body = declsFor(sel) ?? '';
    assert.match(body, /isolation:\s*isolate/, `${sel}: нет контекста наложения — фон может перекрыть контент`);

    const layered = declsFor(`${sel} > .container`) ?? '';
    assert.match(layered, /z-index:\s*1/, `${sel}: контейнер не поднят над фоном`);
  }
  // фотография — самый нижний слой, скрим — над ней
  const after = declsFor('#problems::after') ?? '';
  const before = declsFor('#problems::before') ?? '';
  assert.match(after, /z-index:\s*-2/, '#problems::after должен быть глубже скрима');
  assert.match(before, /z-index:\s*-1/, '#problems::before должен быть над фотографией');
});

test('старые декоративные полосы у секций с фотографией погашены', () => {
  /* .section-alt::before/::after рисуют 3px-полосы по бокам, а
     .section:not(.section-alt)::before — световую линию 1px. На фотографии они
     читаются как случайные штрихи, поэтому для секций с фоном они отключены. */
  /* Ищем именно блок сброса: тот, где перечислены все секции и стоит border: 0. */
  const reset = [...homePlain.matchAll(/([^{}]+)\{([^{}]*border:\s*0[^{}]*)\}/g)].map((m) => ({ sel: m[1], body: m[2] }));
  const block = reset.find((r) =>
    ['#problems::before', '#stats::before', '#services-overview::before', '#materials::before', '#reviews-home::before'].every((s) =>
      r.sel.includes(s),
    ),
  );
  assert.ok(block, 'нет блока сброса служебных линий для секций с фотографией');
  assert.match(block.body, /box-shadow:\s*none/, 'не сброшены тени старых элементов');
});

test('секции главной получили id, на которые опирается CSS', () => {
  // «Полезные материалы» раньше были section-alt без id
  assert.ok(index.includes('id=' + BS2 + 'materials'), 'у секции «Полезные материалы» нет id="materials"');
  // «Что я делаю» уже имела технический services-overview — добавили читаемый признак
  assert.ok(index.includes('data-section=' + BS2 + 'what-i-do'), 'у «Что я делаю» нет data-section="what-i-do"');
  // эти id уже были — убеждаемся, что не потерялись
  for (const id of ['problems', 'calculator', 'stats', 'contact-form']) {
    assert.ok(index.includes('id=' + BS2 + id), `нет id="${id}" на главной`);
  }
});

test('тексты и структура карточек главной не тронуты', () => {
  /* Правка разметки — только атрибуты на <section>. Проверяем, что ключевые
     заголовки и классы карточек на месте. */
  for (const marker of [
    'Знакомые',
    'Рассчитайте',
    'Что я',
    'Полезные',
    'pvs-card problems',
    'pvs-card solutions',
    'calc-result',
    'service-card',
  ]) {
    assert.ok(index.includes(marker), `пропал фрагмент главной: ${marker}`);
  }
});

test('экономия трафика и печать: фоны секций отключаются', () => {
  assert.match(homePlain, /@media \(prefers-reduced-data: reduce\)/, 'нет режима экономии трафика');
  assert.match(homePlain, /@media print/, 'нет правил печати');
  assert.match(homePlain, /--bg-scrim:\s*7,\s*12,\s*24/, 'скрим не привязан к цвету фона #070c18');
});
