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
  LEADS_TIMEOUT_MS,
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

/**
 * Текст экрана успеха под РЕАЛЬНЫЙ результат доставки.
 *
 * Воркер отвечает полем `delivered` — какие каналы подтвердили приём. Обещать
 * «Мария увидит в Telegram», когда Telegram не сработал, нельзя: человек
 * расслабится и не позвонит. Поэтому формулировка выбирается по факту:
 * оба канала — так и говорим; только почта — говорим про почту; только
 * Telegram — про Telegram; ни одного (или поле не пришло от старой сборки
 * воркера) — честно просим продублировать звонком. */
export function successText(
  delivered: { telegram?: boolean; email?: boolean } | undefined,
  fallback: string,
): { title: string; note: string } {
  const tg = delivered?.telegram === true;
  const mail = delivered?.email === true;
  if (tg && mail) {
    return {
      title: 'Заявка ушла — Мария увидит её в Telegram, копия отправлена на почту.',
      note: 'Ответит в рабочее время.',
    };
  }
  if (tg) {
    return {
      title: 'Заявка ушла — Мария увидит её в Telegram.',
      note: 'Ответит в рабочее время.',
    };
  }
  if (mail) {
    return {
      title: 'Заявка отправлена на почту Марии.',
      note: 'Дублируйте звонком, если вопрос срочный: +7 (961) 302-21-12.',
    };
  }
  if (delivered) {
    return {
      title: 'Заявка принята, но подтверждения доставки нет.',
      note: 'Чтобы не потеряться — позвоните: +7 (961) 302-21-12.',
    };
  }
  /* Старая сборка воркера: поля `delivered` в ответе нет. Не врём про каналы. */
  return { title: fallback, note: '' };
}

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
  /* Нейтральная формулировка по умолчанию: канал доставки подтверждает ответ
     воркера, а не наши предположения. Конкретику подставляет showSuccess. */
  success: 'Заявка принята — Мария ответит в рабочее время.',
  ticket: 'Номер заявки',
  error: 'Не получилось отправить заявку. Позвоните, пожалуйста: +7 (961) 302-21-12.',
  phoneHint: 'Позвоните: +7 (961) 302-21-12 — или напишите в Telegram @Mariya061.',
  rateLimit: 'Слишком много заявок с вашего адреса. Повторите позже или позвоните.',
  retry: 'Повторить через',
};

const PHONE_RE = /^\d{11}$/;

/**
 * Скрыто ли поле по-настоящему: `display:none`, `visibility:hidden` или атрибут
 * `hidden`. Только такое поле человек заполнить не может.
 *
 * Офскрин-ловушка (`position:absolute; left:-9999px`, класс `.quick-lead-hp`)
 * сюда НЕ попадает: в ней поле видимо для браузера, и автозаполнение телефона
 * охотно вписывает туда «ООО Ромашка» из профиля. Раньше такая запись
 * означала «бот» и заявка молча терялась при ответе 201.
 */
function isReallyHidden(el: HTMLElement | null): boolean {
  if (!el) return false;
  if (el.hidden === true) return true;
  /* В тестах и в окружениях без CSSOM getComputedStyle может отсутствовать:
     тогда считаем поле видимым (безопасная сторона — доставить заявку). */
  if (typeof getComputedStyle !== 'function') return false;
  try {
    const style = getComputedStyle(el);
    return style.display === 'none' || style.visibility === 'hidden';
  } catch {
    return false;
  }
}

/**
 * Поле-ловушка, из которого пришло ЗНАЧЕНИЕ `honeypot`, — в том же порядке
 * приоритета, что и значение: первое НЕПУСТОЕ поле. Флаг `honeypot_hidden`
 * должен описывать именно этот элемент, а не первый попавшийся.
 *
 * Регрессия K-1123: на формах с двумя ловушками (офскрин `company_website`
 * и `display:none` `_gotcha`) значение приходило из офскрина (его заполнило
 * автозаполнение), а флаг считался от `_gotcha` как первого найденного —
 * `hidden=true`. Воркер считал такую заявку ботом, молча выбрасывал её и
 * отвечал 201 с талоном: человек видел успех, заявка не доходила.
 */
function honeypotSource(form: HTMLElement): HTMLElement | null {
  const names = [form.dataset.honeypot || 'honeypot', '_gotcha', 'company_website'];
  const byName = (name: string): (HTMLElement & { value?: string }) | null =>
    form.querySelector<HTMLElement>(`[name="${name}"]`);
  for (const name of names) {
    const el = byName(name);
    if (el && typeof el.value === 'string' && el.value) return el;
  }
  /* Ловушки пусты — для флага берём первую существующую (значение всё равно
     пустое, и воркер от него ничего не решает). */
  for (const name of names) {
    const el = byName(name);
    if (el) return el;
  }
  return null;
}

/** Значение поля по имени (первое совпадение внутри формы; для radio — выбранное). */
function fieldValue(form: HTMLElement, name: string): string {
  const el = form.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="${name}"]`);
  if ((el as HTMLInputElement | null)?.type === 'radio') {
    const checked = form.querySelector<HTMLInputElement>(`input[type="radio"][name="${name}"]:checked`);
    return (checked?.value ?? '').trim();
  }
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

/**
 * Текст «Спасибо» и номер заявки: блок с `[data-lead-success]` либо подмена формы.
 *
 * `delivered` — подтверждение каналов от воркера. Текст подбирается по нему,
 * а не по нашим ожиданиям: обещать Telegram, когда он не сработал, значит
 * оставить человека без ответа в уверенности, что заявка дошла.
 */
function showSuccess(
  form: HTMLElement,
  ticket: string,
  texts: LeadFormTexts,
  download?: string,
  delivered?: { telegram?: boolean; email?: boolean },
): void {
  clearStrayStatus(form);
  const { title, note } = successText(delivered, texts.success);
  const box = form.parentElement?.querySelector<HTMLElement>('[data-lead-success]')
    ?? document.querySelector<HTMLElement>(`[data-lead-success="${form.id}"]`);
  if (box) {
    box.hidden = false;
    box.classList.add('visible');
    /* Заголовок блока мог быть свёрстан под «Мария увидит в Telegram»:
       заменяем его на подтверждённый канал, если разметка это позволяет. */
    const head = box.querySelector<HTMLElement>('[data-success-title]');
    if (head) head.textContent = title;
    const noteEl = box.querySelector<HTMLElement>('[data-success-note]');
    if (noteEl) {
      noteEl.textContent = note;
      noteEl.hidden = !note;
    }
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
  /* Разметка без блока успеха (формы Агента 01/02): сообщение вставляем сами.
     Текст собираем через textContent — данные пришли из сети, innerHTML с ними
     недопустим. */
  const fallback = document.createElement('div');
  fallback.className = 'lead-success';
  fallback.setAttribute('role', 'status');
  const line = document.createElement('p');
  const strong = document.createElement('b');
  strong.textContent = title;
  line.append(strong);
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = note ? `${note} ${texts.ticket}: ${ticket}` : `${texts.ticket}: ${ticket}`;
  fallback.append(line, hint);
  if (download) {
    const a = document.createElement('a');
    a.className = 'btn btn--primary';
    a.href = absoluteLeadsUrl(LEADS_BASE, download);
    a.textContent = 'Скачать шаблон';
    fallback.append(a);
  }
  form.replaceWith(fallback);
}

/**
 * Гасим посторонние сообщения под формой.
 *
 * `site.ts` в старой версии писал в `.quick-lead-status` текст «Заявка почти
 * ушла — позвоните». Если такой блок остался на странице, он переживёт и
 * успех, и ошибку — человек увидит одновременно «отправлена» и «позвоните».
 * Поэтому перед своим сообщением чистим чужое.
 */
function clearStrayStatus(form: HTMLElement): void {
  const stray = form.querySelector<HTMLElement>('.quick-lead-status');
  if (stray) {
    stray.textContent = '';
    stray.hidden = true;
  }
}

function showError(form: HTMLElement, texts: LeadFormTexts, message?: string, waitSec?: number): void {
  clearStrayStatus(form);
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
/**
 * Потолки полей — те же, что в `relay/src/validate.ts`.
 *
 * Раньше клиент отправлял значение как есть, а воркер отвергал всё, что длиннее
 * (например honeypot > 200: автозаполнение вписывает туда длинную строку).
 * Ответ 400 приходил с ошибкой поля, у которого на странице НЕТ блока вывода —
 * человек видел пустоту или общий «не получилось». Ужимаем на клиенте: длинный
 * текст лучше обрежется, чем потеряет заявку.
 */
const LIMIT = { name: 60, email: 120, company: 120, service: 80, message: 2000, honeypot: 200 } as const;

const clip = (value: string, max: number): string => (value.length > max ? value.slice(0, max) : value);

export function buildPayload(form: HTMLFormElement, startedAt: number, idem: string): Record<string, unknown> {
  const name = clip(fieldValue(form, 'name'), LIMIT.name);
  const phone = normalizePhone(fieldValue(form, 'phone')).replace(/^\+/, '');
  const email = clip(fieldValue(form, 'email'), LIMIT.email);
  const company = clip(fieldValue(form, 'company'), LIMIT.company);
  const service = clip(fieldValue(form, 'service'), LIMIT.service);
  const message = clip(fieldValue(form, 'message') || fieldValue(form, 'comment'), LIMIT.message);
  const kind = (form.dataset.leadKind as LeadKind) || 'consult';

  const contactMethod = fieldValue(form, 'contact_method') || (form.dataset.contactMethod as string) || 'call';

  const base: Record<string, unknown> = {
    kind,
    name,
    phone,
    contact_method: contactMethod,
    consent: isChecked(form, 'consent'),
    consent_version: form.dataset.consentVersion || CONSENT_VERSION,
    page: form.dataset.page || pageSlug(),
    idempotency_key: idem,
    /* Ловушка ботов: имя может приходить из data-honeypot формы, а формы
       Агентов 01/02 используют company_website / _gotcha / honeypot. */
    honeypot: clip(
      fieldValue(form, form.dataset.honeypot || 'honeypot')
      || fieldValue(form, '_gotcha')
      || fieldValue(form, 'company_website'),
      LIMIT.honeypot,
    ),
    /* Флаг нужен воркеру: заполненная офскрин-ловушка — это, скорее всего,
       автозаполнение, а не бот. Доставляем, но с пометкой «проверить». */
    honeypot_hidden: isReallyHidden(honeypotSource(form)),
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
  /* calc_tariff — имя Агента 03, calc_tier — скрытое поле формы главной (Агент 01). */
  const tariff = fieldValue(form, 'calc_tariff') || fieldValue(form, 'calc_tier');
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

/**
 * Форматирование телефона под маску +7 (999) 999-99-99 без поломки мобильного
 * автозаполнения и вставки из буфера: если при фокусе уже стояло «+7» или «+7 (»,
 * а поверх него вставили полный 11-значный номер («+7 961…» или «8 961…»),
 * лишний префикс «+7» снимается, чтобы последняя цифра номера не обрезалась.
 */
export function formatPhoneMaskValue(raw: string): string {
  const pastedAfterPrefix = /^\+7\s*\(?\s*(?:\+7|8)[\s()-]*(\d[\d\s()-]{9,})$/.exec(raw);
  const source = pastedAfterPrefix ? `7${pastedAfterPrefix[1]}` : raw;
  const d = source.replace(/\D/g, '').replace(/^8/, '7').replace(/^([^7])/, '7$1').slice(0, 11);
  if (!d) return '';
  const out = ['+' + d[0]];
  if (d.length > 1) out.push(' (' + d.slice(1, 4));
  if (d.length >= 5) out.push(') ' + d.slice(4, 7));
  if (d.length >= 8) out.push('-' + d.slice(7, 9));
  if (d.length >= 10) out.push('-' + d.slice(9, 11));
  return out.join('');
}

/** Маска телефона: +7 (999) 999-99-99, не мешая вставлять номер из буфера и автозаполнению. */
export function attachPhoneMask(input: HTMLInputElement): void {
  const sync = (): void => {
    const atEnd = input.selectionStart === input.value.length;
    input.value = formatPhoneMaskValue(input.value);
    if (atEnd && typeof input.setSelectionRange === 'function') {
      try {
        input.setSelectionRange(input.value.length, input.value.length);
      } catch {
        /* Некоторые окружения не поддерживают selectionRange на type="tel". */
      }
    }
  };
  input.addEventListener('input', sync);
  input.addEventListener('change', sync);
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

    /* Ключ идемпотентности привязан к тому, ЧТО отправляют.
     *
     * Пока шаблон не менялся, повтор — это та же заявка, и старый ключ
     * защищает от дубля. Но окно заявки на /shablony.html одно на все 64
     * позиции: человек выбрал № 02, отправка сорвалась (таймаут — заявка при
     * этом могла дойти), он выбрал № 53 и отправил снова. Со старым ключом
     * сервер нашёл бы запись от № 02 и вернул её талон как «повтор» — заявка
     * на № 53 потерялась бы совсем. Поэтому при смене выбранного шаблона
     * ключ перевыпускается. */
    let templateSig = form.dataset.template ?? '';
    const rotateIdemForTemplate = (): void => {
      const next = form.dataset.template ?? '';
      if (next === templateSig) return;
      templateSig = next;
      idem = makeIdempotencyKey();
    };
    form.addEventListener('lead-template-change', rotateIdemForTemplate);

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
      /* Страховка на случай, если шаблон поменяли без события (другая сборка
         модального окна): перед отправкой сверяем подпись ещё раз. */
      rotateIdemForTemplate();
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
          /* 409 «ключ идемпотентности уже использован с другими данными»:
             человек поправил телефон после прошлой попытки, а ключ остался
             прежним — без этой ветки каждый повтор упирался бы в 409 с общим
             «не получилось» (тупик до перезагрузки страницы). Крутим ключ и
             повторяем ОДИН раз: это та же заявка, которую просили отправить,
             а уже доставленная под старым ключом не задваивается. */
          let res = await leadsFetch(leadsUrl('leads'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(buildPayload(form, startedAt, idem)),
          });
          if (res.status === 409) {
            idem = makeIdempotencyKey();
            res = await leadsFetch(leadsUrl('leads'), {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(buildPayload(form, startedAt, idem)),
            });
          }
          const data = await res.json().catch(() => null) as
            | {
                ticket?: string;
                duplicate?: boolean;
                download?: string;
                /** Подтверждение каналов от воркера. Может отсутствовать
                 *  у старых сборок — тогда текст остаётся нейтральным. */
                delivered?: { telegram?: boolean; email?: boolean };
              }
            | null;

          if ((res.status === 201 || res.status === 200) && data?.ticket) {
            /* Повторная отправка (`duplicate`) доставку не повторяет: заявка
               уже ушла раньше. Показываем тот же экран, но не обещаем каналы. */
            showSuccess(
              form,
              data.ticket,
              texts,
              data.download,
              data.duplicate ? undefined : data.delivered,
            );
            idem = makeIdempotencyKey();
            form.reset();
            return;
          }

          /* Тело ответа не разобралось как JSON: обычно это страница-заглушка
             вместо API (не тот адрес) либо блокировка CORS. Молчать нельзя —
             иначе «Не получилось отправить» без единой зацепки. */
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
          /* Ответ пришёл, но разобрать его не вышло: показываем код, чтобы
             причину было видно без консоли разработчика. */
          showError(form, texts, data === null
            ? `${texts.error} (ответ сервиса ${res.status}, не JSON)`
            : texts.error);
        } catch (err) {
          /* Таймаут и сеть — человеку важен телефон, но и причину скрывать
             незачем: «network» и «timeout» различимы и не содержат его данных. */
          const name = (err as Error)?.name;
          /* Таймаут не значит, что заявка потерялась: запрос мог дойти, а ответ —
             нет. Обещать «дубликатов не будет» нельзя: ключ идемпотентности
             живёт в памяти изолята, если KV не подключён, а при смене шаблона
             он вообще перевыпускается. Поэтому говорим только то, что мы точно
             знаем: ответа нет, заявка могла уйти — и даём телефон. */
          showError(form, texts, name === 'AbortError'
            ? `Ответ не пришёл за ${Math.round(LEADS_TIMEOUT_MS / 1000)} с (таймаут): возможно, заявка уже ушла — проверьте, не ответила ли Мария. Если срочно: +7 (961) 302-21-12.`
            : `${texts.error} (сеть)`);
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
 *
 * Стыковка Агентов 01 и 03: кнопка главной помечена [data-calc-fix], модуль
 * заявок ищет [data-fix-calc] — поддерживаем оба имени. Скрытые поля формы
 * главной используют calc_tier, модуль заявок — calc_tariff: пишем в оба.
 */
function wireCalculatorFix(): void {
  const buttons = document.querySelectorAll<HTMLElement>('[data-fix-calc], [data-calc-fix]');
  buttons.forEach((button) => {
    if (button.dataset.calcWired === '1') return;
    button.dataset.calcWired = '1';
    button.addEventListener('click', () => {
      const calc = collectCalcSummary(document) ?? collectCalcFromSliders(document);
      const targetSel = button.dataset.fixCalc || '#home-lead-form, #lead-form, form[data-lead-form]';
      const form = document.querySelector<HTMLFormElement>(targetSel);
      if (!calc || !form) return;
      form.dataset.leadKind = 'calculator';
      hidden(form, 'calc_staff').value = String(calc.staff);
      hidden(form, 'calc_salary').value = String(calc.salary_net);
      hidden(form, 'calc_tariff').value = calc.tariff;
      hidden(form, 'calc_tier').value = calc.tariff;
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

/**
 * Расчёт с ползунков калькулятора главной (Агент 01): их id не совпадают с
 * селекторами collectCalcSummary, поэтому читаем напрямую.
 */
function collectCalcFromSliders(doc: Document): CalcSummary | null {
  const staffEl = doc.querySelector<HTMLInputElement>('#staff-slider');
  const salaryEl = doc.querySelector<HTMLInputElement>('#salary-slider');
  if (!staffEl || !salaryEl) return null;
  const staff = Number(staffEl.value);
  const salary = Number(salaryEl.value);
  if (!Number.isFinite(staff) || staff <= 0 || !Number.isFinite(salary) || salary <= 0) return null;
  const tariff = (doc.querySelector<HTMLElement>('#staff-tier')?.textContent ?? '').trim() || 'по расчёту';
  const smText = (doc.querySelector<HTMLElement>('#savings-month')?.textContent ?? '0').replace(/\D/g, '');
  const syText = (doc.querySelector<HTMLElement>('#savings-year')?.textContent ?? '0').replace(/\D/g, '');
  const savings_month = Number(smText) || 0;
  const savings_year = Number(syText) || savings_month * 12;
  return {
    staff: Math.round(staff),
    salary_net: Math.round(salary),
    tariff,
    savings_month: Math.round(savings_month),
    savings_year: Math.round(savings_year),
  };
}

/* Автозапуск: скрипт грузится на всех страницах, формы ищутся сами. */
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => wireLeadForms());
  } else {
    wireLeadForms();
  }
}
