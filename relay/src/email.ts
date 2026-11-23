/**
 * Дублирование заявки на почту.
 *
 * Cloudflare Worker не умеет ходить в SMTP (порт 25 закрыт, а TLS-хендшейк
 * руками — лишний риск), поэтому письмо отправляется через HTTP-API почтового
 * сервиса. Поддерживаются два, включается тот, чей ключ лежит в секретах:
 *
 *   BREVO_API_KEY  — Brevo (https://brevo.com): домен не нужен, достаточно
 *                    подтвердить отправителя (single sender);
 *   RESEND_API_KEY — Resend (https://resend.com): нужен подтверждённый домен,
 *                    зато письма красивые и с DKIM.
 *
 * Если ключа нет — почта просто выключена, заявки идут только в Telegram, а
 * `/health` показывает `email: null`. Секреты задаются в GitHub (Settings →
 * Secrets): их прокидывает workflow `.github/workflows/relay.yml`.
 */
import type { LeadPayload, TemplatePackage } from './validate.ts';
import type { ReviewPayload } from './reviews-validate.ts';
import { fmtPhone } from './telegram.ts';

export const DEFAULT_EMAIL_TO = 'm.perepechay@yandex.ru';

export type EmailProvider = 'resend' | 'brevo';

export interface EmailEnv {
  RESEND_API_KEY?: string;
  BREVO_API_KEY?: string;
  EMAIL_TO?: string;
  EMAIL_FROM?: string;
}

export interface EmailOpts {
  siteName: string;
  address?: string;
  at?: Date;
  to?: string;
  from?: string;
}

/** Провайдер по наличию ключа. Brevo в приоритете: у него нет ограничения на получателя. */
export function emailProvider(env: EmailEnv): EmailProvider | null {
  if (env.BREVO_API_KEY) return 'brevo';
  if (env.RESEND_API_KEY) return 'resend';
  return null;
}

const escHtml = (s: string): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const MONTHS_FULL = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** 21 ноября 2026, 12:15 (МСК) */
export function fmtMailStamp(at: Date): string {
  const msk = new Date(at.getTime() + 3 * 3600_000);
  const hh = String(msk.getUTCHours()).padStart(2, '0');
  const mm = String(msk.getUTCMinutes()).padStart(2, '0');
  return `${msk.getUTCDate()} ${MONTHS_FULL[msk.getUTCMonth()]} ${msk.getUTCFullYear()}, ${hh}:${mm} (МСК)`;
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

export interface ComposedEmail {
  subject: string;
  text: string;
  html: string;
}

/** Письмо-дубль: те же данные, что и в Telegram, но читаемо в почте. */
export function composeEmail(lead: LeadPayload, ticket: string, opts: EmailOpts): ComposedEmail {
  const at = opts.at ?? new Date();
  const stamp = fmtMailStamp(at);

  const rows: [string, string][] = [
    ['Заявка', ticket],
    ['Время', stamp],
    ['Имя', lead.name],
    ['Телефон', `${fmtPhone(lead.phone)} (${CONTACT_LABEL[lead.contact_method] ?? 'звонок'})`],
    ['Страница', lead.page],
    ['Согласие', `версия ${lead.consent_version}, отметка ${stamp}`],
  ];

  let subjectBase = 'Заявка с сайта';
  if (lead.kind === 'calculator') {
    subjectBase = 'Расчёт с калькулятора';
    rows.push(['Штат', `${lead.calc.staff} чел.`]);
    rows.push(['Зарплата «на руки»', `${rub(lead.calc.salary_net)}/мес`]);
    rows.push(['Тариф', lead.calc.tariff]);
    rows.push(['Экономия', `${rub(lead.calc.savings_month)}/мес · ${rub(lead.calc.savings_year)}/год`]);
    if (lead.message) rows.push(['Комментарий', lead.message]);
  } else if (lead.kind === 'template') {
    subjectBase = `Заявка на шаблон: ${lead.template.title}`;
    rows.push(['Шаблон', `${lead.template.title}${lead.template.id ? ` (${lead.template.id})` : ''}`]);
    rows.push(['Пакет', PACKAGE_LABEL[lead.template.package] ?? lead.template.package]);
    if (lead.template.price !== null) rows.push(['Цена', rub(lead.template.price)]);
    if (lead.email) rows.push(['Почта', lead.email]);
  } else {
    if (lead.company) rows.push(['Компания', lead.company]);
    if (lead.email) rows.push(['Почта', lead.email]);
    if (lead.service) rows.push(['Услуга', lead.service]);
    if (lead.message) rows.push(['Сообщение', lead.message]);
  }

  const subject = `${subjectBase} — ${lead.name}, ${fmtPhone(lead.phone)} · ${ticket}`;

  const text = [
    subjectBase.toUpperCase(),
    opts.siteName + (opts.address ? `, ${opts.address}` : ''),
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    'Ответить клиенту: ' + fmtPhone(lead.phone),
  ].join('\n');

  const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>${escHtml(subject)}</title></head>
<body style="margin:0;padding:24px;background:#0a0a0a;color:#f2f5f2;font:16px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#141414;border:1px solid #2a2a2a;border-radius:12px">
    <tr><td style="padding:22px 24px 6px">
      <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#9aa59d">
        ${escHtml(subjectBase)} · ${escHtml(opts.siteName)}
      </div>
      <div style="font-size:22px;font-weight:700;margin-top:6px;color:#4ade80">${escHtml(ticket)}</div>
    </td></tr>
    <tr><td style="padding:10px 24px 4px">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">
        ${rows.map(([k, v]) => `<tr>
          <td style="padding:7px 0;color:#9aa59d;font-size:14px;vertical-align:top;width:38%">${escHtml(k)}</td>
          <td style="padding:7px 0;font-size:15px;vertical-align:top;white-space:pre-wrap">${escHtml(v)}</td>
        </tr>`).join('')}
      </table>
    </td></tr>
    <tr><td style="padding:14px 24px 22px">
      <a href="tel:${escHtml(lead.phone)}" style="display:inline-block;padding:11px 18px;border-radius:10px;background:#4ade80;color:#0a0a0a;text-decoration:none;font-weight:700">
        Позвонить ${escHtml(fmtPhone(lead.phone))}
      </a>
    </td></tr>
  </table>
  <p style="max-width:640px;margin:14px auto 0;color:#6f7a72;font-size:12px">
    Письмо-дубль заявки с сайта kadry-pro.ru. Копия отправлена в Telegram.
  </p>
</body></html>`;

  return { subject, text, html };
}

export interface SendEmailArgs {
  lead: LeadPayload;
  ticket: string;
  env: EmailEnv;
  opts: EmailOpts;
  /** для тестов; по умолчанию настоящий fetch */
  fetchImpl?: typeof fetch;
}

export interface SentEmail {
  provider: EmailProvider;
  to: string;
}

export function emailFrom(env: EmailEnv, to: string): string {
  const own = (env.EMAIL_FROM ?? '').trim();
  if (own) return own;
  /* Resend без подтверждённого домена разрешает писать только самому себе с
     onboarding@resend.dev. Brevo требует подтверждённого отправителя, поэтому
     там по умолчанию берём ящик получателя. */
  return emailProvider(env) === 'resend' ? 'Кадры-Про <onboarding@resend.dev>' : to;
}

async function postWithRetry(
  doFetch: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  provider: EmailProvider,
): Promise<void> {
  let lastErr = 'unknown';
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500));
    let res: Response;
    try {
      res = await doFetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (e) {
      lastErr = `network:${(e as Error)?.name ?? 'error'}`;
      continue;
    }
    if (res.ok) return;
    lastErr = `http:${res.status}`;
    /* 4xx — ошибка в ключе/отправителе/адресе: повторять бессмысленно и вредно. */
    if (res.status !== 429 && res.status < 500) break;
  }
  throw new Error(`email_${provider}_${lastErr}`);
}

export async function sendEmail(args: SendEmailArgs): Promise<SentEmail> {
  const provider = emailProvider(args.env);
  if (!provider) throw new Error('email_not_configured');

  const to = (args.env.EMAIL_TO ?? args.opts.to ?? DEFAULT_EMAIL_TO).trim();
  const from = emailFrom(args.env, to);
  const { subject, text, html } = composeEmail(args.lead, args.ticket, args.opts);
  const doFetch = args.fetchImpl ?? fetch;

  if (provider === 'resend') {
    await postWithRetry(doFetch, 'https://api.resend.com/emails', {
      authorization: `Bearer ${args.env.RESEND_API_KEY ?? ''}`,
      'content-type': 'application/json',
    }, { from, to: [to], subject, text, html }, provider);
  } else {
    const senderEmail = /<([^>]+)>/.exec(from)?.[1] ?? from;
    const senderName = /^(.*)<[^>]+>$/.exec(from)?.[1]?.trim() || args.opts.siteName;
    await postWithRetry(doFetch, 'https://api.brevo.com/v3/smtp/email', {
      'api-key': args.env.BREVO_API_KEY ?? '',
      'content-type': 'application/json',
    }, {
      sender: { name: senderName, email: senderEmail },
      to: [{ email: to }],
      replyTo: { email: to, name: args.opts.siteName },
      subject,
      htmlContent: html,
      textContent: text,
    }, provider);
  }

  return { provider, to };
}

/* ------------------------------------------------------------------ *
 *  Письмо о новом отзыве
 *
 *  Отзыв уже опубликован на сайте — письмо такое же уведомление, как и в
 *  Telegram: «посмотри, при необходимости спрячь». Вложений нет.
 * ------------------------------------------------------------------ */

export function composeReviewEmail(review: ReviewPayload, opts: EmailOpts): ComposedEmail {
  const at = opts.at ?? new Date();
  const stamp = fmtMailStamp(at);
  const subject = `Новый отзыв на сайте — ${opts.siteName}`;

  const rows: [string, string][] = [
    ['Оценка', `${review.rating}/5`],
    ['Имя', review.author],
    ['Время', stamp],
    ['Страница', review.page],
    ['Согласие', `версия ${review.consentVersion}, отметка ${stamp}`],
  ];

  const text = [
    'НОВЫЙ ОТЗЫВ НА САЙТЕ',
    opts.siteName + (opts.address ? `, ${opts.address}` : ''),
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    'Отзыв:',
    review.text,
    '',
    'Отзыв уже опубликован. Если это спам или грубость — скройте его в /manage/ → «Отзывы».',
  ].join('\n');

  const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>${escHtml(subject)}</title></head>
<body style="margin:0;padding:24px;background:#0a0a0a;color:#f2f5f2;font:16px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#141414;border:1px solid #2a2a2a;border-radius:12px">
    <tr><td style="padding:22px 24px 6px">
      <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#9aa59d">
        Отзыв с сайта · ${escHtml(opts.siteName)}
      </div>
      <div style="font-size:22px;font-weight:700;margin-top:6px;color:#4ade80">${'⭐'.repeat(review.rating)} ${review.rating}/5</div>
    </td></tr>
    <tr><td style="padding:10px 24px 4px">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">
        ${rows.map(([k, v]) => `<tr>
          <td style="padding:7px 0;color:#9aa59d;font-size:14px;vertical-align:top;width:38%">${escHtml(k)}</td>
          <td style="padding:7px 0;font-size:15px;vertical-align:top">${escHtml(v)}</td>
        </tr>`).join('')}
      </table>
    </td></tr>
    <tr><td style="padding:6px 24px 4px">
      <div style="border-left:3px solid #4ade80;padding:2px 0 2px 14px;white-space:pre-wrap;font-size:15px">${escHtml(review.text)}</div>
    </td></tr>
    <tr><td style="padding:14px 24px 22px">
      <p style="margin:0;color:#9aa59d;font-size:14px">Отзыв уже опубликован. Спам или грубость — скрыть в /manage/ → «Отзывы».</p>
    </td></tr>
  </table>
</body></html>`;

  return { subject, text, html };
}

export interface SendReviewEmailArgs {
  review: ReviewPayload;
  env: EmailEnv;
  opts: EmailOpts;
  /** для тестов; по умолчанию настоящий fetch */
  fetchImpl?: typeof fetch;
}

/** Письмо об отзыве: те же провайдеры и адреса, что у заявок, но без вложений. */
export async function sendReviewEmail(args: SendReviewEmailArgs): Promise<{ provider: EmailProvider; to: string }> {
  const provider = emailProvider(args.env);
  if (!provider) throw new Error('email_not_configured');

  const to = (args.env.EMAIL_TO ?? args.opts.to ?? DEFAULT_EMAIL_TO).trim();
  const from = emailFrom(args.env, to);
  const { subject, text, html } = composeReviewEmail(args.review, args.opts);
  const doFetch = args.fetchImpl ?? fetch;

  if (provider === 'resend') {
    await postWithRetry(doFetch, 'https://api.resend.com/emails', {
      authorization: `Bearer ${args.env.RESEND_API_KEY ?? ''}`,
      'content-type': 'application/json',
    }, { from, to: [to], subject, text, html }, provider);
  } else {
    const senderEmail = /<([^>]+)>/.exec(from)?.[1] ?? from;
    const senderName = /^(.*)<[^>]+>$/.exec(from)?.[1]?.trim() || args.opts.siteName;
    await postWithRetry(doFetch, 'https://api.brevo.com/v3/smtp/email', {
      'api-key': args.env.BREVO_API_KEY ?? '',
      'content-type': 'application/json',
    }, {
      sender: { name: senderName, email: senderEmail },
      to: [{ email: to }],
      replyTo: { email: to, name: args.opts.siteName },
      subject,
      htmlContent: html,
      textContent: text,
    }, provider);
  }

  return { provider, to };
}
