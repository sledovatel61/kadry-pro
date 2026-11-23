/**
 * Живые отзывы на страницах сайта.
 *
 * Сайт — статика на GitHub Pages: страница собирается с теми отзывами, что
 * лежат в репозитории (`site/content/reviews.json`), а свежие забираются из
 * прослойки `GET /reviews` при открытии страницы. Отзыв, оставленный минуту
 * назад, виден сразу — без пересборки сайта.
 *
 * Правила:
 *   • без приёмника ничего не делаем — показываем статику (а её нет — честную
 *     надпись «пока нет отзывов»);
 *   • если запрос не удался, страница остаётся как была: ни ошибок, ни пустоты;
 *   • дубли отсекаем по имени+тексту+оценке: те же отзывы уже могут быть в статике;
 *   • порядок — новые сверху;
 *   • разметка карточки повторяет `ReviewsSection.astro`: классы `rev-card`,
 *     звёзды `rev-stars`, подпись `rev-who`, ответ Марии `rev-reply`.
 */
import { LEADS_BASE, leadsFetch, leadsUrl } from '../shared/leads-endpoint.ts';

export interface LiveReview {
  id: string;
  author: string;
  text: string;
  rating: number;
  publishedAt: string;
  reply?: string | null;
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** «21 ноября», а если год не текущий — «21 ноября 2025». */
export function formatDayMonth(iso: string, now: Date = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return iso ?? '';
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return iso;
  const base = `${day} ${MONTHS_GEN[month - 1]}`;
  return year === now.getFullYear() ? base : `${base} ${year}`;
}

/** Ключ для отсечения дублей: статика и прослойка описывают один и тот же отзыв. */
export function reviewKey(r: { author: string; text: string; rating: number }): string {
  const squeeze = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  return `${squeeze(r.author)}|${squeeze(r.text)}|${r.rating}`;
}

/** Отбирает отзывы, которых ещё нет на странице. */
export function pickNew(live: LiveReview[], existingKeys: Set<string>, limit = 50): LiveReview[] {
  const out: LiveReview[] = [];
  const seen = new Set(existingKeys);
  for (const item of live) {
    if (!item || typeof item.text !== 'string') continue;
    const key = reviewKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

const STAR_PATH = 'M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z';

function starRow(doc: Document, rating: number): HTMLElement {
  const row = doc.createElement('span');
  row.className = 'rev-stars';
  row.setAttribute('role', 'img');
  row.setAttribute('aria-label', `Оценка ${rating} из 5`);
  for (let i = 0; i < 5; i += 1) {
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    if (i < rating) svg.setAttribute('class', 'is-on');
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', STAR_PATH);
    svg.append(path);
    row.append(svg);
  }
  return row;
}

/** «1 отзыв / 2 отзыва / 5 отзывов». */
export function plural(n: number, one: string, few: string, many: string): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
  return many;
}

/** Карточка отзыва — та же структура, что в серверной разметке. */
export function buildCard(item: LiveReview, doc: Document = document): HTMLElement {
  const card = doc.createElement('article');
  card.className = 'rev-card';
  card.dataset.reviewLive = item.id;

  card.append(starRow(doc, item.rating));

  const text = doc.createElement('div');
  text.className = 'rev-text';
  const p = doc.createElement('p');
  p.textContent = item.text;
  text.append(p);
  card.append(text);

  const who = doc.createElement('div');
  who.className = 'rev-who';
  const ava = doc.createElement('span');
  ava.className = 'rev-ava';
  ava.setAttribute('aria-hidden', 'true');
  ava.textContent = item.author.slice(0, 1).toUpperCase();
  const name = doc.createElement('span');
  const b = doc.createElement('b');
  b.textContent = item.author;
  const meta = doc.createElement('span');
  meta.textContent = `Сайт · ${formatDayMonth(item.publishedAt)}`;
  name.append(b, meta);
  who.append(ava, name);
  card.append(who);

  if (item.reply) {
    const reply = doc.createElement('div');
    reply.className = 'rev-reply';
    const rb = doc.createElement('b');
    rb.textContent = 'Ответ Марии: ';
    reply.append(rb, doc.createTextNode(item.reply));
    card.append(reply);
  }

  return card;
}

/** Пересчитывает плашку «N отзывов на сайте · средняя оценка X» по карточкам. */
export function updateSummary(doc: Document, grid: Element): void {
  const ratings: number[] = [];
  for (const stars of Array.from(grid.querySelectorAll('.rev-card .rev-stars'))) {
    const found = /Оценка (\d)/.exec(stars.getAttribute('aria-label') ?? '');
    if (found) ratings.push(Number(found[1]));
  }
  if (!ratings.length) return;
  const avg = (ratings.reduce((sum, n) => sum + n, 0) / ratings.length).toFixed(1).replace('.', ',');
  for (const line of Array.from(doc.querySelectorAll('.rev-summary-line'))) {
    line.textContent = `${ratings.length} ${plural(ratings.length, 'отзыв', 'отзыва', 'отзывов')} на сайте · средняя оценка ${avg}`;
  }
  for (const big of Array.from(doc.querySelectorAll('.rev-summary-num b'))) {
    big.textContent = avg;
  }
}

const EMPTY_SELECTOR = '[data-reviews-empty]';

/**
 * Обновить все блоки отзывов на странице (главная, «Обо мне», «Кейсы»).
 * Блоки помечены `data-reviews="home|about|cases"`; первый из них дополняем
 * полностью, остальные — тоже (форма одна на страницу, поэтому дублей не боимся).
 */
export async function hydrateReviews(doc: Document = document): Promise<void> {
  if (!LEADS_BASE) return;
  const grids = Array.from(doc.querySelectorAll<HTMLElement>('[data-reviews]'));
  if (!grids.length) return;

  let items: LiveReview[] = [];
  try {
    const res = await leadsFetch(leadsUrl('reviews'), { method: 'GET' });
    if (!res.ok) return;
    const data = await res.json() as { items?: LiveReview[] };
    items = Array.isArray(data.items) ? data.items : [];
  } catch {
    /* Прослойка недоступна — страница остаётся статикой, ничего не ломаем. */
    return;
  }
  if (!items.length) return;

  for (const grid of grids) {
    const existing = new Set<string>();
    for (const card of Array.from(grid.querySelectorAll<HTMLElement>('.rev-card'))) {
      const author = card.querySelector('.rev-who b')?.textContent ?? '';
      const text = card.querySelector('.rev-text p')?.textContent ?? '';
      const rating = Number(/Оценка (\d)/.exec(card.querySelector('.rev-stars')?.getAttribute('aria-label') ?? '')?.[1] ?? 0);
      if (author && text && rating) existing.add(reviewKey({ author, text, rating }));
    }
    const fresh = pickNew(items, existing, grid.dataset.reviewsLimit ? Number(grid.dataset.reviewsLimit) : 50);
    if (!fresh.length) continue;

    const frag = doc.createDocumentFragment();
    for (const item of fresh) frag.append(buildCard(item, doc));
    /* Новые отзывы — сверху: порядок «новые первыми» сохраняется. */
    grid.prepend(frag);

    const empty = doc.querySelector<HTMLElement>(EMPTY_SELECTOR);
    if (empty) empty.hidden = true;
    updateSummary(doc, grid);
  }
}

/* Автозапуск. */
if (typeof document !== 'undefined') {
  const run = (): void => { void hydrateReviews(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
}
