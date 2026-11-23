/**
 * Тесты прослойки: сеть подменена, наружу ничего не уходит.
 *
 * Проверяем то, что ломается незаметно:
 *   - нормализацию телефона и отказ «странным» заявкам;
 *   - ловушку для ботов и «слишком быстрое» заполнение (201 и тишина);
 *   - доставку хотя бы в один канал и 502, когда не сработал ни один;
 *   - CORS и проверку Origin у отзывов;
 *   - публикацию отзыва без модерации и модерацию по ключу GitHub;
 *   - подписанные ссылки на файлы: подпись, срок, подделка.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { resetMemoryStore } from '../src/index.ts';
import { normalizePhone, validateLead, MIN_FILL_MS } from '../src/validate.ts';
import { validateReview, looksLikeLink } from '../src/reviews-validate.ts';
import { signFileToken, verifyFileToken, downloadName } from '../src/files.ts';
import { composeTelegram, fmtPhone } from '../src/telegram.ts';
import { composeEmail } from '../src/email.ts';

type Env = Parameters<typeof worker.fetch>[1];

const ORIGIN = 'https://kadry-pro.ru';
const UUID = '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b';

interface FakeTelegram {
  calls: { url: string; body: { chat_id: string; text: string } }[];
}

/** Подменяем глобальный fetch: Telegram и почта «работают», наружу ничего не идёт. */
function mockFetch(opts: { telegramStatus?: number; mailStatus?: number } = {}): FakeTelegram {
  /* Без KV лимиты и идемпотентность живут в памяти модуля — чистим её, чтобы
     тесты не упирались в лимит, набранный соседним тестом. */
  resetMemoryStore();
  const fake: FakeTelegram = { calls: [] };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    fake.calls.push({ url, body });
    if (url.includes('api.telegram.org')) {
      return new Response(JSON.stringify({ ok: (opts.telegramStatus ?? 200) < 300 }), { status: opts.telegramStatus ?? 200 });
    }
    return new Response(JSON.stringify({ ok: (opts.mailStatus ?? 200) < 300 }), { status: opts.mailStatus ?? 200 });
  }) as typeof fetch;
  return fake;
}

function baseEnv(extra: Partial<Env> = {}): Env {
  return {
    ALLOWED_ORIGINS: ORIGIN,
    SITE_NAME: 'Кадры-Про',
    CONSENT_VERSION: '2026-11-21',
    BOT_TOKEN: 'test-token',
    TELEGRAM_CHAT_ID: '-1001234567890',
    TELEGRAM_API_BASE: 'https://api.telegram.org',
    ...extra,
  } as Env;
}

function leadBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'consult',
    name: 'Иван Петров',
    phone: '+7 (961) 302-21-12',
    contact_method: 'call',
    message: 'Нужен аудит кадрового учёта для компании',
    consent: true,
    consent_version: '2026-11-21',
    page: 'contact',
    idempotency_key: UUID,
    honeypot: '',
    ...overrides,
  };
}

/** Каждый запрос — с новым ключом идемпотентности и «старой» отметкой времени:
   иначе тесты мешают друг другу через общий KV (повторный ключ = дубль). */
function freshBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return leadBody({
    idempotency_key: crypto.randomUUID(),
    form_started_at: Date.now() - MIN_FILL_MS - 1000,
    ...overrides,
  });
}

async function post(path: string, body: unknown, env: Env, headers: Record<string, string> = {}): Promise<Response> {
  return worker.fetch(new Request(`https://relay.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  }), env);
}

/* ----------------------------- заявки ----------------------------- */

test('телефон нормализуется из любого вида, мусор отвергается', () => {
  assert.equal(normalizePhone('+7 (961) 302-21-12'), '+79613022112');
  assert.equal(normalizePhone('8 961 302 21 12'), '+79613022112');
  assert.equal(normalizePhone('9613022112'), '+79613022112');
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone('+1 555 000 00 00'), null);
});

test('заявка-консультация проходит, поля собираются как надо', () => {
  const v = validateLead(leadBody());
  assert.equal(v.ok, true);
  if (!v.ok) return;
  assert.equal(v.value.kind, 'consult');
  assert.equal(v.value.phone, '+79613022112');
  assert.equal(v.value.page, 'contact');
});

test('без согласия, без имени и с коротким сообщением — понятные ошибки полей', () => {
  const v = validateLead(leadBody({ name: 'И', consent: false, message: 'ок' }));
  assert.equal(v.ok, false);
  if (v.ok) return;
  assert.equal(v.error, 'validation');
  assert.ok(v.fields.name);
  assert.ok(v.fields.consent);
  assert.ok(v.fields.message);
});

test('устаревшая версия согласия отвергается с кодом consent_version', async () => {
  mockFetch();
  const res = await post('/leads', leadBody({ consent_version: '2025-01-01' }), baseEnv());
  assert.equal(res.status, 400);
  const body = await res.json() as { error: { code: string } };
  assert.equal(body.error.code, 'consent_version');
});

test('ловушка для ботов: 201 и ни одного сообщения', async () => {
  const fake = mockFetch();
  const res = await post('/leads', leadBody({ honeypot: 'viagra' }), baseEnv());
  assert.equal(res.status, 201);
  const body = await res.json() as { ticket: string };
  assert.match(body.ticket, /^K-\d{4}-\d{4}$/);
  assert.equal(fake.calls.length, 0);
});

test('слишком быстрое заполнение не доставляется, но выглядит успехом', async () => {
  const fake = mockFetch();
  const res = await post('/leads', leadBody({ form_started_at: Date.now() - (MIN_FILL_MS - 1000) }), baseEnv());
  assert.equal(res.status, 201);
  assert.equal(fake.calls.length, 0);
});

test('заявка уходит в Telegram и на почту, талон возвращается', async () => {
  const fake = mockFetch();
  const res = await post('/leads', leadBody({ form_started_at: Date.now() - MIN_FILL_MS - 1000 }), baseEnv({ BREVO_API_KEY: 'x' }));
  assert.equal(res.status, 201);
  const body = await res.json() as { ticket: string; delivered: { telegram: boolean; email: boolean } };
  assert.match(body.ticket, /^K-\d{4}-\d{4}$/);
  assert.equal(body.delivered.telegram, true);
  assert.equal(body.delivered.email, true);
  const tg = fake.calls.find((c) => c.url.includes('api.telegram.org'));
  assert.ok(tg);
  assert.match(tg.body.text, /Иван Петров/);
  assert.match(tg.body.text, /\+7 \(961\) 302-21-12/);
  assert.ok(fake.calls.some((c) => c.url.includes('api.brevo.com')));
});

test('Telegram упал — заявка всё равно принята, если дошло письмо', async () => {
  const fake = mockFetch({ telegramStatus: 500 });
  const res = await post('/leads', freshBody(), baseEnv({ BREVO_API_KEY: 'x' }));
  assert.equal(res.status, 201);
  const body = await res.json() as { delivered: { telegram: boolean; email: boolean } };
  assert.deepEqual(body.delivered, { telegram: false, email: true });
  assert.ok(fake.calls.some((c) => c.url.includes('api.brevo.com')));
});

test('оба канала упали — 502 с просьбой позвонить', async () => {
  mockFetch({ telegramStatus: 500, mailStatus: 500 });
  const res = await post('/leads', freshBody(), baseEnv({ BREVO_API_KEY: 'x' }));
  assert.equal(res.status, 502);
  const body = await res.json() as { error: { code: string; message: string } };
  assert.equal(body.error.code, 'delivery');
  assert.match(body.error.message, /Позвоните/);
});

test('повторная отправка с тем же ключом не дублирует уведомление', async () => {
  const fake = mockFetch();
  const env = baseEnv();
  const body = freshBody();
  const first = await post('/leads', body, env);
  assert.equal(first.status, 201);
  const callsAfterFirst = fake.calls.length;
  const second = await post('/leads', body, env);
  assert.equal(second.status, 201);
  const payload = await second.json() as { duplicate: boolean };
  assert.equal(payload.duplicate, true);
  assert.equal(fake.calls.length, callsAfterFirst);
});

test('заявка с калькулятора несёт штат, зарплату и экономию', async () => {
  const fake = mockFetch();
  const res = await post('/leads', freshBody({
    kind: 'calculator',
    page: 'index',
    calc: { staff: 25, salary_net: 60000, tariff: 'Бизнес — 24 000 ₽/мес', savings_month: 58345, savings_year: 700140 },
  }), baseEnv());
  assert.equal(res.status, 201);
  const tg = fake.calls.find((c) => c.url.includes('api.telegram.org'));
  assert.ok(tg);
  assert.match(tg.body.text, /Штат: <b>25<\/b>/);
  /* toLocaleString('ru-RU') ставит неразрывный пробел — сверяем по цифрам. */
  assert.match(tg.body.text, /58\D?345 ₽/);
  assert.match(tg.body.text, /700\D?140 ₽/);
});

test('заявка на email-шаблон без адреса почты отвергается', async () => {
  const v = validateLead(leadBody({
    kind: 'template',
    template: { id: 't21', title: 'Приказ о командировке', package: 'email', price: 0 },
  }));
  assert.equal(v.ok, false);
  if (v.ok) return;
  assert.ok(v.fields.email);
});

test('заявка на полный пакет возвращает подписанную ссылку только при подключённом бакете', async () => {
  const fake = mockFetch();
  const body = freshBody({
    kind: 'template',
    page: 'shablony',
    template: { id: null, title: 'Полный пакет 64 документа', package: 'full', price: 3500 },
  });
  const without = await post('/leads', body, baseEnv());
  assert.equal(without.status, 201);
  const a = await without.json() as { download?: string };
  assert.equal(a.download, undefined);

  const withBucket = await post('/leads', { ...body, idempotency_key: crypto.randomUUID() }, baseEnv({
    FILE_TOKEN_SECRET: 'secret',
    TEMPLATES: { get: async () => null } as unknown as Env['TEMPLATES'],
  }));
  assert.equal(withBucket.status, 201);
  const b = await withBucket.json() as { download?: string };
  assert.match(b.download ?? '', /^\/files\/full-bundle-64\.\d+\./);
  assert.ok(fake.calls.length >= 2);
});

test('CORS: разрешённому источнику возвращается его Origin, чужому — null', async () => {
  mockFetch();
  const env = baseEnv();
  const ok = await worker.fetch(new Request('https://relay.test/health', { headers: { origin: ORIGIN } }), env);
  assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN);
  const bad = await worker.fetch(new Request('https://relay.test/health', { headers: { origin: 'https://evil.example' } }), env);
  assert.equal(bad.headers.get('access-control-allow-origin'), 'null');
});

test('/health показывает состояние каналов, отзывов и файлов', async () => {
  const res = await worker.fetch(new Request('https://relay.test/health'), baseEnv({ BREVO_API_KEY: 'x' }));
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.service, 'kadry-leads');
  assert.equal(body.telegram, true);
  assert.equal(body.email, 'brevo');
  assert.equal(body.reviews, true);
  assert.equal(body.files, false);
  assert.equal(body.consentVersion, '2026-11-21');
});

/* ----------------------------- отзывы ----------------------------- */

const reviewBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  author: 'Ольга К.',
  text: 'Мария привела в порядок кадровые документы за две недели, проверка ГИТ прошла без замечаний.',
  rating: 5,
  consent: true,
  consentVersion: '2026-11-21',
  honeypot: '',
  page: 'otzyvy',
  ...overrides,
});

test('отзыв публикуется сразу, уведомление уходит в Telegram', async () => {
  const fake = mockFetch();
  const env = baseEnv();
  const res = await post('/reviews', reviewBody(), env);
  assert.equal(res.status, 201);
  const body = await res.json() as { ok: boolean; status: string; id: string };
  assert.equal(body.ok, true);
  assert.equal(body.status, 'published');
  assert.ok(body.id);

  const list = await worker.fetch(new Request('https://relay.test/reviews'), env);
  const data = await list.json() as { items: { author: string }[]; total: number };
  assert.equal(data.total, 1);
  assert.equal(data.items[0].author, 'Ольга К.');
  assert.ok(fake.calls.some((c) => String(c.body.text).includes('Новый отзыв')));
});

test('отзыв с чужого сайта не принимается и не тратит лимит', async () => {
  mockFetch();
  const res = await post('/reviews', reviewBody(), baseEnv(), { origin: 'https://evil.example' });
  assert.equal(res.status, 403);
  const body = await res.json() as { error: string };
  assert.equal(body.error, 'origin');
});

test('ссылки и повторяющиеся строки в отзыве отвергаются', () => {
  assert.equal(looksLikeLink('смотрите https://spam.example'), true);
  assert.equal(looksLikeLink('мой t.me/channel'), true);
  assert.equal(looksLikeLink('зарплата 60 000 руб, всё честно'), false);

  const v = validateReview(reviewBody({ text: 'Пишите мне на https://spam.example/price — там всё дешевле, чем здесь' }));
  assert.equal(v.ok, false);
  if (v.ok) return;
  assert.equal(v.error, 'link_not_allowed');

  const repeated = validateReview(reviewBody({ text: 'купить купить\nкупить купить\nкупить купить\nкупить купить\nкупить купить' }));
  assert.equal(repeated.ok, false);
  if (repeated.ok) return;
  assert.equal(repeated.fields.text, 'repeated_lines');
});

test('оценка обязательна: пропуск не превращается в пять звёзд', () => {
  const v = validateReview(reviewBody({ rating: undefined }));
  assert.equal(v.ok, false);
  if (v.ok) return;
  assert.equal(v.fields.rating, 'required');
});

test('отзыв с ловушкой: 201, но нигде не публикуется', async () => {
  mockFetch();
  const env = baseEnv();
  const res = await post('/reviews', reviewBody({ honeypot: 'bot', author: 'Бот Ботов', text: 'Этот отзыв прислал робот и он не должен попасть на сайт ни при каких условиях.' }), env);
  assert.equal(res.status, 201);
  const list = await worker.fetch(new Request('https://relay.test/reviews'), env);
  const data = await list.json() as { items: { author: string }[] };
  assert.equal(data.items.some((r) => r.author === 'Бот Ботов'), false);
});

test('журнал отзывов открывается ключом GitHub с правом записи, чужой получает 403', async () => {
  const fake = mockFetch();
  const env = baseEnv();
  await post('/reviews', reviewBody(), env);

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes('api.github.com')) {
      return new Response(JSON.stringify({ permissions: { push: true } }), { status: 200 });
    }
    return realFetch(input);
  }) as typeof fetch;
  try {
    const inbox = await worker.fetch(new Request('https://relay.test/reviews/inbox', {
      headers: { authorization: 'Bearer github_pat_good' },
    }), env);
    assert.equal(inbox.status, 200);
    const data = await inbox.json() as { items: unknown[] };
    assert.equal(data.items.length, 1);

    const hidden = await post('/reviews/moderate', { id: (data.items[0] as { id: string }).id, action: 'hide' }, env, {
      authorization: 'Bearer github_pat_good',
    });
    assert.equal(hidden.status, 200);
    const list = await worker.fetch(new Request('https://relay.test/reviews'), env);
    assert.equal(((await list.json()) as { total: number }).total, 0);

    const noKey = await worker.fetch(new Request('https://relay.test/reviews/inbox'), env);
    assert.equal(noKey.status, 403);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(fake.calls.some((c) => c.url.includes('api.telegram.org')));
});

test('ответ Марии на отзыв сохраняется и виден публично', async () => {
  mockFetch();
  const env = baseEnv({ REVIEWS_INBOX_KEY: 'manual-code' });
  const created = await post('/reviews', reviewBody(), env);
  const { id } = await created.json() as { id: string };
  const res = await post('/reviews/reply', { id, reply: 'Спасибо, Ольга! Рада, что проверка прошла спокойно.' }, env, {
    'x-inbox-key': 'manual-code',
  });
  assert.equal(res.status, 200);
  const list = await worker.fetch(new Request('https://relay.test/reviews'), env);
  const data = await list.json() as { items: { reply?: string }[] };
  assert.match(data.items[0].reply ?? '', /Спасибо, Ольга/);
});

/* ----------------------------- файлы ----------------------------- */

test('подписанная ссылка проверяется, подделка и просрочка не проходят', async () => {
  const env = { FILE_TOKEN_SECRET: 'secret-value' };
  const token = await signFileToken(env, 'full-bundle-64');
  assert.match(token, /^full-bundle-64\.\d+\.[0-9a-f]{64}$/);

  const good = await verifyFileToken(env, token);
  assert.deepEqual(good, { ok: true, id: 'full-bundle-64' });

  const tampered = await verifyFileToken(env, token.replace('full-bundle-64', 'email-bundle-25'));
  assert.equal(tampered.ok, false);

  const later = new Date(Date.now() + 25 * 3600_000);
  const expired = await verifyFileToken(env, token, later);
  assert.deepEqual(expired, { ok: false, reason: 'expired' });

  const otherSecret = await verifyFileToken({ FILE_TOKEN_SECRET: 'other' }, token);
  assert.deepEqual(otherSecret, { ok: false, reason: 'bad_token' });

  const noSecret = await verifyFileToken({}, token);
  assert.deepEqual(noSecret, { ok: false, reason: 'no_secret' });
});

test('/files отдаёт PDF из бакета и 404 без бакета', async () => {
  const token = await signFileToken({ FILE_TOKEN_SECRET: 'secret-value' }, 'full-bundle-64');
  const pdf = new Blob(['%PDF-1.4 test'], { type: 'application/pdf' });
  const found = await worker.fetch(
    new Request(`https://relay.test/files/${token}`),
    baseEnv({
      FILE_TOKEN_SECRET: 'secret-value',
      TEMPLATES: {
        get: async (key: string) => (key === 'full-bundle-64.pdf'
          ? { body: pdf.stream(), httpMetadata: { contentType: 'application/pdf' }, size: pdf.size }
          : null),
      } as unknown as Env['TEMPLATES'],
    }),
  );
  assert.equal(found.status, 200);
  assert.match(found.headers.get('content-disposition') ?? '', /attachment/);
  assert.equal(found.headers.get('content-type'), 'application/pdf');

  const missing = await worker.fetch(new Request('https://relay.test/files/broken'), baseEnv({ FILE_TOKEN_SECRET: 'secret-value' }));
  assert.equal(missing.status, 404);

  const noBucket = await worker.fetch(new Request(`https://relay.test/files/${token}`), baseEnv({ FILE_TOKEN_SECRET: 'secret-value' }));
  assert.equal(noBucket.status, 404);
  const body = await noBucket.json() as { error: string };
  assert.equal(body.error, 'files_not_configured');
});

test('имя файла при скачивании — по-русски и без сюрпризов', () => {
  assert.equal(downloadName('full-bundle-64'), 'kadry-pro-64-shablona.pdf');
  assert.equal(downloadName('email-bundle-25'), 'kadry-pro-25-shablonov.pdf');
  assert.equal(downloadName('t02'), 't02.pdf');
});

/* ------------------------- текст уведомлений ------------------------- */

test('телефон в уведомлении читается человеком', () => {
  assert.equal(fmtPhone('+79613022112'), '+7 (961) 302-21-12');
});

test('уведомление и письмо экранируют текст клиента', () => {
  const env = baseEnv();
  const v = validateLead(leadBody({ message: 'Нужен <b>аудит</b> срочно, есть <script>', form_started_at: 1 }));
  assert.equal(v.ok, true);
  if (!v.ok) return;
  const tg = composeTelegram(v.value, 'K-1121-1000', { siteName: 'Кадры-Про' });
  assert.ok(!tg.includes('<script>'));
  assert.match(tg, /&lt;script&gt;/);
  const mail = composeEmail(v.value, 'K-1121-1000', { siteName: 'Кадры-Про' });
  assert.match(mail.subject, /Иван Петров/);
  assert.match(mail.text, /Ответить клиенту/);
});
