/**
 * Защищённая выдача шаблонов: подписанная ссылка на скачивание.
 *
 * Зачем: платные PDF (500 ₽), email-пакет (25 шаблонов) и полный пакет (64 шт.)
 * не должны лежать в открытой папке `/shablony/` — их скачивают бесплатно по
 * прямой ссылке и из поиска. Поэтому полные файлы живут в приватном бакете
 * Cloudflare R2, а воркер выдаёт их по ссылке вида:
 *
 *   GET /files/<id>.<exp>.<подпись>
 *
 * где подпись — HMAC-SHA256 от `id|exp` секретом `FILE_TOKEN_SECRET`. Ссылка
 * живёт сутки, повторно использовать её через год нельзя, а подобрать подпись
 * без секрета — нельзя вовсе.
 *
 * Пока бакет не подключён (`TEMPLATES` нет), `/files` честно отвечает 404:
 * воркер ничего не выдумывает и не отдаёт файлов, которых у него нет.
 */

/** Сколько живёт ссылка на скачивание. */
export const FILE_LINK_TTL_SEC = 24 * 3600;

/** Разрешённые имена файлов: тот же вид, что у PDF в каталоге шаблонов. */
const FILE_ID_RE = /^[a-z0-9][a-z0-9_-]{1,80}$/;

export interface FilesEnv {
  FILE_TOKEN_SECRET?: string;
  /** Соль-запасной вариант: если отдельного секрета нет, подписываем токеном бота. */
  BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  /** Приватный бакет R2 с полными шаблонами. Необязателен. */
  TEMPLATES?: R2Like;
}

export interface R2Like {
  get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string }; size?: number } | null>;
}

export interface FileObject {
  /** Имя файла в бакете без расширения: `full-bundle-64`, `email-bundle-25`, `t02-srochnyy-trudovoy`. */
  id: string;
  /** Как файл называется при скачивании. */
  name: string;
}

export const FILE_KIND_LABEL: Record<string, string> = {
  'email-bundle-25': 'Пакет 25 шаблонов (за email)',
  'full-bundle-64': 'Полный пакет 64 документа',
};

/** Секрет подписи. Отдельный секрет важнее: токен бота не должен гулять по ссылкам. */
export function signingSecret(env: FilesEnv): string {
  const own = (env.FILE_TOKEN_SECRET ?? '').trim();
  if (own) return own;
  /* Если отдельного секрета нет, подмешиваем chat id — он не секрет, но
     гарантирует, что подпись не совпадёт с подписью другого воркера. */
  const bot = (env.BOT_TOKEN ?? '').trim();
  if (bot) return `kadry-files:${bot}:${(env.TELEGRAM_CHAT_ID ?? '').trim()}`;
  return '';
}

const enc = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Сравнение подписей без раннего выхода. */
function sameSig(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Подписанный токен: `<id>.<exp>.<подпись>`. Без секрета токен не создать —
 * возвращаем пустую строку, и вызывающий код честно скажет «ссылки нет».
 */
export async function signFileToken(env: FilesEnv, id: string, now: Date = new Date()): Promise<string> {
  const secret = signingSecret(env);
  if (!secret) return '';
  if (!FILE_ID_RE.test(id)) return '';
  const exp = Math.floor(now.getTime() / 1000) + FILE_LINK_TTL_SEC;
  const sig = await hmacHex(secret, `${id}|${exp}`);
  return `${id}.${exp}.${sig}`;
}

export type VerifyResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'bad_token' | 'expired' | 'no_secret' };

/** Проверка токена: формат, срок, подпись — в этом порядке. */
export async function verifyFileToken(env: FilesEnv, token: string, now: Date = new Date()): Promise<VerifyResult> {
  const secret = signingSecret(env);
  if (!secret) return { ok: false, reason: 'no_secret' };
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return { ok: false, reason: 'bad_token' };
  const [id, expRaw, sig] = parts;
  if (!FILE_ID_RE.test(id) || !/^\d{1,12}$/.test(expRaw)) return { ok: false, reason: 'bad_token' };
  const exp = Number(expRaw);
  if (exp * 1000 <= now.getTime()) return { ok: false, reason: 'expired' };
  const expect = await hmacHex(secret, `${id}|${exp}`);
  if (!sameSig(sig, expect)) return { ok: false, reason: 'bad_token' };
  return { ok: true, id };
}

/** Как назвать файл при скачивании: `full-bundle-64` → `kadry-pro-64-shablona.pdf`. */
export function downloadName(id: string): string {
  if (id === 'full-bundle-64') return 'kadry-pro-64-shablona.pdf';
  if (id === 'email-bundle-25') return 'kadry-pro-25-shablonov.pdf';
  return `${id}.pdf`;
}

/**
 * Отдача файла из бакета. Нет бакета, нет файла — 404 с понятным текстом
 * (JSON: клиент — браузер пользователя, но ответ всё равно машинный).
 */
export async function serveFile(env: FilesEnv, id: string): Promise<Response> {
  const headersBase = { 'cache-control': 'private, no-store', 'content-type': 'application/json; charset=utf-8' };
  if (!env.TEMPLATES) {
    return new Response(JSON.stringify({ error: 'files_not_configured', message: 'Файлы пока выдаются только по запросу — напишите Марии.' }), { status: 404, headers: headersBase });
  }
  const object = await env.TEMPLATES.get(`${id}.pdf`);
  if (!object) {
    return new Response(JSON.stringify({ error: 'not_found', message: 'Файл не найден. Напишите Марии — вышлем вручную.' }), { status: 404, headers: headersBase });
  }
  const name = encodeURIComponent(downloadName(id));
  return new Response(object.body, {
    status: 200,
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/pdf',
      'content-disposition': `attachment; filename*=UTF-8''${name}`,
      'cache-control': 'private, max-age=3600',
      ...(object.size ? { 'content-length': String(object.size) } : {}),
    },
  });
}
