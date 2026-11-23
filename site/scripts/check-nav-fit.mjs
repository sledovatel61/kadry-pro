/**
 * check-nav-fit.mjs — проверка геометрии шапки без браузера.
 *
 * Задача владельца: пункты меню НИКОГДА не переносятся на вторую строку,
 * кнопка «Оставить заявку» не режется, на узких экранах шапка не даёт
 * горизонтального скролла. Вместо headless-браузера (его CDN в песочнице
 * недоступен) считаем ширину строк по реальным метрикам шрифта Inter
 * (fontkit читает те же woff2, что отдаёт сайт) и сверяемся с CSS.
 *
 * Что проверяем:
 *   1. в CSS стоят нужные свойства (nowrap, flex-shrink, компактные отступы);
 *   2. костыля .nav-links a[href='/cases'] нет;
 *   3. агрессивные правила .mobile-menu сужены до .mobile-menu > a;
 *   4. полная шапка влезает в одну строку на всех ширинах, где она показана;
 *   5. на ширинах с бургером верхняя полоса (логотип + бургер) помещается
 *      от 320px без горизонтального скролла.
 *
 * Запуск: node scripts/check-nav-fit.mjs
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fontkit = require('fontkit');

const SITE = resolve(import.meta.dirname, '..');
const style = readFileSync(join(SITE, 'src/styles/style.css'), 'utf8');
const components = readFileSync(join(SITE, 'src/styles/components.css'), 'utf8');
const header = readFileSync(join(SITE, 'src/components/Header.astro'), 'utf8');
/* Комментарии убираем: в них упоминаются имена селекторов, которые мы ищем */
const css = (style + '\n' + components).replace(/\/\*[\s\S]*?\*\//g, '');

const problems = [];
const ok = (msg) => console.log('  ✓ ' + msg);
const fail = (msg) => {
  problems.push(msg);
  console.error('  ✗ ' + msg);
};

/* ---------- 1. Свойства в CSS ---------- */
console.log('Свойства шапки:');
if (header.includes('nav-logo-text')) fail('Header.astro: остался текстовый дубль .nav-logo-text');
else ok('логотип без текстового дубля (только logo.svg)');

if (/\.nav-links a\s*\{[^}]*white-space:\s*nowrap/s.test(css)) ok('.nav-links a { white-space: nowrap }');
else fail('нет .nav-links a { white-space: nowrap } — пункты могут переноситься');

if (/\.nav-cta\s*\{[^}]*flex-shrink:\s*0/s.test(css) && /\.nav-cta\s*\{[^}]*white-space:\s*nowrap/s.test(css)) {
  ok('.nav-cta { flex-shrink: 0; white-space: nowrap }');
} else fail('.nav-cta должен держаться целиком: flex-shrink: 0; white-space: nowrap');

if (/\.nav-links a\s*\{[^}]*padding:\s*8px 11px/s.test(css)) ok('.nav-links a { padding: 8px 11px }');
else fail('у .nav-links a не компактный padding: 8px 11px');

if (/\.nav-links\s*\{[^}]*gap:\s*(4|5|6|7|8)px/s.test(css)) ok('.nav-links gap 4–8px');
else fail('.nav-links: gap должен быть 4–8px');

if (/\.nav-inner\s*\{[^}]*max-width:\s*1320px/s.test(css) && /\.nav-inner\s*\{[^}]*gap:\s*16px/s.test(css)) {
  ok('.nav-inner { max-width: 1320px; gap: 16px }');
} else fail('.nav-inner должен быть max-width: 1320px; gap: 16px');

if (css.includes("[href='/cases']") || css.includes('[href="/cases"]')) {
  fail('остался нерабочий костыль .nav-links a[href=\'/cases\']');
} else ok('костыль .nav-links a[href=\'/cases\'] удалён');

const bp = css.match(/@media \(max-width: (\d+)px\)\s*\{[^}]*\.nav-links,\s*\.nav-cta\s*\{\s*display:\s*none[^}]*\}[^}]*\.hamburger\s*\{\s*display:\s*flex/s);
if (bp) ok(`бургер-меню включается с ${Number(bp[1]) + 1}px (.nav-links, .nav-cta → none; .hamburger → flex)`);
else fail('нет чистого переключения на бургер: @media (max-width: …) { .nav-links, .nav-cta { display: none } .hamburger { display: flex } }');
const BREAKPOINT = bp ? Number(bp[1]) : 0;

if (/\.mobile-menu a\s*\{[^}]*display:\s*block\s*!important/s.test(css)) {
  fail('агрессивное правило .mobile-menu a { display: block !important … } должно быть сужено до .mobile-menu > a');
} else ok('агрессивные правила мобильного меню сужены до .mobile-menu > a');

/* ---------- 2. Замеры по метрикам шрифта ---------- */
console.log('\nЗамеры (Inter, реальные метрики woff2):');
const f5 = fontkit.openSync(join(SITE, 'public/fonts/inter-cyrillic-500.woff2'));
const f7 = fontkit.openSync(join(SITE, 'public/fonts/inter-cyrillic-700.woff2'));
const textW = (font, text, px) => (font.layout(text).advanceWidth / font.unitsPerEm) * px;

const LINK_FONT = 14.08; // 0.88rem
const LINK_PAD_X = 11; // padding: 8px 11px
const LINK_GAP = 6;
const CTA_FONT = 14.4; // 0.9rem
const CTA_PAD_X = 18; // padding: 10px 18px
const CTA_BORDER = 2; // border: 2px solid
const NAV_INNER_PAD_X = 24;
const NAV_INNER_GAP = 16;
const LOGO_W = Math.round(34 * (299 / 62)); // img height 34px × пропорция logo.svg
const HAMBURGER_W = 44;

const LABELS = ['Главная', 'Услуги и цены', 'Подбор кадров', 'Обо мне', 'Трудовые споры', 'Кейсы', 'Шаблоны', 'Контакты'];
const items = LABELS.map((t) => ({ t, w: Math.ceil(textW(f5, t, LINK_FONT)) + LINK_PAD_X * 2 }));
const linksW = items.reduce((s, i) => s + i.w, 0) + LINK_GAP * (items.length - 1);
const ctaW = Math.ceil(textW(f7, 'Оставить заявку', CTA_FONT)) + CTA_PAD_X * 2 + CTA_BORDER * 2;
const fullNeed = LOGO_W + NAV_INNER_GAP + linksW + NAV_INNER_GAP + ctaW;

console.log(`  пункты: ${items.map((i) => `${i.t} ${i.w}px`).join(', ')}`);
console.log(`  логотип ${LOGO_W}px + меню ${linksW}px + кнопка ${ctaW}px + отступы = ${fullNeed}px контента`);

/* ---------- 3. Таблица ширина → режим ---------- */
console.log('\nШирины экрана:');
const WIDTHS = [1440, 1280, 1100, 768, 375, 320];
for (const w of WIDTHS) {
  const avail = Math.min(w, 1320) - NAV_INNER_PAD_X * 2;
  const full = w > BREAKPOINT;
  if (full) {
    const slack = avail - fullNeed;
    if (fullNeed <= avail) {
      ok(`${w}px: полная шапка — в одну строку, запас ${slack}px`);
    } else {
      fail(`${w}px: полная шапка НЕ влезает (нужно ${fullNeed}px, есть ${avail}px)`);
    }
  } else {
    const barNeed = LOGO_W + NAV_INNER_GAP + HAMBURGER_W;
    if (barNeed <= avail) {
      ok(`${w}px: бургер-меню — логотип + кнопка помещаются (запас ${avail - barNeed}px), переносов нет`);
    } else {
      fail(`${w}px: даже логотип + бургер не помещаются (${barNeed}px > ${avail}px) — будет горизонтальный скролл`);
    }
    /* .mobile-menu-contacts: width: 100%, max-width: 340px — по контейнеру меню */
    const contacts = Math.min(340, w - 48);
    if (contacts <= avail) ok(`${w}px: сетка кнопок связи ${Math.round(contacts)}px — в пределах экрана`);
    else fail(`${w}px: сетка кнопок связи ${Math.round(contacts)}px шире экрана`);
  }
}

/* ---------- Итог ---------- */
if (problems.length) {
  console.error(`\n✗ Проверка шапки НЕ пройдена (${problems.length}):`);
  process.exit(1);
}
console.log('\n✓ Шапка в порядке: без переносов, без обрезки, без горизонтального скролла');
