/**
 * Отправка заявки и уведомления об отзыве в Telegram-группу Марии.
 *
 * Один бот, одна группа: и заявки, и отзывы падают в один чат, чтобы владельцу
 * не приходилось смотреть в два места. Разметка — HTML, текст пишут люди с
 * улицы, поэтому всё экранируется.
 */
import type { LeadPayload, TemplatePackage } from './validate.ts';
import type { ReviewPayload } from './reviews-validate.ts';
import { resolveTemplateNotice } from './paid-templates.ts';

const esc = (s: string): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escAttr = (s: string): string =>
  esc(s).replace(/"/g, '&quot;');

/** +79613022112 → +7 (961) 302-21-12 — так номер читается и набирается с телефона. */
export function fmtPhone(normalized: string): string {
  const d = normalized.replace(/\D/g, '');
  if (d.length !== 11) return normalized;
  return `+${d[0]} (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** метка времени → «18 ноя, 20:15» (МСК) */
export function fmtStamp(at: Date): string {
  const msk = new Date(at.getTime() + 3 * 3600_000);
  const hh = String(msk.getUTCHours()).padStart(2, '0');
  const mm = String(msk.getUTCMinutes()).padStart(2, '0');
  return `${msk.getUTCDate()} ${MONTHS[msk.getUTCMonth()]}, ${hh}:${mm}`;
}

const rub = (n: number): string => `${n.toLocaleString('ru-RU')} ₽`;

const CONTACT_LABEL: Record<string, string> = {
  call: 'звонок',
  telegram: 'писать в Telegram',
  whatsapp: 'писать в WhatsApp',
  max: 'писать в MAX',
};

const PACKAGE_LABEL: Record<TemplatePackage, string> = {
  single: 'один шаблон',
  email: 'пакет 25 шаблонов за email',
  full: 'полный пакет 64 документа',
  free: 'бесплатный шаблон',
};

export interface ComposeOpts {
  siteName: string;
  address?: string;
  at?: Date;
  /**
   * Почему заявка помечена как подозрительная (`hidden-field`, `too-fast`).
   * Не блокирует доставку: владелец получает заявку с видимой пометкой и сам
   * решает, спам это или живой человек с автозаполнением.
   */
  suspicious?: string[];
}

export function composeTelegram(lead: LeadPayload, ticket: string, opts: ComposeOpts): string {
  const at = opts.at ?? new Date();
  const common = [
    `\nИмя: <b>${esc(lead.name)}</b>`,
    `\nТелефон: <b>${esc(fmtPhone(lead.phone))}</b> (${CONTACT_LABEL[lead.contact_method] ?? 'звонок'})`,
  ];
  /* Журнал согласий: в уведомлении видно, на какой версии документа человек
     поставил галочку и когда. Отдельной базы у прослойки нет и не нужно. */
  const consent = `\nСогласие на обработку ПД: версия <b>${esc(lead.consent_version)}</b>, отметка ${esc(fmtStamp(at))} МСК`;
  const footer = `\n\n<b>${esc(ticket)}</b> · ${esc(fmtStamp(at))} МСК`;
  const page = `\nСтраница: ${esc(lead.page)}`;
  /* Пометка «проверить» — первой строкой, до имени: её должно быть видно
     в превью уведомления, не разворачивая сообщение. */
  const warn = opts.suspicious?.length
    ? `\n⚠️ <b>Проверить на спам</b> (${esc(opts.suspicious.join(', '))}) — заявка не отброшена, потому что поле мог заполнить автозаполнитель`
    : '';

  if (lead.kind === 'calculator') {
    const c = lead.calc;
    return [
      '🧮 <b>Расчёт с калькулятора</b>',
      warn,
      ...common,
      `\nШтат: <b>${c.staff}</b> чел.`,
      `\nЗарплата «на руки»: <b>${rub(c.salary_net)}</b>/мес`,
      `\nВыбранный тариф: <b>${esc(c.tariff)}</b>`,
      `\nЭкономия по расчёту: <b>${rub(c.savings_month)}</b>/мес · <b>${rub(c.savings_year)}</b>/год`,
      lead.message ? `\nКомментарий: ${esc(lead.message)}` : '',
      page,
      consent,
      footer,
    ].join('');
  }

  if (lead.kind === 'template') {
    const t = lead.template;
    const resolved = resolveTemplateNotice(t);
    return [
      '📄 <b>Заявка на шаблон</b>',
      warn,
      ...common,
      `\nШаблон: <b>${esc(resolved.title)}</b>${resolved.id ? ` (ID: <code>${esc(resolved.id)}</code>)` : ''}`,
      `\nПакет: <b>${PACKAGE_LABEL[t.package] ?? esc(t.package)}</b>`,
      resolved.price !== null
        ? `\nЦена на сайте (по каталогу): <b>${rub(resolved.price)}</b>`
        : '\nЦена по каталогу: <b>не подтверждена (неизвестный ID)</b>',
      lead.email ? `\nПочта: ${esc(lead.email)}` : '',
      lead.message ? `\nКомментарий: ${esc(lead.message)}` : '',
      resolved.githubUrl && resolved.filename
        ? `\nФайл для Марии: <a href="${escAttr(resolved.githubUrl)}">${esc(resolved.filename)}</a>\nПрямая ссылка: ${esc(resolved.githubUrl)}`
        : '',
      resolved.linkNote ? `\nℹ️ <i>${esc(resolved.linkNote)}</i>` : '',
      page,
      consent,
      footer,
    ].join('');
  }

  return [
    lead.kind === 'subscribe' ? '✉️ <b>Заявка из статьи</b>' : '💬 <b>Заявка с сайта</b>',
    warn,
    ...common,
    lead.company ? `\nКомпания: ${esc(lead.company)}` : '',
    lead.email ? `\nПочта: ${esc(lead.email)}` : '',
    lead.service ? `\nУслуга: ${esc(lead.service)}` : '',
    lead.message ? `\nСообщение: ${esc(lead.message)}` : '',
    page,
    consent,
    footer,
  ].join('');
}

export interface SendOpts {
  token: string;
  chatId: string;
  apiBase?: string;
  /** для тестов; по умолчанию настоящий fetch */
  fetchImpl?: typeof fetch;
}

/** Одна попытка + один повтор на 5xx/429/сеть. Бросает Error с коротким кодом. */
export async function sendTelegram(text: string, opts: SendOpts): Promise<void> {
  const base = (opts.apiBase ?? 'https://api.telegram.org').replace(/\/$/, '');
  const doFetch = opts.fetchImpl ?? fetch;
  /* Свой таймаут на попытку. Клиент сдаётся через 12 с (LEADS_TIMEOUT_MS), а
     две попытки без таймаута легко дают 20+ с: посетитель видит ошибку, хотя
     заявка уже ушла, и отправляет её снова. 4 с — с запасом на p95 Telegram. */
  const ATTEMPT_MS = 4000;
  const url = `${base}/bot${opts.token}/sendMessage`;
  const body = JSON.stringify({
    chat_id: opts.chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  });

  let lastErr = 'unknown';
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400));
    let res: Response;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    /* Гонка «запрос против таймера»: одного AbortSignal мало — апстрим,
       который игнорирует сигнал, держал бы нас бесконечно. */
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctrl.abort();
        reject(new Error('timeout'));
      }, ATTEMPT_MS);
    });
    try {
      res = await Promise.race([
        doFetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: ctrl.signal,
        }),
        timeout,
      ]);
    } catch (e) {
      /* AbortError и таймаут — тоже «сеть»: на повтор уходит следующая попытка. */
      lastErr = `network:${(e as Error)?.name ?? 'error'}`;
      continue;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (res.ok) return;
    lastErr = `http:${res.status}`;
    if (res.status !== 429 && res.status < 500) break; // 4xx — повторять бессмысленно
  }
  throw new Error(`telegram_${lastErr}`);
}

/**
 * Уведомление о новом отзыве. Отзыв УЖЕ опубликован — сообщение не задача
 * «одобрить», а сигнал «посмотри, при необходимости спрячь кнопкой в /manage/».
 */
export function composeReviewTelegram(review: ReviewPayload, opts: ComposeOpts): string {
  const at = opts.at ?? new Date();
  const stars = '⭐'.repeat(review.rating);
  return [
    '⭐ <b>Новый отзыв с сайта (уже опубликован)</b>',
    `\nОценка: <b>${review.rating}/5</b> ${stars}`,
    `\nИмя: <b>${esc(review.author)}</b>`,
    `\nОтзыв:\n${esc(review.text)}`,
    `\nИсточник: ${esc(review.page)}`,
    `\nСогласие на обработку ПД: версия <b>${esc(review.consentVersion)}</b>, отметка ${esc(fmtStamp(at))} МСК`,
    '\n<i>Спам или грубость — скрыть: /manage/ → Отзывы</i>',
  ].join('');
}
