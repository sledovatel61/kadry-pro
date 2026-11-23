/**
 * Единый клиент форм заявок: всё, что помечено `data-lead-form`, уходит в
 * прослойку (`relay/`) вместо американского Formspree.
 *
 * Что подключается автоматически:
 *   - любая форма с `[data-lead-form]` — консультация, заказ шаблона, запрос
 *     шаблона за email (тип вида берётся из `data-lead-kind`, по умолчанию `consult`);
 *   - калькулятор на главной: кнопка `[data-fix-calc]` подставляет штат, тариф и
 *     экономию в скрытые поля формы и прокручивает к ней;
 *   - поля `name`, `phone`, `email`, `company`, `message`/`comment`, `service`,
 *     чекбокс `consent`, ловушка `honeypot` (её имя — `data-honeypot` или `honeypot`).
 *
 * Чего НЕ делает: не отправляет данные, если адрес приёмника не настроен —
 * тогда показывает телефон и подсказку позвонить. Молча «проглатывать» заявку
 * нельзя: человек должен знать, что его услышали.
 */
import {
  CONSENT_VERSION,
  LEADS_BASE,
  absoluteLeadsUrl,
  collectCalcSummary,
  leadsFetch,
  leadsUrl,
  makeIdempotencyKey,
  normalizePhone,
  parseApiFailure,
  retryAfterSeconds,
  type CalcSummary,
} from '../shared/leads-endpoint.ts';

export type LeadKind = 'consult' | 'calculator' | 'template' | 'subscribe';

export interface LeadFormTexts {
  sending: string;
  success: string;
  ticket: string;
  error: string;
  phoneHint: string;
  rateLimit: string;
  retry: string;
}

export const DEFAULT_TEXTS: LeadFormTexts = {
  sending: 'Отправляем…',
  success: 'Заявка ушла — Мария увидит её в Telegram и ответит в рабочее время.',
  ticket: 'Номер заявки',
  error: 'Не получилось отправить заявку. Позвоните, пожалуйста: +7 (961) 302-21-12.',
  phoneHint: 'Позвоните: +7 (961) 302-21-12 — или напишите в Telegram @Mariya061.',
  rateLimit: 'Слишком много заявок с вашего адреса. Повторите позже или позвоните.',
  retry: 'Повторить через',
};

const PHONE_RE = /^\d{11}$/;

/** Значение поля по имени (первое совпадение внутри формы). */
function fieldValue(form: HTMLElement, name: string): string {
  const el = form.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="${name}"]`);
  return (el?.value ?? '').trim();
}

function isChecked(form: HTMLElement, name: string): boolean {
  const el = form.querySelector<HTMLInputElement>(`[name="${name}"]`);
  return Boolean(el?.checked);
}

/** Сообщение под полем: `.form-error`, `[data-error="name"]` или `aria-describedby`. */
function errorBox(form: HTMLElement, name: string): HTMLElement | null {
  return form.querySelector<HTMLElement>(`[data-error="${name}"], .form-error[data-for="${name}"], #${form.id}-${name}-error`);
}

function setFieldError(form: HTMLElement, name: string, message: string): void {
  const input = form.querySelector<HTMLElement>(`[name="${name}"]`);
  const box = errorBox(form, name);
  if (box) {
    box.textContent = message;
    box.hidden = false;
  }
  if (input) {
    input.classList.toggle('error', Boolean(message));
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
}

function clearErrors(form: HTMLElement): void {
  form.querySelectorAll<HTMLElement>('[data-error], .form-error[data-for]').forEach((box) => {
    box.textContent = '';
    box.hidden = true;
  });
  form.querySelectorAll<HTMLElement>('[aria-invalid]').forEach((el) => {
    el.classList.remove('error');
    el.removeAttribute('aria-invalid');
  });
}

/** Скрытые поля формы: куда положить расчёт калькулятора и номер шаблона. */
function hidden(form: HTMLElement, name: string): HTMLInputElement {
  let el = form.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`);
  if (!el) {
    el = document.createElement('input');
    el.type = 'hidden';
    el.name = name;
    form.append(el);
  }
  return el;
}

/** Текст «Спасибо» и номер заявки: блок с `[data-lead-success]` либо подмена формы. */
function showSuccess(form: HTMLElement, ticket: string, texts: LeadFormTexts, download?: string): void {
  const box = form.parentElement?.querySelector<HTMLElement>('[data-lead-success]')
    ?? document.querySelector<HTMLElement>(`[data-lead-success="${form.id}"]`);
  if (box) {
    box.hidden = false;
    box.classList.add('visible');
    const no = box.querySelector<HTMLElement>('[data-ticket]');
    if (no) no.textContent = `${texts.ticket}: ${ticket}`;
    const link = box.querySelector<HTMLAnchorElement>('[data-download]');
    if (link && download) {
      link.href = absoluteLeadsUrl(LEADS_BASE, download);
      link.hidden = false;
    }
    form.hidden = true;
    return;
  }
  /* Разметка без блока успеха (формы Агента 01/02): сообщение вставляем сами. */
  const fallback = document.createElement('div');
  fallback.className = 'lead-success';
  fallback.setAttribute('role', 'status');
  fallback.innerHTML = `<p><b>${texts.success}</b></p><p class="hint">${texts.ticket}: ${ticket}</p>`;
  if (download) {
    const a = document.createElement('a');
    a.className = 'btn btn--primary';
    a.href = absoluteLeadsUrl(LEADS_BASE, download);
    a.textContent = 'Скачать шаблон';
    fallback.append(a);
  }
  form.replaceWith(fallback);
}

function showError(form: HTMLElement, texts: LeadFormTexts, message?: string, waitSec?: number): void {
  const box = form.parentElement?.querySelector<HTMLElement>('[data-lead-error]')
    ?? document.querySelector<HTMLElement>(`[data-lead-error="${form.id}"]`);
  const text = message ?? texts.error;
  if (box) {
    box.hidden = false;
    box.textContent = waitSec ? `${text} ${texts.retry} ${waitSec} с.` : text;
    return;
  }
  let holder = form.querySelector<HTMLElement>('.lead-error');
  if (!holder) {
    holder = document.createElement('p');
    holder.className = 'lead-error';
    holder.setAttribute('role', 'alert');
    form.append(holder);
  }
  holder.textContent = waitSec ? `${text} ${texts.retry} ${waitSec} с.` : text;
}

/** Значение шаблона из data-атрибутов кнопки/формы — например, «полный пакет». */
function dataTemplate(form: HTMLElement): { id: string | null; title: string; pkg: string; price: number | null } | null {
  const tpl = form.dataset.template;
  if (!tpl) return null;
  try {
    const parsed = JSON.parse(tpl) as { id?: string; title?: string; package?: string; price?: number };
    return {
      id: parsed.id ?? null,
      title: parsed.title ?? '',
      pkg: parsed.package ?? 'single',
      price: typeof parsed.price === 'number' ? parsed.price : null,
    };
  } catch {
    return null;
  }
}

/**
 * Имя страницы для заявки: `data-page` на форме, иначе адрес без слэшей и `.html`.
 * Глобальный `location` может отсутствовать (тесты, предпросмотр) — не падаем.
 */
function pageSlug(): string {
  const loc = (globalThis as { location?: { pathname?: string } }).location;
  const path = String(loc?.pathname ?? '');
  return path.replace(/^\/|\/+$/g, '').replace(/\.html$/, '') || 'index';
}

/** Собираем тело заявки из полей формы. */
export function buildPayload(form: HTMLFormElement, startedAt: number, idem: string): Record<string, unknown> {
  const name = fieldValue(form, 'name');
  const phone = normalizePhone(fieldValue(form, 'phone')).replace(/^\+/, '');
  const email = fieldValue(form, 'email');
  const company = fieldValue(form, 'company');
  const service = fieldValue(form, 'service');
  const message = fieldValue(form, 'message') || fieldValue(form, 'comment');
  const kind = (form.dataset.leadKind as LeadKind) || 'consult';

  const base: Record<string, unknown> = {
    kind,
    name,
    phone,
    contact_method: (form.dataset.contactMethod as string) || 'call',
    consent: isChecked(form, 'consent'),
    consent_version: form.dataset.consentVersion || CONSENT_VERSION,
    page: form.dataset.page || pageSlug(),
    idempotency_key: idem,
    honeypot: fieldValue(form, 'honeypot') || fieldValue(form, '_gotcha'),
    form_started_at: startedAt,
  };

  if (email) base.email = email;
  if (company) base.company = company;
  if (service) base.service = service;
  if (message) base.message = message;

  if (kind === 'calculator') {
    const calc = readCalc(form);
    if (calc) base.calc = calc;
  }

  if (kind === 'template') {
    const t = dataTemplate(form);
    if (t) {
      base.template = {
        id: t.id,
        title: t.title,
        package: t.pkg,
        price: t.price,
      };
    }
  }

  return base;
}

/** Расчёт калькулятора: сначала скрытые поля формы, потом разбор самой страницы. */
function readCalc(form: HTMLFormElement): CalcSummary | null {
  const staff = Number(fieldValue(form, 'calc_staff'));
  const salary = Number(fieldValue(form, 'calc_salary'));
  const tariff = fieldValue(form, 'calc_tariff');
  const sm = Number(fieldValue(form, 'calc_savings_month'));
  const sy = Number(fieldValue(form, 'calc_savings_year'));
  if (Number.isFinite(staff) && staff > 0 && Number.isFinite(salary) && salary > 0 && tariff) {
    return {
      staff,
      salary_net: Math.round(salary),
      tariff,
      savings_month: Number.isFinite(sm) ? Math.round(sm) : 0,
      savings_year: Number.isFinite(sy) ? Math.round(sy) : 0,
    };
  }
  return collectCalcSummary(document);
}

/** Проверка полей до отправки: то же, что проверит воркер, но раньше и по-русски. */
export function validateForm(form: HTMLFormElement): boolean {
  let ok = true;
  const name = fieldValue(form, 'name');
  if (name.length < 2) {
    setFieldError(form, 'name', 'Укажите имя');
    ok = false;
  }
  const digits = normalizePhone(fieldValue(form, 'phone')).replace(/^\+/, '');
  if (!PHONE_RE.test(digits)) {
    setFieldError(form, 'phone', 'Телефон: +7 (999) 999-99-99');
    ok = false;
  }
  const emailEl = form.querySelector<HTMLInputElement>('[name="email"]');
  const email = fieldValue(form, 'email');
  if (emailEl?.required && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    setFieldError(form, 'email', 'Почта: name@example.ru');
    ok = false;
  }
  const consentEl = form.querySelector<HTMLInputElement>('[name="consent"]');
  if (consentEl && !consentEl.checked) {
    setFieldError(form, 'consent', 'Без согласия на обработку данных отправить нельзя');
    ok = false;
  }
  const kind = form.dataset.leadKind;
  if (kind === 'template') {
    const t = dataTemplate(form);
    if (!t) {
      showError(form, DEFAULT_TEXTS, 'Не выбран шаблон. Обновите страницу и попробуйте снова.');
      ok = false;
    } else if ((t.pkg === 'email' || t.pkg === 'free') && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(fieldValue(form, 'email'))) {
      setFieldError(form, 'email', 'Почта: укажите, куда прислать шаблон');
      ok = false;
    }
  }
  return ok;
}

export interface WireOptions {
  texts?: Partial<LeadFormTexts>;
  /** Навешивать маску на телефон (если её нет у Агента 01). */
  mask?: boolean;
}

/** Маска телефона: +7 (999) 999-99-99, не мешая вставлять номер из буфера. */
export function attachPhoneMask(input: HTMLInputElement): void {
  const format = (digits: string): string => {
    const d = digits.replace(/\D/g, '').replace(/^8/, '7').replace(/^([^7])/, '7$1').slice(0, 11);
    if (!d) return '';
    const out = ['+' + d[0]];
    if (d.length > 1) out.push(' (' + d.slice(1, 4));
    if (d.length >= 5) out.push(') ' + d.slice(4, 7));
    if (d.length >= 8) out.push('-' + d.slice(7, 9));
    if (d.length >= 10) out.push('-' + d.slice(9, 11));
    return out.join('');
  };
  input.addEventListener('input', () => {
    const atEnd = input.selectionStart === input.value.length;
    input.value = format(input.value);
    if (atEnd) input.setSelectionRange(input.value.length, input.value.length);
  });
  input.addEventListener('focus', () => {
    if (!input.value.trim()) input.value = '+7 (';
  });
  input.addEventListener('blur', () => {
    if (input.value.replace(/\D/g, '').length <= 1) input.value = '';
  });
}

/** Подключить все формы на странице. Идемпотентно: повторный вызов ничего не дублирует. */
export function wireLeadForms(options: WireOptions = {}): void {
  const texts = { ...DEFAULT_TEXTS, ...options.texts };
  const forms = document.querySelectorAll<HTMLFormElement>('form[data-lead-form]');

  forms.forEach((form) => {
    if (form.dataset.leadWired === '1') return;
    form.dataset.leadWired = '1';

    const startedAt = Date.now();
    let idem = makeIdempotencyKey();
    let busy = false;
    let retryUntil = 0;

    const phone = form.querySelector<HTMLInputElement>('[name="phone"]');
    if (options.mask && phone && !phone.dataset.maskAttached) {
      phone.dataset.maskAttached = '1';
      attachPhoneMask(phone);
    }

    /* Нет приёмника — честно говорим телефон и не притворяемся, что отправили. */
    if (!LEADS_BASE) {
      form.dataset.leadDisabled = '1';
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        showError(form, texts, texts.phoneHint);
      });
      return;
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (busy) return;
      if (Date.now() < retryUntil) {
        showError(form, texts, texts.rateLimit, Math.ceil((retryUntil - Date.now()) / 1000));
        return;
      }
      clearErrors(form);
      if (!validateForm(form)) {
        const first = form.querySelector<HTMLElement>('.error, [aria-invalid="true"]');
        first?.focus();
        return;
      }

      busy = true;
      const button = form.querySelector<HTMLButtonElement>('button[type="submit"], button:not([type])');
      const label = button?.textContent ?? '';
      if (button) {
        button.disabled = true;
        button.textContent = texts.sending;
      }

      void (async () => {
        try {
          const res = await leadsFetch(leadsUrl('leads'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(buildPayload(form, startedAt, idem)),
          });
          const data = await res.json().catch(() => null) as
            | { ticket?: string; duplicate?: boolean; download?: string }
            | null;

          if ((res.status === 201 || res.status === 200) && data?.ticket) {
            showSuccess(form, data.ticket, texts, data.download);
            idem = makeIdempotencyKey();
            form.reset();
            return;
          }

          const failure = parseApiFailure(data);
          if (res.status === 429) {
            const wait = retryAfterSeconds(res.headers.get('retry-after')) ?? 60;
            retryUntil = Date.now() + wait * 1000;
            showError(form, texts, texts.rateLimit, wait);
            return;
          }
          if (failure) {
            /* Поля с ошибками воркера подсвечиваем, остальную форму — общий текст. */
            let anyField = false;
            for (const [field, code] of Object.entries(failure.fields)) {
              setFieldError(form, field, russianFieldText(field, code));
              anyField = true;
            }
            if (anyField) {
              form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
              return;
            }
            showError(form, texts, failure.message || texts.error);
            return;
          }
          showError(form, texts);
        } catch (err) {
          /* Таймаут и сеть — один экран: человеку важен телефон, а не имя ошибки. */
          const name = (err as Error)?.name;
          showError(form, texts, name === 'AbortError' ? texts.error : texts.error);
        } finally {
          busy = false;
          if (button) {
            button.disabled = false;
            button.textContent = label;
          }
        }
      })();
    });
  });

  wireCalculatorFix();
}

/** Тексты ошибок полей от воркера — те же, что он вернул бы по-русски. */
function russianFieldText(field: string, code: string): string {
  const map: Record<string, string> = {
    name: 'Укажите имя',
    phone: 'Телефон: +7 (999) 999-99-99',
    email: 'Почта: name@example.ru',
    consent: 'Без согласия на обработку данных отправить нельзя',
    message: 'Опишите вопрос — минимум 10 символов',
    'calc.staff': 'Штат — от 1 до 5000 человек',
    'calc.salary_net': 'Укажите зарплату числом',
    'calc.tariff': 'Выберите тариф',
    'template.title': 'Не выбран шаблон',
    'template.package': 'Выберите пакет из списка',
  };
  return map[field] ?? code;
}

/**
 * Кнопка «Зафиксировать этот расчёт» под калькулятором: переносит штат, тариф и
 * экономию в форму заявки, чтобы клиенту не пришлось объяснять цифры заново.
 */
function wireCalculatorFix(): void {
  const buttons = document.querySelectorAll<HTMLElement>('[data-fix-calc]');
  buttons.forEach((button) => {
    if (button.dataset.calcWired === '1') return;
    button.dataset.calcWired = '1';
    button.addEventListener('click', () => {
      const calc = collectCalcSummary(document);
      const targetSel = button.dataset.fixCalc || '#lead-form, form[data-lead-form]';
      const form = document.querySelector<HTMLFormElement>(targetSel);
      if (!calc || !form) return;
      form.dataset.leadKind = 'calculator';
      hidden(form, 'calc_staff').value = String(calc.staff);
      hidden(form, 'calc_salary').value = String(calc.salary_net);
      hidden(form, 'calc_tariff').value = calc.tariff;
      hidden(form, 'calc_savings_month').value = String(calc.savings_month);
      hidden(form, 'calc_savings_year').value = String(calc.savings_year);

      const note = form.querySelector<HTMLElement>('[data-calc-note]');
      if (note) {
        note.hidden = false;
        note.textContent = `К заявке приложен расчёт: ${calc.staff} чел., ${calc.salary_net.toLocaleString('ru-RU')} ₽ «на руки», экономия ${calc.savings_month.toLocaleString('ru-RU')} ₽/мес.`;
      }
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      form.querySelector<HTMLInputElement>('[name="name"]')?.focus({ preventScroll: true });
    });
  });
}

/* Автозапуск: скрипт грузится на всех страницах, формы ищутся сами. */
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => wireLeadForms());
  } else {
    wireLeadForms();
  }
}
