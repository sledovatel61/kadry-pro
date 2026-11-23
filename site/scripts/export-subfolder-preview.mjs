/**
 * export-subfolder-preview.mjs — изолированное превью на https://kadry-pro.ru/preview/
 *
 * Боевой сайт в корне репозитория (index.html, services.html, style.css, …)
 * не трогается НИКАК: скрипт только добавляет новую папку preview/ с полной
 * копией собранного сайта (site/pages-dist), приспособленной для работы
 * из подпапки:
 *
 *   1. каждая страница получает <meta name="robots" content="noindex, nofollow">,
 *      чтобы поисковики не индексировали тестовую копию;
 *   2. все корневые пути переписываются на /preview/... — href, src, action,
 *      poster, content, srcset (все размеры через запятую!), url(...) в CSS,
 *      строковые пути в JS (кроме API-путей релея и GitHub — см. API_PREFIXES);
 *   3. ссылка «На главную» ведёт на /preview/ (index.html на месте),
 *      кабинет — на /preview/manage/ (manage/index.html на месте).
 *
 * В конце (и в режиме --check-only) прогоняется автопроверка:
 *   - внутри preview/ не остаётся НИ ОДНОЙ непереписанной корневой ссылки;
 *   - каждый локальный файл/страница, на которую ссылаются страницы превью,
 *     реально лежит на диске.
 *
 * Запуск: node scripts/export-subfolder-preview.mjs [--check-only]
 */
import { cp, mkdir, readdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, dirname, resolve } from 'node:path';

const SITE = resolve(import.meta.dirname, '..');
const SRC = join(SITE, 'pages-dist');
const REPO = resolve(SITE, '..');
const OUT = join(REPO, 'preview');

const PREFIX = '/preview';
/** Пути API — НЕ страницы сайта: релея заявок и GitHub API кабинета /manage/. */
const API_PREFIXES = ['/reviews/', '/git/', '/contents/', '/api/'];

const CHECK_ONLY = process.argv.includes('--check-only');

/* ------------------------------------------------------------------ */
/* Переписывание путей                                                  */
/* ------------------------------------------------------------------ */

function isApiPath(path) {
  return API_PREFIXES.some((p) => path === p.slice(0, -1) || path.startsWith(p));
}

/** '/contact.html' → '/preview/contact.html'; '/', '//x', '/preview/…' — без изменений. */
function pref(path) {
  if (!path.startsWith('/')) return path;
  if (path.startsWith('//')) return path;
  if (path === '/') return PREFIX + '/';
  if (path.startsWith(PREFIX)) return path;
  return PREFIX + path;
}

function rewriteHtmlAttrs(text) {
  return text.replace(
    /(\b(?:href|src|action|poster|formaction|data-src|data-href|content)\s*=\s*)("[^"]*"|'[^']*')/g,
    (whole, head, quoted) => {
      const value = quoted.slice(1, -1);
      return head + quoted[0] + pref(value) + quoted[0];
    },
  );
}

function rewriteSrcset(text) {
  return text.replace(
    /(\bsrcset\s*=\s*)("[^"]*"|'[^']*')/g,
    (whole, head, quoted) => {
      const q = quoted[0];
      const rewritten = quoted
        .slice(1, -1)
        .split(',')
        .map((candidate) => {
          const trimmed = candidate.trim();
          const match = trimmed.match(/^(\S+)(\s+.*)?$/);
          if (!match) return trimmed;
          return pref(match[1]) + (match[2] ?? '');
        })
        .join(', ');
      return head + q + rewritten + q;
    },
  );
}

function rewriteCssUrls(text) {
  return text.replace(
    /(?<![\w.$-])url\(\s*(['"]?)(\/[^'")\s]*)\1\s*\)/g,
    (whole, quote, path) => `url(${quote}${pref(path)}${quote})`,
  );
}

function rewriteScriptStrings(text) {
  /* Строковые пути в JS: '/privacy.html', '/shablony/x.pdf', '/manage/'.
     Матчится только настоящий путь (сегменты с буквами/цифрами, расширение
     или слэш в конце) — иначе легко порвать минифицированный код, приняв
     за путь кусок регулярного выражения (например replace(/\"/g,…)).
     API-пути релея и GitHub, одиночный '/' и шаблонные строки с ${…}
     не трогаем: их переписывают другие правила или они служебные. */
  const PATH = String.raw`\/(?:[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+|[a-zA-Z0-9_-]+\/[a-zA-Z0-9_./-]*|[a-zA-Z0-9_-]+\/)`;
  return text.replace(new RegExp(`(['"\`])(${PATH})\\1`, 'g'), (whole, quote, path) => {
    if (isApiPath(path)) return whole;
    return quote + pref(path) + quote;
  });
}

function rewriteHtml(text) {
  let out = rewriteHtmlAttrs(text);
  out = rewriteSrcset(out);
  out = rewriteCssUrls(out);
  /* Строки JS — только внутри настоящих <script> (не JSON) */
  out = out.replace(
    /<script([^>]*)>([\s\S]*?)<\/script>/g,
    (whole, attrs, body) => {
      if (/application\/(ld\+)?json/.test(attrs)) return whole;
      return `<script${attrs}>${rewriteScriptStrings(body)}</script>`;
    },
  );
  return out;
}

function rewriteCss(text) {
  /* В CSS бывают и url(...), и атрибутные селекторы вида a[href="/cases"] */
  return rewriteCssUrls(rewriteHtmlAttrs(text));
}

function rewriteJs(text) {
  let out = rewriteHtmlAttrs(text); // href="…" внутри template литералов
  out = rewriteSrcset(out);
  out = rewriteCssUrls(out);
  out = rewriteScriptStrings(out);
  return out;
}

function addNoindex(html) {
  const meta = '<meta name="robots" content="noindex, nofollow">';
  if (/<meta name="robots"[^>]*>/i.test(html)) {
    return html.replace(/<meta name="robots"[^>]*>/i, meta);
  }
  if (/<head[^>]*>/.test(html)) return html.replace(/<head([^>]*)>/, `<head$1>\n    ${meta}`);
  return meta + '\n' + html;
}

/* ------------------------------------------------------------------ */
/* Автопроверка                                                         */
/* ------------------------------------------------------------------ */

async function collectFiles(dir, prefix = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await collectFiles(join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out;
}

function scanRefs(text) {
  const rootRefs = new Set(); // непереписанные корневые ссылки — это ошибка
  const localRefs = new Set(); // локальные ссылки — должны существовать на диске

  const note = (rawPath) => {
    let path = rawPath;
    if (!path) return;
    if (path.startsWith('//')) return;
    if (path.startsWith('/')) {
      if (path === '/') rootRefs.add(path);
      else if (path.startsWith(PREFIX + '/') || path === PREFIX) localRefs.add(path);
      else if (isApiPath(path)) return; // API — не страницы сайта
      else rootRefs.add(path);
      return;
    }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path) || path.startsWith('#')) return; // схемы, якоря
    /* Относительные пути — только похожие на путь (слэш или расширение файла).
       Остальное (meta content со словами, цифры og:width и т.п.) — не ссылки. */
    if (!/\s/.test(path) && (path.includes('/') || /\.[a-z0-9]+$/i.test(path))) {
      localRefs.add(path);
    }
  };

  for (const m of text.matchAll(/(\b(?:href|src|action|poster|formaction|data-src|data-href|content)\s*=\s*)("[^"]*"|'[^']*')/g)) {
    note(m[2].slice(1, -1));
  }
  for (const m of text.matchAll(/(\bsrcset\s*=\s*)("[^"]*"|'[^']*')/g)) {
    for (const candidate of m[2].slice(1, -1).split(',')) {
      const trimmed = candidate.trim();
      const match = trimmed.match(/^(\S+)/);
      if (match) note(match[1]);
    }
  }
  for (const m of text.matchAll(/(?<![\w.$-])url\(\s*(['"]?)(\/[^'")\s]*)\1\s*\)/g)) {
    note(m[2]);
  }
  const jsPath = String.raw`(?:\/(?:[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+|[a-zA-Z0-9_-]+\/[a-zA-Z0-9_./-]*|[a-zA-Z0-9_-]+\/))`;
  for (const m of text.matchAll(new RegExp(`(['"\`])(${jsPath})\\1`, 'g'))) {
    if (!isApiPath(m[2])) note(m[2]);
  }

  return { rootRefs, localRefs };
}

async function verify() {
  const files = await collectFiles(OUT);
  const problems = [];

  for (const req of ['index.html', 'manage/index.html']) {
    if (!files.includes(req)) problems.push(`нет обязательного файла ${req}`);
  }

  const allRootRefs = new Set();
  const allLocalRefs = new Set();

  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (!['.html', '.css', '.js', '.mjs'].includes(ext)) continue;
    const text = await readFile(join(OUT, file), 'utf8');
    const { rootRefs, localRefs } = scanRefs(text);
    for (const ref of rootRefs) allRootRefs.add(`${file} → ${ref}`);
    for (const ref of localRefs) allLocalRefs.add(ref);
    if (ext === '.html') {
      const metas = (text.match(/<meta name="robots" content="noindex, nofollow">/g) || []).length;
      if (metas !== 1) problems.push(`${file}: мета-тегов noindex ${metas}, ожидался ровно 1`);
    }
  }

  for (const bad of allRootRefs) {
    problems.push(`непереписанная корневая ссылка (ведёт в старый корень): ${bad}`);
  }

  const missing = [];
  for (const ref of allLocalRefs) {
    if (ref.includes('${')) continue; // шаблонные строки JS — не конкретные файлы
    const clean = ref.replace(/[?#].*$/, '');
    const rel = clean.startsWith(PREFIX) ? clean.slice(PREFIX.length) : clean;
    const base = join(OUT, rel.replace(/^\/+/, ''));
    const candidates = [base, join(base, 'index.html'), base + '.html'];
    if (!candidates.some((c) => existsSync(c) && true)) missing.push(ref);
  }
  for (const ref of missing) {
    problems.push(`ссылка в никуда: ${ref} — такого файла в preview/ нет`);
  }

  const htmlCount = files.filter((f) => f.endsWith('.html')).length;
  console.log(`Автопроверка preview/: страниц ${htmlCount}, файлов ${files.length},`);
  console.log(`  локальных ссылок: ${allLocalRefs.size}, непереписанных: ${allRootRefs.size}, в никуда: ${missing.length}`);

  if (problems.length) {
    console.error('✗ Автопроверка НЕ пройдена:');
    for (const p of problems.slice(0, 40)) console.error('  - ' + p);
    if (problems.length > 40) console.error(`  … и ещё ${problems.length - 40}`);
    return false;
  }
  console.log('✓ Автопроверка пройдена: все пути переписаны, все файлы на месте');
  return true;
}

/* ------------------------------------------------------------------ */
/* Экспорт                                                              */
/* ------------------------------------------------------------------ */

if (!CHECK_ONLY) {
  try {
    await stat(join(SRC, 'index.html'));
  } catch {
    console.error('Нет site/pages-dist — сначала соберите сайт: npm run build:pages');
    process.exit(1);
  }

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await cp(SRC, OUT, { recursive: true });

  let rewritten = 0;
  for (const file of await collectFiles(OUT)) {
    const ext = extname(file).toLowerCase();
    const path = join(OUT, file);
    if (ext === '.html') {
      const text = await readFile(path, 'utf8');
      await writeFile(path, addNoindex(rewriteHtml(text)));
      rewritten += 1;
    } else if (ext === '.css') {
      const text = await readFile(path, 'utf8');
      await writeFile(path, rewriteCss(text));
    } else if (ext === '.js' || ext === '.mjs') {
      const text = await readFile(path, 'utf8');
      await writeFile(path, rewriteJs(text));
    }
  }
  console.log(`Превью собрано в preview/: страниц переписано ${rewritten}`);
}

const ok = await verify();
process.exit(ok ? 0 : 1);
