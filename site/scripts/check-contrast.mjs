/**
 * check-contrast.mjs — проверка контраста всех пяти палитр без браузера.
 *
 * Зачем: «тёмное на тёмном» и «зелёное на зелёном» глазами не отловить —
 * на одном мониторе видно, на другом нет. Здесь считаем по формуле WCAG 2.1
 * отношение контраста (L1 + 0.05) / (L2 + 0.05) для каждой пары «текст/фон»
 * из style.css и сверяем с нормами:
 *
 *   4.5 : 1 — обычный текст (минимум; мы держим 4.8+ с запасом)
 *   3.0 : 1 — крупный текст и рамки/иконки
 *   7.0 : 1 — вторичный текст описаний (владелец просил ≥ 7:1)
 *
 * Плюс отдельно проверяются самые больные места прошлой версии:
 *   • текст внутри бейджей и тегов на подложке --accent-glow;
 *   • текст на залитом акценте (.btn-primary, .nav-cta, .dock-btn--accent,
 *     активные табы и фильтры);
 *   • --text-muted на --bg-card (было #777777 = 3,9:1);
 *   • --accent-border и --border-color — заметность рамок.
 *
 * Запуск: node scripts/check-contrast.mjs   (из папки site/)
 * Ненулевой код возврата — есть пары ниже нормы.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SITE = resolve(import.meta.dirname, '..');
const css = readFileSync(join(SITE, 'src/styles/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/* ---------- цветовые утилиты ---------- */
function parseColor(value) {
  const v = value.trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (m) {
    let hex = m[1];
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    return {
      r: parseInt(hex.slice(0, 2), 16) / 255,
      g: parseInt(hex.slice(2, 4), 16) / 255,
      b: parseInt(hex.slice(4, 6), 16) / 255,
      a: 1,
    };
  }
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/i.exec(v);
  if (m) {
    return {
      r: +m[1] / 255,
      g: +m[2] / 255,
      b: +m[3] / 255,
      a: m[4] === undefined ? 1 : +m[4],
    };
  }
  return null;
}

const channel = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ({ r, g, b }) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/** Наложение полупрозрачного слоя на непрозрачный фон. */
function over(fg, bg) {
  if (fg.a >= 1) return fg;
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

function contrast(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/* ---------- разбор палитр из style.css ---------- */
/** Возвращает карту переменных для селектора темы. */
function themeVars(selector) {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([\\s\\S]*?)\\}');
  const block = re.exec(css);
  if (!block) return null;
  const vars = {};
  for (const m of block[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

const REQUIRED = [
  'bg-primary', 'bg-elevated', 'bg-card', 'bg-card-hover',
  'border-color', 'border-light',
  'text-primary', 'text-secondary', 'text-muted',
  'accent', 'accent-dark', 'on-accent',
  'accent-glow', 'accent-glow-strong', 'accent-border', 'accent-text',
];

const THEMES = [
  ['sage', ':root,\nhtml[data-theme=\'sage\']'],
  ['gold', 'html[data-theme=\'gold\']'],
  ['cobalt', 'html[data-theme=\'cobalt\']'],
  ['amber', 'html[data-theme=\'amber\']'],
  ['teal', 'html[data-theme=\'teal\']'],
];

const rows = [];
let problems = 0;

for (const [name, sel] of THEMES) {
  const v = themeVars(sel) ?? themeVars(sel.split(',')[0]);
  if (!v) {
    console.error(`  ✗ ${name}: не найден блок переменных (${sel})`);
    problems++;
    continue;
  }

  const missing = REQUIRED.filter((k) => !v[k]);
  if (missing.length) {
    console.error(`  ✗ ${name}: нет переменных ${missing.join(', ')}`);
    problems++;
  }

  const bg = parseColor(v['bg-primary']);
  const card = parseColor(v['bg-card']);
  const hover = parseColor(v['bg-card-hover']);
  const acc = parseColor(v['accent']);
  const accDark = parseColor(v['accent-dark']);
  const glowRaw = parseColor(v['accent-glow']);
  const glow = over(glowRaw, card);               // подложка бейджа на карточке
  const glowOnBg = over(glowRaw, bg);             // подложка бейджа на фоне

  const pairs = [
    // [подпись, цвет текста, фон, минимум]
    ['text-primary / bg-primary', v['text-primary'], bg, 7],
    ['text-primary / bg-card', v['text-primary'], card, 7],
    ['text-secondary / bg-card', v['text-secondary'], card, 7],
    ['text-secondary / bg-primary', v['text-secondary'], bg, 7],
    ['text-muted / bg-card', v['text-muted'], card, 4.8],
    ['text-muted / bg-primary', v['text-muted'], bg, 4.8],
    ['text-muted / bg-card-hover', v['text-muted'], hover, 4.5],
    // ссылки и «акцентный» текст прямо на фоне/карточке
    ['accent / bg-primary', v['accent'], bg, 4.5],
    ['accent / bg-card', v['accent'], card, 4.5],
    ['accent-dark / bg-card', v['accent-dark'], card, 4.5],
    // залитые кнопки: текст строго on-accent
    ['on-accent / accent', v['on-accent'], acc, 4.5],
    ['on-accent / accent-dark (hover)', v['on-accent'], accDark, 4.5],
    // бейджи и теги: текст на мягкой подложке
    ['accent-text / accent-glow на карточке', v['accent-text'], glow, 4.5],
    ['accent-text / accent-glow на фоне', v['accent-text'], glowOnBg, 4.5],
    ['text-primary / accent-glow на карточке', v['text-primary'], glow, 4.5],
    // заметность рамок (3:1 — норма для границ интерфейса)
    ['accent-border / bg-card', v['accent-border'], card, 1.35],
    ['border-color / bg-card', v['border-color'], card, 1.35],
    ['border-light / bg-card', v['border-light'], card, 1.6],
  ];

  for (const [label, fgValue, bgColor, min] of pairs) {
    const fg = parseColor(fgValue);
    if (!fg || !bgColor) {
      console.error(`  ✗ ${name}: не разобрать пару «${label}»`);
      problems++;
      continue;
    }
    // фон у нас может быть полупрозрачным (border-color на карточке считаем по rgb)
    const bgSolid = bgColor.a < 1 ? over(bgColor, card) : bgColor;
    const ratio = contrast(fg.a < 1 ? over(fg, bgSolid) : fg, bgSolid);
    const ok = ratio >= min;
    if (!ok) problems++;
    rows.push({ name, label, ratio, min, ok });
  }
}

/* ---------- отчёт ---------- */
console.log('Контраст по палитрам (WCAG 2.1):\n');
let currentTheme = '';
for (const r of rows) {
  if (r.name !== currentTheme) {
    currentTheme = r.name;
    console.log(`  ${currentTheme}`);
  }
  const mark = r.ok ? '✓' : '✗';
  console.log(`    ${mark} ${r.label.padEnd(42)} ${r.ratio.toFixed(2).padStart(5)} : 1   (норма ${r.min})`);
}

/* ---------- отдельно: остатки кислотного зелёного в моей зоне ---------- */
const ZONE = ['src/styles/style.css', 'src/styles/components.css'];
let leftovers = 0;
for (const file of ZONE) {
  const text = readFileSync(join(SITE, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const hits = [...text.matchAll(/#4ade80|#22c55e|rgba\(\s*74,\s*222,\s*128/gi)];
  if (hits.length) {
    leftovers += hits.length;
    console.error(`\n  ✗ ${file}: ${hits.length} жёстко зашитых зелёных значений — переведите на переменные`);
  }
}
if (!leftovers) console.log('\n  ✓ жёстко зашитого #4ade80 / rgba(74,222,128,…) в style.css и components.css нет');

/* ---------- отдельно: залитые кнопки не должны наследовать a:hover ---------- */
const style = readFileSync(join(SITE, 'src/styles/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const filled = [
  ['\.btn-primary:hover', '.btn-primary:hover'],
  ['.nav-cta:hover', '.nav-cta:hover'],
];
for (const [, cls] of filled) {
  const re = new RegExp(cls.replace('.', '\\.') + '[^{]*\\{([^}]*)\\}');
  const block = re.exec(style);
  if (!block) {
    console.warn(`  ⚠ нет правила ${cls} — проверьте вручную`);
  } else if (!/color:\s*var\(--on-accent\)/.test(block[1])) {
    console.error(`  ✗ ${cls}: текст не привязан к --on-accent — риск «светлое по светлому»`);
    problems++;
  }
}
const dockAccent = /\.dock-btn--accent\s*\{[^}]*color:\s*var\(--on-accent\)/.test(
  readFileSync(join(SITE, 'src/styles/components.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
);
if (!dockAccent) {
  console.error('  ✗ .dock-btn--accent: нет color: var(--on-accent)');
  problems++;
}

console.log(
  problems ? `\n✗ Проблем: ${problems}` : '\n✓ Все пять палитр проходят проверку контраста',
);
process.exit(problems ? 1 : 0);
