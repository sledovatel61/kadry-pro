/**
 * Отзывы клиентов: проверка того, что человек написал в форме.
 *
 * Правила мягкие по сути и жёсткие по форме: отзыв публикуется СРАЗУ (без
 * премодерации), поэтому воркер обязан сам не пустить в разметку то, что потом
 * придётся вычищать руками:
 *   - `<` и `>` вырезаются всегда — воркер не рендерит отзыв, но его читают руками
 *     и вставляют в JSON репозитория;
 *   - ссылки и адреса мессенджеров запрещены — площадка для впечатлений, а не
 *     для рекламы;
 *   - четыре одинаковые строки подряд — накрутка;
 *   - оценка обязательна: значение по умолчанию превратило бы пропуск поля
 *     в «пять звёзд», а этого отзыва не было.
 *
 * Коды полей (`too_short`, `link_not_allowed`, …) — часть контракта: клиент
 * `site/src/client/review-form.ts` переводит их в русские тексты.
 */

import type { FieldErrors } from './validate.ts';

export const REVIEW_AUTHOR_MIN = 2;
export const REVIEW_AUTHOR_MAX = 40;
export const REVIEW_TEXT_MIN = 20;
export const REVIEW_TEXT_MAX = 1500;
export const REVIEW_PAGE_MAX = 60;
export const REVIEW_PAGE_DEFAULT = 'otzyvy';
/** Сколько одинаковых строк подряд считаем накруткой. */
export const REVIEW_REPEAT_LIMIT = 3;
/** Отзывы в ответе кэшируются на минуту: страница не должна дёргать KV на показ. */
export const REVIEWS_CACHE_SECONDS = 60;

export interface ReviewPayload {
  author: string;
  text: string;
  rating: 1 | 2 | 3 | 4 | 5;
  consent: true;
  consentVersion: string;
  honeypot: string;
  page: string;
}

export type ReviewValidated =
  | { ok: true; value: ReviewPayload }
  | { ok: false; error: 'bad_json' | 'validation' | 'link_not_allowed'; fields: FieldErrors };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);

/** `<` и `>` не переносим никогда. */
const stripTags = (s: string): string => s.replace(/[<>]/g, '');

/** Ссылки в отзыве не нужны. */
export function looksLikeLink(s: string): boolean {
  return /https?:\/\//i.test(s)
    || /(^|[\s(«"'])www\./i.test(s)
    || /(^|[\s(«"'])t\.me\//i.test(s)
    /* Домен без схемы: «example.com/price», «магазин.рф». Смотрим только слова
       с точкой и настоящим TLD — иначе обычная фраза «5 тыс. руб» стала бы ссылкой. */
    || /(^|[\s(«"'])[\p{L}\p{N}_-]+\.(ru|su|com|net|org|io|me|рф|xn--p1ai)(\/|$|[\s.,;:!?)\]»"'])/iu.test(s);
}

/** Есть ли 4 одинаковые непустые строки подряд. */
export function hasRepeatedLines(text: string, limit: number = REVIEW_REPEAT_LIMIT): boolean {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  let run = 0;
  let prev: string | null = null;
  for (const line of lines) {
    run = line === prev ? run + 1 : 1;
    if (run > limit) return true;
    prev = line;
  }
  return false;
}

export function validateReview(body: unknown): ReviewValidated {
  if (!isObj(body)) return { ok: false, error: 'bad_json', fields: {} };
  const fields: FieldErrors = {};
  const bad = (k: string, code: string): void => { if (!(k in fields)) fields[k] = code; };

  const author = stripTags(str(body.author).trim()).trim();
  if (!author) bad('author', 'required');
  else if (author.length < REVIEW_AUTHOR_MIN) bad('author', 'too_short');
  else if (author.length > REVIEW_AUTHOR_MAX) bad('author', 'too_long');

  const text = stripTags(str(body.text).trim()).trim();
  if (!text) bad('text', 'required');
  else if (text.length < REVIEW_TEXT_MIN) bad('text', 'too_short');
  else if (text.length > REVIEW_TEXT_MAX) bad('text', 'too_long');
  else if (hasRepeatedLines(text)) bad('text', 'repeated_lines');

  if (body.rating === undefined || body.rating === null) {
    bad('rating', 'required');
  } else {
    const r = int(body.rating);
    if (r === null || r < 1 || r > 5) bad('rating', 'out_of_range');
  }

  if (body.consent !== true) bad('consent', 'required');

  const consentVersion = str(body.consentVersion ?? body.consent_version).trim();
  if (!consentVersion) bad('consentVersion', 'required');

  const honeypot = str(body.honeypot);

  const pageRaw = str(body.page).trim();
  const page = pageRaw ? stripTags(pageRaw) : REVIEW_PAGE_DEFAULT;
  if (page.length > REVIEW_PAGE_MAX) bad('page', 'too_long');

  if (Object.keys(fields).length > 0) return { ok: false, error: 'validation', fields };

  /* Ссылки проверяем после длины: короткий текст со ссылкой — всё равно текст,
     но ответ должен быть один и понятный. */
  if (looksLikeLink(author)) return { ok: false, error: 'link_not_allowed', fields: { author: 'link_not_allowed' } };
  if (looksLikeLink(text)) return { ok: false, error: 'link_not_allowed', fields: { text: 'link_not_allowed' } };

  return {
    ok: true,
    value: {
      author,
      text,
      rating: int(body.rating) as 1 | 2 | 3 | 4 | 5,
      consent: true,
      consentVersion,
      honeypot,
      page,
    },
  };
}
