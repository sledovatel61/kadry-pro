import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';

/**
 * Тесты атмосферных фонов и чистки CSS-артефактов.
 *
 * Проверяют ровно то, что владелец назвал дефектами:
 *   • нет «мутных круглых пятен» с видимым краем (.hero-sub::after 250×250,
 *     круги по углам калькулятора, пятно 600×600 в форме);
 *   • нет полосы 40%×100% в секции «Что я делаю» — она давала резкую
 *     вертикальную линию обрыва фона во всю высоту экрана;
 *   • атмосферные фоны на месте, в двух форматах, и каждый — в коридоре веса;
 *   • у каждого фона есть скрим, который сводит его к цвету страницы сверху и
 *     снизу, поэтому между секциями нет горизонтальной линии края картинки;
 *   • микро-фактура подключена и не мешает читаемости (≥ 0,02 и ≤ 0,03);
 *   • мобильное правило больше не выключает .hero::after со скримом.
 */

const ROOT = new URL('../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
const style = read('src/styles/style.css');
const plain = style.replace(/\/\*[\s\S]*?\*\//g, '');
const aurora = read('src/styles/aurora-backgrounds.css');
const auroraPlain = aurora.replace(/\/\*[\s\S]*?\*\//g, '');
const base = read('src/layouts/Base.astro');

const BG = [
  ['bg-hero-main', 1920, 1081],
  ['bg-hero-sub', 1920, 823],
  ['bg-cta-aurora', 1920, 1081],
];

test('три атмосферных фона лежат в public/img/bg в AVIF и WebP', () => {
  for (const [name] of BG) {
    for (const ext of ['avif', 'webp']) {
      const path = new URL(`public/img/bg/${name}.${ext}`, ROOT);
      assert.ok(existsSync(path), `нет файла ${name}.${ext}`);
      const kb = statSync(path).size / 1024;
      assert.ok(kb >= 65 && kb <= 115, `${name}.${ext}: ${kb.toFixed(0)} КБ вне коридора 65–115 КБ`);
    }
  }
});

test('styles/aurora-backgrounds.css подключён после общей темы, layout-polish — последним', () => {
  assert.match(base, /import '\.\.\/styles\/aurora-backgrounds\.css'/, 'файл не подключён');
  const order = [...base.matchAll(/import '\.\.\/styles\/([\w-]+\.css)'/g)].map((m) => m[1]);
  // скримы авроры должны перекрывать старые фоны style.css, поэтому aurora —
  // после общей темы; layout-polish идёт последним (стыковочный порядок ревьюера)
  assert.deepEqual(
    order.slice(-4),
    ['reviews.css', 'aurora-backgrounds.css', 'bg-home-sections.css', 'layout-polish.css'],
    `порядок стилей нарушен: ${order.join(' → ')}`,
  );
  assert.equal(order.at(-1), 'layout-polish.css', 'уплотнения layout-polish должны перекрывать базовые отступы');
});

test('фон первого экрана: картинка, позиция справа, горизонтальный скрим под заголовком', () => {
  const before = /\.hero::before\s*\{([^}]*)\}/.exec(auroraPlain);
  assert.ok(before, 'нет правила .hero::before');
  assert.match(before[1], /bg-hero-main\.avif/, 'нет AVIF-версии фона первого экрана');
  assert.match(before[1], /bg-hero-main\.webp/, 'нет WebP-версии фона первого экрана');
  assert.match(before[1], /background-position:\s*7\d% center/, 'свет не смещён к правой части — заголовку не хватит глубины');

  const after = /\.hero::after\s*\{([^}]*)\}/.exec(auroraPlain);
  assert.ok(after, 'нет скрима .hero::after');
  assert.match(after[1], /linear-gradient\(\s*90deg/, 'нет горизонтального скрима под текстом слева');
  assert.match(after[1], /linear-gradient\(\s*180deg/, 'нет вертикальной виньетки — верх и низ картинки будут обрезаны линией');
  assert.match(after[1], /rgb\(var\(--bg-scrim\)\) 100%/, 'низ не сходится ровно в цвет фона страницы');
});

test('шапки внутренних страниц: своя панорама и виньетка сверху и снизу', () => {
  const before = /\.hero-sub::before\s*\{([^}]*)\}/.exec(auroraPlain);
  assert.ok(before, 'нет правила .hero-sub::before');
  assert.match(before[1], /bg-hero-sub\.(avif|webp)/, 'нет панорамы для внутренних шапок');

  const after = /\.hero-sub::after\s*\{([^}]*)\}/.exec(auroraPlain);
  assert.ok(after, 'нет скрима .hero-sub::after');
  assert.match(after[1], /180deg/, 'виньетка не вертикальная');
  assert.match(after[1], /rgb\(var\(--bg-scrim\)\) 100%/, 'низ не сходится в цвет страницы');
});

test('CTA и форма консультации — на фактуре bg-cta-aurora', () => {
  for (const sel of ['.cta-section::before', '#contact-form::before']) {
    const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
    const block = re.exec(auroraPlain);
    assert.ok(block, `нет правила ${sel}`);
    assert.match(block[1], /bg-cta-aurora\.(avif|webp)/, `${sel}: не подключена CTA-фактура`);
  }
});

test('удалены мутные круглые пятна и полоса обрыва фона', () => {
  // .hero-sub::after больше не рисует круг 250×250
  assert.ok(!/\.hero-sub::after\s*\{[^}]*border-radius:\s*50%/.test(plain), 'вернулся круг .hero-sub::after');
  assert.ok(!/\.hero-sub::after\s*\{[^}]*width:\s*250px/.test(plain), 'круг 250×250 в шапке внутренних страниц вернулся');

  // круги по углам калькулятора
  assert.ok(!/#calculator::before\s*\{[^}]*border-radius:\s*50%/.test(plain), 'вернулся круг в #calculator::before');
  assert.ok(!/#calculator::after\s*\{[^}]*border-radius:\s*50%/.test(plain), 'вернулся круг в #calculator::after');

  // пятно 600×600 в форме
  assert.ok(!/#contact-form::before\s*\{[^}]*600px/.test(plain), 'вернулось пятно 600×600 в #contact-form');

  // полоса 40% × 100% в секции «Что я делаю» — источник вертикальной линии
  assert.ok(
    !/#services-overview::before\s*\{[^}]*width:\s*40%/.test(plain),
    'вернулась полоса 40%×100% в секции «Что я делаю» — она даёт резкую вертикальную линию',
  );
  assert.ok(
    !/#services-overview\s*\{[^}]*overflow:\s*hidden/.test(plain),
    '#services-overview снова обрезает фон по контейнеру',
  );

  // в моих стилях не осталось ни одного «круг из radial-gradient» на секции
  const circular = [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
    ([, sel, body]) =>
      /border-radius:\s*50%/.test(body) &&
      /radial-gradient/.test(body) &&
      /^#(calculator|contact-form|services-overview)/.test(sel.trim()) === false &&
      /::{1,2}before|::{1,2}after/.test(sel) &&
      /width:\s*\d{3}px/.test(body),
  );
  assert.equal(circular.length, 0, `остались круглые пятна: ${circular.map(([, s]) => s.trim()).join(' | ')}`);
});

test('на мобильном .hero::after не выключается целиком — он несёт скрим', () => {
  const blocks = [...plain.matchAll(/@media \(max-width: 768px\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]);
  for (const block of blocks) {
    assert.ok(
      !/\.hero::after\s*\{[^}]*display:\s*none/.test(block),
      'на телефоне скрим .hero::after выключается — картинка начнёт обрываться по краю',
    );
  }
});

test('микро-фактура: тонкая плёнка зерна без сетевых запросов', () => {
  assert.match(auroraPlain, /--grain-opacity:\s*0\.02\d*/, 'плотность зерна не задана');
  const value = Number(/--grain-opacity:\s*([\d.]+)/.exec(auroraPlain)[1]);
  assert.ok(value >= 0.02 && value <= 0.03, `зерно ${value} — должно быть 0,02–0,03, иначе мешает тексту`);

  const grain = /#bg-decor::after\s*\{([^}]*)\}/.exec(auroraPlain);
  assert.ok(grain, 'зерно не наложено на #bg-decor::after');
  assert.match(grain[1], /data:image\/svg\+xml/, 'зерно тянется отдельным файлом — должен быть inline-SVG');
  assert.match(grain[1], /feTurbulence/, 'нет генератора шума');
  assert.match(grain[1], /var\(--grain-opacity\)/, 'плотность зерна не через переменную');
});

test('верх и низ каждого фона уходят ровно в цвет страницы (без линии края)', () => {
  /* Кромка изображения должна быть ПОЛНОСТЬЮ скрыта скримом: иначе на стыке
     секций видна тонкая горизонтальная линия — ровно то, о чём просил владелец. */
  for (const sel of ['.hero::after', '.hero-sub::after', '.cta-section::after', '#contact-form::after']) {
    const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
    const block = re.exec(auroraPlain);
    assert.ok(block, `нет правила ${sel}`);
    assert.match(block[1], /rgb\(var\(--bg-scrim\)\) 0%/, `${sel}: верхний край не полностью в цвет фона`);
    assert.match(block[1], /rgb\(var\(--bg-scrim\)\) 100%/, `${sel}: нижний край не полностью в цвет фона`);
  }
});

test('экономия трафика и печать: фоны отключаются', () => {
  assert.match(auroraPlain, /@media \(prefers-reduced-data: reduce\)/, 'нет режима экономии трафика');
  const reduced = auroraPlain.slice(
    auroraPlain.indexOf('@media (prefers-reduced-data: reduce)'),
    auroraPlain.indexOf('@media print'),
  );
  assert.match(reduced, /#contact-form::before/, 'в режиме экономии забыты CTA-фактуры');
  assert.match(reduced, /background-image:\s*none/, 'в режиме экономии картинки всё ещё грузятся');
  assert.match(auroraPlain, /@media print/, 'нет правил печати');
});

test('все переменные из aurora-backgrounds.css определены', () => {
  const used = new Set([...auroraPlain.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
  for (const name of used) {
    const declared = new RegExp(`${name}\\s*:`).test(auroraPlain) || new RegExp(`${name}\\s*:`).test(plain);
    assert.ok(declared, `переменная ${name} используется, но нигде не объявлена`);
  }
});
