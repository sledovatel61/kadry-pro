import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Тесты палитр, контраста и объёма (кобальт).
 *
 * Проверяют то, что нельзя увидеть глазами на одном мониторе:
 *   • объявлены ровно три вариации кобальта с одинаковым набором переменных;
 *   • ни одна пара «текст/фон» не ниже нормы WCAG 2.1;
 *   • белый --on-accent держит ≥ 4,95:1 на КАЖДОЙ точке --grad-btn и --grad-btn-hover;
 *   • компаньон (--accent-secondary) не используется как цвет текста;
 *   • каждый градиентный текст имеет запасной сплошной цвет;
 *   • кислотный зелёный не вернулся в style.css и components.css;
 *   • залитые кнопки всегда красят текст в --on-accent;
 *   • логотип в шапке и подвале — инлайновый и красится переменными;
 *   • переключатель палитр подключён и помнит выбор.
 */

const ROOT = new URL('../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
const style = read('src/styles/style.css');
const components = read('src/styles/components.css');
const plain = style.replace(/\/\*[\s\S]*?\*\//g, '');
const plainComponents = components.replace(/\/\*[\s\S]*?\*\//g, '');

/* ---------- цветовые утилиты (те же, что в scripts/check-contrast.mjs) ---------- */
function parseColor(value) {
  const v = String(value ?? '').trim();
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
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([\\s\\S]*?)\\}');
  const block = re.exec(plain);
  if (!block) return null;
  const vars = {};
  for (const m of block[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

/** Переменные объёма/градиентов — из общего :root (первый блок в файле). */
function rootVars() {
  const m = /:root\s*\{([\s\S]*?)\n\}/.exec(plain);
  const vars = {};
  if (m) for (const d of m[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars[d[1]] = d[2].trim();
  return vars;
}

const REQUIRED_VARS = [
  'bg-primary', 'bg-elevated', 'bg-card', 'bg-card-hover',
  'border-color', 'border-light',
  'text-primary', 'text-secondary', 'text-muted', 'text-slate',
  'accent', 'accent-dark', 'accent-text', 'on-accent',
  'accent-glow', 'accent-glow-strong', 'accent-border',
  'accent-secondary', 'accent-secondary-text', 'on-accent-secondary',
  'accent-secondary-glow', 'accent-secondary-border',
  'atmosphere-1', 'atmosphere-2', 'atmosphere-3',
];

/* Основная тема объявлена на :root и дублируется алиасом cobalt-champagne. */
const CHAMPAGNE = ":root,\nhtml[data-theme='cobalt'],\nhtml[data-theme='cobalt-champagne']";
const THEMES = {
  cobalt: CHAMPAGNE,
  'cobalt-aurora': "html[data-theme='cobalt-aurora']",
  'cobalt-platinum': "html[data-theme='cobalt-platinum']",
};

const varsOf = (selector) => themeVars(selector) ?? themeVars(selector.split(',')[0]);

test('объявлены ровно три вариации кобальта с одинаковым набором переменных', () => {
  for (const [name, selector] of Object.entries(THEMES)) {
    const vars = varsOf(selector);
    assert.ok(vars, `нет блока переменных для темы ${name}`);
    for (const key of REQUIRED_VARS) {
      assert.ok(vars[key], `тема ${name}: нет --${key}`);
    }
  }

  // старые палитры первой волны убраны, чтобы не тянуть мёртвые блоки
  for (const gone of ['sage', 'gold', 'amber', 'teal']) {
    assert.ok(
      !new RegExp(`html\\[data-theme='${gone}'\\]`).test(plain),
      `в style.css остался блок старой темы ${gone}`,
    );
  }
});

test('все три вариации остаются кобальтом: общий акцент и очень тёмная база', () => {
  const base = varsOf(CHAMPAGNE);
  const white = parseColor('#ffffff');

  for (const name of ['cobalt', 'cobalt-aurora', 'cobalt-platinum']) {
    const v = varsOf(name === 'cobalt' ? CHAMPAGNE : `html[data-theme='${name}']`);

    /* акцент и его текстовые производные — общий кобальтовый каркас */
    for (const key of ['accent', 'accent-dark', 'accent-text', 'on-accent']) {
      assert.equal(v[key], base[key], `${name}: --${key} должен совпадать с базой — это один и тот же кобальт`);
    }

    /* фон каждой вариации — глубокий ночной, а не серый: белый на нём ≥ 15:1 */
    for (const key of ['bg-primary', 'bg-card']) {
      const r = contrast(white, parseColor(v[key]));
      assert.ok(r >= 15, `${name}: --${key} слишком светлый (${r.toFixed(2)}:1 к белому) — пропала глубина`);
    }
  }

  /* компаньоны у трёх вариаций разные: иначе вариации неразличимы */
  const companions = ['cobalt', 'cobalt-aurora', 'cobalt-platinum'].map(
    (n) => varsOf(n === 'cobalt' ? CHAMPAGNE : `html[data-theme='${n}']`)['accent-secondary'],
  );
  assert.equal(new Set(companions).size, 3, `компаньоны должны различаться, а они: ${companions.join(', ')}`);
});

test('контраст текста не ниже нормы во всех трёх вариациях', () => {
  /* [цвет текста, цвет фона, минимум] */
  const minimums = [
    ['text-primary', ['bg-card', 'bg-primary'], 7],
    ['text-secondary', ['bg-card', 'bg-primary'], 7],
    ['text-muted', ['bg-card', 'bg-primary'], 4.8],
    ['text-slate', ['bg-card'], 4.8],
    ['accent', ['bg-card', 'bg-primary'], 4.5],
    ['accent-dark', ['bg-card'], 4.5],
    ['accent-text', ['accent-glow'], 4.5],
    // компаньон: текст идёт через *-text на мягкой подложке, заливка — только фон
    ['accent-secondary-text', ['accent-secondary-glow', 'bg-card'], 4.5],
    ['on-accent-secondary', ['accent-secondary'], 4.5],
  ];

  for (const [name, selector] of Object.entries(THEMES)) {
    const v = varsOf(selector);
    const card = parseColor(v['bg-card']);
    const bg = parseColor(v['bg-primary']);

    for (const [fgKey, bgKeys, min] of minimums) {
      const fg = parseColor(v[fgKey]);
      assert.ok(fg, `${name}: не разобрать --${fgKey} (${v[fgKey]})`);

      for (const bgKey of bgKeys) {
        /* полупрозрачные подложки накладываем на карточку */
        const bgColor =
          bgKey === 'accent-glow' ? over(parseColor(v['accent-glow']), card)
          : bgKey === 'accent-secondary-glow' ? over(parseColor(v['accent-secondary-glow']), card)
          : bgKey === 'bg-card' ? card
          : bgKey === 'accent-secondary' ? parseColor(v['accent-secondary'])
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

test('компаньон держит норму как заливка и не подменяет собой текст', () => {
  for (const [name, selector] of Object.entries(THEMES)) {
    const v = varsOf(selector);

    /* заливка компаньона + тёмный --on-accent-secondary — контрастная пара */
    const onFill = contrast(parseColor(v['on-accent-secondary']), parseColor(v['accent-secondary']));
    assert.ok(onFill >= 4.5, `${name}: тёмный текст на заливке компаньона всего ${onFill.toFixed(2)}:1`);

    /* текстовая версия компаньона на мягкой подложке — тоже норма */
    const card = parseColor(v['bg-card']);
    const glow = over(parseColor(v['accent-secondary-glow']), card);
    const asText = contrast(parseColor(v['accent-secondary-text']), glow);
    assert.ok(asText >= 4.5, `${name}: --accent-secondary-text на подложке ${asText.toFixed(2)}:1`);
  }

  /* в правилах цвета текста компаньон не должен появляться напрямую:
     буквы идут через *-text, а на заливке — через --on-accent-secondary */
  for (const [file, text] of [
    ['style.css', plain],
    ['components.css', plainComponents],
  ]) {
    const colorRules = [...text.matchAll(/(?:^|\n)\s*color:\s*([^;]+);/g)].map((m) => m[1].trim());
    const offenders = colorRules.filter((c) => /var\(--accent-secondary\)\s*(!important)?\s*$/.test(c));
    assert.equal(offenders.length, 0, `${file}: цвет текста задан --accent-secondary: ${offenders.join(' | ')}`);
  }
});

test('--text-muted больше не #777777', () => {
  assert.ok(!/--text-muted:\s*#777/i.test(plain), '--text-muted вернулся к #777777 (контраст 3,9:1)');
  for (const [name, selector] of Object.entries(THEMES)) {
    const v = varsOf(selector);
    const ratio = contrast(parseColor(v['text-muted']), parseColor(v['bg-card']));
    assert.ok(ratio >= 4.8, `${name}: --text-muted на карточке ${ratio.toFixed(2)}:1`);
  }
});

test('--on-accent держит ≥ 4,95:1 на каждой точке градиента кнопки', () => {
  const root = rootVars();
  for (const key of ['grad-btn', 'grad-btn-hover']) {
    const value = root[key];
    assert.ok(value, `нет --${key} в общем :root`);
    const stops = [...value.matchAll(/#([0-9a-f]{6})/gi)].map((m) => '#' + m[1]);
    assert.ok(stops.length >= 2, `--${key} должен содержать хотя бы две цветовые точки`);
  }

  for (const [name, selector] of Object.entries(THEMES)) {
    const onAccent = parseColor(varsOf(selector)['on-accent']);
    for (const key of ['grad-btn', 'grad-btn-hover']) {
      const stops = [...root[key].matchAll(/#([0-9a-f]{6})/gi)].map((m) => '#' + m[1]);
      for (const stop of stops) {
        const ratio = contrast(onAccent, parseColor(stop));
        assert.ok(
          ratio >= 4.95,
          `${name}: --on-accent на ${key} ${stop} = ${ratio.toFixed(2)}:1, нужно ≥ 4,95:1`,
        );
      }
    }
  }
});

test('плоский --accent не годится под белый текст — кнопки живут на градиенте', () => {
  const v = varsOf(CHAMPAGNE);
  const flat = contrast(parseColor(v['on-accent']), parseColor(v['accent']));
  assert.ok(flat < 3, 'плоский --accent неожиданно стал контрастным — обновите контракт переменных');

  const btnPrimary = /\.btn-primary\s*\{([^}]*)\}/.exec(plain);
  assert.ok(btnPrimary, 'нет правила .btn-primary');
  assert.match(btnPrimary[1], /background:\s*var\(--grad-btn\)/, '.btn-primary: заливка не --grad-btn');
  assert.match(btnPrimary[1], /color:\s*var\(--on-accent\)/, '.btn-primary: текст не --on-accent');
  assert.match(btnPrimary[1], /inset 0 1px 0 rgba\(255,\s*255,\s*255/, '.btn-primary: нет верхнего блика');

  const cta = /\.nav-cta\s*\{([^}]*)\}/.exec(plain);
  assert.ok(cta, 'нет правила .nav-cta');
  assert.match(cta[1], /background:\s*var\(--grad-btn\)/, '.nav-cta: заливка не --grad-btn');

  assert.match(
    plainComponents,
    /\.dock-btn--accent\s*\{[^}]*background:\s*var\(--grad-btn\)/,
    '.dock-btn--accent: заливка не --grad-btn (плоский акцент даст 2:1)',
  );
});

test('нет ни одного правила «белый текст на плоском акценте»', () => {
  /* Плоский --accent со светлым --on-accent = 2,07:1. Любая залитая плашка
     должна брать --grad-btn / --grad-btn-hover, иначе текст «плывёт». */
  for (const [file, text] of [
    ['style.css', plain],
    ['components.css', plainComponents],
  ]) {
    const offenders = [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => /background(?:-color)?:\s*var\(--accent(?:-dark)?\)/.test(body)
        && /color:\s*var\(--on-accent\)/.test(body))
      .map(([, selector]) => selector.trim().split('\n').pop());
    assert.equal(offenders.length, 0, `${file}: белый текст на плоском акценте — ${offenders.join(' | ')}`);
  }
});

test('градиентный текст всегда имеет запасной сплошной цвет', () => {
  for (const [label, re] of [
    ['.grad-text', /\.grad-text\s*\{([^}]*)\}/],
    ['.hero h1 .accent', /\.hero h1 \.accent\s*\{([^}]*)\}/],
  ]) {
    const block = re.exec(plain);
    assert.ok(block, `нет правила ${label}`);
    assert.match(
      block[1],
      /color:\s*var\(--(text-primary|accent-text)\)/,
      `${label}: нет запасного цвета, если background-clip: text не поддержан`,
    );
    assert.match(block[1], /var\(--grad-heading\)|var\(--accent-text\)/, `${label}: не привязан к --grad-heading`);
  }

  // сам приём обёрнут в @supports — иначе в старом браузере текст исчезнет
  assert.match(plain, /@supports\s*\(background-clip:\s*text\)/, 'нет @supports вокруг background-clip: text');
});

test('объём: карточки, выделенный тариф и атмосфера на переменных', () => {
  const root = rootVars();
  for (const key of [
    'grad-btn', 'grad-btn-hover', 'grad-heading', 'grad-card', 'grad-card-featured',
    'card-highlight', 'card-shadow', 'card-shadow-hover', 'grad-surface',
    'rule-gradient', 'rule-gradient-gold',
  ]) {
    assert.ok(root[key], `нет --${key} в общем :root — страницы агентов 02/03 его не унаследуют`);
  }

  const card = /(?:^|\n)\.card\s*\{([^}]*)\}/.exec(plain);
  assert.ok(card, 'нет правила .card');
  assert.match(card[1], /var\(--grad-card\)/, '.card: плоская заливка, нет градиента объёма');
  assert.match(card[1], /var\(--card-highlight\)/, '.card: нет верхнего светового блика');
  assert.match(card[1], /var\(--card-shadow\)/, '.card: нет многослойной тени');

  const featured = /\.pricing-card\.featured\s*\{([^}]*)\}/.exec(plain);
  assert.ok(featured, 'нет правила .pricing-card.featured');
  assert.match(featured[1], /var\(--grad-card-featured\)/, 'выделенный тариф потерял градиент');

  const heroBg = /\.hero-bg\s*\{([^}]*)\}/.exec(plain);
  assert.ok(heroBg, 'нет правила .hero-bg');
  assert.match(heroBg[1], /var\(--atmosphere-1\)/, '.hero-bg: атмосферный купол не на переменной');

  // мягкая линия-разделитель между секциями привязана к переменной, а не к хардкоду
  assert.match(plain, /\.section:not\(\.section-alt\)::before\s*\{[^}]*var\(--rule-gradient\)/, 'нет световой линии между секциями');
});

test('кислотный зелёный не вернулся в мои стили', () => {
  for (const [file, text] of [
    ['style.css', plain],
    ['components.css', plainComponents],
  ]) {
    const hits = text.match(/#4ade80|#22c55e|rgba\(\s*74,\s*222,\s*128/gi) ?? [];
    assert.equal(hits.length, 0, `${file}: ${hits.length} жёстко зашитых зелёных значений`);
  }
});

test('залитые акцентные кнопки красят текст в --on-accent', () => {
  const hover = /\.btn-primary:hover[^{]*\{([^}]*)\}/.exec(plain);
  assert.ok(hover, 'нет правила .btn-primary:hover');
  assert.match(hover[1], /color:\s*var\(--on-accent\)/, '.btn-primary:hover: текст не --on-accent');
  assert.match(hover[1], /background:\s*var\(--grad-btn-hover\)/, '.btn-primary:hover: заливка не --grad-btn-hover');

  const navHover = /\.nav-cta:hover[^{]*\{([^}]*)\}/.exec(plain);
  assert.ok(navHover, 'нет правила .nav-cta:hover');
  assert.match(navHover[1], /color:\s*var\(--on-accent\)/, '.nav-cta:hover: текст не --on-accent');

  assert.match(
    plainComponents,
    /\.dock-btn--accent\s*\{[^}]*color:\s*var\(--on-accent\)/,
    '.dock-btn--accent: текст не --on-accent',
  );
});

test('неактивные табы и буллиты уходят в спокойный сланцевый тон', () => {
  const tab = /\.tabs-nav button\s*\{([^}]*)\}/.exec(plain);
  assert.ok(tab, 'нет правила .tabs-nav button');
  assert.match(tab[1], /color:\s*var\(--text-slate\)/, 'неактивные табы всё ещё синие');

  const active = /\.tabs-nav button\.active\s*\{([^}]*)\}/.exec(plain);
  assert.ok(active, 'нет правила .tabs-nav button.active');
  assert.match(active[1], /var\(--grad-btn\)/, 'активный таб потерял градиентную заливку');
});

test('бейджи и теги не красят акцентный текст самим акцентом', () => {
  const badges = ['.hero-badge', '.tag', '.category-tag', '.experience-badge', '.guarantee-badge', '.nav-links a.active'];
  for (const selector of badges) {
    const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\s*,[^{]*)?\\s*\\{([^}]*)\\}');
    const block = re.exec(plain);
    assert.ok(block, `нет правила ${selector}`);
    const body = block[1];
    if (!/background[^;]*--accent/.test(body)) continue; // подложка не акцентная — не наш случай
    assert.match(
      body,
      /color:\s*var\(--(accent-text|accent-secondary-text|text-primary|on-accent)\)/,
      `${selector}: текст на акцентной подложке должен быть осветлённым вариантом`,
    );
  }
});

test('бейдж «Популярный» — на ювелирном компаньоне с тёмным текстом', () => {
  const badge = /\.pricing-badge\s*\{([^}]*)\}/.exec(plain);
  assert.ok(badge, 'нет правила .pricing-badge');
  assert.match(badge[1], /var\(--accent-secondary\)/, '.pricing-badge: не на компаньоне');
  assert.match(badge[1], /color:\s*var\(--on-accent-secondary\)/, '.pricing-badge: текст не --on-accent-secondary');
});

test('базовый сброс: кнопки и поля наследуют цвет, а не берут чёрный браузерный', () => {
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

  // знак «цветок» красится деликатным градиентом, id уникален для каждого экземпляра
  assert.match(logo, /<linearGradient/, 'у знака логотипа нет градиента');
  assert.match(logo, /stop-color="var\(--accent-secondary\)"/, 'градиент знака не заканчивается компаньоном темы');
  assert.match(logo, /stop-color="var\(--accent-text\)"/, 'градиент знака не начинается светлым кобальтом');
  assert.ok(!logo.includes('color-mix('), 'в SVG-градиенте color-mix: старые движки выключат остановку');
  assert.match(logo, /__kpLogoSeq/, 'id градиента не уникален — шапка и подвал дадут дубль');
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
  assert.match(base, /data-theme="cobalt"/, 'базовая тема в <html> не кобальт');

  for (const name of ['cobalt', 'cobalt-aurora', 'cobalt-platinum']) {
    assert.ok(bar.includes(`data-theme-set="${name}"`), `в плашке нет кнопки ${name}`);
    assert.ok(theme.includes(`'${name}'`), `в theme.ts нет темы ${name}`);
  }
  // старые имена остаются только как алиасы, а не как отдельные кнопки
  for (const gone of ['sage', 'gold', 'amber', 'teal']) {
    assert.ok(!bar.includes(`data-theme-set="${gone}"`), `в плашке осталась кнопка ${gone}`);
  }
  assert.match(theme, /root\.setAttribute\('data-theme', name\)/, 'theme.ts не ставит data-theme');
  assert.match(theme, /localStorage\.setItem\(THEME_KEY, name\)/, 'theme.ts не запоминает выбор');
  assert.match(theme, /return 'cobalt';/, 'тема по умолчанию в theme.ts не кобальт');
});

test('точки палитр в плашке покрашены под три компаньона', () => {
  for (const dot of ['champagne', 'aurora', 'platinum']) {
    assert.match(
      plainComponents,
      new RegExp(`\\.theme-bar-dot--${dot}\\s*\\{`),
      `нет стиля .theme-bar-dot--${dot}`,
    );
  }
  for (const gone of ['sage', 'gold', 'amber', 'teal']) {
    assert.ok(
      !new RegExp(`\\.theme-bar-dot--${gone}\\s*\\{`).test(plainComponents),
      `в components.css остался .theme-bar-dot--${gone}`,
    );
  }
});

test('плашка палитр никого не перекрывает: док на телефоне, куки на ПК', () => {
  const block = plainComponents.slice(plainComponents.indexOf('.theme-bar {'));
  const mobileBlocks = [...block.matchAll(/@media \(max-width: 768px\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]);
  const mobile = mobileBlocks[mobileBlocks.length - 1] ?? '';

  // телефон: плашка над доком (68px), куки и «Настройки cookie» ещё выше
  assert.match(mobile, /\.theme-bar\s*\{[^}]*bottom:\s*calc\(76px/, 'на телефоне плашка не поднимается над .dock');
  // баннер свёрстан через шорткат inset: auto 8px <низ> 8px
  assert.match(mobile, /\.cookie-consent\s*\{[^}]*inset:\s*auto\s+8px\s+calc\(126px/, 'баннер куки перекрывает плашку палитр');
  assert.match(mobile, /\.cookie-consent__manage\s*\{[^}]*bottom:\s*calc\(126px/, 'кнопка «Настройки cookie» осталась под плашкой');

  // компьютер: плашка слева, кнопка настроек куки справа — не пересекаются
  assert.match(plainComponents, /\.theme-bar\s*\{[^}]*left:\s*16px/, 'плашка палитр не слева');
  assert.match(plainComponents, /\.cookie-consent\s*\{[^}]*bottom:\s*78px/, 'на ПК куки-баннер не поднят над плашкой');
});
