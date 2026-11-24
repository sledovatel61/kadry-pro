/**
 * Тесты серверной обработки заявок на конкретный платный шаблон (Раунд 9).
 *
 * Проверяют:
 *   - все 44 платных ID: сверка с site/content/templates.json и коммитом git,
 *     верное название, серверная цена 500 ₽ и прямая ссылка на нужный PDF
 *     в ОБОИХ уведомлениях (Telegram и почта: text + html), отсутствие ссылки
 *     в ответе покупателю;
 *   - русские имена файлов (включая «ё» и дефисы): корректное RFC-3986 кодирование;
 *   - недоверие цене, названию и произвольным полям из браузера;
 *   - неизвестный ID и бесплатный ID: заявка доставляется Марии без потери,
 *     но ссылка НЕ формируется и поддельная цена не подтверждается;
 *   - полный пакет (package: 'full'): серверная цена 3 500 ₽, отсутствие
 *     придуманной ссылки на несуществующий архив 64 документов;
 *   - экранирование HTML и кавычек во всех полях уведомлений.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import worker, { resetMemoryStore, type Env } from '../src/index.ts';
import { validateLead } from '../src/validate.ts';
import { composeTelegram } from '../src/telegram.ts';
import { composeEmail } from '../src/email.ts';
import {
  PAID_TEMPLATES,
  PAID_TEMPLATES_BY_ID,
  PAID_TEMPLATES_COMMIT,
  PAID_TEMPLATES_REPO,
  FULL_BUNDLE_OFFER,
  buildPaidTemplateGithubUrl,
  resolveTemplateNotice,
} from '../src/paid-templates.ts';

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const ORIGIN = 'https://kadry-pro.ru';

interface SiteTemplateItem {
  id: string;
  name: string;
  price: number;
  free: boolean;
  filename: string;
}

const siteCatalog = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'site/content/templates.json'), 'utf8'),
) as { items: SiteTemplateItem[] };

const sitePrices = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'site/content/prices.json'), 'utf8'),
) as { groups: { id: string; items: { id: string; name: string; price: number }[] }[] };

interface CapturedCall {
  url: string;
  body: Record<string, unknown>;
}

function mockChannels() {
  resetMemoryStore();
  const calls: CapturedCall[] = [];
  const prev = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ url, body });
    return new Response(JSON.stringify({ ok: true, id: 'msg-1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = prev;
    },
  };
}

function testEnv(): Env {
  return {
    ALLOWED_ORIGINS: ORIGIN,
    CONSENT_VERSION: '2026-11-21',
    SITE_NAME: 'Кадры-Про',
    SITE_ADDRESS: 'Ростов-на-Дону',
    BOT_TOKEN: 'test-bot-token',
    TELEGRAM_CHAT_ID: '-1001234567890',
    BREVO_API_KEY: 'test-brevo-key',
    EMAIL_TO: 'm.perepechay@yandex.ru',
  };
}

test('серверный каталог платных шаблонов совпадает с templates.json, prices.json и коммитом git', () => {
  const expectedPaid = siteCatalog.items.filter((it) => !it.free);
  const freeItems = siteCatalog.items.filter((it) => it.free);
  assert.equal(expectedPaid.length, 44);
  assert.equal(PAID_TEMPLATES.length, 44);

  const tmplPrices = sitePrices.groups.find((g) => g.id === 'templates');
  assert.ok(tmplPrices);
  assert.equal(tmplPrices.items.find((i) => i.id === 'single')?.price, 500);
  assert.equal(tmplPrices.items.find((i) => i.id === 'bundle-64')?.price, FULL_BUNDLE_OFFER.price);

  /* Бесплатные ID не должны попадать в платный список. */
  for (const free of freeItems) {
    assert.equal(PAID_TEMPLATES_BY_ID.has(free.id), false, `бесплатный ID ${free.id} в платном списке`);
  }

  /* Проверяем наличие каждого из 44 PDF в зафиксированном коммите git и заголовок %PDF-. */
  const lsTree = execFileSync(
    'git',
    ['-c', 'core.quotepath=false', 'ls-tree', PAID_TEMPLATES_COMMIT, 'shablony/'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  const filesInCommit = new Set(
    lsTree
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t')[1].replace(/^shablony\//, '')),
  );

  for (const siteItem of expectedPaid) {
    const serverEntry = PAID_TEMPLATES_BY_ID.get(siteItem.id);
    assert.ok(serverEntry, `отсутствует платный ID ${siteItem.id}`);
    assert.equal(serverEntry.title, siteItem.name);
    assert.equal(serverEntry.price, 500);
    assert.equal(serverEntry.filename, siteItem.filename);
    assert.ok(serverEntry.filename.startsWith(`${siteItem.id}_`), `префикс файла ${serverEntry.filename}`);
    assert.ok(filesInCommit.has(serverEntry.filename), `в коммите нет файла ${serverEntry.filename}`);

    const header = execFileSync(
      'git',
      ['cat-file', '-p', `${PAID_TEMPLATES_COMMIT}:shablony/${serverEntry.filename}`],
      { cwd: REPO_ROOT, maxBuffer: 5 * 1024 * 1024 },
    ).subarray(0, 5).toString('latin1');
    assert.equal(header, '%PDF-', `некорректный PDF для ${serverEntry.filename}`);
  }
});

test('русские имена файлов (включая «ё» и дефисы) кодируются в чистый ASCII URL и декодируются обратно', () => {
  let cyrillicCount = 0;
  for (const entry of PAID_TEMPLATES) {
    const url = buildPaidTemplateGithubUrl(entry);
    assert.match(
      url,
      new RegExp(`^https://raw\\.githubusercontent\\.com/${PAID_TEMPLATES_REPO}/${PAID_TEMPLATES_COMMIT}/shablony/[A-Za-z0-9_%.-]+\\.pdf$`),
      `небезопасные символы в URL для ${entry.id}: ${url}`,
    );
    const tail = url.slice(url.lastIndexOf('/') + 1);
    assert.equal(decodeURIComponent(tail), entry.filename);
    if (/[А-Яа-яЁё]/.test(entry.filename)) {
      cyrillicCount++;
      assert.match(tail, /%[0-9A-F]{2}/, `кириллица должна быть процент-кодирована: ${entry.filename}`);
    }
  }
  assert.ok(cyrillicCount >= 35, 'большинство платных файлов имеют русские имена');
  /* Отдельно проверяем букву «ё» (ID 53, 55, 60) и дефис «ФЗ-152» (ID 28). */
  const t53 = PAID_TEMPLATES_BY_ID.get('53')!;
  assert.match(buildPaidTemplateGithubUrl(t53), /%D1%91/);
  const t28 = PAID_TEMPLATES_BY_ID.get('28')!;
  assert.match(buildPaidTemplateGithubUrl(t28), /%D0%A4%D0%97-152\.pdf$/);
});

test('все 44 платных ID дают верное название, серверную цену и ссылку на нужный файл в Telegram и письме, не раскрывая её клиенту', async () => {
  const mock = mockChannels();
  try {
    let idx = 0;
    for (const entry of PAID_TEMPLATES) {
      idx++;
      mock.calls.length = 0;
      /* В каждом запросе передаём заниженную цену (1 ₽), подменённое название и лишнее поле url
         из браузера — сервер обязан их проигнорировать и взять свои данные по ID. */
      const ip = `203.0.113.${idx}`;
      const res = await worker.fetch(
        new Request('https://relay.test/leads', {
          method: 'POST',
          headers: {
            origin: ORIGIN,
            'content-type': 'application/json',
            'cf-connecting-ip': ip,
          },
          body: JSON.stringify({
            kind: 'template',
            name: 'Алексей Смирнов',
            phone: '+7 (961) 302-21-12',
            contact_method: 'telegram',
            email: 'buyer@example.ru',
            message: 'Пришлите в Telegram после оплаты',
            consent: true,
            consent_version: '2026-11-21',
            page: 'shablony',
            idempotency_key: crypto.randomUUID(),
            honeypot: '',
            form_started_at: Date.now() - 15_000,
            template: {
              id: entry.id,
              title: 'Поддельное название из браузера',
              package: 'single',
              price: 1,
              url: 'https://evil.example/fake.pdf',
            },
          }),
        }),
        testEnv(),
      );

      assert.equal(res.status, 201, `ожидался 201 для ID ${entry.id}`);
      const rawClientJson = await res.text();
      const clientBody = JSON.parse(rawClientJson) as {
        ticket: string;
        download?: string;
        delivered?: { telegram: boolean; email: boolean };
      };

      /* 1. Клиенту ссылка НЕ возвращается ни в каком виде. */
      assert.ok(clientBody.ticket);
      assert.deepEqual(clientBody.delivered, { telegram: true, email: true });
      assert.equal(clientBody.download, undefined);
      assert.doesNotMatch(rawClientJson, /githubusercontent|github\.com|ac75af6|\.pdf/i);

      const expectedUrl = buildPaidTemplateGithubUrl(entry);

      /* 2. Проверяем уведомление в Telegram. */
      const tgCall = mock.calls.find((c) => c.url.includes('api.telegram.org'));
      assert.ok(tgCall, `нет вызова Telegram для ID ${entry.id}`);
      const tgText = String(tgCall.body.text);
      assert.ok(tgText.includes(entry.title), `Telegram должен содержать название для ${entry.id}`);
      assert.ok(!tgText.includes('Поддельное название из браузера'));
      assert.ok(!tgText.includes('evil.example'));
      assert.ok(tgText.includes(`ID: <code>${entry.id}</code>`), `Telegram должен содержать ID ${entry.id}`);
      assert.match(tgText, /Цена на сайте \(по каталогу\): <b>500\s*₽<\/b>/);
      assert.doesNotMatch(tgText, /<b>1\s*₽<\/b>/);
      assert.ok(tgText.includes('Алексей Смирнов'));
      assert.ok(tgText.includes('+7 (961) 302-21-12'));
      assert.ok(tgText.includes(clientBody.ticket));
      assert.ok(tgText.includes(expectedUrl), `Telegram должен содержать ссылку на ${entry.filename}`);
      assert.match(tgText, /только для удобства Марии/i);
      assert.match(tgText, /публичный GitHub/i);

      /* 3. Проверяем письмо на почту (и textContent, и htmlContent). */
      const mailCall = mock.calls.find((c) => c.url.includes('brevo.com'));
      assert.ok(mailCall, `нет вызова почты для ID ${entry.id}`);
      const mailSubject = String(mailCall.body.subject);
      const mailText = String(mailCall.body.textContent);
      const mailHtml = String(mailCall.body.htmlContent);

      assert.ok(mailSubject.includes(entry.title));
      assert.ok(mailSubject.includes(`ID ${entry.id}`));
      assert.ok(mailSubject.includes(clientBody.ticket));

      for (const content of [mailText, mailHtml]) {
        assert.ok(content.includes(entry.title), `письмо должно содержать название для ${entry.id}`);
        assert.ok(!content.includes('Поддельное название из браузера'));
        assert.ok(!content.includes('evil.example'));
        assert.ok(content.includes(`ID: ${entry.id}`));
        assert.match(content, /500\s*₽/);
        assert.ok(content.includes('Алексей Смирнов'));
        assert.ok(content.includes('+7 (961) 302-21-12'));
        assert.ok(content.includes(clientBody.ticket));
        assert.ok(content.includes(expectedUrl), `письмо должно содержать ссылку на ${entry.filename}`);
        assert.match(content, /только для удобства Марии/i);
        assert.match(content, /публичный GitHub/i);
      }
      assert.ok(mailHtml.includes(`href="${expectedUrl}"`), 'в HTML-письме ссылка должна быть кликабельной');
    }
  } finally {
    mock.restore();
  }
});

test('неизвестный ID и бесплатный ID: ссылка НЕ формируется, поддельная цена из браузера НЕ принимается', async () => {
  const mock = mockChannels();
  try {
    /* 99 — несуществующий ID; 01 — реальный бесплатный шаблон, которого нет среди 44 платных. */
    for (const badId of ['99', 't999', '01', null]) {
      mock.calls.length = 0;
      const res = await worker.fetch(
        new Request('https://relay.test/leads', {
          method: 'POST',
          headers: {
            origin: ORIGIN,
            'content-type': 'application/json',
            'cf-connecting-ip': `198.51.100.${badId ? badId.length + 10 : 1}`,
          },
          body: JSON.stringify({
            kind: 'template',
            name: 'Елена Кузнецова',
            phone: '89613022112',
            contact_method: 'call',
            consent: true,
            consent_version: '2026-11-21',
            page: 'shablony',
            idempotency_key: crypto.randomUUID(),
            honeypot: '',
            form_started_at: Date.now() - 10_000,
            template: {
              id: badId,
              title: 'Неизвестный документ',
              package: 'single',
              price: 77,
            },
          }),
        }),
        testEnv(),
      );
      assert.equal(res.status, 201, `заявка клиента не должна теряться даже при ID=${String(badId)}`);
      const tgText = String(mock.calls.find((c) => c.url.includes('api.telegram.org'))?.body.text ?? '');
      const mailCall = mock.calls.find((c) => c.url.includes('brevo.com'));
      const mailText = String(mailCall?.body.textContent ?? '');
      const mailHtml = String(mailCall?.body.htmlContent ?? '');

      for (const out of [tgText, mailText, mailHtml]) {
        assert.doesNotMatch(out, /githubusercontent|github\.com\/sledovatel61/i, `ссылка не должна формироваться для ID=${String(badId)}`);
        assert.doesNotMatch(out, /77\s*₽/, 'цена из браузера не должна показываться как подтверждённая');
        assert.match(out, /не подтверждена/);
        assert.match(out, /ссылка не сформирована/i);
      }
    }
  } finally {
    mock.restore();
  }
});

test('полный пакет (package: full): сервер ставит цену 3 500 ₽ и НЕ придумывает ссылку на архив', () => {
  const notice = resolveTemplateNotice({
    id: '02',
    title: 'Подмена цены полного пакета',
    package: 'full',
    price: 10,
  });
  assert.equal(notice.title, 'Полный набор из 64 шаблонов');
  assert.equal(notice.price, 3500);
  assert.equal(notice.githubUrl, null);
  assert.equal(notice.filename, null);

  const v = validateLead({
    kind: 'template',
    name: 'Дмитрий Волков',
    phone: '+7 961 302-21-12',
    contact_method: 'whatsapp',
    consent: true,
    consent_version: '2026-11-21',
    page: 'shablony',
    idempotency_key: crypto.randomUUID(),
    honeypot: '',
    form_started_at: 1,
    template: {
      id: null,
      title: 'Что угодно из браузера',
      package: 'full',
      price: 10,
    },
  });
  assert.equal(v.ok, true);
  if (!v.ok) return;

  const tg = composeTelegram(v.value, 'K-1123-7777', { siteName: 'Кадры-Про' });
  const mail = composeEmail(v.value, 'K-1123-7777', { siteName: 'Кадры-Про' });

  for (const out of [tg, mail.text, mail.html]) {
    assert.match(out, /Полный набор из 64 шаблонов/);
    assert.match(out, /3\D?500\s*₽/);
    assert.doesNotMatch(out, /<b>10\s*₽<\/b>|: 10\s*₽/);
    assert.doesNotMatch(out, /githubusercontent|email-bundle\.zip|free-bundle-20\.zip/i);
    assert.match(out, /архива полного пакета \(64 документа\) в GitHub нет/i);
  }
});

test('экранирование: опасные теги и кавычки в полях заявки на шаблон обезвреживаются в Telegram и письме', () => {
  const v = validateLead({
    kind: 'template',
    name: 'Иван <script>alert(1)</script> "ООО"',
    phone: '89613022112',
    contact_method: 'telegram',
    email: 'a&b@example.ru',
    message: 'Комментарий с <img src=x onerror=alert(1)> и & и "кавычками"',
    consent: true,
    consent_version: '2026-11-21',
    page: 'shablony',
    idempotency_key: crypto.randomUUID(),
    honeypot: '',
    form_started_at: 1,
    template: {
      id: '99',
      title: '<b>Взлом</b> <script>bad()</script> "quote"',
      package: 'single',
      price: 500,
    },
  });
  assert.equal(v.ok, true);
  if (!v.ok) return;

  const tg = composeTelegram(v.value, 'K-1123-9999', { siteName: 'Кадры-Про' });
  const mail = composeEmail(v.value, 'K-1123-9999', { siteName: 'Кадры-Про' });

  assert.ok(!tg.includes('<script>'));
  assert.ok(!tg.includes('<img'));
  assert.match(tg, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(tg, /&lt;b&gt;Взлом&lt;\/b&gt;/);

  assert.ok(!mail.html.includes('<script>'));
  assert.ok(!mail.html.includes('<img'));
  assert.match(mail.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(mail.html, /&quot;ООО&quot;/);
});
