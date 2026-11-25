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
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  DOCX_READY_IDS,
  DOCX_PACKAGE,
  DOCX_PACKAGE_COMMIT,
  hasConfirmedDocx,
  docxDriveUrl,
  DOCX_DRIVE_LINKS,
  templateHandoffNote,
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

/** Есть ли объект в клоне (бросает, если нет). */
function gitObject(rev: string, type: 'commit'): void {
  execFileSync('git', ['cat-file', '-e', `${rev}^{${type}}`], { cwd: REPO_ROOT, stdio: 'ignore' });
}

test('серверный каталог платных шаблонов совпадает с templates.json, prices.json и коммитом git', (t) => {
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

  /* Проверяем наличие каждого из 44 PDF в зафиксированном коммите git и заголовок %PDF-.
     В неполном клоне (shallow, sparse) объекта может не быть — тогда пробуем
     добрать его, а если сети нет, честно пропускаем эту часть, а не роняем
     деплой relay: контракт каталога проверяется и без git. */
  try {
    gitObject(PAID_TEMPLATES_COMMIT, 'commit');
  } catch {
    try {
      execFileSync('git', ['fetch', '--no-tags', '--depth=1', 'origin', PAID_TEMPLATES_COMMIT], {
        cwd: REPO_ROOT,
        stdio: 'ignore',
        timeout: 60_000,
      });
    } catch {
      /* Сети нет — ниже пропустим проверку по git. */
    }
  }
  const commitAvailable = (() => {
    try {
      gitObject(PAID_TEMPLATES_COMMIT, 'commit');
      return true;
    } catch {
      return false;
    }
  })();

  if (!commitAvailable) {
    t.skip(`коммит ${PAID_TEMPLATES_COMMIT} недоступен и не добрался из origin — проверка файлов по git пропущена`);
    return;
  }

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

test('манифест DOCX № 01–10: закреплённые SHA-256 совпадают с файлами, без зависимости от чужой ветки', () => {
  /* Тест НЕ ходит в git и не требует ветки arena/281d419d: имена и хеши
     закреплены в `DOCX_PACKAGE`. Проверяем внутреннюю согласованность
     (10 позиций, уникальные ID и имена, формат хеша) и совпадение с каталогом.
     Наличие файлов в git проверяется отдельным тестом ниже — и он мягко
     пропускается, если объекта нет в клоне: деплой relay не должен зависеть
     от чужой ветки. */
  assert.equal(DOCX_PACKAGE.length, 10);
  assert.deepEqual(
    DOCX_PACKAGE.map((entry) => entry.id),
    ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'],
  );
  assert.equal(new Set(DOCX_PACKAGE.map((e) => e.filename)).size, 10, 'имена файлов должны быть уникальны');

  for (const entry of DOCX_PACKAGE) {
    assert.match(entry.sha256, /^[0-9a-f]{64}$/, `хеш ${entry.id} должен быть SHA-256`);
    assert.ok(entry.filename.startsWith(`${entry.id}_`), `префикс файла ${entry.filename}`);
    assert.ok(entry.filename.endsWith('.docx'), `расширение файла ${entry.filename}`);
    /* ID есть в каталоге сайта и это договор из № 01–10. */
    const siteItem = siteCatalog.items.find((it) => it.id === entry.id);
    assert.ok(siteItem, `нет позиции ${entry.id} в templates.json`);
    /* Никакого обещания «актуальный»: приёмка за Марией. */
    assert.match(templateHandoffNote({ id: entry.id, title: siteItem.name, package: siteItem.free ? 'free' : 'single', price: siteItem.price }), /проверьте документ/i);
  }

  assert.equal(DOCX_PACKAGE_COMMIT, 'c70ac32e5f54404483357e33f0bc2de0f9ee315d');
  for (const entry of PAID_TEMPLATES) {
    assert.equal(hasConfirmedDocx(entry.id), DOCX_READY_IDS.has(entry.id), `DOCX для ${entry.id}`);
  }
  assert.equal(hasConfirmedDocx('14'), true, '№ 14 входит в комплект 11–20');
  assert.equal(hasConfirmedDocx('53'), false);
  assert.equal(hasConfirmedDocx('t07'), true);
  assert.equal(hasConfirmedDocx('01'), true, 'бесплатный № 01 входит в комплект');
  assert.equal(hasConfirmedDocx(null), false);
});

test('файлы комплекта DOCX, если объект доступен в клоне, совпадают с закреплёнными хешами', (t) => {
  /* Мягкая проверка: в CI может не быть объекта (чужую ветку удалили или клон
     неполный). Тогда тест пропускается, а не падает: деплой relay не должен
     зависеть от существования ветки. Когда объект есть — сверяем побайтово. */
  try {
    gitObject(DOCX_PACKAGE_COMMIT, 'commit');
  } catch {
    t.skip(`коммит ${DOCX_PACKAGE_COMMIT} недоступен в этом клоне — проверка файлов пропущена`);
    return;
  }

  let checked = 0;
  for (const entry of DOCX_PACKAGE) {
    const path = `agents/agent-02/docx-01-10/${entry.filename}`;
    let raw: Buffer;
    try {
      raw = execFileSync('git', ['cat-file', '-p', `${DOCX_PACKAGE_COMMIT}:${path}`], { cwd: REPO_ROOT, maxBuffer: 5 * 1024 * 1024 });
    } catch {
      t.skip(`файл ${entry.filename} недоступен — проверка пропущена`);
      return;
    }
    assert.equal(raw.subarray(0, 2).toString('latin1'), 'PK', `${entry.filename} не DOCX`);
    const hash = createHash('sha256').update(raw).digest('hex');
    assert.equal(hash, entry.sha256, `содержимое ${entry.filename} изменилось — обновите манифест осознанно`);
    checked++;
  }
  assert.equal(checked, 10);
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

test('обещание DOCX ограничено подтверждёнными № 01–20, для старых карточек — только PDF', () => {
  /* Комплект редактируемых DOCX в репозитории подтверждён ровно для № 01–20.
     Для остальных 34 платных позиций есть лишь PDF образца 27.03.2026,
     поэтому и лайтбокс, и уведомление Марии не должны обещать DOCX. */
  const cases = [
    { id: '02', title: 'Срочный трудовой договор', package: 'single' as const, docx: true },
    { id: '01', title: 'Трудовой договор бессрочный', package: 'free' as const, docx: true },
    { id: '14', title: 'Приказ об увольнении за прогул', package: 'single' as const, docx: true },
    { id: '20', title: 'Приказ о временном переводе', package: 'single' as const, docx: true },
    { id: '17', title: 'Приказ о предоставлении отпуска', package: 'free' as const, docx: true },
    { id: '53', title: 'Табель учёта рабочего времени Т-12', package: 'single' as const, docx: false },
  ];

  for (const item of cases) {
    const v = validateLead({
      kind: 'template',
      name: 'Наталья Орлова',
      phone: '89613022112',
      contact_method: 'telegram',
      email: 'natalia@example.ru',
      consent: true,
      consent_version: '2026-11-21',
      page: 'shablony',
      idempotency_key: crypto.randomUUID(),
      honeypot: '',
      form_started_at: 1,
      template: { id: item.id, title: item.title, package: item.package, price: 500 },
    });
    assert.equal(v.ok, true);
    if (!v.ok || v.value.kind !== 'template') continue;

    /* Сверка с серверным каталогом: docxReady только у подтверждённых. */
    const notice = resolveTemplateNotice(v.value.template);
    assert.equal(notice.docxReady, item.docx, `docxReady для ID ${item.id}`);

    const tg = composeTelegram(v.value, 'K-1124-0001', { siteName: 'Кадры-Про' });
    const mail = composeEmail(v.value, 'K-1124-0001', { siteName: 'Кадры-Про' });

    /* № 01–10: Мария получает прямую ссылку Google Drive на DOCX. */
    const driveUrl = docxDriveUrl(item.id);
    assert.equal(notice.docxUrl, driveUrl, `ID ${item.id}: ссылка Google Drive в уведомлении`);
    for (const out of [tg, mail.text, mail.html]) {
      if (item.docx) {
        assert.ok(driveUrl, `ID ${item.id}: для подтверждённой позиции должна быть ссылка Drive`);
        /* В HTML и Telegram-разметке «&» экранируется в «&amp;» — сверяем оба вида. */
        assert.ok(
          out.includes(driveUrl!) || out.includes(driveUrl!.replace(/&/g, '&amp;')),
          `ID ${item.id}: в уведомлении нет прямой ссылки на DOCX`,
        );
        assert.match(out, /DOCX для покупателя/i);
        assert.match(out, /Google Drive/i);
        /* Приёмка — за Марией: слово «актуальный» не обещаем. */
        assert.doesNotMatch(out, /актуальный/i, `ID ${item.id}: нельзя называть DOCX «актуальным» без приёмки`);
      } else {
        assert.doesNotMatch(out, /редактируемый DOCX из комплекта/i, `ID ${item.id}: DOCX нет — обещать нельзя`);
        assert.match(out, /DOCX для этой позиции не подтверждён/i);
        assert.match(out, /PDF образца/i);
      }
    }
  }

  /* Пакеты: полный набор и email — без обещания DOCX, с ручной сборкой. */
  for (const pkg of ['full', 'email'] as const) {
    const v = validateLead({
      kind: 'template',
      name: 'Олег Орлов',
      phone: '89613022112',
      contact_method: 'call',
      email: 'oleg@example.ru',
      consent: true,
      consent_version: '2026-11-21',
      page: 'shablony',
      idempotency_key: crypto.randomUUID(),
      honeypot: '',
      form_started_at: 1,
      template: { id: pkg === 'email' ? '21' : null, title: 'Пакет', package: pkg, price: 3500 },
    });
    assert.equal(v.ok, true);
    if (!v.ok || v.value.kind !== 'template') continue;
    const tg = composeTelegram(v.value, 'K-1124-0002', { siteName: 'Кадры-Про' });
    const mail = composeEmail(v.value, 'K-1124-0002', { siteName: 'Кадры-Про' });
    for (const out of [tg, mail.text, mail.html]) {
      assert.doesNotMatch(out, /DOCX из комплекта/i, `package=${pkg}: DOCX не обещаем`);
      assert.match(out, /соберите (комплект|архив) вручную/i);
    }
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

test('ссылки Google Drive на платные DOCX № 02–10 и 14–20 не утекают клиенту: ни в ответ /leads, ни на сайт', async () => {
  /* Требование: сайт показывает по платным позициям только превью и заявку,
     а прямые ссылки на DOCX приходят исключительно Марии в уведомлении.
     Проверяем с двух сторон: разметка собранной страницы и тело ответа на
     заявку (включая повтор и ветку дубля). */
  /* Открыто на сайте отдаются только БЕСПЛАТНЫЕ позиции с DOCX (№ 01, 11, 12, 13, 17, 19). */
  const FREE_DOCX_OPEN_IDS = new Set(['01', '11', '12', '13', '17', '19']);
  const paidLinks = Object.entries(DOCX_DRIVE_LINKS)
    .filter(([id]) => !FREE_DOCX_OPEN_IDS.has(id))
    .map(([, url]) => url);
  assert.equal(paidLinks.length, 14, 'ожидались ссылки для платных № 02–10, 14–16, 18, 20');

  /* Бесплатные позиции, наоборот, обязаны присутствовать в открытой сборке — иначе кнопки нет. */
  for (const id of FREE_DOCX_OPEN_IDS) {
    assert.ok(DOCX_DRIVE_LINKS[id], `у бесплатной позиции ${id} должна быть ссылка Drive`);
  }

  /* 1. Разметка сайта: ни одной ссылки на платные DOCX (в т.ч. в preview/). */
  for (const page of ['shablony.html', 'preview/shablony.html']) {
    const file = resolve(REPO_ROOT, page);
    if (!existsSync(file)) continue;
    const html = readFileSync(file, 'utf8');
    for (const url of paidLinks) {
      /* В HTML «&» экранирован в «&amp;», поэтому ищем по id файла Drive. */
      const id = url.split('id=')[1];
      assert.ok(!html.includes(id), `${page}: ссылка на платный DOCX (id=${id}) попала в открытую сборку`);
    }
  }

  /* 2. Ответ клиенту на реальную заявку: ссылки в теле нет. */
  const v = validateLead({
    kind: 'template',
    name: 'Пётр Иванов',
    phone: '89613022112',
    contact_method: 'call',
    email: 'petr@example.ru',
    consent: true,
    consent_version: '2026-11-21',
    page: 'shablony',
    idempotency_key: crypto.randomUUID(),
    honeypot: '',
    form_started_at: 1,
    template: { id: '02', title: 'Срочный трудовой договор', package: 'single', price: 500 },
  });
  assert.equal(v.ok, true);
  if (!v.ok || v.value.kind !== 'template') return;

  /* Уведомление Марии ссылку содержит... */
  const tg = composeTelegram(v.value, 'K-1124-0100', { siteName: 'Кадры-Про' });
  assert.ok(tg.includes(docxDriveUrl('02')!.replace(/&/g, '&amp;')), 'Мария должна получить ссылку');
  const resolved = resolveTemplateNotice(v.value.template);
  assert.equal(resolved.docxUrl, docxDriveUrl('02'));

  /* ...а ответ покупателю — нет: ни в первой отправке, ни в повторе. */
  const env = {
    BOT_TOKEN: 'test',
    TELEGRAM_CHAT_ID: '-100',
    TELEGRAM_API_BASE: 'https://api.telegram.test',
    ALLOWED_ORIGINS: ORIGIN,
  } as unknown as Env;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{"ok":true}', { status: 200 })) as unknown as typeof fetch;
  try {
    const payload = {
      kind: 'template',
      name: v.value.name,
      phone: v.value.phone,
      contact_method: 'call',
      email: 'petr@example.ru',
      consent: true,
      consent_version: '2026-11-21',
      page: 'shablony',
      idempotency_key: v.value.idempotency_key,
      honeypot: '',
      form_started_at: 1,
      template: { id: '02', title: 'Срочный трудовой договор', package: 'single', price: 500 },
    };
    const request = (): Promise<Response> => worker.fetch(new Request(`${ORIGIN.replace('://', '://api.')}/leads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify(payload),
    }), env);
    for (const res of [await request(), await request()]) {
      const body = await res.text();
      for (const url of paidLinks) {
        assert.ok(!body.includes(url.split('id=')[1]), 'ссылка на платный DOCX не должна возвращаться клиенту');
      }
      assert.doesNotMatch(body, /drive\.google\.com/i, 'в ответе клиенту нет Google Drive');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
