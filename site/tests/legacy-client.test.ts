/**
 * Совместимость нового relay со СТАРЫМ клиентом из `main`.
 *
 * После деплоя воркера часть посетителей ещё работает на прежнем JS из кэша.
 * Такой клиент:
 *   • любой 409 повторяет автоматически новым ключом → молчаливый дубль;
 *   • любой 2xx с `ticket` считает успехом и скрывает форму → «принято», хотя
 *     исправленные данные не доставлены.
 *
 * Поэтому неоднозначная старая запись идемпотентности отвечает 422 с
 * `error.message`. Здесь проверяется настоящий старый код (фикстура
 * `tests/fixtures/legacy-leads-form.ts` — копия из `main`), а не пересказ.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error jsdom поставляется без встроенных .d.ts в devDependencies проекта
import { JSDOM as RawJSDOM } from 'jsdom';

interface JSDOMWindow {
  document: Document;
  location: Location;
  Event: typeof Event;
  getComputedStyle: typeof getComputedStyle;
  close(): void;
}
const JSDOM = RawJSDOM as unknown as new (html: string, options?: { url?: string }) => { window: JSDOMWindow };

process.env.PUBLIC_LEADS_ENDPOINT = 'https://kadry-leads.ats439.workers.dev';

const SITE_DIR = resolve(import.meta.dirname, '..');
const builtPage = resolve(SITE_DIR, 'pages-dist/shablony.html');
const pagePath = (await import('node:fs')).existsSync(builtPage)
  ? builtPage
  : resolve(SITE_DIR, '../shablony.html');

/** Старый клиент из main — фикстура, не текущий код. */
const legacy = await import('./fixtures/legacy-leads-form.ts');

function mountLegacy() {
  const dom = new JSDOM(readFileSync(pagePath, 'utf8'), { url: 'https://kadry-pro.ru/shablony.html' });
  const prevDoc = globalThis.document;
  const prevWin = (globalThis as { window?: unknown }).window;
  const prevStyle = globalThis.getComputedStyle;
  const prevLoc = (globalThis as { location?: unknown }).location;

  globalThis.document = dom.window.document;
  (globalThis as { window?: unknown }).window = dom.window;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  Object.defineProperty(globalThis, 'location', { value: dom.window.location, configurable: true });

  /* Старый клиент умеет только общий провод форм; модалку шаблона он не знает,
     поэтому форму готовим вручную — как это делала страница того релиза. */
  const modal = dom.window.document.getElementById('template-lead-modal') as HTMLDialogElement;
  modal.setAttribute('open', '');
  const form = dom.window.document.getElementById('template-lead-form') as HTMLFormElement;
  form.dataset.leadKind = 'template';
  form.dataset.template = JSON.stringify({
    id: '02',
    title: 'Срочный трудовой договор',
    package: 'single',
    price: 500,
  });
  legacy.wireLeadForms();

  return {
    dom,
    doc: dom.window.document,
    form,
    cleanup() {
      globalThis.document = prevDoc;
      (globalThis as { window?: unknown }).window = prevWin;
      globalThis.getComputedStyle = prevStyle;
      if (prevLoc !== undefined) Object.defineProperty(globalThis, 'location', { value: prevLoc, configurable: true });
      dom.window.close();
    },
  };
}

function fill(form: HTMLFormElement, comment: string): void {
  (form.querySelector('[name="name"]') as HTMLInputElement).value = 'Марина Соколова';
  (form.querySelector('[name="phone"]') as HTMLInputElement).value = '+7 (961) 302-21-12';
  (form.querySelector('[name="consent"]') as HTMLInputElement).checked = true;
  const message = form.querySelector('[name="comment"]') as HTMLTextAreaElement | null;
  if (message) message.value = comment;
}

/**
 * Текст предупреждения берём из воркера, а не переписываем здесь: тест должен
 * проверять ту инструкцию, которую человек увидит на самом деле.
 */
const RELAY_SRC = readFileSync(resolve(SITE_DIR, '../relay/src/index.ts'), 'utf8');
const HINT_TEMPLATE = /'Если вы выбрали другой шаблон или изменили данные — (нажмите «Отправить» ещё раз[^']*)'/;

const AMBIGUOUS_BODY = {
  ticket: 'K-1121-4242',
  status: 'ambiguous',
  duplicate: true,
  ambiguous: true,
  delivered: { telegram: false, email: false },
  error: {
    code: 'idempotency_legacy',
    message:
      'Заявка с этим ключом уже отправлялась раньше (номер K-1121-4242), и что именно в ней было — неизвестно. '
      + 'Прежняя заявка могла быть уже доставлена. '
      + 'Повторно ничего не отправлено, чтобы не создать дубль. '
      + (HINT_TEMPLATE.exec(RELAY_SRC)?.[1] ?? ''),
  },
};

/**
 * Модель нового relay для старой записи идемпотентности — ровно то, что делает
 * `resolveSeenRecord` + `handleLead`:
 *   1-я отправка с ключом без предупреждения → 422 + `idempotency_legacy`;
 *   повтор с тем же ключом → заявка доставляется (201, новый талон);
 *   дальше тот же ключ и данные → 201 `duplicate: true` без новой доставки.
 * Нужна, чтобы проверить именно ВЫПОЛНИМОСТЬ инструкции из предупреждения, а не
 * только показ текста.
 */
function fakeRelay() {
  const warned = new Set<string>();
  const delivered = new Map<string, string>();
  const deliveries: string[] = [];
  const requests: Record<string, unknown>[] = [];
  let seq = 0;

  const handler = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    requests.push(body);
    const key = String(body.idempotency_key ?? '');
    if (delivered.has(key)) {
      return new Response(JSON.stringify({ ticket: delivered.get(key), status: 'accepted', duplicate: true }), {
        status: 201, headers: { 'content-type': 'application/json' },
      });
    }
    if (!warned.has(key)) {
      warned.add(key);
      return new Response(JSON.stringify(AMBIGUOUS_BODY), {
        status: 422, headers: { 'content-type': 'application/json' },
      });
    }
    seq += 1;
    const ticket = `K-1123-90${seq}`;
    delivered.set(key, ticket);
    deliveries.push(ticket);
    return new Response(JSON.stringify({
      ticket, status: 'accepted', duplicate: false, delivered: { telegram: true, email: false },
    }), { status: 201, headers: { 'content-type': 'application/json' } });
  };

  return { handler, deliveries, requests };
}

test('старый клиент из main на 422 idempotency_legacy: показывает текст, НЕ скрывает форму и НЕ повторяет отправку', async () => {
  const { dom, doc, form, cleanup } = mountLegacy();
  const prevFetch = globalThis.fetch;
  const sent: Record<string, unknown>[] = [];

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    return new Response(JSON.stringify(AMBIGUOUS_BODY), {
      status: 422,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    fill(form, 'Исправленный комментарий: нужен договор для ООО «Север»');
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 30));

    assert.equal(sent.length, 1, 'старый клиент не должен повторять отправку на 422');

    /* 1. Форма видна: человек может исправить данные и отправить осознанно. */
    assert.equal(form.hidden, false, 'форма не должна скрываться');
    assert.notEqual(form.style.display, 'none');

    /* 2. Успеха нет: никакого «Заявка принята». */
    const successBox = doc.querySelector<HTMLElement>('[data-lead-success="template-lead-form"]')!;
    assert.equal(successBox.hidden, true, 'экран успеха показывать нельзя — доставки не было');

    /* 3. Текст ошибки от сервера виден человеку. */
    const errorBox = doc.querySelector<HTMLElement>('[data-lead-error="template-lead-form"]')!;
    assert.equal(errorBox.hidden, false);
    assert.match(errorBox.textContent ?? '', /уже отправлялась раньше/i);
    assert.match(errorBox.textContent ?? '', /ничего не отправлено, чтобы не создать дубль/i);
    assert.match(errorBox.textContent ?? '', /могла быть уже доставлена/i, 'предупреждение честное: прежняя могла дойти');
    assert.match(errorBox.textContent ?? '', /нажмите «Отправить» ещё раз/i);

    /* 4. Исправленный комментарий не улетел в никуда молча — он остался в поле. */
    const comment = form.querySelector<HTMLTextAreaElement>('[name="comment"]');
    assert.equal(comment?.value, 'Исправленный комментарий: нужен договор для ООО «Север»');
  } finally {
    globalThis.fetch = prevFetch;
    cleanup();
  }
});

test('старый клиент из main: нажатие «Отправить» после предупреждения действительно доставляет заявку', async () => {
  /* Жалоба ревьюера: предупреждение советовало «отправьте заявку ещё раз», но
     старый клиент сохраняет прежний ключ и получал тот же 422 — исправленный
     комментарий не доставлялся никогда. Здесь проверяется, что инструкция
     выполнима: после предупреждения человек жмёт ту же кнопку и заявка уходит. */
  const { dom, doc, form, cleanup } = mountLegacy();
  const relay = fakeRelay();
  const prevFetch = globalThis.fetch;
  globalThis.fetch = relay.handler as unknown as typeof fetch;

  try {
    fill(form, 'Исправленный комментарий: нужен договор для ООО «Север»');
    const submit = () => {
      form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
      return new Promise((r) => setTimeout(r, 30));
    };

    /* 1. Первая отправка: предупреждение, доставки нет. */
    await submit();
    const errorBox = doc.querySelector<HTMLElement>('[data-lead-error="template-lead-form"]')!;
    assert.equal(errorBox.hidden, false);
    assert.match(errorBox.textContent ?? '', /нажмите «Отправить» ещё раз/i);
    assert.equal(relay.deliveries.length, 0, 'первая попытка не доставляет');
    const firstKey = String(relay.requests[0]?.idempotency_key ?? '');
    assert.ok(firstKey, 'ключ идемпотентности должен быть в запросе');

    /* 2. Человек делает ровно то, что написано: нажимает «Отправить» ещё раз.
          Старый клиент сохраняет ключ — так и должно быть, сервер обязан
          распознать подтверждение, а не отдать тот же отказ. */
    await submit();
    assert.equal(relay.requests.length, 2, 'старый клиент не отправляет запросов больше, чем нажатий');
    assert.equal(String(relay.requests[1]?.idempotency_key ?? ''), firstKey,
      'старый клиент сохраняет прежний ключ — сценарий должен проверять именно это');
    assert.deepEqual(relay.deliveries, ['K-1123-901'], 'заявка должна быть доставлена со вторым нажатием');

    /* 3. Результат виден человеку: успех, форма скрыта, предупреждение убрано. */
    const successBox = doc.querySelector<HTMLElement>('[data-lead-success="template-lead-form"]')!;
    assert.equal(successBox.hidden, false, 'после реальной доставки показываем успех');
    assert.match(successBox.textContent ?? '', /K-1123-901/);
    assert.equal(form.hidden, true, 'форма скрывается только после доставки');
    /* Старый клиент не убирает текст ошибки сам, но этот блок лежит ВНУТРИ
       формы — а форма скрыта, поэтому человек одновременно «не отправлено» и
       «принято» не увидит. Проверяем именно видимость, а не свойство. */
    assert.ok(form.contains(errorBox), 'блок ошибки должен жить внутри формы — тогда он скрыт вместе с ней');

    /* 4. Третье нажатие (двойной клик) не создаёт второй заявки. */
    await submit();
    assert.deepEqual(relay.deliveries, ['K-1123-901'], 'повтор того же ключа не доставляет второй раз');
  } finally {
    globalThis.fetch = prevFetch;
    cleanup();
  }
});

test('старый клиент из main: 200 + ambiguous больше не выдаётся сервером (регресс-контроль контракта)', () => {
  /* Исходная жалоба: на 200 старый клиент показывал «Заявка принята» и скрывал
     форму, хотя исправленный комментарий не доставлен. Поэтому ответ для
     неоднозначной записи обязан быть не-2xx и не-409. Проверяем по исходнику
     воркера, чтобы контракт нельзя было вернуть случайно. */
  const src = readFileSync(resolve(SITE_DIR, '../relay/src/index.ts'), 'utf8');
  const block = src.slice(src.indexOf('if (storedTpl === null)'), src.indexOf('if (storedTpl !== tplSig)'));
  assert.ok(block.length > 0, 'ветка неоднозначной записи должна существовать');
  assert.match(block, /idempotency_legacy/);
  assert.match(block, /\}, 422\);/);
  assert.doesNotMatch(block, /\}, 200\);/);
  assert.doesNotMatch(block, /\}, 201\);/);
  assert.doesNotMatch(block, /err\(\s*409/);
  /* Инструкция «нажмите ещё раз» должна быть выполнимой: повтор с тем же
     ключом уходит в обычную доставку, а не в тот же 422. */
  assert.match(block, /return null;/);
  assert.match(RELAY_SRC, /idemwarn:/, 'предупреждение должно запоминаться на сервере');
});
