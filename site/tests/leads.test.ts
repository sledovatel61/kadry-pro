/**
 * Тесты форм заявок (Агент 03).
 *
 * Formspree больше нет: всё, что помечено `[data-lead-form]`, уходит в прослойку
 * `relay/` (Telegram + почта). Тесты проверяют те места, где ошибка стоит денег:
 *   • адрес приёмника: только https, без мусора, пусто — «работаем без приёмника»;
 *   • телефон: `8…`, `+7…`, скобки и дефисы приводятся к одному виду;
 *   • тело заявки: тип формы, согласие, расчёт калькулятора, выбранный шаблон;
 *   • проверка до отправки: без имени/телефона/согласия заявка не уходит;
 *   • ошибки приёмника переводятся в русский текст, включая лимит частоты;
 *   • расчёт калькулятора снимается со страницы, даже если поля не скрытые.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSENT_VERSION,
  LEADS_ENDPOINT_ERROR,
  absoluteLeadsUrl,
  buildLeadsUrl,
  collectCalcSummary,
  makeIdempotencyKey,
  normalizePhone,
  parseApiFailure,
  parseLeadsEndpoint,
  retryAfterSeconds,
} from '../src/shared/leads-endpoint.ts';
import { buildPayload, validateForm, DEFAULT_TEXTS, successMessage } from '../src/client/leads-form.ts';
import { fieldText, FIELD_TEXTS } from '../src/client/review-form.ts';
import { pickNew, reviewKey, plural as livePlural, formatDayMonth } from '../src/client/reviews-live.ts';

/* ------------------------------------------------------------------ */
/*  Минимальный DOM: ровно тот, который используют формы               */
/* ------------------------------------------------------------------ */

interface FakeEl {
  value?: string;
  checked?: boolean;
  required?: boolean;
  dataset?: Record<string, string>;
  textContent?: string;
  hidden?: boolean;
  classList: { toggle: () => void; add: () => void; remove: () => void };
  getAttribute: (name: string) => string | null;
  setAttribute: () => void;
  removeAttribute: () => void;
  focus: () => void;
  children?: FakeEl[];
  querySelectorAll?: () => FakeEl[];
}

function el(props: Partial<FakeEl> = {}): FakeEl {
  return {
    value: '',
    checked: false,
    required: false,
    dataset: {},
    textContent: '',
    hidden: true,
    classList: { toggle: () => {}, add: () => {}, remove: () => {} },
    getAttribute: () => null,
    setAttribute: () => {},
    removeAttribute: () => {},
    focus: () => {},
    ...props,
  };
}

/** Форма: поля по имени + data-атрибуты. Всё, чего нет, — пустое поле. */
function makeForm(fields: Record<string, FakeEl>, dataset: Record<string, string> = {}): HTMLFormElement {
  const form = el({ dataset, children: [] }) as unknown as {
    dataset: Record<string, string>;
    querySelector: (sel: string) => FakeEl | null;
    querySelectorAll: (sel: string) => FakeEl[];
  };
  form.querySelector = (sel: string) => {
    const match = /\[name="([^"]+)"\]/.exec(sel);
    if (match) return fields[match[1]] ?? null;
    const errorMatch = /\[data-error="([^"]+)"\]/.exec(sel);
    if (errorMatch) return el();
    return el();
  };
  form.querySelectorAll = () => [];
  return form as unknown as HTMLFormElement;
}

/* ------------------------------------------------------------------ */
/*  Адрес приёмника                                                    */
/* ------------------------------------------------------------------ */

test('адрес приёмника: пусто — это режим «только телефон», а не ошибка', () => {
  assert.deepEqual(parseLeadsEndpoint(''), { base: '', error: null });
  assert.deepEqual(parseLeadsEndpoint(null), { base: '', error: null });
  assert.deepEqual(parseLeadsEndpoint('   '), { base: '', error: null });
});

test('адрес приёмника: https, без хвостового слэша и query', () => {
  assert.deepEqual(parseLeadsEndpoint('https://kadry-leads.example.workers.dev/'), {
    base: 'https://kadry-leads.example.workers.dev',
    error: null,
  });
  assert.equal(parseLeadsEndpoint('http://kadry-leads.example.workers.dev').error, 'адрес приёмника должен начинаться с https://');
  assert.match(String(parseLeadsEndpoint('https://x.dev/?a=1').error), /\?|#/);
  assert.match(String(parseLeadsEndpoint('https://x .dev').error), /пробел/);
  assert.match(String(parseLeadsEndpoint('https://').error), /хост/);
});

test('адреса ресурсов: и с приёмником, и без него', () => {
  assert.equal(buildLeadsUrl('', 'leads'), '/api/leads');
  assert.equal(buildLeadsUrl('https://w.dev', 'leads'), 'https://w.dev/leads');
  assert.equal(buildLeadsUrl('https://w.dev', 'reviews'), 'https://w.dev/reviews');
  assert.equal(buildLeadsUrl('https://w.dev', 'files', 'token=abc'), 'https://w.dev/files?token=abc');
});

test('ссылка на файл: относительная превращается в абсолютную', () => {
  assert.equal(absoluteLeadsUrl('https://w.dev', '/files/a.b'), 'https://w.dev/files/a.b');
  assert.equal(absoluteLeadsUrl('https://w.dev', 'files/a.b'), 'https://w.dev/files/a.b');
  assert.equal(absoluteLeadsUrl('https://w.dev', 'https://cdn.example/a.b'), 'https://cdn.example/a.b');
  assert.equal(absoluteLeadsUrl('', '/files/a.b'), '/files/a.b');
  assert.equal(absoluteLeadsUrl('https://w.dev', ''), '');
});

test('конфигурация сборки по умолчанию пустая и без ошибки', () => {
  /* В тестах переменная не задана: сайт обязан работать как честная статика. */
  if (!process.env.PUBLIC_LEADS_ENDPOINT) {
    assert.equal(LEADS_ENDPOINT_ERROR, null);
  }
});

/* ------------------------------------------------------------------ */
/*  Телефон, ключ идемпотентности, Retry-After                         */
/* ------------------------------------------------------------------ */

test('телефон: 8, +7, скобки и дефисы — один и тот же номер', () => {
  for (const raw of ['8 (961) 302-21-12', '+7 961 302 21 12', '89613022112', '9613022112', '+7(961)302-21-12']) {
    assert.equal(normalizePhone(raw), '+79613022112', raw);
  }
  assert.equal(normalizePhone(''), '');
  assert.equal(normalizePhone('нет цифр'), '');
});

test('ключ идемпотентности — валидный UUID v4, каждый раз новый', () => {
  const a = makeIdempotencyKey();
  const b = makeIdempotencyKey();
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(a, b);
});

test('Retry-After читается как секунды и как дата', () => {
  assert.equal(retryAfterSeconds('30'), 30);
  assert.equal(retryAfterSeconds(null), null);
  assert.equal(retryAfterSeconds('не дата'), null);
  const future = new Date(Date.now() + 60_000).toUTCString();
  const seconds = retryAfterSeconds(future);
  assert.ok(seconds !== null && seconds >= 55 && seconds <= 61, `ожидали ~60, получили ${seconds}`);
});

/* ------------------------------------------------------------------ */
/*  Ошибки приёмника                                                   */
/* ------------------------------------------------------------------ */

test('ошибка приёмника: плоский и вложенный вид понимаются одинаково', () => {
  const flat = parseApiFailure({ error: 'validation', fields: { phone: 'bad_phone' } });
  assert.equal(flat?.code, 'validation');
  assert.equal(flat?.fields.phone, 'bad_phone');

  const nested = parseApiFailure({ error: { code: 'validation', fields: { text: 'too_short' } } });
  assert.equal(nested?.code, 'validation');
  assert.equal(nested?.fields.text, 'too_short');

  const rate = parseApiFailure({ error: 'too_many', retryAfter: 45 });
  assert.equal(rate?.code, 'too_many');

  assert.equal(parseApiFailure(null), null);
  assert.equal(parseApiFailure('строка'), null);
  assert.equal(parseApiFailure({}), null);
});

test('ошибки полей формы отзыва переводятся по-русски', () => {
  assert.equal(fieldText('author', 'too_short'), FIELD_TEXTS.author.too_short);
  assert.match(String(fieldText('text', 'too_short')), /20/);
  assert.match(String(fieldText('text', 'too_long')), /1500/);
  assert.equal(fieldText('чепуха', 'что-то'), null, 'незнакомый код — без выдуманного текста');
});

/* ------------------------------------------------------------------ */
/*  Тело заявки                                                        */
/* ------------------------------------------------------------------ */

const started = Date.now() - 10_000;
const idem = '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b';

test('заявка «консультация»: поля, согласие, версия согласия, страница', () => {
  const form = makeForm({
    name: el({ value: 'Мария' }),
    phone: el({ value: '8 961 302-21-12' }),
    consent: el({ checked: true }),
    comment: el({ value: 'Нужен аудит документов, в штате 12 человек.' }),
    email: el({ value: 'client@example.ru' }),
    company: el({ value: 'ООО «Ромашка»' }),
  }, { leadKind: 'consult', page: 'audit', consentVersion: CONSENT_VERSION });

  const payload = buildPayload(form, started, idem);
  assert.equal(payload.kind, 'consult');
  assert.equal(payload.name, 'Мария');
  assert.equal(payload.phone, '79613022112', 'номер уходит без плюса — так его ждёт воркер');
  assert.equal(payload.consent, true);
  assert.equal(payload.consent_version, CONSENT_VERSION);
  assert.equal(payload.page, 'audit');
  assert.equal(payload.idempotency_key, idem);
  assert.equal(payload.form_started_at, started);
  assert.equal(payload.message, 'Нужен аудит документов, в штате 12 человек.');
  assert.equal(payload.email, 'client@example.ru');
  assert.equal(payload.company, 'ООО «Ромашка»');
  assert.equal(payload.calc, undefined, 'у консультации нет расчёта');
});

test('заявка из калькулятора несёт штат, зарплату, тариф и экономию', () => {
  const form = makeForm({
    name: el({ value: 'Мария' }),
    phone: el({ value: '+7 961 302 21 12' }),
    consent: el({ checked: true }),
    calc_staff: el({ value: '5' }),
    calc_salary: el({ value: '60000' }),
    calc_tariff: el({ value: 'Бизнес' }),
    calc_savings_month: el({ value: '49590' }),
    calc_savings_year: el({ value: '595080' }),
  }, { leadKind: 'calculator', page: 'index' });

  const payload = buildPayload(form, started, idem);
  assert.deepEqual(payload.calc, {
    staff: 5,
    salary_net: 60000,
    tariff: 'Бизнес',
    savings_month: 49590,
    savings_year: 595080,
  });
});

test('заявка на шаблон несёт id, название, пакет и цену', () => {
  const template = JSON.stringify({ id: 'prikaz-o-prieme', title: 'Приказ о приёме', package: 'paid', price: 500 });
  const form = makeForm({
    name: el({ value: 'Мария' }),
    phone: el({ value: '89613022112' }),
    email: el({ value: 'client@example.ru' }),
    consent: el({ checked: true }),
    template_id: el({ value: 'prikaz-o-prieme' }),
  }, { leadKind: 'template', template, page: 'shablony' });

  const payload = buildPayload(form, started, idem);
  assert.deepEqual(payload.template, {
    id: 'prikaz-o-prieme',
    title: 'Приказ о приёме',
    package: 'paid',
    price: 500,
  });
});

test('ловушка для ботов уходит в приёмник, а не прячется в браузере', () => {
  /* Решение бота принимает воркер: он отвечает «201», но ничего не отправляет.
     Если поле потерять здесь, бот получит настоящую заявку. */
  const form = makeForm({
    name: el({ value: 'Бот' }),
    phone: el({ value: '89613022112' }),
    honeypot: el({ value: 'http://spam.example' }),
    consent: el({ checked: true }),
  }, { leadKind: 'consult', page: 'contact' });
  assert.equal(buildPayload(form, started, idem).honeypot, 'http://spam.example');

  const legacy = makeForm({
    name: el({ value: 'Бот' }),
    phone: el({ value: '89613022112' }),
    _gotcha: el({ value: 'мусор' }),
    consent: el({ checked: true }),
  }, { leadKind: 'consult' });
  assert.equal(buildPayload(legacy, started, idem).honeypot, 'мусор', 'старое поле Formspree тоже ловим');
});

test('пустые необязательные поля не засоряют заявку', () => {
  const form = makeForm({
    name: el({ value: 'Мария' }),
    phone: el({ value: '89613022112' }),
    consent: el({ checked: true }),
    email: el({ value: '  ' }),
    company: el({ value: '' }),
  }, { leadKind: 'consult' });
  const payload = buildPayload(form, started, idem);
  assert.equal('email' in payload, false);
  assert.equal('company' in payload, false);
  assert.equal('message' in payload, false);
});

/* ------------------------------------------------------------------ */
/*  Проверка до отправки                                               */
/* ------------------------------------------------------------------ */

test('без телефона и согласия заявка не уходит', () => {
  const form = makeForm({
    name: el({ value: 'М' }),
    phone: el({ value: '123' }),
    consent: el({ checked: false }),
  }, { leadKind: 'consult' });
  assert.equal(validateForm(form), false);
});

test('нормальные данные проходят проверку', () => {
  const form = makeForm({
    name: el({ value: 'Мария' }),
    phone: el({ value: '8 (961) 302-21-12' }),
    consent: el({ checked: true }),
  }, { leadKind: 'consult' });
  assert.equal(validateForm(form), true);
});

test('шаблон за email требует почту, платный — нет', () => {
  const base = {
    name: el({ value: 'Мария' }),
    phone: el({ value: '89613022112' }),
    consent: el({ checked: true }),
    email: el({ value: '' }),
  };

  const emailPkg = makeForm({ ...base }, {
    leadKind: 'template',
    template: JSON.stringify({ id: 't1', title: 'Т', package: 'email', price: 0 }),
  });
  assert.equal(validateForm(emailPkg), false, 'для email-шаблона почта обязательна');

  const paid = makeForm({ ...base }, {
    leadKind: 'template',
    template: JSON.stringify({ id: 't2', title: 'Т', package: 'paid', price: 500 }),
  });
  assert.equal(validateForm(paid), true, 'для платного шаблона почта не нужна');
});

/* ------------------------------------------------------------------ */
/*  Расчёт со страницы                                                 */
/* ------------------------------------------------------------------ */

test('расчёт калькулятора снимается со страницы, даже без скрытых полей', () => {
  /* Макет настоящего калькулятора: штат, зарплата, тариф и две строки экономии. */
  const fields: Record<string, FakeEl> = {
    '#staff-count': el({ value: '5' }),
    '#salary': el({ value: '60000' }),
    '[data-calc-tariff][data-value]': el({
      textContent: 'Бизнес',
      dataset: { value: 'Бизнес' },
      getAttribute: (name: string) => (name === 'data-value' ? 'Бизнес' : null),
    }),
    '[data-calc-staff]': el({ value: '' }),
    '[data-calc-salary]': el({ value: '' }),
    '[data-calc-tariff]': el({
      textContent: 'Бизнес',
      dataset: { value: 'Бизнес' },
      getAttribute: (name: string) => (name === 'data-value' ? 'Бизнес' : null),
    }),
    '[data-calc-savings-month]': el({ value: '49590' }),
    '[data-calc-savings-year]': el({ value: '595080' }),
  };

  const doc = {
    querySelector: (sel: string) => fields[sel] ?? null,
    querySelectorAll: () => [],
  };
  const summary = collectCalcSummary(doc as unknown as Parameters<typeof collectCalcSummary>[0]);
  assert.ok(summary, 'расчёт должен собираться');
  assert.equal(summary.staff, 5);
  assert.equal(summary.salary_net, 60000);
  assert.equal(summary.tariff, 'Бизнес');
  assert.equal(summary.savings_month, 49590);
  assert.equal(summary.savings_year, 595080);
});

test('без штата или зарплаты расчёт честно пустой, а не нулевой', () => {
  const doc = { querySelector: () => null, querySelectorAll: () => [] };
  assert.equal(collectCalcSummary(doc as unknown as Parameters<typeof collectCalcSummary>[0]), null);
});

/* ------------------------------------------------------------------ */
/*  Живые отзывы на странице                                           */
/* ------------------------------------------------------------------ */

test('новые живые отзывы не дублируют уже показанные', () => {
  const live = [
    { id: 'r-1', author: 'Павел И.', text: 'Спасибо, всё сделали быстро и по делу.', rating: 5, published_at: '2026-11-20' },
    { id: 'r-2', author: 'Анна К.', text: 'Помогли с восстановлением документов, рекомендую.', rating: 5, published_at: '2026-11-21' },
  ];
  const existing = new Set([reviewKey(live[0])]);
  const fresh = pickNew(live as never, existing);
  assert.deepEqual(fresh.map((r) => r.id), ['r-2']);
});

test('ключ отзыва не зависит от лишних пробелов', () => {
  assert.equal(
    reviewKey({ author: ' Павел  И. ', text: 'Текст  отзыва', rating: 5 }),
    reviewKey({ author: 'Павел И.', text: 'Текст отзыва', rating: 5 }),
  );
});

test('подписи на странице отзывов склоняются верно', () => {
  assert.equal(livePlural(1, 'отзыв', 'отзыва', 'отзывов'), 'отзыв');
  assert.equal(livePlural(3, 'отзыв', 'отзыва', 'отзывов'), 'отзыва');
  assert.equal(livePlural(11, 'отзыв', 'отзыва', 'отзывов'), 'отзывов');
});

test('дата в карточке отзыва — день и месяц, с годом только для прошлых лет', () => {
  const now = new Date('2026-11-23T10:00:00Z');
  assert.equal(formatDayMonth('2026-11-20', now), '20 ноября');
  assert.equal(formatDayMonth('2025-12-31', now), '31 декабря 2025');
});

test('результат заявки называет только каналы, подтверждённые Worker', () => {
  assert.match(successMessage({ telegram: true, email: true }), /Telegram и на почту/);
  assert.match(successMessage({ telegram: true, email: false }), /Telegram/);
  assert.match(successMessage({ telegram: false, email: true }), /на почту/);
  assert.match(successMessage(), /свяжется с вами/);
});

test('тексты формы заявки — понятные и без Formspree', () => {
  for (const text of Object.values(DEFAULT_TEXTS)) {
    assert.match(text, /[А-Яа-яЁё]/);
    assert.doesNotMatch(text, /formspree/i);
  }
});
