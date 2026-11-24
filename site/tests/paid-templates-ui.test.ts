/**
 * Интеграционные тесты страницы /shablony.html, модального окна платного шаблона,
 * мобильной эргономики и автозаполнения (Раунд 9).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
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

const {
  attachPhoneMask,
  buildPayload,
  formatPhoneMaskValue,
  validateForm,
  wireLeadForms,
} = await import('../src/client/leads-form.ts');
const { wireTemplateModal } = await import('../src/client/template-modal.ts');

const SITE_DIR = resolve(import.meta.dirname, '..');
const REPO_ROOT = resolve(SITE_DIR, '..');
const catalog = JSON.parse(
  readFileSync(resolve(SITE_DIR, 'content/templates.json'), 'utf8'),
) as {
  items: { id: string; name: string; price: number; free: boolean; file: string | null }[];
};

const builtShablonyPath = existsSync(resolve(SITE_DIR, 'pages-dist/shablony.html'))
  ? resolve(SITE_DIR, 'pages-dist/shablony.html')
  : resolve(REPO_ROOT, 'shablony.html');

function mountShablonyDom() {
  const html = readFileSync(builtShablonyPath, 'utf8');
  const dom = new JSDOM(html, { url: 'https://kadry-pro.ru/shablony.html' });
  const prevDoc = globalThis.document;
  const prevWin = (globalThis as { window?: unknown }).window;
  const prevGetComputedStyle = globalThis.getComputedStyle;
  const prevLocation = (globalThis as { location?: unknown }).location;

  globalThis.document = dom.window.document;
  (globalThis as { window?: unknown }).window = dom.window;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  Object.defineProperty(globalThis, 'location', {
    value: dom.window.location,
    configurable: true,
  });

  wireTemplateModal(dom.window.document);
  wireLeadForms({ mask: true });

  return {
    dom,
    doc: dom.window.document,
    cleanup() {
      globalThis.document = prevDoc;
      (globalThis as { window?: unknown }).window = prevWin;
      globalThis.getComputedStyle = prevGetComputedStyle;
      if (prevLocation !== undefined) {
        Object.defineProperty(globalThis, 'location', {
          value: prevLocation,
          configurable: true,
        });
      }
      dom.window.close();
    },
  };
}

test('на собранной /shablony.html у всех 44 платных карточек есть кнопка заявки, а 20 бесплатных сохраняют прямое скачивание', () => {
  const { doc, cleanup } = mountShablonyDom();
  try {
    const paidItems = catalog.items.filter((i) => !i.free);
    const freeItems = catalog.items.filter((i) => i.free);
    assert.equal(paidItems.length, 44);
    assert.equal(freeItems.length, 20);

    const singleButtons = [
      ...doc.querySelectorAll<HTMLButtonElement>('[data-open-template][data-template-package="single"]'),
    ];
    assert.equal(singleButtons.length, 44, 'у каждой платной карточки должна быть кнопка заявки');

    for (const item of paidItems) {
      const card = doc.getElementById(`s${item.id}`);
      assert.ok(card, `нет карточки #s${item.id}`);
      const btn = card.querySelector<HTMLButtonElement>('[data-open-template]');
      assert.ok(btn, `нет кнопки заявки на платной карточке ${item.id}`);
      assert.equal(btn.dataset.templateId, item.id);
      assert.equal(btn.dataset.templateTitle, item.name);
      assert.equal(btn.dataset.templatePrice, '500');
      assert.equal(btn.dataset.templatePackage, 'single');
      assert.equal(card.querySelector('a[download]'), null, 'у платной карточки не должно быть ссылки download');
    }

    for (const item of freeItems) {
      const card = doc.getElementById(`s${item.id}`);
      assert.ok(card, `нет бесплатной карточки #s${item.id}`);
      const link = card.querySelector<HTMLAnchorElement>('a.template-download[download]');
      assert.ok(link, `потеряна ссылка скачивания бесплатного шаблона ${item.id}`);
      assert.equal(link.getAttribute('href'), item.file);
    }

    const bundleZip = doc.querySelector<HTMLAnchorElement>('a[href="/shablony/free-bundle-20.zip"][download]');
    assert.ok(bundleZip, 'бесплатный архив free-bundle-20.zip должен оставаться доступным');

    const rawHtml = readFileSync(builtShablonyPath, 'utf8');
    assert.doesNotMatch(rawHtml, /raw\.githubusercontent\.com|ac75af6/i, 'на сайте не должно быть служебных ссылок GitHub');
  } finally {
    cleanup();
  }
});

test('отправка заявки по платной карточке и переключение на другую карточку без перезагрузки страницы', async () => {
  const { dom, doc, cleanup } = mountShablonyDom();
  const prevFetch = globalThis.fetch;
  const sentBodies: Record<string, unknown>[] = [];
  let n = 0;

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    n++;
    sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    return new Response(
      JSON.stringify({
        ticket: `K-1123-000${n}`,
        status: 'accepted',
        duplicate: false,
        delivered: n === 1 ? { telegram: true, email: true } : { telegram: true, email: false },
      }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    const modal = doc.getElementById('template-lead-modal') as HTMLDialogElement;
    const form = doc.getElementById('template-lead-form') as HTMLFormElement;
    const successBox = doc.querySelector<HTMLElement>('[data-lead-success="template-lead-form"]')!;

    /* 1. Клик по карточке № 02 открывает окно и подставляет данные шаблона. */
    const btn02 = doc.querySelector<HTMLButtonElement>('#s02 [data-open-template]')!;
    btn02.click();
    assert.equal(modal.hasAttribute('open'), true);
    assert.equal(doc.querySelector('[data-template-modal-doc]')?.textContent, 'Срочный трудовой договор');
    assert.match(doc.querySelector('[data-template-modal-badge]')?.textContent ?? '', /№ 02/);
    assert.match(doc.querySelector('[data-template-modal-price]')?.textContent ?? '', /500\s*₽/);

    (form.querySelector('[name="name"]') as HTMLInputElement).value = 'Марина Соколова';
    (form.querySelector('[name="phone"]') as HTMLInputElement).value = '+7 (961) 302-21-12';
    (form.querySelector('[name="contact_method"]') as HTMLSelectElement).value = 'telegram';
    (form.querySelector('[name="email"]') as HTMLInputElement).value = 'marina@example.ru';
    (form.querySelector('[name="comment"]') as HTMLTextAreaElement).value = 'Нужен шаблон для ООО';
    (form.querySelector('[name="consent"]') as HTMLInputElement).checked = true;

    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 30));

    assert.equal(sentBodies.length, 1);
    assert.deepEqual(sentBodies[0].template, {
      id: '02',
      title: 'Срочный трудовой договор',
      package: 'single',
      price: 500,
    });
    assert.equal(sentBodies[0].contact_method, 'telegram');
    assert.equal(sentBodies[0].email, 'marina@example.ru');
    assert.equal(sentBodies[0].message, 'Нужен шаблон для ООО');

    assert.equal(form.hidden, true);
    assert.equal(successBox.hidden, false);
    assert.match(successBox.textContent ?? '', /Telegram, копия отправлена на почту/);
    assert.match(successBox.textContent ?? '', /K-1123-0001/);
    assert.doesNotMatch(successBox.innerHTML, /githubusercontent|github\.com|\.pdf/i);

    /* 2. Покупатель закрывает окно и выбирает карточку № 53 (с буквой «ё») — форма снова готова. */
    const btn53 = doc.querySelector<HTMLButtonElement>('#s53 [data-open-template]')!;
    btn53.click();
    assert.equal(form.hidden, false, 'при выборе следующего шаблона форма должна снова показаться');
    assert.equal(successBox.hidden, true);
    assert.equal(doc.querySelector('[data-template-modal-doc]')?.textContent, 'Табель учёта рабочего времени Т-12');

    (form.querySelector('[name="name"]') as HTMLInputElement).value = 'Марина Соколова';
    (form.querySelector('[name="phone"]') as HTMLInputElement).value = '89613022112';
    (form.querySelector('[name="consent"]') as HTMLInputElement).checked = true;

    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 30));

    assert.equal(sentBodies.length, 2);
    assert.notEqual(sentBodies[0].idempotency_key, sentBodies[1].idempotency_key);
    assert.deepEqual(sentBodies[1].template, {
      id: '53',
      title: 'Табель учёта рабочего времени Т-12',
      package: 'single',
      price: 500,
    });
    /* Честный статус: во втором ответе email=false, поэтому про почту не обещаем. */
    const title2 = successBox.querySelector('[data-success-title]')?.textContent ?? '';
    assert.match(title2, /Telegram/);
    assert.doesNotMatch(title2, /копия отправлена на почту/);
  } finally {
    globalThis.fetch = prevFetch;
    cleanup();
  }
});

test('кнопка полного набора открывает модальное окно с package=full и ценой 3 500 ₽', () => {
  const { doc, cleanup } = mountShablonyDom();
  try {
    const fullBtn = doc.querySelector<HTMLButtonElement>('[data-open-template][data-template-package="full"]');
    assert.ok(fullBtn, 'кнопка заявки на весь набор должна быть на странице');
    fullBtn.click();

    const form = doc.getElementById('template-lead-form') as HTMLFormElement;
    (form.querySelector('[name="name"]') as HTMLInputElement).value = 'Олег Орлов';
    (form.querySelector('[name="phone"]') as HTMLInputElement).value = '+7 961 302-21-12';
    (form.querySelector('[name="consent"]') as HTMLInputElement).checked = true;

    const payload = buildPayload(form, Date.now() - 10_000, '11111111-2222-4333-8444-555555555555');
    assert.deepEqual(payload.template, {
      id: null,
      title: 'Полный набор из 64 шаблонов',
      package: 'full',
      price: 3500,
    });
  } finally {
    cleanup();
  }
});

test('мобильная форма и автозаполнение: без iOS-зума, без обрезки номера после +7 и без потери заявки K-1123', () => {
  const { dom, doc, cleanup } = mountShablonyDom();
  try {
    const form = doc.getElementById('template-lead-form') as HTMLFormElement;
    const nameInput = form.querySelector<HTMLInputElement>('[name="name"]')!;
    const phoneInput = form.querySelector<HTMLInputElement>('[name="phone"]')!;
    const emailInput = form.querySelector<HTMLInputElement>('[name="email"]')!;
    const honeypot = form.querySelector<HTMLInputElement>('[name="company_website"]')!;

    /* 1. Атрибуты для мобильной клавиатуры и автозаполнения iOS Safari / Android Chrome. */
    assert.equal(nameInput.getAttribute('autocomplete'), 'name');
    assert.equal(phoneInput.getAttribute('autocomplete'), 'tel');
    assert.equal(phoneInput.getAttribute('inputmode'), 'tel');
    assert.equal(emailInput.getAttribute('autocomplete'), 'email');
    assert.equal(emailInput.getAttribute('inputmode'), 'email');

    /* Проверка защиты от автозума iOS Safari (font-size: 16px на полях модалки в собранном CSS). */
    const linkedStyles = [...doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]
      .map((l) => l.getAttribute('href') ?? '')
      .filter(Boolean)
      .map((href) => {
        const p = resolve(SITE_DIR, 'pages-dist', href.replace(/^\//, ''));
        return existsSync(p) ? readFileSync(p, 'utf8') : '';
      });
    const cssText = [
      ...[...doc.querySelectorAll('style')].map((s) => s.textContent ?? ''),
      ...linkedStyles,
    ].join('\n');
    assert.match(cssText, /\.template-modal__form[^{]*\{[^}]*font-size:\s*16px/);

    /* 2. Мобильное автозаполнение и вставка поверх префикса фокуса «+7 (». */
    assert.equal(formatPhoneMaskValue('+79613022112'), '+7 (961) 302-21-12');
    assert.equal(formatPhoneMaskValue('8 (961) 302-21-12'), '+7 (961) 302-21-12');
    assert.equal(formatPhoneMaskValue('+7 (+7 961 302-21-12'), '+7 (961) 302-21-12');
    assert.equal(formatPhoneMaskValue('+7 (89613022112'), '+7 (961) 302-21-12');
    assert.equal(formatPhoneMaskValue('+789613022112'), '+7 (961) 302-21-12');

    /* Проверяем реальный DOM-поток: фокус ставит «+7 (», затем автозаполнение стреляет change/input. */
    const btn28 = doc.querySelector<HTMLButtonElement>('#s28 [data-open-template]')!;
    btn28.click();
    attachPhoneMask(phoneInput);
    phoneInput.dispatchEvent(new dom.window.Event('focus'));
    assert.equal(phoneInput.value, '+7 (');

    /* Вставка полного номера поверх «+7 (» на телефоне. */
    phoneInput.value = '+7 (+7 (961) 302-21-12';
    phoneInput.dispatchEvent(new dom.window.Event('change'));
    assert.equal(phoneInput.value, '+7 (961) 302-21-12');

    /* 3. Мобильное автозаполнение профиля вписало организацию в офскрин-ловушку (K-1123). */
    nameInput.value = 'Сергей Иванов';
    honeypot.value = 'ООО «Север»';
    (form.querySelector('[name="consent"]') as HTMLInputElement).checked = true;

    assert.equal(validateForm(form), true);
    const payload = buildPayload(form, Date.now() - 2_000, '22222222-3333-4444-8555-666666666666');
    assert.equal(payload.phone, '79613022112');
    assert.equal(payload.honeypot, 'ООО «Север»');
    assert.equal(
      payload.honeypot_hidden,
      false,
      'офскрин-ловушка в модалке шаблона НЕ должна помечаться hidden=true при автозаполнении',
    );
  } finally {
    cleanup();
  }
});
