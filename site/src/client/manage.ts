/**
 * Кабинет Марии `/manage/` — четыре вкладки, всё с телефона.
 *
 * Страница `site/src/pages/manage/index.astro` держит только разметку и подключает
 * этот модуль: `init({ repo, branch, leadsBase, … })`.
 *
 * Две «половины»:
 *   • чистая логика — слаги, сборка кейса/статьи, правки прайса, Markdown,
 *     разбор конфликтов GitHub. Её проверяют `site/tests/manage.test.ts`;
 *   • тонкий слой DOM, который читает поля, показывает ошибки и зовёт GitHub API.
 *
 * Правила, которые нельзя терять:
 *   – цены в статьях не хардкодятся: в тексте `{{price:id}}`, число берётся из прайса;
 *   – отзывы без выдумок: пусто — значит «пока нет отзывов», а не «пример»;
 *   – каждое сохранение файла — один коммит; при гонке один повтор, потом честная
 *     ошибка «кто-то сохранил одновременно» (молча чужую правку не перезаписываем);
 *   – платные файлы в статике не лежат: ссылки на скачивание выдаёт только воркер.
 */

/* ================================ конфиг ================================ */

export interface ManageConfig {
  repo: string;
  branch: string;
  /** База воркера (`https://…`); пусто — отзывы идут только в Telegram. */
  leadsBase: string;
  pricesPath: string;
  casesPath: string;
  articlesPath: string;
}

export const DEFAULT_CONFIG: ManageConfig = {
  repo: 'sledovatel61/kadry-pro',
  branch: 'main',
  leadsBase: '',
  pricesPath: 'site/content/prices.json',
  casesPath: 'site/content/cases.json',
  articlesPath: 'site/content/articles.json',
};

export type ManageTab = 'prices' | 'cases' | 'reviews' | 'articles';

export const TABS: { id: ManageTab; label: string }[] = [
  { id: 'prices', label: 'Прайс' },
  { id: 'cases', label: 'Кейсы' },
  { id: 'reviews', label: 'Отзывы' },
  { id: 'articles', label: 'Полезное' },
];

/** Вкладка из адреса: `/manage/#cases`. Неизвестное — «Прайс». */
export function tabFromHash(hash: string, fallback: ManageTab = 'prices'): ManageTab {
  const name = String(hash ?? '').replace(/^#/, '').trim().toLowerCase();
  return TABS.some((t) => t.id === name) ? (name as ManageTab) : fallback;
}

/* ============================ GitHub: адреса ============================ */

const API = 'https://api.github.com';

export const githubUrl = (repo: string, path = ''): string => `${API}/repos/${repo}${path}`;

export function contentsUrl(repo: string, path: string, ref: string): string {
  const encoded = path.split('/').map((s) => encodeURIComponent(s)).join('/');
  return githubUrl(repo, `/contents/${encoded}?ref=${encodeURIComponent(ref)}`);
}

export class ManageError extends Error {
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = 'ManageError';
    this.status = status;
  }
}

/** Понятный текст вместо «HTTP 403». */
export function githubErrorText(status: number): string {
  if (status === 401) return 'Токен не подошёл или истёк. Выпустите новый и вставьте сюда.';
  if (status === 403) return 'GitHub не разрешает действие: у токена должно быть право Contents: Read and write.';
  if (status === 404) return 'Файл не найден в репозитории или у токена нет к нему доступа.';
  if (status === 409 || status === 422) return 'Кто-то сохранил изменения одновременно. Нажмите «Сохранить» ещё раз.';
  if (status === 429) return 'GitHub просит подождать минуту: слишком много запросов.';
  if (status >= 500) return 'GitHub временно недоступен. Попробуйте через минуту.';
  return `GitHub ответил ошибкой ${status}.`;
}

/** Ответ на попытку сдвинуть ветку: сохранили / можно повторить / показываем текст. */
export function refUpdateOutcome(status: number): 'ok' | 'retry' | 'fail' {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 409 || status === 422) return 'retry';
  return 'fail';
}

/* ============================ base64 с кириллицей ============================ */

export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function fromBase64(b64: string): string {
  const binary = atob(String(b64).replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/* ================================ прайс ================================ */

export interface PriceItem {
  id: string;
  name: string;
  unit?: string;
  note?: string;
  price: number | null;
}

export interface PriceGroup {
  id: string;
  title: string;
  items: PriceItem[];
}

export interface PriceEdit {
  group: string;
  id: string;
  price: number | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const asObj = (v: unknown): Record<string, any> =>
  (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, any>) : {});
const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Копия JSON-значения. `structuredClone` есть не везде (старые мобильные браузеры,
 * тестовые окружения) — тогда падаем на JSON-клон: данные здесь всегда JSON.
 */
const cloneJson = <T>(value: T): T => {
  const sc = (globalThis as { structuredClone?: <V>(v: V) => V }).structuredClone;
  if (typeof sc === 'function') return sc(value);
  return JSON.parse(JSON.stringify(value)) as T;
};
const asNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Прайс в двух формах: группы `{ groups: [{ id, title, items }] }` (Агент 02) или
 * плоский `{ items: [...] }`. Возвращаем всегда группы — вкладке всё равно.
 */
export function priceGroups(json: unknown): PriceGroup[] {
  const root = asObj(json);
  if (Array.isArray(root.groups)) {
    return root.groups.map((raw: unknown, gi: number) => {
      const group = asObj(raw);
      const items = Array.isArray(group.items) ? group.items : [];
      return {
        id: asStr(group.id) || `group-${gi + 1}`,
        title: asStr(group.title) || asStr(group.id) || `Раздел ${gi + 1}`,
        items: items.map((rawItem: unknown, ii: number) => {
          const item = asObj(rawItem);
          return {
            id: asStr(item.id) || `item-${ii + 1}`,
            name: asStr(item.name) || asStr(item.id) || `Позиция ${ii + 1}`,
            unit: asStr(item.unit) || undefined,
            note: asStr(item.note) || undefined,
            price: asNum(item.price) ?? asNum(item.amount),
          };
        }),
      };
    });
  }
  if (Array.isArray(root.items)) {
    if (!root.items.length) return [];
    return [{
      id: 'all',
      title: 'Позиции',
      items: root.items.map((rawItem: unknown, ii: number) => {
        const item = asObj(rawItem);
        return {
          id: asStr(item.id) || `item-${ii + 1}`,
          name: asStr(item.name) || asStr(item.id) || `Позиция ${ii + 1}`,
          unit: asStr(item.unit) || undefined,
          price: asNum(item.price) ?? asNum(item.amount),
        };
      }),
    }];
  }
  return [];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Словарь цен для подстановки `{{price:id}}`: и `группа.позиция`, и короткий `id`.
 * Короткий id работает, пока он не повторяется в разных группах.
 */
export function priceLookup(json: unknown): Map<string, number> {
  const out = new Map<string, number>();
  const duplicated = new Set<string>();
  for (const group of priceGroups(json)) {
    for (const item of group.items) {
      if (item.price === null) continue;
      out.set(`${group.id}.${item.id}`, item.price);
      if (out.has(item.id)) duplicated.add(item.id);
      else out.set(item.id, item.price);
    }
  }
  for (const id of duplicated) out.delete(id);
  return out;
}

/**
 * Пары «ключ для прайса» → «короткий id»: `audit.express` → `express`.
 * В тексте статьи допустимы оба вида токена, но проверять их нужно по одному
 * словарю без учёта регистра — этим и занимается `knownPriceKeys`.
 */
export function knownPriceKeys(json: unknown): Set<string> {
  const out = new Set<string>();
  for (const group of priceGroups(json)) {
    for (const item of group.items) {
      out.add(`${group.id}.${item.id}`.toLowerCase());
      out.add(item.id.toLowerCase());
    }
  }
  return out;
}

/** Применить правки формы к копии прайса; исходный объект не меняется. */
export function applyPriceEdits(json: unknown, edits: PriceEdit[]): Record<string, unknown> {
  const copy = cloneJson(asObj(json)) as Record<string, unknown>;
  const wanted = new Map(edits.map((e) => [`${e.group}.${e.id}`, e.price]));
  if (Array.isArray(copy.groups)) {
    for (const raw of copy.groups) {
      const group = asObj(raw);
      if (!Array.isArray(group.items)) continue;
      for (const rawItem of group.items) {
        const item = asObj(rawItem);
        const key = `${asStr(group.id)}.${asStr(item.id)}`;
        if (!wanted.has(key)) continue;
        const value = wanted.get(key) ?? null;
        if ('amount' in item && !('price' in item)) item.amount = value;
        else item.price = value;
      }
    }
  } else if (Array.isArray(copy.items)) {
    for (const rawItem of copy.items) {
      const item = asObj(rawItem);
      const key = `all.${asStr(item.id)}`;
      if (wanted.has(key)) item.price = wanted.get(key) ?? null;
    }
  }
  copy.updated_at = new Date().toISOString().slice(0, 10);
  return copy;
}

/** `14900` → «14 900». Пустая строка → null (цена «по запросу»). */
export function parsePrice(raw: string): number | null {
  const value = String(raw ?? '').replace(/[\s\u00a0₽]/g, '').replace(',', '.').trim();
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export const formatPrice = (value: number | null): string =>
  value === null ? '' : Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');

/* ================================ слаги ================================ */

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** `Штрафы ГИТ за 2026` → `shtrafy-git-za-2026`. */
export function slugify(text: string, max = 60): string {
  return String(text ?? '').toLowerCase().split('')
    .map((c) => TRANSLIT[c] ?? c).join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, max)
    .replace(/-+$/, '');
}

/* ================================ кейсы ================================ */

export const CASE_AREA_TITLES: Record<string, string> = {
  kdp: 'Кадровое делопроизводство',
  podbor: 'Подбор персонала',
  audit: 'Аудит и проверки ГИТ',
  sout: 'Охрана труда и СОУТ',
  voinskiy: 'Воинский учёт',
  lna: 'Локальные акты',
};

export interface CaseDraft {
  slug: string;
  title: string;
  area: string;
  client: string;
  task: string;
  actions: string;
  results: string[];
  published_at: string;
  sort: number;
  status: 'published' | 'draft';
}

export interface CaseInput {
  title: string;
  area: string;
  client?: string;
  task: string;
  actions: string;
  /** Текст из textarea: по одному результату в строке. */
  results: string;
  published_at?: string;
  sort?: number | string;
  status?: string;
}

export interface BuildResult<T> {
  item: T | null;
  errors: string[];
}

/** Кейс из полей формы — те же пределы, что в `cases-schema.ts`. */
export function buildCase(input: CaseInput, isNew: boolean, existingSlug = ''): BuildResult<CaseDraft> {
  const errors: string[] = [];
  const title = String(input.title ?? '').trim();
  const task = String(input.task ?? '').trim();
  const actions = String(input.actions ?? '').trim();
  const results = String(input.results ?? '').split('\n').map((s) => s.trim()).filter(Boolean);

  if (title.length < 5 || title.length > 120) errors.push('Название — 5–120 знаков.');
  if (task.length < 20) errors.push('Задача клиента — от 20 знаков.');
  if (actions.length < 20) errors.push('Что сделано — от 20 знаков.');
  if (results.length === 0) errors.push('Добавьте хотя бы один результат — по одному в строке.');
  if (results.length > 6) errors.push('Результатов — не больше шести.');
  if (results.some((r) => r.length > 160)) errors.push('Каждый результат — до 160 знаков.');
  if (!CASE_AREA_TITLES[String(input.area ?? '')]) errors.push('Выберите направление.');
  const date = String(input.published_at ?? '').trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('Дата — в виде 2026-11-21.');

  const slug = isNew ? slugify(title) : String(existingSlug ?? '').trim();
  if (!/^[a-z0-9][a-z0-9-]{2,59}$/.test(slug)) {
    errors.push('Из названия не получается адрес кейса — добавьте буквы или цифры.');
  }
  if (errors.length) return { item: null, errors };

  return {
    errors: [],
    item: {
      slug,
      title,
      area: String(input.area),
      client: String(input.client ?? '').trim(),
      task,
      actions,
      results,
      published_at: date || new Date().toISOString().slice(0, 10),
      sort: Number.isFinite(Number(input.sort)) ? Number(input.sort) : 100,
      status: input.status === 'published' ? 'published' : 'draft',
    },
  };
}

const casesArray = (json: Record<string, any>): unknown[] => (Array.isArray(json.cases) ? json.cases : []);

export function upsertCase(json: unknown, item: CaseDraft): Record<string, unknown> {
  const copy = cloneJson(asObj(json)) as Record<string, any>;
  const list = casesArray(copy).slice();
  const at = list.findIndex((c) => asStr(asObj(c).slug) === item.slug);
  if (at >= 0) list[at] = item;
  else list.push(item);
  copy.cases = list;
  copy.updated_at = new Date().toISOString().slice(0, 10);
  return copy;
}

export function removeCase(json: unknown, slug: string): Record<string, unknown> {
  const copy = cloneJson(asObj(json)) as Record<string, any>;
  copy.cases = casesArray(copy).filter((c) => asStr(asObj(c).slug) !== slug);
  copy.updated_at = new Date().toISOString().slice(0, 10);
  return copy;
}

/** Сдвиг кейса на позицию: `sort` перенумеровывается шагом 10. */
export function moveCase(json: unknown, slug: string, dir: 'up' | 'down'): Record<string, unknown> {
  const copy = cloneJson(asObj(json)) as Record<string, any>;
  const list = casesArray(copy).slice()
    .sort((a, b) => Number(asObj(a).sort ?? 0) - Number(asObj(b).sort ?? 0));
  const at = list.findIndex((c) => asStr(asObj(c).slug) === slug);
  const to = dir === 'up' ? at - 1 : at + 1;
  if (at >= 0 && to >= 0 && to < list.length) {
    const tmp = list[at];
    list[at] = list[to];
    list[to] = tmp;
  }
  list.forEach((c, i) => { asObj(c).sort = (i + 1) * 10; });
  copy.cases = list;
  copy.updated_at = new Date().toISOString().slice(0, 10);
  return copy;
}

/* ================================ статьи ================================ */

export const ARTICLE_CATEGORY_TITLES: Record<string, string> = {
  'trudovye-spory': 'Трудовые споры',
  shtrafy: 'Штрафы и проверки',
  kadry: 'Кадровое делопроизводство',
  'okhrana-truda': 'Охрана труда',
  podbor: 'Подбор персонала',
};

export const ARTICLE_LIMITS = Object.freeze({
  title: [5, 160] as const,
  seoTitleMax: 70,
  excerpt: [30, 300] as const,
  body: [200, 40000] as const,
});

export interface ArticleInput {
  title: string;
  seo_title?: string;
  excerpt: string;
  category: string;
  body_md: string;
  status?: string;
  /** `2026-11-21 09:30`; пусто — берём текущее московское время. */
  published_at?: string;
}

export interface ArticleDraft {
  slug: string;
  title: string;
  seo_title: string | null;
  excerpt: string;
  category: string;
  body_md: string;
  status: 'published' | 'draft';
  published_at: string | null;
  updated_at: string;
}

/** `2026-11-21 09:30` по Москве — в этом виде даты лежат в `articles.json`. */
export function moscowStamp(date: Date = new Date()): string {
  const msk = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${msk.getUTCFullYear()}-${p(msk.getUTCMonth() + 1)}-${p(msk.getUTCDate())} `
    + `${p(msk.getUTCHours())}:${p(msk.getUTCMinutes())}`;
}

export function buildArticle(
  input: ArticleInput,
  isNew: boolean,
  existingSlug = '',
  now: Date = new Date(),
): BuildResult<ArticleDraft> {
  const errors: string[] = [];
  const title = String(input.title ?? '').trim();
  const excerpt = String(input.excerpt ?? '').trim();
  const body = String(input.body_md ?? '').trim();
  const seo = String(input.seo_title ?? '').trim();

  if (title.length < ARTICLE_LIMITS.title[0] || title.length > ARTICLE_LIMITS.title[1]) {
    errors.push(`Заголовок — ${ARTICLE_LIMITS.title[0]}–${ARTICLE_LIMITS.title[1]} знаков.`);
  }
  if (seo.length > ARTICLE_LIMITS.seoTitleMax) errors.push(`Короткий title для поиска — до ${ARTICLE_LIMITS.seoTitleMax} знаков.`);
  if (excerpt.length < ARTICLE_LIMITS.excerpt[0] || excerpt.length > ARTICLE_LIMITS.excerpt[1]) {
    errors.push(`Описание для карточки — ${ARTICLE_LIMITS.excerpt[0]}–${ARTICLE_LIMITS.excerpt[1]} знаков.`);
  }
  if (body.length < ARTICLE_LIMITS.body[0] || body.length > ARTICLE_LIMITS.body[1]) {
    errors.push(`Текст статьи — ${ARTICLE_LIMITS.body[0]}–${ARTICLE_LIMITS.body[1].toLocaleString('ru-RU')} знаков.`);
  }
  if (!ARTICLE_CATEGORY_TITLES[String(input.category ?? '')]) errors.push('Выберите категорию.');

  const slug = isNew ? slugify(title, 80) : String(existingSlug ?? '').trim();
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(slug)) {
    errors.push('Из заголовка не получается адрес статьи — добавьте буквы или цифры.');
  }
  const publishedAt = String(input.published_at ?? '').trim();
  if (publishedAt && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(publishedAt)) {
    errors.push('Дата публикации — в виде 2026-11-21 09:30.');
  }
  if (errors.length) return { item: null, errors };

  const status = input.status === 'published' ? 'published' : 'draft';
  const stamp = moscowStamp(now);
  return {
    errors: [],
    item: {
      slug,
      title,
      seo_title: seo || null,
      excerpt,
      category: String(input.category),
      body_md: body,
      status,
      published_at: publishedAt || (status === 'published' ? stamp : null),
      updated_at: stamp,
    },
  };
}

export function upsertArticle(json: unknown, item: ArticleDraft): Record<string, unknown> {
  const copy = cloneJson(asObj(json)) as Record<string, any>;
  const list = (Array.isArray(copy.items) ? copy.items : []).slice();
  const at = list.findIndex((a) => asStr(asObj(a).slug) === item.slug);
  if (at >= 0) list[at] = item;
  else list.push(item);
  copy.items = list;
  copy.version = Number(copy.version) > 0 ? copy.version : 1;
  copy.updated_at = item.updated_at;
  return copy;
}

export function removeArticle(json: unknown, slug: string): Record<string, unknown> {
  const copy = cloneJson(asObj(json)) as Record<string, any>;
  copy.items = (Array.isArray(copy.items) ? copy.items : []).filter((a) => asStr(asObj(a).slug) !== slug);
  copy.updated_at = moscowStamp();
  return copy;
}

/**
 * id цен, использованных в тексте: `{{price:audit.express}}` → `audit.express`.
 * Кириллица в id допустима: группы прайса Агент 02 может назвать по-русски.
 */
export function priceTokensIn(md: string): string[] {
  const out = new Set<string>();
  const text = String(md ?? '');
  const re = /\{\{price:([^}|\s]+)(?:\|[^}]*)?\}\}/g;
  let m = re.exec(text);
  while (m) {
    out.add(m[1].toLowerCase());
    m = re.exec(text);
  }
  return [...out];
}

/**
 * Предупреждения перед публикацией: неизвестные токены цен и лишний `#` в тексте.
 * Не блокируют: цену могли завести позже, и тогда она подставится сама.
 */
export function articleWarnings(md: string, prices: unknown): string[] {
  const warnings: string[] = [];
  const known = knownPriceKeys(prices);
  const tokens = priceTokensIn(md);
  if (!known.size && tokens.length) {
    warnings.push('Прайс не прочитан — проверьте, что цены в тексте подставятся.');
  } else {
    for (const token of tokens) {
      if (!known.has(token)) warnings.push(`Цена «${token}» не найдена в прайсе — на сайте будет «по запросу».`);
    }
  }
  if (/^#\s+/m.test(String(md ?? ''))) {
    warnings.push('Заголовок первого уровня не нужен: название статьи уже стоит сверху.');
  }
  return warnings;
}

/* ================================ отзывы ================================ */

export interface ReviewInboxItem {
  id: string;
  author: string;
  text: string;
  rating: number;
  status: 'published' | 'hidden';
  createdAt: string;
  reply: string | null;
}

/** Ответ на отзыв: пустой — «убрать ответ». */
export function buildReply(reply: string): { reply: string | null; error: string | null } {
  const text = String(reply ?? '').trim().replace(/[ \t]+/g, ' ');
  if (!text) return { reply: null, error: null };
  if (text.length < 2) return { reply: null, error: 'Ответ слишком короткий.' };
  if (text.length > 600) return { reply: null, error: 'Ответ — до 600 знаков.' };
  return { reply: text, error: null };
}

export function clampRating(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(5, Math.max(0, n)) : 0;
}

/** Куда и что шлём при модерации — проверяется тестом, чтобы не разошлось с воркером. */
export function moderationRequest(
  action: 'hide' | 'publish' | 'delete' | 'reply',
  id: string,
  reply?: string,
): { path: string; body: Record<string, unknown> } {
  if (action === 'reply') return { path: '/reviews/reply', body: { id, reply: String(reply ?? '') } };
  return { path: '/reviews/moderate', body: { id, action } };
}

/* ============================ Markdown (предпросмотр) ============================ */

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** `14900` → «14 900 ₽» с неразрывными пробелами — как на сайте. */
export const rub = (n: number): string =>
  `${Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')}\u00a0₽`;

/** То же для вставки в HTML предпросмотра: пробелы не должны ломать строку. */
const rubHtml = (n: number): string => rub(n).replace(/\u00a0/g, '&nbsp;');

/**
 * Тот же набор разметки, что рендерит сайт: абзацы, `##`/`###`, списки, `**жирный**`,
 * `*курсив*`, `` `код` ``, таблицы GFM и токены `{{price:id}}`. Только экранирование:
 * произвольный HTML из текста не исполняется.
 */
export function renderMarkdown(md: string, prices: unknown = null): string {
  const known = priceLookup(prices);
  const inline = (line: string): string => {
    let out = escapeHtml(line);
    out = out.replace(/\{\{price:([^}|\s]+)(?:\|([^}]*))?\}\}/g, (_m, id: string, prefix: string) => {
      const value = known.get(String(id).toLowerCase());
      const head = prefix ? `${escapeHtml(prefix.trim())}&nbsp;` : '';
      return value === undefined
        ? `<span class="price-token" data-price="${escapeHtml(id)}">${head}по&nbsp;запросу</span>`
        : `<span class="price-token">${head}${rubHtml(value)}</span>`;
    });
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    return out;
  };

  const lines = String(md ?? '').replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const para: string[] = [];
  const closeList = (): void => { if (list) { html.push(`</${list}>`); list = null; } };
  const closePara = (): void => { if (para.length) { html.push(`<p>${inline(para.join(' '))}</p>`); para.length = 0; } };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) { closeList(); closePara(); continue; }

    const isRow = /^\|.*\|$/.test(line);
    const nextSeparator = i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim());
    if (isRow && nextSeparator) {
      closeList(); closePara();
      const cellsOf = (l: string): string[] =>
        l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const head = cellsOf(line);
      const body: string[][] = [];
      let j = i + 2;
      while (j < lines.length && /^\|.*\|$/.test(lines[j].trim())) {
        body.push(cellsOf(lines[j].trim()));
        j += 1;
      }
      html.push('<table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>'
        + body.map((row) => '<tr>' + head.map((_h, k) => `<td>${inline(row[k] ?? '')}</td>`).join('') + '</tr>').join('')
        + '</tbody></table>');
      i = j - 1;
      continue;
    }

    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      closeList(); closePara();
      if (h[1].length === 1) html.push('<p class="md-warn">Заголовок первого уровня: на сайте название статьи уже стоит сверху.</p>');
      else html.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      continue;
    }

    const ul = /^[-*]\s+(.*)$/.exec(line);
    if (ul) {
      closePara();
      if (list !== 'ul') { closeList(); html.push('<ul>'); list = 'ul'; }
      html.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ol) {
      closePara();
      if (list !== 'ol') { closeList(); html.push('<ol>'); list = 'ol'; }
      html.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }
    closeList();
    para.push(line);
  }
  closeList(); closePara();
  return html.join('\n');
}

/* ============================ GitHub-клиент ============================ */

export interface FileSnapshot {
  json: unknown;
  sha: string;
}

type FetchLike = (input: string, init?: Record<string, unknown>) => Promise<TransportResponse>;

/** Минимум от `fetch`, который нужен клиенту: код, заголовки и тело. */
export interface TransportResponse {
  status: number;
  ok: boolean;
  text(): Promise<string>;
  headers?: { get(name: string): string | null };
}

/**
 * Чтение и запись файлов репозитория. `fetchImpl` подменяется в тестах —
 * поэтому гонку и «токен истёк» проверяем без сети.
 */
export class GithubStore {
  private config: ManageConfig;

  private token = '';

  private fetchImpl: FetchLike;

  constructor(config: Partial<ManageConfig> = {}, fetchImpl?: FetchLike) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.fetchImpl = (fetchImpl ?? (globalThis.fetch as unknown as FetchLike));
  }

  setToken(token: string): void {
    this.token = String(token ?? '').trim();
  }

  /** Тот же токен нужен отзывам: воркер проверяет его как «свой человек». */
  get authToken(): string {
    return this.token;
  }

  get branch(): string {
    return this.config.branch;
  }

  get repo(): string {
    return this.config.repo;
  }

  private async call(path: string, init: { method?: string; body?: unknown } = {}): Promise<Record<string, any>> {
    const url = path.startsWith('http') ? path : githubUrl(this.config.repo, path);
    const res = await this.fetchImpl(url, {
      method: init.method ?? 'GET',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.token}`,
        'x-github-api-version': '2022-11-28',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });
    if (!res.ok) throw new ManageError(githubErrorText(res.status), res.status);
    const text = await res.text();
    return text ? JSON.parse(text) as Record<string, any> : {};
  }

  /** Кто владелец токена — для строки «Подключено: …». */
  async whoami(): Promise<string> {
    const data = await this.call(`${API}/user`);
    return asStr(data.login) || 'GitHub';
  }

  async readFile(path: string): Promise<FileSnapshot> {
    const data = await this.call(contentsUrl(this.config.repo, path, this.config.branch).replace(githubUrl(this.config.repo), ''));
    let content = typeof data.content === 'string' ? fromBase64(data.content) : '';
    if (!content && data.sha) {
      const blob = await this.call(`/git/blobs/${String(data.sha)}`);
      content = fromBase64(asStr(blob.content));
    }
    return { json: JSON.parse(content || '{}') as unknown, sha: asStr(data.sha) };
  }

  /**
   * Сохранить файл одним коммитом. При гонке — один повтор с новым родителем.
   * `expectedParent` — то, что мы прочитали: если ветка уже ушла вперёд, это
   * видно до записи и мы не перетираем чужую правку молча.
   */
  async writeFile(path: string, json: unknown, message: string): Promise<{ commit: string; sha: string }> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      /* На повторе вершина ветки уже другая: читаем её заново, иначе коммит
         упрётся в тот же конфликт. */
      const ref = await this.call(`/git/ref/heads/${this.config.branch}`);
      const parent = asStr(asObj(ref.object).sha);
      const parentCommit = await this.call(`/git/commits/${parent}`);
      const blob = await this.call('/git/blobs', {
        method: 'POST',
        body: { content: toBase64(`${JSON.stringify(json, null, 2)}\n`), encoding: 'base64' },
      });
      const tree = await this.call('/git/trees', {
        method: 'POST',
        body: { base_tree: asStr(asObj(parentCommit.tree).sha), tree: [{ path, mode: '100644', type: 'blob', sha: asStr(blob.sha) }] },
      });
      const saved = await this.call('/git/commits', {
        method: 'POST',
        body: { message, tree: asStr(tree.sha), parents: [parent] },
      });
      try {
        await this.call(`/git/refs/heads/${this.config.branch}`, {
          method: 'PATCH',
          body: { sha: asStr(saved.sha), force: false },
        });
        return { commit: asStr(saved.sha), sha: asStr(blob.sha) };
      } catch (e) {
        const status = e instanceof ManageError ? e.status : 0;
        if (refUpdateOutcome(status) === 'retry' && attempt === 0) continue;
        throw e;
      }
    }
    throw new ManageError('Не удалось сохранить: изменения конфликтуют. Попробуйте ещё раз.', 409);
  }
}

/* ============================== слой страницы ============================== */

const TOKEN_KEY = 'kadry-manage-token';

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null =>
  root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] =>
  Array.from(root.querySelectorAll<T>(sel));

const escape = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c] ?? c));

const starsHtml = (rating: number): string => {
  const n = clampRating(rating);
  return `<span class="stars" aria-label="Оценка ${n} из 5">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>`;
};

const dateRu = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
};

/**
 * Подключить кабинет к разметке `/manage/`. Возвращает состояние — в тестах
 * можно вызвать с фальшивым `document` и проверить, что ничего не падает.
 */
export function init(config: Partial<ManageConfig> = {}, store?: GithubStore): ManageStore {
  const manager = new ManageStore({ ...readPageConfig(), ...config }, store);
  manager.mount();
  return manager;
}

/**
 * Конфиг со страницы: `<script type="application/json" id="manage-config">`.
 * Так страница передаёт репозиторий, ветку и пути файлов, не зашивая их в скрипт.
 */
export function readPageConfig(doc: Document | null = typeof document === 'undefined' ? null : document): Partial<ManageConfig> {
  const node = doc?.getElementById('manage-config');
  if (!node || !node.textContent) return {};
  try {
    const raw = JSON.parse(node.textContent) as Record<string, unknown>;
    const out: Partial<ManageConfig> = {};
    for (const key of ['repo', 'branch', 'leadsBase', 'pricesPath', 'casesPath', 'articlesPath'] as const) {
      const value = raw[key];
      if (typeof value === 'string' && value) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** Всё, что делает кабинет: состояние + отрисовка. */
export class ManageStore {
  readonly config: ManageConfig;

  readonly store: GithubStore;

  login = '';

  files: { prices: FileSnapshot | null; cases: FileSnapshot | null; articles: FileSnapshot | null } = {
    prices: null, cases: null, articles: null,
  };

  dirty = false;

  tab: ManageTab = 'prices';

  private noticeTimer: number | null = null;

  constructor(config: Partial<ManageConfig> = {}, store?: GithubStore) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.store = store ?? new GithubStore(this.config);
  }

  /* ---------- сообщения ---------- */

  tell(message: string, isError = false): void {
    const box = $('#notice');
    if (!box) return;
    box.textContent = message;
    box.className = `manage-notice${isError ? ' error' : ''}`;
    box.hidden = !message;
    if (this.noticeTimer) window.clearTimeout(this.noticeTimer);
    if (message) {
      this.noticeTimer = window.setTimeout(() => { box.hidden = true; }, isError ? 12000 : 6000);
    }
  }

  /* ---------- вход ---------- */

  mount(): void {
    const token = $('#token') as HTMLInputElement | null;
    $('#connect')?.addEventListener('click', () => { void this.connect(); });
    token?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); void this.connect(); }
    });
    $('#logout')?.addEventListener('click', () => this.logout());

    $$<HTMLButtonElement>('#tabs button[data-tab]').forEach((button) => {
      button.addEventListener('click', () => this.showTab(button.dataset.tab as ManageTab));
    });

    $('#save-prices')?.addEventListener('click', () => { void this.savePrices(); });
    $('#new-case')?.addEventListener('click', () => this.openCaseEditor(null));
    $('#new-article')?.addEventListener('click', () => this.openArticleEditor(null));
    $('#reload-reviews')?.addEventListener('click', () => { void this.loadReviews(); });

    $('#cases-body')?.addEventListener('click', (event) => { void this.onCasesClick(event); });
    $('#articles-body')?.addEventListener('click', (event) => { void this.onArticlesClick(event); });
    $('#reviews-body')?.addEventListener('click', (event) => { void this.onReviewsClick(event); });
    $('#prices-body')?.addEventListener('input', () => {
      this.dirty = true;
      const save = $('#save-prices');
      if (save) save.textContent = 'Сохранить прайс •';
    });

    window.addEventListener('beforeunload', (event) => {
      if (!this.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });

    let saved = '';
    try { saved = localStorage.getItem(TOKEN_KEY) ?? ''; } catch { saved = ''; }
    if (token && saved) {
      token.value = saved;
      void this.connect();
    }
  }

  async connect(): Promise<void> {
    const input = $('#token') as HTMLInputElement | null;
    const token = input ? input.value.trim() : '';
    if (!token) { this.tell('Вставьте личный токен GitHub.', true); return; }
    const button = $('#connect') as HTMLButtonElement | null;
    if (button) button.disabled = true;
    this.tell('Проверяем токен…');
    this.store.setToken(token);
    try {
      this.login = await this.store.whoami();
      const status = $('#conn-status');
      if (status) { status.textContent = `Подключено: ${this.login}`; status.classList.add('is-on'); }
      const tabs = $('#tabs');
      if (tabs) tabs.hidden = false;
      const logout = $('#logout');
      if (logout) logout.hidden = false;
      const access = $('#access');
      if (access) access.hidden = true;
      try { localStorage.setItem(TOKEN_KEY, token); } catch { /* приватный режим */ }
      this.tell('Доступ подтверждён. Можно править цены, кейсы и статьи.');
      await this.loadAll();
    } catch (e) {
      this.tell(e instanceof Error ? e.message : 'Не удалось подключиться.', true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  logout(): void {
    if (!window.confirm('Выйти и удалить токен из этого браузера?')) return;
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
    this.store.setToken('');
    this.login = '';
    this.files = { prices: null, cases: null, articles: null };
    const token = $('#token') as HTMLInputElement | null;
    if (token) token.value = '';
    const status = $('#conn-status');
    if (status) { status.textContent = 'Не подключено'; status.classList.remove('is-on'); }
    for (const id of ['tabs', 'logout']) {
      const node = document.getElementById(id);
      if (node) node.hidden = true;
    }
    const access = $('#access');
    if (access) access.hidden = false;
    this.fill('prices-body', 'Загружаем прайс…');
    this.fill('cases-body', 'Загружаем кейсы…');
    this.fill('articles-body', 'Загружаем статьи…');
    this.tell('Вы вышли. Токен удалён из этого браузера.');
  }

  /* ---------- вкладки ---------- */

  showTab(name: ManageTab): void {
    this.tab = name;
    $$<HTMLButtonElement>('#tabs button[data-tab]').forEach((button) => {
      button.setAttribute('aria-selected', button.dataset.tab === name ? 'true' : 'false');
    });
    $$('.manage-panel').forEach((panel) => {
      (panel as HTMLElement).hidden = panel.id !== `panel-${name}`;
    });
    if (window.location.hash !== `#${name}`) {
      window.history.replaceState(null, '', `#${name}`);
    }
    if (name === 'reviews' && this.store) void this.loadReviews();
  }

  /* ---------- общие мелочи ---------- */

  private fill(id: string, text: string): void {
    const node = document.getElementById(id);
    if (!node) return;
    node.className = 'empty';
    node.textContent = text;
  }

  private async loadAll(): Promise<void> {
    const jobs: Promise<void>[] = [
      this.store.readFile(this.config.pricesPath)
        .then((file) => { this.files.prices = file; this.renderPrices(); })
        .catch((e: unknown) => {
          this.fill('prices-body', (e as ManageError)?.status === 404
            ? 'Файл прайса ещё не создан — его ведёт Агент 02 (site/content/prices.json).'
            : `Не удалось прочитать прайс: ${(e as Error).message}`);
        }),
      this.store.readFile(this.config.casesPath)
        .then((file) => { this.files.cases = file; this.renderCases(); })
        .catch((e: unknown) => this.fill('cases-body', `Не удалось прочитать кейсы: ${(e as Error).message}`)),
      this.store.readFile(this.config.articlesPath)
        .then((file) => { this.files.articles = file; this.renderArticles(); })
        .catch((e: unknown) => this.fill('articles-body', `Не удалось прочитать статьи: ${(e as Error).message}`)),
    ];
    await Promise.all(jobs);
    this.showTab(tabFromHash(window.location.hash));
  }

  /* ---------- 1. прайс ---------- */

  renderPrices(): void {
    const body = document.getElementById('prices-body');
    const file = this.files.prices;
    if (!body) return;
    if (!file) { this.fill('prices-body', 'Прайс не прочитан.'); return; }
    const groups = priceGroups(file.json);
    if (!groups.length) {
      this.fill('prices-body', 'В файле прайса нет групп. Ожидаются группы «groups» с позициями.');
      return;
    }
    body.className = '';
    body.innerHTML = groups.map((group) => `
      <div class="price-group">
        <h3>${escape(group.title)}</h3>
        ${group.items.map((item) => `
          <div class="price-row">
            <label class="price-name" for="price-${escape(group.id)}-${escape(item.id)}">
              ${escape(item.name)}
              ${item.unit || item.note ? `<small>${escape(item.unit ?? item.note ?? '')}</small>` : ''}
            </label>
            <input type="text" inputmode="numeric" id="price-${escape(group.id)}-${escape(item.id)}"
                   data-group="${escape(group.id)}" data-item="${escape(item.id)}"
                   value="${escape(formatPrice(item.price))}"
                   placeholder="по запросу"
                   aria-label="Цена: ${escape(item.name)}, рублей" />
          </div>`).join('')}
      </div>`).join('');

    const meta = $('#prices-meta');
    if (meta) {
      const updated = asStr(asObj(asObj(file.json)).updated_at);
      meta.textContent = updated ? `Последнее обновление: ${updated}` : '';
    }
    const save = $('#save-prices') as HTMLButtonElement | null;
    if (save) { save.disabled = false; save.textContent = 'Сохранить прайс'; }
    this.dirty = false;
  }

  collectPriceEdits(): PriceEdit[] {
    return $$<HTMLInputElement>('#prices-body input[data-group]').map((input) => ({
      group: input.dataset.group ?? '',
      id: input.dataset.item ?? '',
      price: parsePrice(input.value),
    }));
  }

  async savePrices(): Promise<void> {
    const file = this.files.prices;
    if (!file) return;
    const button = $('#save-prices') as HTMLButtonElement | null;
    if (button) { button.disabled = true; button.textContent = 'Сохраняем…'; }
    try {
      const next = applyPriceEdits(file.json, this.collectPriceEdits());
      const saved = await this.store.writeFile(this.config.pricesPath, next, `Цены: правка из кабинета (${this.login || 'Мария'})`);
      this.files.prices = { json: next, sha: saved.sha };
      this.dirty = false;
      if (button) button.textContent = 'Сохранить прайс';
      this.tell('Прайс сохранён. Сайт обновится после сборки — обычно 1–2 минуты.');
    } catch (e) {
      this.tell((e as Error).message || 'Не удалось сохранить прайс.', true);
      if (button) button.textContent = 'Сохранить прайс';
    } finally {
      if (button) button.disabled = false;
    }
  }

  /* ---------- 2. кейсы ---------- */

  renderCases(): void {
    const body = document.getElementById('cases-body');
    const file = this.files.cases;
    if (!body) return;
    if (!file) { this.fill('cases-body', 'Кейсы не прочитаны.'); return; }
    const list = casesArray(asObj(file.json)).slice()
      .sort((a, b) => Number(asObj(a).sort ?? 0) - Number(asObj(b).sort ?? 0));
    if (!list.length) { this.fill('cases-body', 'Кейсов пока нет. Нажмите «＋ Новый кейс».'); return; }
    body.className = '';
    body.innerHTML = list.map((raw, index) => {
      const c = asObj(raw);
      const results = Array.isArray(c.results) ? c.results.length : 0;
      return `
        <article class="item">
          <div class="item-head">
            <div class="grow">
              <h4>${escape(c.title)}</h4>
              <div class="meta">${escape(CASE_AREA_TITLES[asStr(c.area)] ?? asStr(c.area))} · ${escape(asStr(c.published_at))} · ${results} результ.</div>
            </div>
            <span class="badge ${c.status === 'published' ? 'live' : 'draft'}">${c.status === 'published' ? 'На сайте' : 'Черновик'}</span>
          </div>
          <div class="actions">
            <button class="btn small" type="button" data-case-edit="${escape(asStr(c.slug))}">Открыть</button>
            <button class="btn small" type="button" data-case-move="up" data-slug="${escape(asStr(c.slug))}" ${index === 0 ? 'disabled' : ''}>↑ Выше</button>
            <button class="btn small" type="button" data-case-move="down" data-slug="${escape(asStr(c.slug))}" ${index === list.length - 1 ? 'disabled' : ''}>↓ Ниже</button>
            <button class="btn small danger" type="button" data-case-delete="${escape(asStr(c.slug))}">Удалить</button>
          </div>
        </article>`;
    }).join('');
  }

  openCaseEditor(slug: string | null): void {
    const box = document.getElementById('case-editor');
    if (!box) return;
    const existing = slug
      ? casesArray(asObj(this.files.cases?.json)).map(asObj).find((c) => asStr(c.slug) === slug)
      : null;
    const c = existing ?? {};
    box.hidden = false;
    box.innerHTML = `
      <div class="item item-edit">
        <div class="row">
          <h3 class="grow">${existing ? `Кейс: ${escape(asStr(c.title))}` : 'Новый кейс'}</h3>
          <button class="btn small quiet" type="button" data-case-cancel>Закрыть</button>
        </div>
        <label class="field"><span class="label-text">Название</span>
          <input type="text" id="case-title" maxlength="120" value="${escape(asStr(c.title))}" /></label>
        <label class="field"><span class="label-text">Направление</span>
          <select id="case-area">${Object.entries(CASE_AREA_TITLES).map(([key, title]) =>
            `<option value="${key}" ${asStr(c.area) === key ? 'selected' : ''}>${escape(title)}</option>`).join('')}</select></label>
        <label class="field"><span class="label-text">Клиент (можно без названия компании)</span>
          <input type="text" id="case-client" maxlength="160" value="${escape(asStr(c.client))}" /></label>
        <label class="field"><span class="label-text">Задача клиента</span>
          <textarea id="case-task" rows="3" maxlength="600">${escape(asStr(c.task))}</textarea></label>
        <label class="field"><span class="label-text">Что сделано</span>
          <textarea id="case-actions" rows="4" maxlength="900">${escape(asStr(c.actions))}</textarea></label>
        <label class="field"><span class="label-text">Результаты — по одному в строке (1–6)</span>
          <textarea id="case-results" rows="4">${escape(Array.isArray(c.results) ? c.results.join('\n') : '')}</textarea></label>
        <div class="row">
          <label class="field grow"><span class="label-text">Дата</span>
            <input type="date" id="case-date" value="${escape(asStr(c.published_at) || new Date().toISOString().slice(0, 10))}" /></label>
          <label class="field grow"><span class="label-text">Порядок (меньше — выше)</span>
            <input type="number" id="case-sort" step="1" value="${escape(c.sort ?? 100)}" /></label>
          <label class="field grow"><span class="label-text">Статус</span>
            <select id="case-status">
              <option value="published" ${c.status === 'published' ? 'selected' : ''}>На сайте</option>
              <option value="draft" ${c.status !== 'published' ? 'selected' : ''}>Черновик</option>
            </select></label>
        </div>
        <div class="actions">
          <button class="btn primary" type="button" id="case-save">Сохранить кейс</button>
          <span class="hint error-text" id="case-error"></span>
        </div>
      </div>`;
    $('[data-case-cancel]', box)?.addEventListener('click', () => { box.hidden = true; box.innerHTML = ''; });
    $('#case-save', box)?.addEventListener('click', () => { void this.saveCase(existing ? slug : null, box); });
  }

  async saveCase(slug: string | null, box: HTMLElement): Promise<void> {
    const file = this.files.cases;
    if (!file) return;
    const errorBox = $('#case-error', box);
    if (errorBox) errorBox.textContent = '';
    try {
      const built = buildCase({
        title: ($('#case-title', box) as HTMLInputElement).value,
        area: ($('#case-area', box) as HTMLSelectElement).value,
        client: ($('#case-client', box) as HTMLInputElement).value,
        task: ($('#case-task', box) as HTMLTextAreaElement).value,
        actions: ($('#case-actions', box) as HTMLTextAreaElement).value,
        results: ($('#case-results', box) as HTMLTextAreaElement).value,
        published_at: ($('#case-date', box) as HTMLInputElement).value,
        sort: ($('#case-sort', box) as HTMLInputElement).value,
        status: ($('#case-status', box) as HTMLSelectElement).value,
      }, !slug, slug ?? '');
      if (!built.item) {
        if (errorBox) errorBox.textContent = built.errors.join(' ');
        return;
      }
      const next = upsertCase(file.json, built.item);
      const saved = await this.store.writeFile(
        this.config.casesPath,
        next,
        `Кейсы: ${slug ? 'правка' : 'новый кейс'} «${built.item.title}» из кабинета`,
      );
      this.files.cases = { json: next, sha: saved.sha };
      box.hidden = true;
      box.innerHTML = '';
      this.renderCases();
      this.tell('Кейс сохранён. Страница «Кейсы» обновится после сборки.');
    } catch (e) {
      if (errorBox) errorBox.textContent = (e as Error).message;
    }
  }

  async onCasesClick(event: Event): Promise<void> {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-case-edit],[data-case-move],[data-case-delete]');
    if (!target) return;
    if (target.dataset.caseEdit) { this.openCaseEditor(target.dataset.caseEdit); return; }
    if (target.dataset.caseDelete) { await this.deleteCase(target.dataset.caseDelete); return; }
    const dir = target.dataset.caseMove;
    if (dir === 'up' || dir === 'down') await this.moveCase(target.dataset.slug ?? '', dir);
  }

  async moveCase(slug: string, dir: 'up' | 'down'): Promise<void> {
    const file = this.files.cases;
    if (!file || !slug) return;
    try {
      const next = moveCase(file.json, slug, dir);
      const saved = await this.store.writeFile(this.config.casesPath, next, 'Кейсы: порядок из кабинета');
      this.files.cases = { json: next, sha: saved.sha };
      this.renderCases();
      this.tell('Порядок кейсов сохранён.');
    } catch (e) {
      this.tell((e as Error).message, true);
    }
  }

  async deleteCase(slug: string): Promise<void> {
    const file = this.files.cases;
    if (!file) return;
    const item = casesArray(asObj(file.json)).map(asObj).find((c) => asStr(c.slug) === slug);
    if (!item) return;
    if (!window.confirm(`Удалить кейс «${asStr(item.title)}»?`)) return;
    try {
      const next = removeCase(file.json, slug);
      const saved = await this.store.writeFile(this.config.casesPath, next, `Кейсы: удалён «${asStr(item.title)}»`);
      this.files.cases = { json: next, sha: saved.sha };
      this.renderCases();
      this.tell('Кейс удалён.');
    } catch (e) {
      this.tell((e as Error).message, true);
    }
  }

  /* ---------- 3. отзывы ---------- */

  async loadReviews(): Promise<void> {
    const body = document.getElementById('reviews-body');
    const status = $('#reviews-status');
    if (!body) return;
    if (!this.config.leadsBase) {
      this.fill('reviews-body', 'Приёмник отзывов не настроен. Пока отзывы приходят только в Telegram — их видно там же, в чате.');
      return;
    }
    this.fill('reviews-body', 'Загружаем отзывы…');
    if (status) status.textContent = '';
    try {
      const items = await this.fetchInbox();
      if (!items.length) {
        this.fill('reviews-body', 'Отзывов пока нет. Как только клиент оставит отзыв на сайте, он появится здесь и в Telegram.');
        return;
      }
      body.className = '';
      body.innerHTML = items.map((review) => `
        <article class="item" data-review="${escape(review.id)}">
          <div class="item-head">
            <div class="grow">
              <h4>${escape(review.author)} ${starsHtml(review.rating)}</h4>
              <div class="meta">${escape(dateRu(review.createdAt))}</div>
            </div>
            <span class="badge ${review.status === 'hidden' ? 'hidden' : 'live'}">${review.status === 'hidden' ? 'Скрыт' : 'Опубликован'}</span>
          </div>
          <p class="review-text">${escape(review.text)}</p>
          ${review.reply ? `<div class="reply-box"><b>Ваш ответ:</b> ${escape(review.reply)}</div>` : ''}
          <label class="field"><span class="label-text">Ответ — виден под отзывом на сайте</span>
            <textarea data-reply-input rows="2" maxlength="600">${escape(review.reply ?? '')}</textarea></label>
          <div class="actions">
            <button class="btn small primary" type="button" data-reply="${escape(review.id)}">Сохранить ответ</button>
            <button class="btn small" type="button" data-moderate="publish" data-id="${escape(review.id)}" ${review.status !== 'hidden' ? 'disabled' : ''}>Вернуть на сайт</button>
            <button class="btn small" type="button" data-moderate="hide" data-id="${escape(review.id)}" ${review.status === 'hidden' ? 'disabled' : ''}>Скрыть</button>
            <button class="btn small danger" type="button" data-moderate="delete" data-id="${escape(review.id)}">Удалить</button>
          </div>
        </article>`).join('');
    } catch (e) {
      this.fill('reviews-body', 'Не удалось загрузить отзывы.');
      if (status) status.textContent = (e as Error).message;
    }
  }

  private async fetchInbox(): Promise<ReviewInboxItem[]> {
    const data = await this.reviewRequest('/reviews/inbox');
    const items = Array.isArray(asObj(data).items) ? (asObj(data).items as unknown[]) : [];
    return items.map((raw) => {
      const r = asObj(raw);
      return {
        id: asStr(r.id),
        author: asStr(r.author),
        text: asStr(r.text),
        rating: clampRating(r.rating),
        status: r.status === 'hidden' ? 'hidden' : 'published',
        createdAt: asStr(r.createdAt),
        reply: asStr(r.reply) || null,
      };
    });
  }

  private async reviewRequest(path: string, body?: Record<string, unknown>): Promise<unknown> {
    const token = this.store.authToken;
    const res = await fetch(`${this.config.leadsBase}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const code = asStr(asObj(asObj(data)).error) || asStr(asObj(data).error);
      if (res.status === 403) throw new ManageError('Прослойка не пустила: проверьте, что у токена есть право записи в репозиторий.', 403);
      if (code === 'auth_unavailable') throw new ManageError('GitHub не ответил на проверку ключа — попробуйте через минуту.', 503);
      throw new ManageError(code ? `Ошибка прослойки: ${code}` : `Ошибка ${res.status}`, res.status);
    }
    return data;
  }

  async onReviewsClick(event: Event): Promise<void> {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-moderate],[data-reply]');
    if (!target) return;
    const action = target.dataset.moderate as 'hide' | 'publish' | 'delete' | undefined;
    if (action && target.dataset.id) { await this.moderate(target.dataset.id, action); return; }
    if (target.dataset.reply) await this.saveReply(target.dataset.reply);
  }

  async moderate(id: string, action: 'hide' | 'publish' | 'delete'): Promise<void> {
    if (action === 'delete' && !window.confirm('Удалить отзыв навсегда?')) return;
    try {
      await this.reviewRequest('/reviews/moderate', { id, action });
      this.tell(action === 'delete' ? 'Отзыв удалён.' : action === 'hide' ? 'Отзыв скрыт с сайта.' : 'Отзыв снова на сайте.');
      await this.loadReviews();
    } catch (e) {
      this.tell((e as Error).message, true);
    }
  }

  async saveReply(id: string): Promise<void> {
    const card = $(`[data-review="${id}"]`);
    const input = card ? $<HTMLTextAreaElement>('[data-reply-input]', card) : null;
    if (!input) return;
    const built = buildReply(input.value);
    if (built.error) { this.tell(built.error, true); return; }
    try {
      await this.reviewRequest('/reviews/reply', { id, reply: built.reply ?? '' });
      this.tell(built.reply ? 'Ответ сохранён — он виден под отзывом на сайте.' : 'Ответ убран.');
      await this.loadReviews();
    } catch (e) {
      this.tell((e as Error).message, true);
    }
  }

  /* ---------- 4. статьи ---------- */

  renderArticles(): void {
    const body = document.getElementById('articles-body');
    const file = this.files.articles;
    if (!body) return;
    if (!file) { this.fill('articles-body', 'Статьи не прочитаны.'); return; }
    const list = (Array.isArray(asObj(file.json).items) ? (asObj(file.json).items as unknown[]) : [])
      .slice().sort((a, b) => (asStr(asObj(a).published_at) < asStr(asObj(b).published_at) ? 1 : -1));
    if (!list.length) { this.fill('articles-body', 'Статей пока нет. Нажмите «＋ Новая статья».'); return; }
    body.className = '';
    body.innerHTML = list.map((raw) => {
      const a = asObj(raw);
      return `
        <article class="item">
          <div class="item-head">
            <div class="grow">
              <h4>${escape(a.title)}</h4>
              <div class="meta">${escape(ARTICLE_CATEGORY_TITLES[asStr(a.category)] ?? asStr(a.category))} · ${escape(asStr(a.published_at) || 'без даты')} · ${escape(asStr(a.slug))}</div>
            </div>
            <span class="badge ${a.status === 'published' ? 'live' : 'draft'}">${a.status === 'published' ? 'Опубликована' : 'Черновик'}</span>
          </div>
          <div class="actions">
            <button class="btn small" type="button" data-article-edit="${escape(asStr(a.slug))}">Открыть</button>
            ${a.status === 'published'
              ? `<a class="btn small" href="/articles/${escape(asStr(a.slug))}.html" target="_blank" rel="noopener">Смотреть</a>`
              : ''}
            <button class="btn small danger" type="button" data-article-delete="${escape(asStr(a.slug))}">Удалить</button>
          </div>
        </article>`;
    }).join('');
  }

  openArticleEditor(slug: string | null): void {
    const box = document.getElementById('article-editor');
    if (!box) return;
    const existing = slug
      ? (Array.isArray(asObj(this.files.articles?.json).items) ? (asObj(this.files.articles?.json).items as unknown[]) : [])
        .map(asObj).find((a) => asStr(a.slug) === slug)
      : null;
    const a = existing ?? {};
    box.hidden = false;
    box.innerHTML = `
      <div class="item item-edit">
        <div class="row">
          <h3 class="grow">${existing ? `Статья: ${escape(asStr(a.title))}` : 'Новая статья'}</h3>
          <button class="btn small quiet" type="button" data-article-cancel>Закрыть</button>
        </div>
        <label class="field"><span class="label-text">Заголовок</span>
          <input type="text" id="art-title" maxlength="160" value="${escape(asStr(a.title))}" /></label>
        <label class="field"><span class="label-text">Короткий title для поиска (до 70 знаков, необязательно)</span>
          <input type="text" id="art-seo" maxlength="70" value="${escape(asStr(a.seo_title))}" /></label>
        <label class="field"><span class="label-text">Описание для карточки (30–300 знаков)</span>
          <textarea id="art-excerpt" rows="2" maxlength="300">${escape(asStr(a.excerpt))}</textarea></label>
        <div class="row">
          <label class="field grow"><span class="label-text">Категория</span>
            <select id="art-category">${Object.entries(ARTICLE_CATEGORY_TITLES).map(([key, title]) =>
              `<option value="${key}" ${asStr(a.category) === key ? 'selected' : ''}>${escape(title)}</option>`).join('')}</select></label>
          <label class="field grow"><span class="label-text">Статус</span>
            <select id="art-status">
              <option value="published" ${a.status === 'published' ? 'selected' : ''}>Опубликована</option>
              <option value="draft" ${a.status !== 'published' ? 'selected' : ''}>Черновик</option>
            </select></label>
        </div>
        <label class="field"><span class="label-text">Текст: «## подзаголовок», «- пункт», «**жирный**», цены — кнопками ниже</span>
          <textarea id="art-body" rows="16" maxlength="40000">${escape(asStr(a.body_md))}</textarea></label>
        <div class="price-chips" id="art-chips" aria-label="Вставить цену из прайса"></div>
        <div class="row">
          <button class="btn small" type="button" id="art-preview">Предпросмотр</button>
          <span class="hint">Цены подставляются при сборке из прайса — в тексте остаётся код, на сайте стоит число.</span>
        </div>
        <div class="md-preview" id="art-preview-box" hidden></div>
        <p class="hint error-text" id="art-warnings"></p>
        <div class="actions">
          <button class="btn primary" type="button" id="art-save">Сохранить статью</button>
          <span class="hint error-text" id="art-error"></span>
        </div>
      </div>`;

    const chips = $('#art-chips', box);
    if (chips) {
      const groups = priceGroups(this.files.prices?.json);
      if (groups.length) {
        chips.innerHTML = groups.flatMap((group) => group.items.map((item) =>
          `<button class="chip-code" type="button" data-token="{{price:${escape(group.id)}.${escape(item.id)}}}" title="${escape(item.name)}">${escape(item.name)}</button>`)).slice(0, 30).join('');
        chips.addEventListener('click', (event) => {
          const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-token]');
          const area = $('#art-body', box) as HTMLTextAreaElement | null;
          if (!chip || !area) return;
          const at = area.selectionStart ?? area.value.length;
          area.value = area.value.slice(0, at) + (chip.dataset.token ?? '') + area.value.slice(area.selectionEnd ?? at);
          area.focus();
        });
      } else {
        chips.innerHTML = '<span class="hint">Прайс ещё не прочитан — подсказки цен появятся после сохранения прайса.</span>';
      }
    }

    $('#art-preview', box)?.addEventListener('click', () => {
      const preview = $('#art-preview-box', box);
      const area = $('#art-body', box) as HTMLTextAreaElement | null;
      if (!preview || !area) return;
      preview.hidden = false;
      preview.innerHTML = renderMarkdown(area.value, this.files.prices?.json);
      const warnings = $('#art-warnings', box);
      if (warnings) warnings.textContent = articleWarnings(area.value, this.files.prices?.json).join(' ');
    });

    $('[data-article-cancel]', box)?.addEventListener('click', () => { box.hidden = true; box.innerHTML = ''; });
    $('#art-save', box)?.addEventListener('click', () => { void this.saveArticle(existing ? slug : null, box); });
  }

  async saveArticle(slug: string | null, box: HTMLElement): Promise<void> {
    const file = this.files.articles;
    if (!file) return;
    const errorBox = $('#art-error', box);
    if (errorBox) errorBox.textContent = '';
    try {
      const built = buildArticle({
        title: ($('#art-title', box) as HTMLInputElement).value,
        seo_title: ($('#art-seo', box) as HTMLInputElement).value,
        excerpt: ($('#art-excerpt', box) as HTMLTextAreaElement).value,
        category: ($('#art-category', box) as HTMLSelectElement).value,
        body_md: ($('#art-body', box) as HTMLTextAreaElement).value,
        status: ($('#art-status', box) as HTMLSelectElement).value,
      }, !slug, slug ?? '');
      if (!built.item) {
        if (errorBox) errorBox.textContent = built.errors.join(' ');
        return;
      }
      const next = upsertArticle(file.json, built.item);
      const saved = await this.store.writeFile(
        this.config.articlesPath,
        next,
        `Статьи: «${built.item.title}» из кабинета`,
      );
      this.files.articles = { json: next, sha: saved.sha };
      box.hidden = true;
      box.innerHTML = '';
      this.renderArticles();
      this.tell(built.item.status === 'published'
        ? 'Статья опубликована. Через 1–2 минуты она будет на сайте и в RSS-ленте.'
        : 'Черновик сохранён — на сайте он не появится, пока не переключите статус.');
      const warnings = articleWarnings(built.item.body_md, this.files.prices?.json);
      if (warnings.length) this.tell(warnings.join(' '), true);
    } catch (e) {
      if (errorBox) errorBox.textContent = (e as Error).message;
    }
  }

  async onArticlesClick(event: Event): Promise<void> {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-article-edit],[data-article-delete]');
    if (!target) return;
    if (target.dataset.articleEdit) { this.openArticleEditor(target.dataset.articleEdit); return; }
    if (target.dataset.articleDelete) await this.deleteArticle(target.dataset.articleDelete);
  }

  async deleteArticle(slug: string): Promise<void> {
    const file = this.files.articles;
    if (!file) return;
    const item = (Array.isArray(asObj(file.json).items) ? (asObj(file.json).items as unknown[]) : [])
      .map(asObj).find((a) => asStr(a.slug) === slug);
    if (!item) return;
    if (!window.confirm(`Удалить статью «${asStr(item.title)}»?`)) return;
    try {
      const next = removeArticle(file.json, slug);
      const saved = await this.store.writeFile(this.config.articlesPath, next, `Статьи: удалена «${asStr(item.title)}»`);
      this.files.articles = { json: next, sha: saved.sha };
      this.renderArticles();
      this.tell('Статья удалена.');
    } catch (e) {
      this.tell((e as Error).message, true);
    }
  }
}
