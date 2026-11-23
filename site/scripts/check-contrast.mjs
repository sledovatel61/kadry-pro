/**
 * check-contrast.mjs — проверка контраста финальной палитры «Кобальт × Аврора»
 * без браузера.
 *
 * Зачем: «тёмное на тёмном» и «синее на синем» глазами не отловить — на одном
 * мониторе видно, на другом нет. Здесь считаем по формуле WCAG 2.1 отношение
 * контраста (L1 + 0.05) / (L2 + 0.05) для каждой пары «текст/фон» из style.css
 * и сверяем с нормами:
 *
 *   4.5 : 1 — обычный текст (минимум; держим 4.8+ с запасом)
 *   3.0 : 1 — крупный текст и рамки/иконки
 *   7.0 : 1 — вторичный текст описаний
 *
 * Дополнительно проверяется то, что специфично для кобальта:
 *   • ВСЕ точки градиента --grad-btn: белый --on-accent обязан держать ≥ 4,95:1
 *     на самом светлом конце, иначе надпись на кнопке «плывёт»;
 *   • --on-accent НЕ используется на плоском --accent (там светлый текст даёт
 *     около 2:1 — именно так появлялось «светлое по светлому»);
 *   • текст компаньона (--accent-secondary-text) на подложке
 *     --accent-secondary-glow и тёмный --on-accent-secondary на заливке
 *     --accent-secondary;
 *   • --text-slate на карточке — спокойный тон для буллитов и неактивных табов.
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
  if (typeof value !== 'string') return null;
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
function themeVars(selector) {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([\\s\\S]*?)\\}');
  const block = re.exec(css);
  if (!block) return null;
  const vars = {};
  for (const m of block[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

/* Переменные объёма и градиентов лежат в отдельном блоке :root — читаем их
   отдельно, чтобы проверить все точки --grad-btn. */
const rootVars = (() => {
  const re = /:root\s*\{([\s\S]*?)\n\}/;
  const m = re.exec(css);
  const vars = {};
  if (m) for (const d of m[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars[d[1]] = d[2].trim();
  return vars;
})();

const REQUIRED = [
  'bg-primary', 'bg-elevated', 'bg-card', 'bg-card-hover',
  'border-color', 'border-light',
  'text-primary', 'text-secondary', 'text-muted', 'text-slate',
  'accent', 'accent-dark', 'accent-text', 'on-accent',
  'accent-glow', 'accent-glow-strong', 'accent-border',
  'accent-secondary', 'accent-secondary-text', 'on-accent-secondary',
  'accent-secondary-glow', 'accent-secondary-border',
  'atmosphere-1', 'atmosphere-2', 'atmosphere-3',
];

const THEMES = [
  ['Кобальт × Аврора (штатная)', ':root,' + String.fromCharCode(10) + "html[data-theme='cobalt-aurora']"],
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
  const sec = parseColor(v['accent-secondary']);
  const glowRaw = parseColor(v['accent-glow']);
  const glow = over(glowRaw, card);                 // подложка бейджа на карточке
  const secGlowRaw = parseColor(v['accent-secondary-glow']);
  const secGlow = secGlowRaw ? over(secGlowRaw, card) : card;

  const pairs = [
    // [подпись, цвет текста, фон, минимум]
    ['text-primary / bg-primary', v['text-primary'], bg, 7],
    ['text-primary / bg-card', v['text-primary'], card, 7],
    ['text-secondary / bg-card', v['text-secondary'], card, 7],
    ['text-secondary / bg-primary', v['text-secondary'], bg, 7],
    ['text-muted / bg-card', v['text-muted'], card, 4.8],
    ['text-muted / bg-primary', v['text-muted'], bg, 4.8],
    ['text-muted / bg-card-hover', v['text-muted'], hover, 4.5],
    // спокойный сланцевый тон: буллиты, неактивные табы, второстепенные детали
    ['text-slate / bg-card', v['text-slate'], card, 4.8],
    // ссылки и «акцентный» текст прямо на фоне/карточке
    ['accent / bg-primary', v['accent'], bg, 4.5],
    ['accent / bg-card', v['accent'], card, 4.5],
    ['accent-dark / bg-card', v['accent-dark'], card, 4.5],
    ['accent-text / accent-glow', v['accent-text'], glow, 4.5],
    // компаньон: текст на его подложке и тёмный текст на его заливке
    ['accent-secondary-text / secondary-glow', v['accent-secondary-text'], secGlow, 4.5],
    ['accent-secondary-text / bg-card', v['accent-secondary-text'], card, 4.5],
    ['accent-secondary / bg-card', v['accent-secondary'], card, 3],
    ['on-accent-secondary / accent-secondary', v['on-accent-secondary'], sec, 4.5],
    // заметность рамок (3:1 — норма для границ интерфейса, у нас мягче)
    ['accent-border / bg-card', v['accent-border'], card, 1.35],
    ['accent-secondary-border / bg-card', v['accent-secondary-border'], card, 1.35],
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
    const bgSolid = bgColor.a < 1 ? over(bgColor, card) : bgColor;
    const ratio = contrast(fg.a < 1 ? over(fg, bgSolid) : fg, bgSolid);
    const ok = ratio >= min;
    if (!ok) problems++;
    rows.push({ name, label, ratio, min, ok });
  }

  /* ---- все точки градиента главной кнопки ---- */
  const grad = rootVars['grad-btn'] ?? '';
  const stops = [...grad.matchAll(/#([0-9a-f]{6})/gi)].map((m) => '#' + m[1]);
  const onAccent = parseColor(v['on-accent']);
  if (!stops.length) {
    console.error(`  ✗ не найден --grad-btn с цветовыми точками`);
    problems++;
  }
  for (const stop of stops) {
    const ratio = contrast(onAccent, parseColor(stop));
    const ok = ratio >= 4.95;
    if (!ok) problems++;
    rows.push({ name, label: `on-accent / grad-btn ${stop}`, ratio, min: 4.95, ok });
  }

  /* ---- на плоском --accent светлый текст не читается: так и должно быть ---- */
  const flatRatio = contrast(onAccent, acc);
  rows.push({
    name,
    label: `[справка] on-accent на плоском accent (не использовать)`,
    ratio: flatRatio,
    min: 0,
    ok: true,
  });
}

/* ---------- отчёт ---------- */
console.log('Контраст палитры «Кобальт × Аврора» (WCAG 2.1):\n');
let currentTheme = '';
for (const r of rows) {
  if (r.name !== currentTheme) {
    currentTheme = r.name;
    console.log(`  ${currentTheme}`);
  }
  const mark = r.ok ? '✓' : '✗';
  console.log(`    ${mark} ${r.label.padEnd(48)} ${r.ratio.toFixed(2).padStart(5)} : 1   (норма ${r.min})`);
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

/* ---------- залитые кнопки: только градиент, только --on-accent ---------- */
const style = readFileSync(join(SITE, 'src/styles/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const btnPrimary = /\.btn-primary\s*\{([^}]*)\}/.exec(style);
if (!btnPrimary) {
  console.error('  ✗ нет правила .btn-primary');
  problems++;
} else {
  if (!/background:\s*var\(--grad-btn\)/.test(btnPrimary[1])) {
    console.error('  ✗ .btn-primary: заливка не --grad-btn (плоский акцент даст 2:1 для белого текста)');
    problems++;
  }
  if (!/color:\s*var\(--on-accent\)/.test(btnPrimary[1])) {
    console.error('  ✗ .btn-primary: текст не --on-accent');
    problems++;
  }
}

for (const cls of ['.btn-primary:hover', '.nav-cta:hover']) {
  const re = new RegExp(cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^{]*\\{([^}]*)\\}');
  const block = re.exec(style);
  if (!block) {
    console.warn(`  ⚠ нет правила ${cls} — проверьте вручную`);
  } else if (!/color:\s*var\(--on-accent\)/.test(block[1])) {
    console.error(`  ✗ ${cls}: текст не привязан к --on-accent — риск «светлое по светлому»`);
    problems++;
  }
}

const components = readFileSync(join(SITE, 'src/styles/components.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
if (!/\.dock-btn--accent\s*\{[^}]*color:\s*var\(--on-accent\)/.test(components)) {
  console.error('  ✗ .dock-btn--accent: нет color: var(--on-accent)');
  problems++;
}

/* ---------- градиент обязан иметь запасной сплошной цвет ---------- */
for (const [label, selector] of [
  ['.grad-text', /\.grad-text\s*\{([^}]*)\}/],
  ['.hero h1 .accent', /\.hero h1 \.accent\s*\{([^}]*)\}/],
]) {
  const block = selector.exec(style);
  if (!block) {
    console.error(`  ✗ нет правила ${label}`);
    problems++;
  } else if (!/color:\s*var\(--(text-primary|accent-text)\)/.test(block[1])) {
    console.error(`  ✗ ${label}: нет запасного сплошного цвета на случай, если background-clip: text не поддержан`);
    problems++;
  }
}

console.log(
  problems ? `\n✗ Проблем: ${problems}` : '\n✓ Палитра «Кобальт × Аврора» проходит проверку контраста',
);
process.exit(problems ? 1 : 0);
