/**
 * Отправка заявки и уведомления об отзыве в Telegram-группу Марии.
 *
 * Один бот, одна группа: и заявки, и отзывы падают в один чат, чтобы владельцу
 * не приходилось смотреть в два места. Разметка — HTML, текст пишут люди с
 * улицы, поэтому всё экранируется.
 */
import type { LeadPayload, TemplatePackage } from './validate.ts';
import type { ReviewPayload } from './reviews-validate.ts';

const esc = (s: string): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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

  if (lead.kind === 'calculator') {
    const c = lead.calc;
    return [
      '🧮 <b>Расчёт с калькулятора</b>',
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
    return [
      '📄 <b>Заявка на шаблон</b>',
      ...common,
      `\nШаблон: <b>${esc(t.title)}</b>${t.id ? ` (${esc(t.id)})` : ''}`,
      `\nПакет: <b>${PACKAGE_LABEL[t.package] ?? t.package}</b>`,
      t.price !== null ? `\nЦена: <b>${rub(t.price)}</b>` : '',
      lead.email ? `\nПочта: ${esc(lead.email)}` : '',
      page,
      consent,
      footer,
    ].join('');
  }

  return [
    lead.kind === 'subscribe' ? '✉️ <b>Заявка из статьи</b>' : '💬 <b>Заявка с сайта</b>',
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
    try {
      res = await doFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    } catch (e) {
      lastErr = `network:${(e as Error)?.name ?? 'error'}`;
      continue;
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
