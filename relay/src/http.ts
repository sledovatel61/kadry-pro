/**
 * Мелкие помощники, общие для заявок и отзывов:
 *   - `json` / `err` с одинаковыми заголовками (без кэша);
 *   - `hashIp` — IP не должен встречаться в KV и логах открытым;
 *   - `sameKey` — сравнение кодов без раннего выхода;
 *   - чтение тела запроса с потолком по размеру.
 */

export const json = (data: unknown, status = 200, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });

export const err = (
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>,
  extra: Record<string, string> = {},
): Response => json({ error: { code, message, ...(fields ? { fields } : {}) } }, status, extra);

/** SHA-256 первых 8 байт от IP: в логах и KV не должно быть открытых адресов. */
export async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(`kadry-leads:${ip}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Сравнение кодов без раннего выхода: длина и символы проверяются целиком. */
export function sameKey(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type BodyResult = { ok: true; text: string } | { ok: false; reason: 'too_large' | 'bad_body' };

/**
 * Тело не читаем целиком, если оно заведомо больше лимита: сначала смотрим на
 * `content-length`, потом режем поток по счётчику.
 */
export async function readBodyLimited(req: Request, maxBytes: number): Promise<BodyResult> {
  const len = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(len) && len > maxBytes) return { ok: false, reason: 'too_large' };
  if (!req.body) return { ok: true, text: '' };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* поток уже закрыт — не наша забота */ }
      return { ok: false, reason: 'too_large' };
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(all) };
  } catch {
    return { ok: false, reason: 'bad_body' };
  }
}
