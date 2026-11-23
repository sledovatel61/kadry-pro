/**
 * Единственный адрес приёмника заявок на весь сайт (Агент 03).
 *
 * Без `PUBLIC_LEADS_ENDPOINT` сайт остаётся честной статикой: формы показывают
 * телефон и не отправляют данные никуда. С `PUBLIC_LEADS_ENDPOINT=https://…`
 * заявки, отзывы и ссылки на файлы идут напрямую в Cloudflare Worker (`relay/`),
 * а сайт по-прежнему живёт на GitHub Pages.
 *
 * Здесь же — версия согласия (её проверяет воркер), формат адреса (только https,
 * без хвостового слэша), таймаут запроса и разбор `Retry-After`.
 */

/** Версия согласия на обработку персональных данных. Меняется вместе с consent.html
 *  и `CONSENT_VERSION` в `relay/wrangler.toml` — иначе заявка получит 400. */
export const CONSENT_VERSION = '2026-11-21';

/** Сколько ждём ответа приёмника, прежде чем показать экран с телефоном. */
export const LEADS_TIMEOUT_MS = 12_000;

export interface LeadsEndpointInfo {
  /** Нормализованная база без хвостового слэша; пустая строка — работаем без приёмника. */
  base: string;
  /** Текст ошибки конфигурации (тогда база пустая и заявки не уходят). */
  error: string | null;
}

/**
 * Разбирает значение переменной сборки. Пустое значение — не ошибка: это режим
 * «только телефон».
 */
export function parseLeadsEndpoint(raw: string | null | undefined): LeadsEndpointInfo {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return { base: '', error: null };
  if (/\s/.test(value)) return { base: '', error: 'адрес приёмника содержит пробел' };
  if (!value.toLowerCase().startsWith('https://')) {
    return { base: '', error: 'адрес приёмника должен начинаться с https://' };
  }
  const base = value.replace(/\/+$/, '');
  const rest = base.slice('https://'.length);
  if (!rest) return { base: '', error: 'в адресе приёмника нет хоста' };
  if (/[?#]/.test(rest)) return { base: '', error: 'адрес приёмника не должен содержать ? или #' };
  if (!/^[a-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~-]+)*$/i.test(rest)) {
    return { base: '', error: 'в адресе приёмника недопустимые символы' };
  }
  return { base, error: null };
}

/** Значение из сборки: Vite подставляет его только в каноническую запись. */
function fromBuildEnv(): string {
  try {
    /* `import.meta.env` есть в Astro/Vite и нет в Node — поэтому без `?.` на импорте. */
    const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
    const value = env?.PUBLIC_LEADS_ENDPOINT;
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

/** Значение из process.env — для скриптов сборки, гейтов и тестов. */
function fromNodeEnv(): string {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const value = proc?.env?.PUBLIC_LEADS_ENDPOINT;
  return typeof value === 'string' ? value : '';
}

/** Сырое значение переменной: сначала сборка, потом окружение Node. */
export function leadsEndpointRaw(): string {
  return fromBuildEnv() || fromNodeEnv();
}

const parsed = parseLeadsEndpoint(leadsEndpointRaw());

/** База приёмника без хвостового слэша; '' — заявки не отправляются. */
export const LEADS_BASE = parsed.base;

/** Ошибка конфигурации адреса (если была) — её печатает `check-leads-config`. */
export const LEADS_ENDPOINT_ERROR = parsed.error;

/** true — заявки идут в прослойку; false — сайт работает без приёмника. */
export const relayMode = LEADS_BASE !== '';

export type LeadsResource = 'leads' | 'reviews' | 'files';

/**
 * Адрес ресурса для заданной базы (чистая функция — её проверяют тесты).
 * `buildLeadsUrl('', 'leads')` → `/api/leads`
 * `buildLeadsUrl('https://worker', 'leads')` → `https://worker/leads`
 */
export function buildLeadsUrl(base: string, resource: LeadsResource, query?: string): string {
  const tail = query ? `?${query}` : '';
  return base ? `${base}/${resource}${tail}` : `/api/${resource}${tail}`;
}

/** Адрес ресурса в текущем режиме сборки. */
export function leadsUrl(resource: LeadsResource, query?: string): string {
  return buildLeadsUrl(LEADS_BASE, resource, query);
}

/** Абсолютный адрес скачивания: воркер возвращает относительный `/files/…`. */
export function absoluteLeadsUrl(base: string, path: string): string {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return base ? `${base}${path.startsWith('/') ? '' : '/'}${path}` : path;
}

/**
 * fetch с таймаутом. Приёмник может «зависнуть» — без ограничения человек
 * смотрит на «Отправляем…» бесконечно. По таймауту бросаем AbortError,
 * формы показывают обычный экран с телефоном.
 */
export async function leadsFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = LEADS_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Секунды из Retry-After (число секунд или дата); null — заголовка нет/он кривой. */
export function retryAfterSeconds(header: string | null): number | null {
  if (!header) return null;
  const raw = header.trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.round((at - Date.now()) / 1000));
}

/** Универсальный UUID v4 для идемпотентности: crypto есть везде, где есть fetch. */
export function makeIdempotencyKey(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Нормализация телефона ровно как на воркере: `8…`, `+7…`, скобки, дефисы. */
export function normalizePhone(raw: string): string {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 10) d = '7' + d;
  if (d.startsWith('8') && d.length === 11) d = '7' + d.slice(1);
  return d ? `+${d}` : '';
}

/* ------------------------------------------------------------------ *
 *  Разбор ошибок приёмника — общий для формы заявки и формы отзыва.
 *  Приёмник отвечает и плоским видом { error, fields }, и вложенным
 *  { error: { code, fields } } — понимаем оба, иначе человек увидит
 *  «Неизвестная ошибка» вместо «Проверьте телефон».
 * ------------------------------------------------------------------ */

export interface ApiFailure {
  code: string;
  message: string;
  fields: Record<string, string>;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** `{…:'code'}` или `{…:['code']}` → `{…:'code'}`; прочее игнорируем. */
export function normalizeFields(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const obj = asObject(value);
  if (!obj) return out;
  for (const [key, raw] of Object.entries(obj)) {
    if (typeof raw === 'string' && raw) out[key] = raw;
    else if (Array.isArray(raw) && typeof raw[0] === 'string' && raw[0]) out[key] = raw[0];
  }
  return out;
}

/**
 * Плоский `{error:'code', message?, fields?}` и вложенный
 * `{error:{code?,message?,fields?}}` → один вид. Всё остальное — `null`.
 */
export function parseApiFailure(payload: unknown): ApiFailure | null {
  const obj = asObject(payload);
  if (!obj) return null;

  const message = typeof obj.message === 'string' ? obj.message : '';
  const rawError = obj.error;

  if (typeof rawError === 'string' && rawError) {
    return { code: rawError, message, fields: normalizeFields(obj.fields) };
  }
  const nested = asObject(rawError);
  if (nested) {
    return {
      code: typeof nested.code === 'string' ? nested.code : 'error',
      message: typeof nested.message === 'string' ? nested.message : message,
      fields: normalizeFields(nested.fields),
    };
  }
  /* Ответ без `error`, но с полями — тоже ошибка валидации. */
  const fields = normalizeFields(obj.fields);
  if (Object.keys(fields).length > 0) return { code: 'validation', message, fields };
  return null;
}

/* ------------------------------------------------------------------ *
 *  Расчёт калькулятора → скрытые поля формы заявки.
 *  Человек нажал «Зафиксировать этот расчёт»: в заявку уходят штат,
 *  зарплата, тариф и экономия, чтобы в Telegram было видно цифры.
 * ------------------------------------------------------------------ */

export interface CalcSummary {
  staff: number;
  salary_net: number;
  tariff: string;
  savings_month: number;
  savings_year: number;
}

/** Минимум от `document`: калькулятор читается и в браузере, и в тестах. */
type Doc = {
  querySelector<T extends Element = Element>(selector: string): T | null;
  querySelectorAll<T extends Element = Element>(selector: string): ArrayLike<T>;
};

const num = (raw: string | null | undefined): number => {
  if (!raw) return 0;
  /* «58 345 ₽», «58 345,00» и «58,345.00» → 58345 / 58345. */
  const cleaned = String(raw)
    .replace(/[^\d,.\-]/g, '')
    .replace(/\s|\u00a0|\u202f/g, '');
  if (!cleaned) return 0;
  const normalized = cleaned.includes(',') && !cleaned.includes('.')
    ? cleaned.replace(',', '.')
    : cleaned.replace(/,/g, '');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
};

/**
 * Число из элемента: `data-value`, `content`, значение поля (`value`) или текст.
 * Порядок важен: у скрытого поля есть `value`, но нет текста, а у карточки тарифа
 * наоборот — без `value` расчёт экономии уходил бы нулём.
 */
function attrNumber(doc: Doc, selector: string): number {
  const el = doc.querySelector<HTMLElement>(selector);
  if (!el) return 0;
  const value = (el as HTMLInputElement).value;
  for (const raw of [
    el.getAttribute('data-value'),
    el.getAttribute('content'),
    typeof value === 'string' ? value : '',
    el.textContent,
  ]) {
    const parsed = num(raw);
    if (parsed > 0) return parsed;
  }
  return 0;
}

function inputNumber(doc: Doc, selectors: string[]): number {
  for (const sel of selectors) {
    const el = doc.querySelector<HTMLInputElement | HTMLSelectElement>(sel);
    if (!el) continue;
    const value = num(el.value);
    if (value > 0) return value;
  }
  return 0;
}

/** Выбранный тариф: значение select или подпись активной карточки/таба. */
function selectedTariff(doc: Doc): string {
  const select = doc.querySelector<HTMLSelectElement>('[data-calc-tariff-select], #calc-tariff, select[name="tariff"]');
  if (select) {
    const option = select.options[select.selectedIndex];
    const text = (option?.textContent ?? select.value).trim();
    if (text) return text;
  }
  const active = doc.querySelector<HTMLElement>('[data-tariff].is-active, .tier-card.active, [data-tariff-active]');
  if (active) {
    const text = (active.getAttribute('data-tariff-name') ?? active.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text) return text.slice(0, 60);
  }
  const explicit = doc.querySelector<HTMLElement>('[data-calc-tariff]');
  const text = (explicit?.getAttribute('data-value') ?? explicit?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text.slice(0, 60);
}

/** Экономия по подписи: ближайший блок с «экономи» и число в нём. */
function savingsByLabel(doc: Doc): { month: number; year: number } {
  let month = 0;
  let year = 0;
  const candidates = doc.querySelectorAll<HTMLElement>('[data-calc-result], .calc-result, .calculator-result, #calculator, .calculator');
  const roots = Array.from(candidates);
  for (const root of roots) {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
      if (el.children.length > 2) continue;
      const text = (el.textContent ?? '').replace(/\s+/g, ' ');
      if (!/экономи|выгод/i.test(text)) continue;
      const match = text.match(/([\d\s\u00a0\u202f.,]{3,})\s*₽/);
      if (!match) continue;
      const value = num(match[1]);
      if (value <= 0) continue;
      if (/год|12\s*мес/i.test(text)) year = year || value;
      else month = month || value;
    }
  }
  return { month, year };
}

/**
 * Собрать расчёт со страницы. `null` — данных не хватило (нет штата или зарплаты).
 */
export function collectCalcSummary(doc: Doc): CalcSummary | null {
  const staff = attrNumber(doc, '[data-calc-staff]')
    || inputNumber(doc, ['#staff-count', '#staff', '#calc-staff', 'input[name="staff"]', 'select[name="staff"]']);
  const salary = attrNumber(doc, '[data-calc-salary]')
    || inputNumber(doc, ['#salary', '#calc-salary', '#salary-net', 'input[name="salary"]']);
  const tariff = selectedTariff(doc)
    || (doc.querySelector<HTMLElement>('[data-calc-tariff]')?.textContent ?? '').trim();

  const byLabel = savingsByLabel(doc);
  let savingsMonth = attrNumber(doc, '[data-calc-savings-month]') || byLabel.month;
  let savingsYear = attrNumber(doc, '[data-calc-savings-year]') || byLabel.year;
  if (!savingsMonth && savingsYear) savingsMonth = Math.round(savingsYear / 12);
  if (!savingsYear && savingsMonth) savingsYear = savingsMonth * 12;

  if (!staff || !salary) return null;

  return {
    staff: Math.round(staff),
    salary_net: Math.round(salary),
    tariff: tariff || 'по расчёту',
    savings_month: Math.round(savingsMonth),
    savings_year: Math.round(savingsYear),
  };
}
