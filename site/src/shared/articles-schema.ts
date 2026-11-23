/**
 * Статьи раздела «Полезное» — контракт файла `site/content/articles.json`.
 *
 * Мария публикует разборы законов сама из `/manage/` (вкладка «Полезное /
 * Статьи») и не зовёт программиста: заголовок, описание, текст в Markdown,
 * категория, дата. Всё остальное делает сборка — страница статьи, RSS-лента,
 * разметка Article и оглавление из заголовков второго уровня.
 *
 * Тексты статей — из живых страниц сайта: «Штрафы ГИТ за кадровые документы
 * в 2026 году» (shtrafy-git.html) и «Работодатель требует „по собственному“ —
 * что делать» (trudovoy-spor.html). Новые статьи Мария пишет сама.
 *
 * Модуль чистый: без `node:fs`. Импортируют страницы, RSS, админка и гейт
 * `site/scripts/check-articles.mjs`.
 */

export const ARTICLE_CATEGORIES = [
  { slug: 'trudovye-spory', title: 'Трудовые споры' },
  { slug: 'shtrafy', title: 'Штрафы и проверки' },
  { slug: 'kadry', title: 'Кадровое делопроизводство' },
  { slug: 'okhrana-truda', title: 'Охрана труда' },
  { slug: 'podbor', title: 'Подбор персонала' },
] as const;

export type ArticleCategorySlug = (typeof ARTICLE_CATEGORIES)[number]['slug'];
export const ARTICLE_CATEGORY_SLUGS: readonly ArticleCategorySlug[] = ARTICLE_CATEGORIES.map((c) => c.slug);

export function categoryTitle(slug: string): string {
  return ARTICLE_CATEGORIES.find((c) => c.slug === slug)?.title ?? slug;
}

export const ARTICLE_STATUSES = ['published', 'draft'] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export const ARTICLE_SLUG_RE = /^[a-z0-9][a-z0-9-]{2,79}$/;
/* Дата-время в двух видах: «2026-11-21 09:30» (админка) и «2026-11-21T09:30» (ISO из кода). */
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const ARTICLE_LIMITS = Object.freeze({
  title: [5, 160] as const,
  seoTitleMax: 70,
  excerpt: [30, 300] as const,
  bodyMd: [200, 40000] as const,
});

export interface ArticleItem {
  /** `shtrafy-git-2026` — латиницей, из заголовка. */
  slug: string;
  title: string;
  /** Короткий title для SEO (≤ 70); пусто — берётся `title`. */
  seo_title: string | null;
  /** Описание для карточки и meta description, 30–300 знаков. */
  excerpt: string;
  category: ArticleCategorySlug;
  /** Markdown: абзацы, `## подзаголовки`, списки, `**жирный**`, `{{price:id}}`. */
  body_md: string;
  status: ArticleStatus;
  /** `YYYY-MM-DD HH:MM` (МСК) — обязательно для опубликованных. */
  published_at: string | null;
  /** `YYYY-MM-DD HH:MM` */
  updated_at: string | null;
}

export interface ArticlesFile {
  version: number;
  updated_at: string;
  items: ArticleItem[];
}

export interface ArticlesParseResult {
  file: ArticlesFile;
  errors: string[];
}

export const EMPTY_ARTICLES_FILE: ArticlesFile = { version: 1, updated_at: '', items: [] };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function isRealDateTime(s: string): boolean {
  if (!DATETIME_RE.test(s)) return false;
  const [date, time] = s.replace('T', ' ').split(' ');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
    && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function parseItem(raw: unknown, index: number, errors: string[]): ArticleItem | null {
  const at = `items[${index}]`;
  if (!isObj(raw)) {
    errors.push(`${at}: запись должна быть объектом`);
    return null;
  }
  const bad: string[] = [];

  const slug = str(raw.slug).trim();
  if (!ARTICLE_SLUG_RE.test(slug)) bad.push(`slug: «${slug}» — латиница, цифры, дефисы, 3–80 знаков`);

  const title = str(raw.title).trim();
  if (title.length < ARTICLE_LIMITS.title[0] || title.length > ARTICLE_LIMITS.title[1]) {
    bad.push(`title: нужно ${ARTICLE_LIMITS.title[0]}–${ARTICLE_LIMITS.title[1]} знаков`);
  }

  let seoTitle: string | null = null;
  if (raw.seo_title !== undefined && raw.seo_title !== null && raw.seo_title !== '') {
    const t = str(raw.seo_title).trim();
    if (t.length > ARTICLE_LIMITS.seoTitleMax) bad.push(`seo_title: до ${ARTICLE_LIMITS.seoTitleMax} знаков`);
    else seoTitle = t;
  }

  const excerpt = str(raw.excerpt).trim();
  if (excerpt.length < ARTICLE_LIMITS.excerpt[0] || excerpt.length > ARTICLE_LIMITS.excerpt[1]) {
    bad.push(`excerpt: нужно ${ARTICLE_LIMITS.excerpt[0]}–${ARTICLE_LIMITS.excerpt[1]} знаков`);
  }

  const category = raw.category;
  if (typeof category !== 'string' || !(ARTICLE_CATEGORY_SLUGS as readonly string[]).includes(category)) {
    bad.push(`category: «${String(category)}» — допустимо ${ARTICLE_CATEGORY_SLUGS.join(' | ')}`);
  }

  const body = str(raw.body_md);
  if (body.length < ARTICLE_LIMITS.bodyMd[0] || body.length > ARTICLE_LIMITS.bodyMd[1]) {
    bad.push(`body_md: нужно ${ARTICLE_LIMITS.bodyMd[0]}–${ARTICLE_LIMITS.bodyMd[1]} знаков`);
  }

  const status = raw.status === undefined ? 'draft' : raw.status;
  if (typeof status !== 'string' || !(ARTICLE_STATUSES as readonly string[]).includes(status)) {
    bad.push(`status: «${String(status)}» — допустимо ${ARTICLE_STATUSES.join(' | ')}`);
  }

  let publishedAt: string | null = null;
  if (raw.published_at !== undefined && raw.published_at !== null && raw.published_at !== '') {
    const p = str(raw.published_at).trim();
    if (!isRealDateTime(p)) bad.push(`published_at: «${p}» — нужен вид YYYY-MM-DD HH:MM`);
    else publishedAt = p;
  }
  if (status === 'published' && !publishedAt) bad.push('published_at: у опубликованной статьи должна быть дата');

  let updatedAt: string | null = null;
  if (raw.updated_at !== undefined && raw.updated_at !== null && raw.updated_at !== '') {
    const u = str(raw.updated_at).trim();
    if (!isRealDateTime(u)) bad.push(`updated_at: «${u}» — нужен вид YYYY-MM-DD HH:MM`);
    else updatedAt = u;
  }

  if (bad.length > 0) {
    errors.push(`${at}: ${bad.join('; ')}`);
    return null;
  }

  return {
    slug,
    title,
    seo_title: seoTitle,
    excerpt,
    category: category as ArticleCategorySlug,
    body_md: body,
    status: status as ArticleStatus,
    published_at: publishedAt,
    updated_at: updatedAt,
  };
}

export function parseArticlesFile(raw: unknown): ArticlesParseResult {
  const errors: string[] = [];
  const out: ArticlesFile = { ...EMPTY_ARTICLES_FILE, items: [] };

  if (!isObj(raw)) return { file: out, errors: ['articles.json: корень должен быть объектом'] };

  const version = Number(raw.version);
  out.version = Number.isFinite(version) && version > 0 ? version : 1;
  if (typeof raw.updated_at === 'string') out.updated_at = raw.updated_at;

  if (!Array.isArray(raw.items)) {
    errors.push('items: нужен массив');
    return { file: out, errors };
  }

  const seen = new Set<string>();
  raw.items.forEach((item, index) => {
    const parsed = parseItem(item, index, errors);
    if (!parsed) return;
    if (seen.has(parsed.slug)) {
      errors.push(`items[${index}]: slug «${parsed.slug}» повторяется`);
      return;
    }
    seen.add(parsed.slug);
    out.items.push(parsed);
  });

  return { file: out, errors };
}

/** Опубликованные статьи: свежие сверху. */
export function publishedArticles(file: ArticlesFile): ArticleItem[] {
  return file.items
    .filter((a) => a.status === 'published' && a.published_at)
    .sort((a, b) => ((a.published_at ?? '') < (b.published_at ?? '') ? 1 : -1));
}

/** `2026-11-21 09:30` из карточки админки → та же строка, проверенная на реальность. */
export function isValidArticleDateTime(value: string): boolean {
  return isRealDateTime(value);
}

/** `2026-11-21 09:30` → `2026-11-21` (для sitemap и RSS). */
export function articleDate(item: ArticleItem): string {
  return (item.published_at ?? '').slice(0, 10);
}

export function isValidArticleDate(value: string): boolean {
  return isRealDate(value);
}

/**
 * Оглавление из заголовков второго уровня: `## Что проверит инспектор` →
 * `{ id: 'chto-proverit-inspektor', text: 'Что проверит инспектор' }`.
 * Тот же slug-алгоритм, что и в рендере Markdown, и та же нумерация повторов
 * (`-2`, `-3`) — иначе ссылка из оглавления не находит якорь.
 */
export function articleToc(bodyMd: string): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  const seen = new Map<string, number>();
  for (const line of bodyMd.split('\n')) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const text = m[1].replace(/[*_`]/g, '').trim();
    if (!text) continue;
    const base = headingId(text);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.push({ id: n === 1 ? base : `${base}-${n}`, text });
  }
  return out;
}

/** Транслитерация заголовка в якорь: `Что проверит инспектор` → `chto-proverit-inspektor`. */
export function headingId(text: string): string {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
    х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };
  return text.toLowerCase().split('').map((c) => map[c] ?? c).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '') || 'razdel';
}

/** Адрес статьи: `/articles/<slug>.html`. */
export function articleUrl(slug: string): string {
  return `/articles/${slug}.html`;
}
