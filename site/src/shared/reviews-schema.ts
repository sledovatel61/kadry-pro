/**
 * Отзывы клиентов — контракт файла `site/content/reviews.json`.
 *
 * Модуль намеренно чистый: никаких Node API и обращений к диску. Его импортируют
 * страницы (серверная разметка), клиентский скрипт живых отзывов, гейт
 * (`site/scripts/check-reviews.mjs`) и тесты.
 *
 * ГЛАВНОЕ ПРАВИЛО (решение владельца): выдуманные отзывы строго запрещены.
 * Поэтому стартовое состояние — пустой список, а любой отзыв с `demo: true`
 * роняет строгий прогон гейта. Отзывы приходят только от живых людей через
 * форму на сайте (`relay/`, `POST /reviews`) и публикуются сразу.
 */

export const REVIEW_SOURCES = ['site', 'yandex', '2gis', 'email'] as const;
export type ReviewSource = (typeof REVIEW_SOURCES)[number];

export const REVIEW_STATUSES = ['published', 'hidden'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_LIMITS = Object.freeze({
  author: [2, 40] as const,
  text: [20, 1500] as const,
  reply: [0, 600] as const,
  rating: [1, 5] as const,
  id: [2, 64] as const,
});

const SAFE_ID_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface SiteReview {
  /** `r-YYYY-MM-DD-NNN` или uuid из воркера — стабильный и уникальный. */
  id: string;
  /** 2–40 знаков, например «Павел И.» */
  author: string;
  /** 20–1500 знаков */
  text: string;
  /** Целое 1–5 */
  rating: number;
  source: ReviewSource;
  source_url: string | null;
  /** `YYYY-MM-DD` */
  published_at: string;
  status: ReviewStatus;
  /** Ответ Марии: 0–600 знаков. Показывается под отзывом. */
  reply?: string | null;
  /** Образец оформления. В продакшене таких быть не должно (--strict). */
  demo: boolean;
}

export interface ReviewsFile {
  updated_at: string;
  items: SiteReview[];
}

export interface ReviewsParseResult {
  file: ReviewsFile;
  errors: string[];
}

export interface ReviewsStats {
  count: number;
  average: number | null;
  byRating: Record<1 | 2 | 3 | 4 | 5, number>;
}

/** Пустой файл — честное стартовое состояние: отзывы появятся сами. */
export const EMPTY_REVIEWS_FILE: ReviewsFile = { updated_at: '', items: [] };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function isRealCalendarDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function parseSingleReview(raw: unknown, index: number, errors: string[]): SiteReview | null {
  const at = `items[${index}]`;
  if (!isObj(raw)) {
    errors.push(`${at}: запись должна быть объектом`);
    return null;
  }

  const bad: string[] = [];

  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id || !SAFE_ID_RE.test(id)) {
    bad.push(`id: «${String(raw.id ?? '')}» — нужен непустой идентификатор`);
  }

  const author = typeof raw.author === 'string' ? raw.author.trim() : '';
  if (author.length < REVIEW_LIMITS.author[0] || author.length > REVIEW_LIMITS.author[1]) {
    bad.push(`author: длина ${author.length}, нужно ${REVIEW_LIMITS.author[0]}–${REVIEW_LIMITS.author[1]} знаков`);
  }

  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (text.length < REVIEW_LIMITS.text[0] || text.length > REVIEW_LIMITS.text[1]) {
    bad.push(`text: длина ${text.length}, нужно ${REVIEW_LIMITS.text[0]}–${REVIEW_LIMITS.text[1]} знаков`);
  }

  const rating = raw.rating;
  if (typeof rating !== 'number' || !Number.isInteger(rating)
    || rating < REVIEW_LIMITS.rating[0] || rating > REVIEW_LIMITS.rating[1]) {
    bad.push(`rating: «${String(rating)}» — нужно целое число от 1 до 5`);
  }

  const source = raw.source;
  if (typeof source !== 'string' || !(REVIEW_SOURCES as readonly string[]).includes(source)) {
    bad.push(`source: «${String(source)}» — допустимо ${REVIEW_SOURCES.join(' | ')}`);
  }

  let sourceUrl: string | null = null;
  if (raw.source_url !== undefined && raw.source_url !== null && raw.source_url !== '') {
    if (typeof raw.source_url !== 'string' || !/^https:\/\//i.test(raw.source_url)) {
      bad.push('source_url: нужна https-ссылка или null');
    } else {
      sourceUrl = raw.source_url;
    }
  }

  const publishedAt = typeof raw.published_at === 'string' ? raw.published_at.trim() : '';
  if (!isRealCalendarDate(publishedAt)) {
    bad.push(`published_at: «${String(raw.published_at ?? '')}» — нужна реальная дата YYYY-MM-DD`);
  }

  const status = raw.status === undefined ? 'published' : raw.status;
  if (typeof status !== 'string' || !(REVIEW_STATUSES as readonly string[]).includes(status)) {
    bad.push(`status: «${String(raw.status)}» — допустимо ${REVIEW_STATUSES.join(' | ')}`);
  }

  let reply: string | null = null;
  if (raw.reply !== undefined && raw.reply !== null && raw.reply !== '') {
    if (typeof raw.reply !== 'string') bad.push('reply: нужна строка или null');
    else if (raw.reply.length > REVIEW_LIMITS.reply[1]) {
      bad.push(`reply: длина ${raw.reply.length}, максимум ${REVIEW_LIMITS.reply[1]}`);
    } else reply = raw.reply;
  }

  const demo = raw.demo === true;
  if (raw.demo !== undefined && typeof raw.demo !== 'boolean') {
    bad.push('demo: true или false');
  }

  if (bad.length > 0) {
    errors.push(`${at}: ${bad.join('; ')}`);
    return null;
  }

  return {
    id,
    author,
    text,
    rating: rating as number,
    source: source as ReviewSource,
    source_url: sourceUrl,
    published_at: publishedAt,
    status: status as ReviewStatus,
    ...(reply ? { reply } : {}),
    demo,
  };
}

/** Разбор файла отзывов: битые записи пропускаются, причины — в `errors`. */
export function parseReviewsFile(raw: unknown): ReviewsParseResult {
  const errors: string[] = [];
  const out: ReviewsFile = { updated_at: '', items: [] };

  if (!isObj(raw)) {
    return { file: out, errors: ['reviews.json: корень должен быть объектом'] };
  }

  if (typeof raw.updated_at === 'string') out.updated_at = raw.updated_at;
  else if (raw.updated_at !== undefined) errors.push('updated_at: нужна строка YYYY-MM-DD');

  if (!Array.isArray(raw.items)) {
    errors.push('items: нужен массив');
    return { file: out, errors };
  }

  const seen = new Set<string>();
  raw.items.forEach((item, index) => {
    const parsed = parseSingleReview(item, index, errors);
    if (!parsed) return;
    if (seen.has(parsed.id)) {
      errors.push(`items[${index}]: id «${parsed.id}» повторяется`);
      return;
    }
    seen.add(parsed.id);
    out.items.push(parsed);
  });

  return { file: out, errors };
}

/** Опубликованные отзывы: новые сверху. */
export function publishedReviews(file: ReviewsFile): SiteReview[] {
  return file.items
    .filter((r) => r.status === 'published')
    .sort((a, b) => (a.published_at < b.published_at ? 1 : a.published_at > b.published_at ? -1 : 0));
}

/** Сводка для шапки блока: сколько отзывов и средняя оценка (одно число после запятой). */
export function reviewsStats(items: SiteReview[]): ReviewsStats {
  const byRating: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of items) byRating[r.rating as 1 | 2 | 3 | 4 | 5] += 1;
  const count = items.length;
  const average = count === 0
    ? null
    : Math.round((items.reduce((sum, r) => sum + r.rating, 0) / count) * 10) / 10;
  return { count, average, byRating };
}

/** «1 отзыв / 2 отзыва / 5 отзывов» — для заголовков. */
export function plural(n: number, one: string, few: string, many: string): string {
  const n10 = Math.abs(n) % 10;
  const n100 = Math.abs(n) % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
  return many;
}
