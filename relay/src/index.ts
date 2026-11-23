/**
 * kadry-leads — прослойка между статическим сайтом kadry-pro.ru на GitHub Pages
 * и Telegram-группой Марии плюс почтой. Заменяет американский Formspree.
 *
 * Контракт (на него завязаны клиент сайта и тесты — менять нельзя):
 *   GET  /health             → { ok, service:'kadry-leads', time, telegram, email, emailTo,
 *                               consentVersion, kv, reviews, reviewsKv, reviewsModeration, files }
 *   POST /leads              → 201 { ticket, status:'accepted', duplicate, delivered{telegram,email}, download? }
 *                              400 { error:{ code:'validation'|'bad_json'|'consent_version', message, fields? } }
 *                              403 { error:{ code:'origin', … } }
 *                              429 { error:{ code:'too_many', … } } + Retry-After
 *   GET  /files/:token       → PDF из приватного бакета по подписанной ссылке
 *   POST /reviews            → 201 { ok:true, status:'published', id }  (отзыв сразу на сайте)
 *   GET  /reviews            → { items:[{id,author,text,rating,publishedAt,reply?}], total } — публично
 *   GET  /reviews/inbox      → { items:[…] } со статусами (ключ GitHub из /manage/)
 *   POST /reviews/moderate   → { ok:true } — { id, action:'hide'|'publish'|'delete' }
 *   POST /reviews/reply      → { ok:true } — { id, reply:'…' }
 *
 * Секреты (wrangler secret put): BOT_TOKEN, TELEGRAM_CHAT_ID, BREVO_API_KEY или
 * RESEND_API_KEY, FILE_TOKEN_SECRET.
 * Переменные (wrangler.toml): ALLOWED_ORIGINS, SITE_NAME, SITE_ADDRESS, CONSENT_VERSION, EMAIL_TO, GITHUB_REPO.
 */
import { validateLead, type LeadPayload } from './validate.ts';
import { composeTelegram, sendTelegram } from './telegram.ts';
import { emailProvider, sendEmail, DEFAULT_EMAIL_TO } from './email.ts';
import { mailStatus, markMailOk, markMailFailed } from './mail-status.ts';
import { handleReview, reviewsHealth, type ReviewsStore } from './reviews.ts';
import { handleLiveReviews, liveReviewsHealth } from './reviews-live.ts';
import { allowedOrigins } from './origins.ts';
import { hashIp, json, err } from './http.ts';
import { signFileToken, verifyFileToken, serveFile, signingSecret, type R2Like } from './files.ts';

export interface Env {
  BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  TELEGRAM_API_BASE?: string;
  ALLOWED_ORIGINS?: string;
  SITE_NAME?: string;
  SITE_ADDRESS?: string;
  CONSENT_VERSION?: string;
  /** Почта-дубль: включается наличием ключа сервиса (Brevo или Resend). */
  BREVO_API_KEY?: string;
  RESEND_API_KEY?: string;
  EMAIL_TO?: string;
  EMAIL_FROM?: string;
  /** Необязательный KV: лимиты, идемпотентность и живые отзывы переживают перезапуск. */
  KADRY_KV?: KVNamespace;
  /** Старый код модерации. Необязателен: основной вход — ключ GitHub из /manage/. */
  REVIEWS_INBOX_KEY?: string;
  /** Репозиторий для проверки ключа GitHub. По умолчанию — сайт kadry-pro. */
  GITHUB_REPO?: string;
  /** Секрет подписи ссылок на файлы. Пусто — соль из BOT_TOKEN. */
  FILE_TOKEN_SECRET?: string;
  /** Приватный бакет R2 с полными шаблонами. Пока его нет, /files отвечает 404. */
  TEMPLATES?: R2Like;
}

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const allowed = allowedOrigins(env);
  const origin = req.headers.get('origin') ?? '';
  const ok = allowed.includes(origin) || allowed.includes('*');
  return {
    /* Не разрешено (в том числе пустой список) — отдаём `null`: браузер такой
       ответ заблокирует, и подставлять чужой адрес из конфига не нужно. */
    'access-control-allow-origin': ok ? origin : 'null',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    /* `authorization` — вход в модерацию тем же ключом GitHub, что и в /manage/. */
    'access-control-allow-headers': 'content-type, authorization, x-inbox-key',
    /* `retry-after` на 429 не входит в safelist, поэтому без этого заголовка
       кросс-доменный JS не видит, через сколько секунд повторять. */
    'access-control-expose-headers': 'retry-after',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

/** K-1121-4821: буква + ММДД + 4 цифры, как в серверных талонах. */
export function makeTicket(now: Date = new Date(), rand: () => number = Math.random): string {
  const msk = new Date(now.getTime() + 3 * 3600_000);
  const mm = String(msk.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(msk.getUTCDate()).padStart(2, '0');
  const n = 1000 + Math.floor(rand() * 9000);
  return `K-${mm}${dd}-${n}`;
}

/* ---------- лимиты и идемпотентность ---------- */

const mem = new Map<string, { v: string; exp: number }>();
const memGet = (k: string): string | null => {
  const hit = mem.get(k);
  if (!hit) return null;
  if (hit.exp < Date.now()) { mem.delete(k); return null; }
  return hit.v;
};
const memPut = (k: string, v: string, ttl: number): void => { mem.set(k, { v, exp: Date.now() + ttl * 1000 }); };

/** Очистка памяти изолята. Нужна тестам: без KV лимиты и идемпотентность
 *  живут в этом же Map, и тесты мешали бы друг другу. В бою не вызывается. */
export function resetMemoryStore(): void { mem.clear(); }

const kvGet = async (env: Env, k: string): Promise<string | null> =>
  env.KADRY_KV ? env.KADRY_KV.get(k) : memGet(k);
const kvPut = async (env: Env, k: string, v: string, ttl: number): Promise<void> => {
  if (env.KADRY_KV) await env.KADRY_KV.put(k, v, { expirationTtl: ttl });
  else memPut(k, v, ttl);
};

/* Приём отзывов живёт в ./reviews.ts, но лимиты и идемпотентность у него общие
   с заявками: тот же KV, та же память изолята, только другие ключи. */
const reviewStore = (env: Env): ReviewsStore => ({
  get: (k) => kvGet(env, k),
  put: (k, v, ttl) => kvPut(env, k, v, ttl),
});

/** Простой счётчик: N заявок с одного адреса за 10 минут. */
export const LEAD_LIMIT = { max: 5, windowSec: 600 };

async function tooMany(env: Env, ipHash: string): Promise<{ ok: boolean; retry: number }> {
  const key = `rl:${ipHash}`;
  const raw = await kvGet(env, key);
  const n = raw ? Number(raw) || 0 : 0;
  if (n >= LEAD_LIMIT.max) return { ok: false, retry: LEAD_LIMIT.windowSec };
  await kvPut(env, key, String(n + 1), LEAD_LIMIT.windowSec);
  return { ok: true, retry: 0 };
}

/* ---------- заявка ---------- */

/** Тело заявки: больше 64 КБ — это не заявка, а попытка что-то залить. */
const LEAD_MAX_BYTES = 64 * 1024;

async function readLead(req: Request): Promise<unknown | null> {
  const len = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(len) && len > LEAD_MAX_BYTES) return null;
  try { return await req.json(); } catch { return null; }
}

async function handleLead(req: Request, env: Env): Promise<Response> {
  const body = await readLead(req);
  if (body === null) return err(400, 'bad_json', 'Ожидался JSON-запрос');

  const v = validateLead(body);
  if (!v.ok) {
    if (v.error === 'bad_json') return err(400, 'bad_json', 'Ожидался JSON-запрос');
    return err(400, 'validation', 'Проверьте заполнение полей', v.fields);
  }
  const lead: LeadPayload = v.value;

  // Бот: отвечаем как при успехе, но ничего не отправляем (защита от перебора).
  if (lead.honeypot.trim() !== '') {
    return json({ ticket: makeTicket(), status: 'accepted', duplicate: false }, 201);
  }
  if (lead.form_started_at && Date.now() - lead.form_started_at < 4000) {
    return json({ ticket: makeTicket(), status: 'accepted', duplicate: false }, 201);
  }
  if (env.CONSENT_VERSION && lead.consent_version !== env.CONSENT_VERSION) {
    return err(400, 'consent_version', 'Версия согласия устарела. Обновите страницу и отправьте заявку снова.');
  }

  // Идемпотентность: повторная отправка того же ключа возвращает тот же талон.
  const idemKey = `idem:${lead.idempotency_key}`;
  const seen = await kvGet(env, idemKey);
  if (seen) {
    const [ticket, hash, download] = seen.split('|');
    if (hash !== (await hashIp(lead.phone))) {
      return err(409, 'conflict', 'Ключ идемпотентности уже использован');
    }
    return json({
      ticket, status: 'accepted', duplicate: true,
      ...(download ? { download } : {}),
    }, 201);
  }

  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for') ?? 'unknown';
  const ipHash = await hashIp(ip);
  const rl = await tooMany(env, ipHash);
  if (!rl.ok) {
    return err(429, 'too_many', 'Слишком много заявок с вашего адреса. Повторите позже или позвоните нам.', undefined, {
      'retry-after': String(rl.retry),
    });
  }

  if (!env.BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.error('[leads] telegram не настроен');
    return err(502, 'telegram', 'Сервис не смог принять заявку. Позвоните нам, пожалуйста.');
  }

  const ticket = makeTicket();
  const text = composeTelegram(lead, ticket, {
    siteName: env.SITE_NAME ?? 'Кадры-Про',
    address: env.SITE_ADDRESS ?? 'Ростов-на-Дону',
  });

  /* Доставка в два канала. Заявка считается принятой, если сработал хотя бы один:
     Марии важнее увидеть заявку хоть где-то, чем потерять её из-за чужого сбоя.
     Идём параллельно — человек не должен ждать два последовательных запроса. */
  const tg = { token: env.BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID, apiBase: env.TELEGRAM_API_BASE };
  const emailOn = Boolean(emailProvider(env));
  const telegramJob = (async (): Promise<string | null> => {
    try {
      await sendTelegram(text, tg);
      return null;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 120);
      console.error('[leads] telegram failed', msg);
      return msg;
    }
  })();
  const emailJob = (async (): Promise<string | null> => {
    if (!emailOn) return 'email_not_configured';
    try {
      await sendEmail({
        lead, ticket, env,
        opts: {
          siteName: env.SITE_NAME ?? 'Кадры-Про',
          address: env.SITE_ADDRESS ?? 'Ростов-на-Дону',
        },
      });
      await markMailOk(env);
      return null;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 120);
      console.error('[leads] email failed', msg);
      /* Причину видно в /health: emailLastError. */
      await markMailFailed(env, msg);
      return msg;
    }
  })();
  const [tgErr, mailErr] = await Promise.all([telegramJob, emailJob]);
  const delivered = { telegram: !tgErr, email: emailOn && !mailErr };
  if (!delivered.telegram && !delivered.email) {
    /* Почта не настроена — это не второй канал, и код ошибки должен остаться прежним. */
    return emailOn
      ? err(502, 'delivery', 'Не удалось доставить заявку. Позвоните нам, пожалуйста.')
      : err(502, 'telegram', 'Не удалось доставить заявку. Позвоните нам, пожалуйста.');
  }

  /* Заявка на шаблон: выдаём подписанную ссылку на файл, если файл вообще есть
     в бакете. Пока бакета нет — ссылки нет, и Мария вышлет файл руками. */
  let download: string | undefined;
  if (lead.kind === 'template' && (lead.template.package === 'full' || lead.template.package === 'email')) {
    const id = lead.template.package === 'full' ? 'full-bundle-64' : 'email-bundle-25';
    const hasFiles = Boolean(env.TEMPLATES);
    if (hasFiles && lead.template.package === 'full') {
      const token = await signFileToken(env, id);
      if (token) download = `/files/${token}`;
    }
  }

  await kvPut(env, idemKey, `${ticket}|${await hashIp(lead.phone)}|${download ?? ''}`, 86400);
  return json({
    ticket, status: 'accepted', duplicate: false, delivered,
    ...(download ? { download } : {}),
  }, 201);
}

/* ---------- воркер ---------- */

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    const withCors = (r: Response): Response => {
      const headers = new Headers(r.headers);
      for (const [k, v] of Object.entries(cors)) headers.set(k, v);
      return new Response(r.body, { status: r.status, headers });
    };

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        const mail = emailProvider(env);
        const mailLog = mail ? await mailStatus(env) : {};
        return withCors(json({
          ok: true,
          service: 'kadry-leads',
          time: new Date().toISOString(),
          telegram: Boolean(env.BOT_TOKEN && env.TELEGRAM_CHAT_ID),
          email: emailProvider(env),
          emailTo: emailProvider(env) ? (env.EMAIL_TO ?? DEFAULT_EMAIL_TO) : undefined,
          /* Последняя попытка письма: код ошибки и время. Помогает понять, почему
             заявка пришла в Telegram, а письма нет, не открывая логи Cloudflare. */
          ...(mail ? {
            emailLastOk: mailLog.lastOk,
            emailLastError: mailLog.lastError,
            emailLastErrorAt: mailLog.lastErrorAt,
          } : {}),
          /* Версия согласия, которую принимает воркер. Сайт видит её здесь и не
             гадает, почему форма получает 400 consent_version. */
          consentVersion: env.CONSENT_VERSION ?? null,
          kv: Boolean(env.KADRY_KV),
          /* Приём отзывов и подписи файлов: смоук по этим полям понимает, что
             сборка доехала целиком. */
          ...reviewsHealth(env),
          ...liveReviewsHealth(env),
          files: Boolean(env.TEMPLATES) && Boolean(signingSecret(env)),
        }));
      }

      if (req.method === 'GET' && url.pathname.startsWith('/files/')) {
        const token = decodeURIComponent(url.pathname.slice('/files/'.length));
        const checked = await verifyFileToken(env, token);
        if (!checked.ok) {
          const message = checked.reason === 'expired'
            ? 'Срок действия ссылки истёк. Напишите Марии — вышлем файл заново.'
            : checked.reason === 'no_secret'
              ? 'Выдача файлов ещё не настроена.'
              : 'Ссылка неверная или устаревшая.';
          return withCors(new Response(JSON.stringify({ error: checked.reason, message }), {
            status: checked.reason === 'expired' ? 410 : 404,
            headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
          }));
        }
        /* Файл отдаём без CORS-обвязки: браузер скачивает его переходом, а не fetch. */
        return serveFile(env, checked.id);
      }

      if (req.method === 'POST' && url.pathname === '/leads') return withCors(await handleLead(req, env));

      if (req.method === 'POST' && url.pathname === '/reviews') {
        return withCors(await handleReview(req, env, { hashIp, store: reviewStore(env) }));
      }
      /* Живые отзывы: публичный список для страниц сайта и модерация по ключу. */
      const live = await handleLiveReviews(req, url, env, reviewStore(env));
      if (live) return withCors(live);

      return withCors(err(404, 'not_found', 'Неизвестный адрес'));
    } catch (e) {
      console.error('[relay] unhandled', String((e as Error)?.stack ?? e).slice(0, 400));
      return withCors(err(500, 'internal', 'Внутренняя ошибка сервиса. Позвоните нам, пожалуйста.'));
    }
  },
};
