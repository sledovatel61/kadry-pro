/**
 * Генератор страниц Astro из извлечённого содержимого.
 *
 * Для каждой страницы берёт src/pages/_content/<slug>.{json,html} и создаёт
 * src/pages/<slug>.astro — тонкую обёртку вокруг Base.astro:
 *   • title, description и JSON-LD переносятся из старой страницы один в один;
 *   • содержимое вставляется как есть (set:html) — все тексты сохранены;
 *   • внизу продающих страниц подключается QuickLeadForm.
 *
 * Запуск из папки site/: node scripts/lib/make-pages.mjs
 * Скрипт одноразовый (переезд). Ручные правки после генерации живут прямо
 * в .astro-файлах, поэтому повторно запускать его «поверх» не нужно.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const PAGES_DIR = resolve(import.meta.dirname, '../../src/pages');
const CONTENT = join(PAGES_DIR, '_content');

/** Ключ страницы для меню, «человеческое» имя и настройки. */
const PAGES = [
  /* На главной своя большая форма заявки в блоке «Связаться» — вторую не ставим. */
  { slug: 'index', page: 'home', file: 'index.astro', lead: null },
  { slug: 'services', page: 'services', file: 'services.astro', lead: { title: 'Подберу услугу под вашу задачу', page: 'services', service: 'subscription' } },
  { slug: 'podbor', page: 'podbor', file: 'podbor.astro', lead: null, extraStyles: ['/styles/podbor.css'] },
  { slug: 'audit', page: 'audit', file: 'audit.astro', lead: { title: 'Проверю документы до проверки ГИТ', page: 'audit', service: 'audit' } },
  { slug: 'lna', page: 'lna', file: 'lna.astro', lead: { title: 'Разработаю ЛНА под ваш бизнес', page: 'lna', service: 'lna' } },
  { slug: 'sout', page: 'sout', file: 'sout.astro', lead: { title: 'Организую СОУТ под ключ', page: 'sout', service: 'sout' } },
  { slug: 'voinskiy-uchet', page: 'voinskiy-uchet', file: 'voinskiy-uchet.astro', lead: { title: 'Поставлю воинский учёт с нуля', page: 'voinskiy-uchet', service: 'voinskiy' } },
  { slug: 'shtrafy-git', page: 'shtrafy-git', file: 'shtrafy-git.astro', lead: { title: 'Помогу избежать штрафов ГИТ', page: 'shtrafy-git', service: 'git' } },
  { slug: 'trudovoy-spor', page: 'trudovoy-spor', file: 'trudovoy-spor.astro', lead: null, extraStyles: ['/styles/trudovoy-spor.css'], client: 'trudovoy-spor' },
  { slug: 'about', page: 'about', file: 'about.astro', lead: { title: 'Обсудим вашу ситуацию', page: 'about', service: 'consultation' } },
  { slug: 'cases', page: 'cases', file: 'cases.astro', lead: { title: 'Хочу такой же результат', page: 'cases', service: 'other' } },
  { slug: 'contact', page: 'contact', file: 'contact.astro', lead: null },
];

const esc = (value) => String(value).replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

for (const cfg of PAGES) {
  const meta = JSON.parse(await readFile(join(CONTENT, `${cfg.slug}.json`), 'utf8'));
  const body = await readFile(join(CONTENT, `${cfg.slug}.html`), 'utf8');

  const jsonLd = meta.jsonLd.length
    ? `jsonLd={${JSON.stringify(meta.jsonLd)}}`
    : '';
  const styles = cfg.extraStyles?.length ? `styles={${JSON.stringify(cfg.extraStyles)}}` : '';
  const clientScript = cfg.client
    ? `\n  <script>import '../client/${cfg.client}.ts';</script>\n`
    : '';
  const leadImport = cfg.lead ? "import QuickLeadForm from '../components/QuickLeadForm.astro';\n" : '';
  const leadBlock = cfg.lead
    ? `\n  <QuickLeadForm page="${cfg.lead.page}" service="${cfg.lead.service}" title="${cfg.lead.title}" />\n`
    : '';

  const file = `---
/**
 * Страница «${cfg.slug}» — перенесена с ${cfg.slug}.html без потери текстов.
 * Заголовок, описание и JSON-LD взяты из старой страницы один в один;
 * адрес остаётся прежним (build.format: 'file' → ${cfg.slug === 'index' ? '/' : `/${cfg.slug}.html`}).
 */
import Base from '../layouts/Base.astro';
${leadImport}const content = ${JSON.stringify(body)};
---

<Base
  title={${JSON.stringify(meta.title)}}
  description={${JSON.stringify(meta.description)}}
  page="${cfg.page}"
  ${jsonLd}
  ${styles}
>
  <Fragment set:html={content} />
${leadBlock}${clientScript}</Base>
`;

  await writeFile(join(PAGES_DIR, cfg.file), file);
  console.log(`${cfg.file.padEnd(24)} ${body.length} симв., JSON-LD ${meta.jsonLd.length}${cfg.lead ? ', + форма заявки' : ''}`);
}
