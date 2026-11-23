import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Тесты палитр и контраста.
 *
 * Проверяют то, что нельзя увидеть глазами на одном мониторе:
 *   • все пять тем объявлены и содержат одинаковый набор переменных;
 *   • ни одна пара «текст/фон» не ниже нормы WCAG;
 *   • кислотный зелёный не вернулся в style.css и components.css;
 *   • залитые кнопки всегда красят текст в --on-accent;
 *   • логотип в шапке и подвале — инлайновый и красится переменными;
 *   • переключатель палитр подключён и помнит выбор.
 */

const ROOT = new URL('../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
const style = read('src/styles/style.css');
const components = read('src/styles/components.css');

/* ---------- цветовые утилиты (те же, что в scripts/check-contrast.mjs) ---------- */
function parseColor(value) {
  const v = String(value).trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (m) {
    let hex = m[1];
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    return { r: parseInt(hex.slice(0, 2), 16) / 255, g: parseInt(hex.slice(2, 4), 16) / 255, b: parseInt(hex.slice(4, 6), 16) / 255, a: 1 };
  }
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/i.exec(v);
  if (m) return { r: +m[1] / 255, g: +m[2] / 255, b: +m[3] / 255, a: m[4] === undefined ? 1 : +m[4] };
  return null;
}
const ch = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ({ r, g, b }) => 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
const over = (fg, bg) =>
  fg.a >= 1 ? fg : { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 };
const contrast = (a, b) => {
  const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
  return (hi + 0.05) / (lo + 0.05);
};

function themeVars(selector) {
  const plain = style.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([\\s\\S]*?)\\}');
  const block = re.exec(plain);
  if (!block) return null;
  const vars = {};
  for (const m of block[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

const REQUIRED_VARS = [
  'bg-primary', 'bg-elevated', 'bg-card', 'bg-card-hover',
  'border-color', 'border-light',
  'text-primary', 'text-secondary', 'text-muted',
  'accent', 'accent-dark', 'on-accent',
  'accent-glow', 'accent-glow-strong', 'accent-border', 'accent-text',
];

const THEMES = {
  sage: ":root,\nhtml[data-theme='sage']",
  gold: "html[data-theme='gold']",
  cobalt: "html[data-theme='cobalt']",
  amber: "html[data-theme='amber']",
  teal: "html[data-theme='teal']",
};

test('объявлены все пять палитр с одинаковым набором переменных', () => {
  for (const [name, selector] of Object.entries(THEMES)) {
    const vars = themeVars(selector) ?? themeVars(selector.split(',')[0]);
    assert.ok(vars, `нет блока переменных для темы ${name}`);
    for (const key of REQUIRED_VARS) {
      assert.ok(vars[key], `тема ${name}: нет --${key}`);
    }
  }
});

test('контраст текста не ниже нормы во всех пяти палитрах', () => {
  /* [цвет текста, цвет фона, минимум] — фонов может быть несколько */
  const minimums = [
    ['text-primary', ['bg-card', 'bg-primary'], 7],
    ['text-secondary', ['bg-card', 'bg-primary'], 7],
    ['text-muted', ['bg-card', 'bg-primary'], 4.8],
    ['accent', ['bg-card', 'bg-primary'], 4.5],
    ['accent-text', ['accent-glow'], 4.5],
    ['on-accent', ['accent', 'accent-dark'], 4.5],
  ];

  for (const [name, selector] of Object.entries(THEMES)) {
    const v = themeVars(selector) ?? themeVars(selector.split(',')[0]);
    const card = parseColor(v['bg-card']);
    const bg = parseColor(v['bg-primary']);

    for (const [fgKey, bgKeys, min] of minimums) {
      const fg = parseColor(v[fgKey]);
      assert.ok(fg, `${name}: не разобрать --${fgKey} (${v[fgKey]})`);

      for (const bgKey of bgKeys) {
        /* accent-glow — полупрозрачная подложка, накладываем её на карточку */
        const bgColor =
          bgKey === 'accent-glow' ? over(parseColor(v['accent-glow']), card)
          : bgKey === 'bg-card' ? card
          : bgKey === 'accent' || bgKey === 'accent-dark' ? parseColor(v[bgKey])
          : bg;
        const ratio = contrast(fg.a < 1 ? over(fg, bgColor) : fg, bgColor);
        assert.ok(
          ratio >= min,
          `${name}: ${fgKey} на ${bgKey} = ${ratio.toFixed(2)}:1, а нужно не меньше ${min}:1`,
        );
      }
    }
  }
});

test('раньше провальный --text-muted (#777777) больше не используется', () => {
  const plain = style.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/--text-muted:\s*#777/i.test(plain), '--text-muted вернулся к #777777 (контраст 3,9:1)');
  for (const [name, selector] of Object.entries(THEMES)) {
    const v = themeVars(selector) ?? themeVars(selector.split(',')[0]);
    const ratio = contrast(parseColor(v['text-muted']), parseColor(v['bg-card']));
    assert.ok(ratio >= 4.8, `${name}: --text-muted на карточке ${ratio.toFixed(2)}:1`);
  }
});

test('кислотный зелёный не вернулся в мои стили', () => {
  for (const [file, text] of [
    ['style.css', style],
    ['components.css', components],
  ]) {
    const plain = text.replace(/\/\*[\s\S]*?\*\//g, '');
    const hits = plain.match(/#4ade80|#22c55e|rgba\(\s*74,\s*222,\s*128/gi) ?? [];
    assert.equal(hits.length, 0, `${file}: ${hits.length} жёстко зашитых зелёных значений`);
  }
});

test('залитые акцентные кнопки красят текст в --on-accent', () => {
  const plain = style.replace(/\/\*[\s\S]*?\*\//g, '');
  const btnPrimary = /\.btn-primary\s*\{([^}]*)\}/.exec(plain);
  assert.ok(btnPrimary, 'нет правила .btn-primary');
  assert.match(btnPrimary[1], /color:\s*var\(--on-accent\)/, '.btn-primary: текст не --on-accent');

  const hover = /\.btn-primary:hover[^{]*\{([^}]*)\}/.exec(plain);
  assert.ok(hover, 'нет правила .btn-primary:hover');
  assert.match(hover[1], /color:\s*var\(--on-accent\)/, '.btn-primary:hover: текст не --on-accent');

  const cta = /\.nav-cta\s*\{([^}]*)\}/.exec(plain);
  assert.match(cta[1], /color:\s*var\(--on-accent\)/, '.nav-cta: текст не --on-accent');

  assert.match(components, /\.dock-btn--accent\s*\{[^}]*color:\s*var\(--on-accent\)/, '.dock-btn--accent: текст не --on-accent');
});

test('бейджи и теги не красят акцентный текст самим акцентом', () => {
  const plain = style.replace(/\/\*[\s\S]*?\*\//g, '');
  const badges = ['.hero-badge', '.tag', '.category-tag', '.experience-badge', '.guarantee-badge', '.nav-links a.active'];
  for (const selector of badges) {
    const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\s*,[^{]*)?\\s*\\{([^}]*)\\}');
    const block = re.exec(plain);
    assert.ok(block, `нет правила ${selector}`);
    const body = block[1];
    if (!/background[^;]*--accent/.test(body)) continue; // подложка не акцентная — не наш случай
    assert.match(
      body,
      /color:\s*var\(--(accent-text|text-primary|on-accent)\)/,
      `${selector}: текст на акцентной подложке должен быть --accent-text или --text-primary`,
    );
  }
});

test('базовый сброс: кнопки и поля наследуют цвет, а не берут чёрный браузерный', () => {
  const plain = style.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(plain, /button\s*\{[^}]*color:\s*inherit/, 'button без color: inherit');
  assert.match(plain, /input,\s*textarea,\s*select\s*\{[^}]*color:\s*inherit/, 'поля без color: inherit');
});

test('логотип в шапке и подвале инлайновый и красится переменными', () => {
  const header = read('src/components/Header.astro');
  const footer = read('src/components/Footer.astro');
  const logo = read('src/components/Logo.astro');

  assert.match(header, /<Logo\b/, 'Header.astro не использует Logo.astro');
  assert.match(footer, /<Logo\b/, 'Footer.astro не использует Logo.astro');
  assert.ok(!/<img[^>]*logo\.svg/.test(header), 'Header.astro всё ещё тянет logo.svg через <img>');
  assert.ok(!/<img[^>]*logo\.svg/.test(footer), 'Footer.astro всё ещё тянет logo.svg через <img>');
  assert.ok(!header.includes('nav-logo-text'), 'в шапку вернулся текстовый дубль .nav-logo-text');

  assert.match(logo, /fill="var\(--accent\)"/, 'знак логотипа не красится --accent');
  assert.match(logo, /fill="var\(--text-primary\)"/, 'буквы логотипа не красятся --text-primary');

  // сам файл на диске не тронут — он нужен OG-карточке и превью в мессенджерах
  const svg = read('public/img/logo.svg');
  assert.match(svg, /#6dbf7b/, 'public/img/logo.svg изменён — он должен остаться исходным');
});

test('переключатель палитр подключён и помнит выбор', () => {
  const base = read('src/layouts/Base.astro');
  const theme = read('src/client/theme.ts');
  const bar = read('src/components/ThemePreviewBar.astro');

  assert.match(base, /ThemePreviewBar/, 'Base.astro не подключает ThemePreviewBar');
  assert.match(base, /client\/theme\.ts/, 'Base.astro не подключает client/theme.ts');
  assert.match(base, /localStorage\.getItem\('kadrypro-preview-theme'\)/, 'нет предварительного применения темы в <head>');

  for (const name of ['sage', 'gold', 'cobalt', 'amber', 'teal']) {
    assert.ok(bar.includes(`data-theme-set="${name}"`), `в плашке нет кнопки ${name}`);
    assert.ok(theme.includes(`'${name}'`), `в theme.ts нет темы ${name}`);
  }
  assert.match(theme, /root\.setAttribute\('data-theme', name\)/, 'theme.ts не ставит data-theme');
  assert.match(theme, /localStorage\.setItem\(THEME_KEY, name\)/, 'theme.ts не запоминает выбор');
});

test('плашка палитр никого не перекрывает: док на телефоне, куки на ПК', () => {
  const plain = components.replace(/\/\*[\s\S]*?\*\//g, '');
  const block = plain.slice(plain.indexOf('.theme-bar {'));
  // последний блок @media (max-width: 768px) — телефонная стопка
  const mobileBlocks = [...block.matchAll(/@media \(max-width: 768px\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]);
  const mobile = mobileBlocks[mobileBlocks.length - 1] ?? '';

  // телефон: плашка над доком (68px), куки и «Настройки cookie» ещё выше
  assert.match(mobile, /\.theme-bar\s*\{[^}]*bottom:\s*calc\(76px/, 'на телефоне плашка не поднимается над .dock');
  // баннер свёрстан через шорткат inset: auto 8px <низ> 8px
  assert.match(mobile, /\.cookie-consent\s*\{[^}]*inset:\s*auto\s+8px\s+calc\(126px/, 'баннер куки перекрывает плашку палитр');
  assert.match(mobile, /\.cookie-consent__manage\s*\{[^}]*bottom:\s*calc\(126px/, 'кнопка «Настройки cookie» осталась под плашкой');

  // компьютер: плашка слева, кнопка настроек куки справа — не пересекаются
  assert.match(plain, /\.theme-bar\s*\{[^}]*left:\s*16px/, 'плашка палитр не слева');
  assert.match(plain, /\.cookie-consent\s*\{[^}]*bottom:\s*78px/, 'на ПК куки-баннер не поднят над плашкой');
});
