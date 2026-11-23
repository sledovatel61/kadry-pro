/**
 * Живые отзывы: отзыв с сайта публикуется сразу, без премодерации.
 *
 * Как это работает:
 *   1. Человек отправил отзыв — воркер кладёт его в KV со статусом `published`
 *      ДО отправки в Telegram (если Telegram упадёт, отзыв всё равно на сайте).
 *   2. Страница /otzyvy и блоки на главной, в «Обо мне» и «Кейсах» забирают
 *      список с `GET /reviews` и показывают сразу.
 *   3. Марии приходит сообщение в Telegram и письмо — это не «модерация», а
 *      уведомление: спам или грубость скрываются одной кнопкой в /manage/.
 *
 * Почему без предварительной проверки: ручная публикация каждого отзыва — это
 * работа на каждый отзыв. Владелец должен реагировать только на плохое.
 *
 * Доступ к модерации — тем же ключом GitHub, которым Мария входит в /manage/:
 *   GET  /reviews            — публичный список (только `published`);
 *   GET  /reviews/inbox      — всё, включая скрытые;
 *   POST /reviews/moderate   — { id, action: 'hide'|'publish'|'delete' }.
 *
 * Воркер проверяет `Authorization: Bearer <ключ GitHub>` запросом к api.github.com
 * и пускает только того, у кого есть право записи в репозиторий сайта. Ключ
 * никуда не сохраняется: уходит в GitHub, в памяти изолята живёт только его
 * отпечаток не дольше пяти минут.
 *
 * Приватность: в логах только id и длина текста.
 */
import { json, sameKey } from './http.ts';

/** Сколько живёт отзыв в хранилище. */
export const REVIEW_TTL_SEC = 180 * 24 * 3600;
/** Сколько отзывов храним максимум (старые вытесняются). */
export const REVIEW_MAX = 300;

const INDEX_KEY = 'rlive:index';
const itemKey = (id: string) => `rlive:item:${id}`;

export interface LiveEnv {
  /** Необязательный запасной код модерации (проверка руками через curl). */
  REVIEWS_INBOX_KEY?: string;
  /** Репозиторий, доступ к которому проверяем. По умолчанию — сайт kadry-pro. */
  GITHUB_REPO?: string;
}

/** Куда идём проверять ключ GitHub. */
const DEFAULT_GITHUB_REPO = 'sledovatel61/kadry-pro';
/** Сколько помним, что ключ уже проверен (только отпечаток, не сам ключ). */
const GITHUB_OK_TTL_MS = 5 * 60_000;

/** Отпечатки проверенных ключей: живут в памяти изолята, на диск не попадают. */
const verifiedTokens = new Map<string, number>();

const githubFingerprint = async (token: string): Promise<string> => {
  const data = new TextEncoder().encode(token);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/**
 * Пускать ли этого человека к модерации. Ответы:
 *   `ok`          — ключ GitHub с правом записи в репозиторий (или старый код);
 *   `forbidden`   — ключа нет или он не наш;
 *   `unavailable` — GitHub не ответил, поэтому решать не берёмся.
 */
async function authoriseModeration(
  req: Request,
  url: URL,
  env: LiveEnv,
  fetcher: typeof fetch,
): Promise<'ok' | 'forbidden' | 'unavailable'> {
  const secret = (env.REVIEWS_INBOX_KEY ?? '').trim();
  if (secret && sameKey(moderationKeyOf(req, url), secret)) return 'ok';

  const bearer = /^Bearer\s+(.+)$/i.exec((req.headers.get('authorization') ?? '').trim());
  const token = bearer?.[1]?.trim() ?? '';
  if (!token) return 'forbidden';

  try {
    const print = await githubFingerprint(token);
    const until = verifiedTokens.get(print) ?? 0;
    if (until > Date.now()) return 'ok';

    const repo = (env.GITHUB_REPO ?? DEFAULT_GITHUB_REPO).replace(/^\/+|\/+$/g, '');
    const res = await fetcher(`https://api.github.com/repos/${repo}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'kadry-pro-reviews',
      },
    });
    if (!res.ok) return 'forbidden';
    const data = (await res.json()) as { permissions?: { push?: boolean; admin?: boolean; maintain?: boolean } };
    const canPush = Boolean(data.permissions?.push || data.permissions?.admin || data.permissions?.maintain);
    if (!canPush) return 'forbidden';
    verifiedTokens.set(print, Date.now() + GITHUB_OK_TTL_MS);
    return 'ok';
  } catch {
    return 'unavailable';
  }
}

export interface LiveStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSec: number): Promise<void>;
  delete?(key: string): Promise<void>;
}

export type ReviewStatus = 'published' | 'hidden';

export interface LiveReview {
  id: string;
  createdAt: string;
  author: string;
  text: string;
  rating: number;
  status: ReviewStatus;
  /** Ответ Марии, если он есть: показывается в карточке отзыва. */
  reply?: string | null;
}

/** Отзыв в том виде, в каком его видит посетитель сайта. */
export interface PublicReview {
  id: string;
  author: string;
  text: string;
  rating: number;
  publishedAt: string;
  reply?: string | null;
}

/** Код доступа из заголовка или (для проверки руками) из `?key=`. */
export function moderationKeyOf(req: Request, url: URL): string {
  return (req.headers.get('x-inbox-key') ?? url.searchParams.get('key') ?? '').trim();
}

async function readIndex(store: LiveStore): Promise<string[]> {
  const raw = await store.get(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function writeIndex(store: LiveStore, ids: string[]): Promise<void> {
  await store.put(INDEX_KEY, JSON.stringify(ids.slice(0, REVIEW_MAX)), REVIEW_TTL_SEC);
}

async function readItem(store: LiveStore, id: string): Promise<LiveReview | null> {
  const raw = await store.get(itemKey(id));
  if (!raw) return null;
  try {
    const item = JSON.parse(raw) as LiveReview;
    if (!item || typeof item.id !== 'string') return null;
    /* Все поля переносим как есть: `reply` не должен теряться при чтении,
       иначе ответ Марии сохранится в KV, но не покажется на сайте. */
    return {
      ...item,
      status: item.status === 'hidden' ? 'hidden' : 'published',
      reply: typeof item.reply === 'string' && item.reply.trim() ? item.reply : null,
    };
  } catch {
    return null;
  }
}

/**
 * Сохранить отзыв и сразу опубликовать. Ошибки глотаем: если KV недоступен,
 * отзыв всё равно должен уйти в Telegram — уведомление важнее идеальности.
 */
export async function publishReview(
  store: LiveStore,
  review: { author: string; text: string; rating: number },
  id: string,
  now: Date = new Date(),
): Promise<boolean> {
  try {
    const item: LiveReview = {
      id,
      createdAt: now.toISOString(),
      author: review.author,
      text: review.text,
      rating: review.rating,
      status: 'published',
    };
    await store.put(itemKey(id), JSON.stringify(item), REVIEW_TTL_SEC);
    const ids = await readIndex(store);
    await writeIndex(store, [id, ...ids.filter((x) => x !== id)]);
    return true;
  } catch {
    return false;
  }
}

/** Опубликованные отзывы: новые сверху. */
export async function listPublished(store: LiveStore, limit = 100): Promise<PublicReview[]> {
  const ids = await readIndex(store);
  const out: PublicReview[] = [];
  for (const id of ids) {
    if (out.length >= limit) break;
    const item = await readItem(store, id);
    if (!item || item.status !== 'published') continue;
    out.push({
      id: item.id,
      author: item.author,
      text: item.text,
      rating: item.rating,
      publishedAt: item.createdAt,
      ...(item.reply ? { reply: item.reply } : {}),
    });
  }
  return out;
}

/** Все отзывы, включая скрытые, — для модерации. */
export async function listAll(store: LiveStore, limit = 100): Promise<LiveReview[]> {
  const ids = await readIndex(store);
  const out: LiveReview[] = [];
  for (const id of ids) {
    if (out.length >= limit) break;
    const item = await readItem(store, id);
    if (item) out.push(item);
  }
  return out;
}

/** Скрыть, вернуть на сайт, удалить отзыв или записать ответ Марии. */
export async function moderateReview(
  store: LiveStore,
  id: string,
  action: 'hide' | 'publish' | 'delete',
): Promise<boolean> {
  const item = await readItem(store, id);
  if (!item) return false;
  if (action === 'delete') {
    if (store.delete) await store.delete(itemKey(id));
    else await store.put(itemKey(id), 'null', 1);
    const ids = await readIndex(store);
    await writeIndex(store, ids.filter((x) => x !== id));
    return true;
  }
  await store.put(itemKey(id), JSON.stringify({ ...item, status: action === 'hide' ? 'hidden' : 'published' }), REVIEW_TTL_SEC);
  return true;
}

/** Ответ Марии на отзыв: пустая строка убирает ответ. */
export async function replyToReview(store: LiveStore, id: string, reply: string): Promise<boolean> {
  const item = await readItem(store, id);
  if (!item) return false;
  const clean = reply.replace(/[<>]/g, '').trim().slice(0, 600);
  await store.put(itemKey(id), JSON.stringify({ ...item, reply: clean || null }), REVIEW_TTL_SEC);
  return true;
}

/**
 * Обработчик адресов отзывов. Возвращает `null`, если адрес не наш —
 * тогда `index.ts` отдаст общий 404.
 */
export async function handleLiveReviews(
  req: Request,
  url: URL,
  env: LiveEnv,
  store: LiveStore,
  deps: { fetchGithub?: typeof fetch } = {},
): Promise<Response | null> {
  const { pathname } = url;

  /* Публичный список: его читают страница отзывов и блоки на главной. Кэш на
     минуту, чтобы форма и обновление страницы не дёргали KV на каждый показ. */
  if (pathname === '/reviews') {
    if (req.method !== 'GET') return json({ error: 'not_found' }, 404);
    const items = await listPublished(store);
    return json({ items, total: items.length }, 200, { 'cache-control': 'public, max-age=60' });
  }

  const isInbox = pathname === '/reviews/inbox';
  const isModerate = pathname === '/reviews/moderate';
  const isReply = pathname === '/reviews/reply';
  if (!isInbox && !isModerate && !isReply) return null;

  /* Один вход на всё управление: ключ GitHub из /manage/. Второго кода нет. */
  const access = await authoriseModeration(req, url, env, deps.fetchGithub ?? fetch);
  if (access === 'unavailable') return json({ error: 'auth_unavailable' }, 503);
  if (access === 'forbidden') return json({ error: 'forbidden' }, 403);

  if (isInbox) {
    if (req.method !== 'GET') return json({ error: 'not_found' }, 404);
    const items = await listAll(store);
    return json({ items, total: items.length });
  }

  if (req.method !== 'POST') return json({ error: 'not_found' }, 404);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  const record = (body ?? {}) as { id?: unknown; action?: unknown; reply?: unknown };
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (!id) return json({ error: 'bad_id' }, 400);

  if (isReply) {
    if (typeof record.reply !== 'string') return json({ error: 'bad_reply' }, 400);
    const ok = await replyToReview(store, id, record.reply);
    console.log('[reviews] reply', id, ok);
    return json({ ok }, ok ? 200 : 404);
  }

  const action = record.action;
  if (action !== 'hide' && action !== 'publish' && action !== 'delete') {
    return json({ error: 'bad_action' }, 400);
  }
  const ok = await moderateReview(store, id, action);
  console.log('[reviews] moderate', id, action, ok);
  return json({ ok }, ok ? 200 : 404);
}

/** Что показать в `/health`: включена ли модерация отзывов. */
export function liveReviewsHealth(env: LiveEnv): { reviewsInbox: boolean; reviewsModeration: 'github' } {
  return {
    /* Старый код модерации — необязательный запасной вход. */
    reviewsInbox: Boolean((env.REVIEWS_INBOX_KEY ?? '').trim()),
    /* Основной вход всегда один: ключ GitHub из /manage/. */
    reviewsModeration: 'github',
  };
}
