/**
 * Проверка заявки с сайта kadry-pro.ru.
 *
 * Контракт общий с клиентом `site/src/client/leads-form.ts` и с тестами сайта
 * (`site/tests/leads.test.ts` импортирует этот файл напрямую) — поэтому имена
 * полей и коды ошибок менять нельзя без синхронной правки клиента.
 *
 * Заявка бывает четырёх видов:
 *   `consult`    — обычная форма: имя, телефон, необязательные компания/email/услуга;
 *   `calculator` — расчёт с главной: штат, зарплата «на руки», тариф, экономия;
 *   `template`   — заказ шаблона: одиночный (500 ₽), email-пакет (25 шт.) или полный;
 *   `subscribe`  — заявка на консультацию из блога/статьи (без выбора услуги).
 *
 * Телефон принимается в любом человеческом виде (8…, +7…, скобки, дефисы) и
 * нормализуется в `+7XXXXXXXXXX`. Бот получает 201 и ничего не отправляет.
 */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9_\-/]{1,59}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Zа-яА-Я]{2,}$/;
const PHONE_DIGITS = 11;

/** Быстрее, чем за это время, человек форму не заполнит. */
export const MIN_FILL_MS = 4000;

export const LEAD_KINDS = ['consult', 'calculator', 'template', 'subscribe'] as const;
export type LeadKind = (typeof LEAD_KINDS)[number];

export const CONTACT_METHODS = ['call', 'telegram', 'whatsapp', 'max'] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];

/** Пакеты шаблонов: один файл 500 ₽, «за email» 25 шт., полный набор 64 шт. 3 500 ₽, бесплатный. */
export const TEMPLATE_PACKAGES = ['single', 'email', 'full', 'free'] as const;
export type TemplatePackage = (typeof TEMPLATE_PACKAGES)[number];

export interface LeadBase {
  name: string;
  phone: string;
  contact_method: ContactMethod;
  consent: true;
  consent_version: string;
  page: string;
  idempotency_key: string;
  honeypot: string;
  /**
   * Клиент сообщил, что скрытое поле действительно скрыто (`display:none`
   * или атрибут `hidden`). Только в этом случае заполненный honeypot —
   * достоверный признак бота: человек такое поле заполнить не может.
   * Офскрин-ловушку (`position:absolute; left:-9999px`) автозаполнение
   * телефона видит и заполняет, поэтому она признаком бота не считается.
   */
  honeypot_hidden?: boolean;
  form_started_at?: number;
}

export interface CalcSummary {
  /** Численность штата, человек. */
  staff: number;
  /** Зарплата «на руки», ₽/мес (одного сотрудника или фонд — как считает калькулятор). */
  salary_net: number;
  /** Тариф аутсорсинга: `start` | `business` | `max`. */
  tariff: string;
  /** Экономия, ₽/мес. */
  savings_month: number;
  /** Экономия, ₽/год. */
  savings_year: number;
}

export interface TemplateRequest {
  /** Позиция каталога `t01`…`t64`; пусто — заявка на весь пакет. */
  id: string | null;
  title: string;
  package: TemplatePackage;
  price: number | null;
}

export interface ConsultPayload extends LeadBase {
  kind: 'consult' | 'subscribe';
  message: string | null;
  company: string | null;
  email: string | null;
  service: string | null;
}

export interface CalculatorPayload extends LeadBase {
  kind: 'calculator';
  calc: CalcSummary;
  message: string | null;
}

export interface TemplatePayload extends LeadBase {
  kind: 'template';
  template: TemplateRequest;
  email: string | null;
}

export type LeadPayload = ConsultPayload | CalculatorPayload | TemplatePayload;

export type FieldErrors = Record<string, string>;

export type Validated =
  | { ok: true; value: LeadPayload }
  | { ok: false; error: 'bad_json' | 'validation'; fields: FieldErrors };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);

/** +7XXXXXXXXXX из 8/7/+7, скобок, пробелов и дефисов. */
export function normalizePhone(raw: unknown): string | null {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 10) d = '7' + d;
  if (d.startsWith('8') && d.length === PHONE_DIGITS) d = '7' + d.slice(1);
  if (d.length !== PHONE_DIGITS || !d.startsWith('7')) return null;
  return '+7' + d.slice(1);
}

export function isValidEmail(raw: unknown): boolean {
  const value = String(raw ?? '').trim();
  return value.length >= 5 && value.length <= 120 && EMAIL_RE.test(value);
}

const has = (f: FieldErrors): boolean => Object.keys(f).length > 0;

export function validateLead(body: unknown): Validated {
  if (!isObj(body)) return { ok: false, error: 'bad_json', fields: {} };
  const fields: FieldErrors = {};
  const bad = (k: string, msg: string): void => { if (!(k in fields)) fields[k] = msg; };

  /* --- общие поля --- */
  const name = str(body.name).trim();
  if (name.length < 2) bad('name', 'Укажите имя');
  else if (name.length > 60) bad('name', 'Имя — до 60 символов');

  const phone = normalizePhone(body.phone);
  if (!phone) bad('phone', 'Телефон: +7 (999) 999-99-99');

  const contactRaw = body.contact_method === undefined ? 'call' : body.contact_method;
  if (!(CONTACT_METHODS as readonly unknown[]).includes(contactRaw)) {
    bad('contact_method', 'Выберите вариант из списка');
  }
  const contact_method = contactRaw as ContactMethod;

  if (body.consent !== true) bad('consent', 'Без согласия на обработку данных отправить нельзя');

  const consent_version = str(body.consent_version).trim();
  if (consent_version.length < 4) bad('consent_version', 'Версия согласия: не указана');

  const page = str(body.page).trim();
  if (!page || page.length > 60) bad('page', 'Страница: не указана');
  else if (!SLUG_RE.test(page)) bad('page', 'Страница: недопустимые символы');

  const idempotency_key = str(body.idempotency_key).trim();
  if (!UUID_RE.test(idempotency_key)) bad('idempotency_key', 'Ключ идемпотентности: uuid v4');

  const honeypot = str(body.honeypot);
  if (honeypot.length > 200) bad('honeypot', 'Значение больше допустимого');

  /* Флаг ставит клиент. Принимаем только явный `true`: строка "false" из
     разметки не должна включать «режим бота». */
  const honeypot_hidden = body.honeypot_hidden === true;

  const form_started_at = body.form_started_at === undefined ? undefined : int(body.form_started_at);
  if (body.form_started_at !== undefined && (form_started_at == null || form_started_at <= 0)) {
    bad('form_started_at', 'Время заполнения: неверный формат значения');
  }

  const base: LeadBase = {
    name,
    phone: phone ?? '',
    contact_method: contact_method ?? 'call',
    consent: true,
    consent_version,
    page,
    idempotency_key,
    honeypot,
    ...(honeypot_hidden ? { honeypot_hidden } : {}),
    ...(form_started_at ? { form_started_at } : {}),
  };

  const kindRaw = body.kind === undefined ? 'consult' : body.kind;
  if (!(LEAD_KINDS as readonly unknown[]).includes(kindRaw)) {
    return { ok: false, error: 'validation', fields: { kind: 'Неизвестный тип заявки' } };
  }
  const kind = kindRaw as LeadKind;

  /* --- необязательные строки, проверяем у всех видов --- */
  const optText = (key: string, max: number, label: string): string | null => {
    const raw = body[key];
    if (raw === undefined || raw === null) return null;
    const value = str(raw).trim();
    if (value.length > max) bad(key, `${label} — до ${max} символов`);
    return value || null;
  };

  const email = optText('email', 120, 'Email');
  if (email && !isValidEmail(email)) bad('email', 'Почта: name@example.ru');
  const company = optText('company', 120, 'Компания');
  const service = optText('service', 80, 'Услуга');
  const message = optText('message', 2000, 'Сообщение');

  if (kind === 'consult' || kind === 'subscribe') {
    if (message && message.length > 0 && message.length < 10) {
      bad('message', 'Опишите вопрос — минимум 10 символов');
    }
  }

  if (kind === 'calculator') {
    const calcRaw = body.calc;
    if (!isObj(calcRaw)) {
      bad('calc', 'Расчёт калькулятора: заполните блок');
    } else {
      const staff = int(calcRaw.staff);
      if (staff === null || staff < 1 || staff > 5000) bad('calc.staff', 'Штат — от 1 до 5000 человек');
      const salary = int(calcRaw.salary_net);
      if (salary === null || salary < 1000 || salary > 100_000_000) {
        bad('calc.salary_net', 'Зарплата — от 1 000 до 100 000 000 ₽');
      }
      const tariff = str(calcRaw.tariff).trim();
      if (!tariff || tariff.length > 40) bad('calc.tariff', 'Тариф: не указан');
      const sm = int(calcRaw.savings_month);
      const sy = int(calcRaw.savings_year);
      if (sm === null || sm < -100_000_000 || sm > 100_000_000) bad('calc.savings_month', 'Экономия: неверное число');
      if (sy === null || sy < -1_000_000_000 || sy > 1_000_000_000) bad('calc.savings_year', 'Экономия: неверное число');
    }
  }

  if (kind === 'template') {
    const tRaw = body.template;
    if (!isObj(tRaw)) {
      bad('template', 'Шаблон: не выбран');
    } else {
      const idRaw = tRaw.id === undefined || tRaw.id === null ? '' : str(tRaw.id).trim();
      const tid = idRaw || null;
      if (tid && !/^t\d{1,3}$/.test(tid)) bad('template.id', 'Шаблон: неверный номер');
      const title = str(tRaw.title).trim();
      if (title.length < 2 || title.length > 200) bad('template.title', 'Шаблон: не указано название');
      const pkg = tRaw.package;
      if (!(TEMPLATE_PACKAGES as readonly unknown[]).includes(pkg)) {
        bad('template.package', 'Выберите пакет из списка');
      }
      const priceRaw = tRaw.price;
      if (priceRaw !== undefined && priceRaw !== null) {
        const price = int(priceRaw);
        if (price === null || price < 0 || price > 1_000_000) bad('template.price', 'Цена: неверное число');
      }
      /* За email-пакетом и бесплатным файлом нужно куда его прислать. */
      if ((pkg === 'email' || pkg === 'free') && !email) {
        bad('email', 'Почта: укажите, куда прислать шаблон');
      }
    }
  }
  if (kind === 'template' && email && !isValidEmail(email)) bad('email', 'Почта: name@example.ru');

  if (has(fields)) return { ok: false, error: 'validation', fields };

  if (kind === 'calculator') {
    const c = body.calc as Record<string, unknown>;
    return {
      ok: true,
      value: {
        ...base,
        kind: 'calculator',
        message,
        calc: {
          staff: c.staff as number,
          salary_net: c.salary_net as number,
          tariff: str(c.tariff).trim(),
          savings_month: c.savings_month as number,
          savings_year: c.savings_year as number,
        },
      },
    };
  }

  if (kind === 'template') {
    const t = body.template as Record<string, unknown>;
    const idRaw = t.id === undefined || t.id === null ? '' : str(t.id).trim();
    const priceRaw = t.price;
    return {
      ok: true,
      value: {
        ...base,
        kind: 'template',
        email,
        template: {
          id: idRaw || null,
          title: str(t.title).trim(),
          package: t.package as TemplatePackage,
          price: priceRaw === undefined || priceRaw === null ? null : (priceRaw as number),
        },
      },
    };
  }

  return {
    ok: true,
    value: { ...base, kind: kind as 'consult' | 'subscribe', message, company, email, service },
  };
}
