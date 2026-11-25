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

/**
 * Откуда берём собранную страницу.
 *
 * Приоритет — свежая сборка `site/pages-dist`, но `npm test` обязан проходить и
 * на чистом дереве (после `git clone` без `npm run build:root`), поэтому есть
 * второй источник: закоммиченный в корень репозитория `shablony.html`.
 */
const pagesDistShablonyPath = resolve(SITE_DIR, 'pages-dist/shablony.html');
const builtShablonyPath = existsSync(pagesDistShablonyPath)
  ? pagesDistShablonyPath
  : resolve(REPO_ROOT, 'shablony.html');

/**
 * Файл сборки (CSS/JS), на который ссылается страница: ищем рядом со сборкой,
 * затем в корне репозитория. Без этого на чистом дереве ссылки вида
 * `/assets/shablony.<hash>.css` не находились и проверка стилей модалки
 * молча пропускалась.
 */
function readBuiltAsset(href: string): string {
  const rel = href.replace(/^\//, '');
  const candidates = [
    resolve(SITE_DIR, 'pages-dist', rel),
    resolve(REPO_ROOT, rel),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
  }
  assert.fail(`не найден файл сборки «${href}»: ни в site/pages-dist, ни в корне репозитория`);
}

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
      if (item.id === '01') {
        /* № 01 отдаётся редактируемым DOCX из Google Drive — одна прямая кнопка. */
        const docxLink = card.querySelector<HTMLAnchorElement>('a.template-download[href*="drive.google.com"]');
        assert.ok(docxLink, 'у № 01 должна остаться прямая ссылка скачивания (DOCX)');
        assert.match(docxLink.getAttribute('href') ?? '', /drive\.google\.com\/uc\?export=download&id=1kJOeCWe/);
        assert.match(docxLink.textContent ?? '', /Скачать DOCX/);
        assert.equal(card.querySelector('a.template-download[download]'), null, 'старой кнопки PDF у № 01 быть не должно');
        continue;
      }
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
      .map((href) => readBuiltAsset(href));
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

test('предпросмотр первой страницы № 01–10: миниатюра, кнопка до заявки, масштаб, закрытие по ✕ / фону / Esc и переход к заказу', () => {
  const { dom, doc, cleanup } = mountShablonyDom();
  try {
    const previewModal = doc.getElementById('template-preview-modal') as HTMLDialogElement;
    const leadModal = doc.getElementById('template-lead-modal') as HTMLDialogElement;
    assert.ok(previewModal, 'на странице должен быть лайтбокс #template-preview-modal');

    /* 1. Проверяем привязку 01.jpg–10.jpg к карточкам #s01–#s10, осмысленный alt, якорь #s09 и порядок кнопок. */
    const card09 = doc.getElementById('s09');
    assert.ok(card09, 'якорь #s09 должен присутствовать на /shablony.html');

    for (let i = 1; i <= 10; i++) {
      const id = String(i).padStart(2, '0');
      const expectedItem = catalog.items.find((entry) => entry.id === id)!;
      const card = doc.getElementById(`s${id}`)!;
      assert.ok(card, `отсутствует карточка #s${id}`);

      const thumbBtn = card.querySelector<HTMLButtonElement>('.template-tile__thumb-btn[data-open-preview]');
      const previewBtn = card.querySelector<HTMLButtonElement>('.template-preview-btn[data-open-preview]');
      const thumbImg = card.querySelector<HTMLImageElement>('.template-tile__visual img');
      assert.ok(thumbBtn, `у #s${id} должна быть кликабельная миниатюра предпросмотра`);
      assert.ok(previewBtn, `у #s${id} должна быть кнопка предпросмотра первой страницы`);
      assert.ok(thumbImg, `у #s${id} должно выводиться изображение превью`);

      assert.equal(thumbImg.getAttribute('src'), `/shablony/previews/${id}.jpg`);
      assert.equal(thumbImg.getAttribute('width'), '1080');
      assert.equal(thumbImg.getAttribute('height'), '1528');
      assert.ok(
        (thumbImg.getAttribute('alt') ?? '').includes(expectedItem.name),
        `alt изображения #s${id} должен содержать название шаблона`,
      );

      /* Действие «Посмотреть первую страницу» расположено ДО кнопки скачивания или заявки */
      const mainAction = card.querySelector<HTMLElement>('a.template-download, button[data-open-template]')!;
      assert.ok(mainAction, `у #s${id} должна быть основная кнопка скачивания или заявки`);
      const posMask = previewBtn.compareDocumentPosition(mainAction);
      assert.ok(
        Boolean(posMask & dom.window.document.DOCUMENT_POSITION_FOLLOWING),
        `у #s${id} кнопка предпросмотра должна идти до кнопки скачивания/заявки`,
      );
    }

    /* 2. Открытие по клику на миниатюру платной карточки #s08, проверка подписи, масштаба и закрытия по крестику. */
    const thumb08 = doc.querySelector<HTMLButtonElement>('#s08 .template-tile__thumb-btn[data-open-preview]')!;
    thumb08.click();
    assert.equal(previewModal.hasAttribute('open'), true);

    const modalImg = previewModal.querySelector<HTMLImageElement>('[data-preview-modal-img]')!;
    const modalCaption = previewModal.querySelector<HTMLElement>('[data-preview-modal-caption]')!;
    const zoomBtn = previewModal.querySelector<HTMLButtonElement>('[data-preview-zoom]')!;
    const viewport = previewModal.querySelector<HTMLElement>('[data-preview-viewport]')!;
    const downloadBtn = previewModal.querySelector<HTMLAnchorElement>('[data-preview-download]')!;
    const orderBtn = previewModal.querySelector<HTMLButtonElement>('[data-preview-order]')!;

    assert.match(modalImg.getAttribute('src') ?? '', /\/shablony\/previews\/08\.jpg$/);
    assert.match(modalImg.getAttribute('alt') ?? '', /Договор с директором \(генеральным директором\)/);
    /* № 08 входит в подтверждённый комплект 01–10: обещаем DOCX вручную. */
    assert.equal(
      modalCaption.textContent?.trim(),
      'Первая страница шаблона. В открытой сборке DOCX нет: после заявки Мария свяжется с вами и пришлёт редактируемый DOCX вручную.',
    );
    assert.doesNotMatch(
      modalCaption.textContent ?? '',
      /Полная версия — редактируемый DOCX/,
      'нельзя обещать мгновенную выдачу DOCX',
    );
    assert.equal(downloadBtn.hidden, true, 'у платного шаблона в лайтбоксе нет прямой ссылки на скачивание');
    assert.equal(orderBtn.hidden, false);
    assert.match(orderBtn.textContent ?? '', /500\s*₽/);

    /* Масштабирование для чтения */
    assert.equal(viewport.classList.contains('is-zoomed'), false);
    zoomBtn.click();
    assert.equal(viewport.classList.contains('is-zoomed'), true);
    assert.equal(zoomBtn.getAttribute('aria-pressed'), 'true');

    /* Закрытие по крестику */
    previewModal.querySelector<HTMLButtonElement>('[data-close-preview]')!.click();
    assert.equal(previewModal.hasAttribute('open'), false);

    /* 3. Открытие по кнопке «Посмотреть первую страницу» на бесплатной карточке #s01 и закрытие кликом вне окна. */
    const previewBtn01 = doc.querySelector<HTMLButtonElement>('#s01 .template-preview-btn[data-open-preview]')!;
    previewBtn01.click();
    assert.equal(previewModal.hasAttribute('open'), true);
    assert.equal(viewport.classList.contains('is-zoomed'), false, 'масштаб сбрасывается при новом открытии');
    assert.equal(downloadBtn.hidden, false, 'у бесплатного шаблона #s01 доступно скачивание DOCX');
    assert.match(
      downloadBtn.getAttribute('href') ?? '',
      /^https:\/\/drive\.google\.com\/uc\?export=download&id=1kJOeCWe6MjMgFuq1dGzuOXVzKy0t7hPR$/,
      'в лайтбоксе № 01 одна прямая ссылка на DOCX',
    );
    assert.match(downloadBtn.textContent ?? '', /Скачать DOCX/);

    previewModal.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    assert.equal(previewModal.hasAttribute('open'), false, 'клик по фону диалога закрывает предпросмотр');

    /* 4. Открытие #s09 и закрытие по клавише Escape. */
    doc.querySelector<HTMLButtonElement>('#s09 .template-preview-btn[data-open-preview]')!.click();
    assert.equal(previewModal.hasAttribute('open'), true);
    const escEvent = new dom.window.Event('keydown', { bubbles: true, cancelable: true }) as Event & { key: string };
    Object.defineProperty(escEvent, 'key', { value: 'Escape' });
    doc.dispatchEvent(escEvent);
    assert.equal(previewModal.hasAttribute('open'), false, 'клавиша Esc закрывает предпросмотр');

    /* 5. Переход из лайтбокса предпросмотра #s07 сразу к заявке на этот шаблон. */
    doc.querySelector<HTMLButtonElement>('#s07 .template-preview-btn[data-open-preview]')!.click();
    assert.equal(previewModal.hasAttribute('open'), true);
    orderBtn.click();
    assert.equal(previewModal.hasAttribute('open'), false, 'при переходе к заказу лайтбокс закрывается');
    assert.equal(leadModal.hasAttribute('open'), true, 'открывается окно заявки на выбранный шаблон');
    assert.equal(
      doc.querySelector('[data-template-modal-doc]')?.textContent,
      'Договор с ненормированным рабочим днём',
    );
    assert.match(doc.querySelector('[data-template-modal-badge]')?.textContent ?? '', /№ 07/);

    /* 6. Проверяем, что в собранном HTML нет ни одной ссылки на .docx. */
    const rawHtml = readFileSync(builtShablonyPath, 'utf8');
    assert.doesNotMatch(rawHtml, /\.docx\b/i, 'в публичном HTML не должно быть ссылок на файлы .docx');
  } finally {
    cleanup();
  }
});

test('смена шаблона после сорванной отправки: новый ключ идемпотентности, без старого талона как дубля', async () => {
  const { dom, doc, cleanup } = mountShablonyDom();
  const prevFetch = globalThis.fetch;
  const sentBodies: Record<string, unknown>[] = [];
  let call = 0;

  /* Сценарий жизни: человек выбрал № 02, отправка упала по таймауту (запрос
     мог дойти), он выбрал № 53 и отправил снова. Сервер без ротации ключа
     нашёл бы запись от № 02 и вернул её талон с duplicate:true — заявка на
     № 53 потерялась бы. */
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    call++;
    sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    if (call === 1) {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }
    return new Response(
      JSON.stringify({
        ticket: 'K-1124-0053',
        status: 'accepted',
        duplicate: false,
        delivered: { telegram: true, email: false },
      }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    const form = doc.getElementById('template-lead-form') as HTMLFormElement;
    const successBox = doc.querySelector<HTMLElement>('[data-lead-success="template-lead-form"]')!;
    const nameInput = form.querySelector<HTMLInputElement>('[name="name"]')!;
    const phoneInput = form.querySelector<HTMLInputElement>('[name="phone"]')!;
    const consent = form.querySelector<HTMLInputElement>('[name="consent"]')!;

    /* 1. Шаблон № 02 — отправка срывается таймаутом. */
    doc.querySelector<HTMLButtonElement>('#s02 [data-open-template]')!.click();
    nameInput.value = 'Марина Соколова';
    phoneInput.value = '+7 (961) 302-21-12';
    consent.checked = true;
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 30));

    assert.equal(sentBodies.length, 1);
    assert.deepEqual(
      (sentBodies[0] as { template: { id: string } }).template.id,
      '02',
    );
    /* Никакой гарантии «дубликатов не будет»: постоянного KV нет. */
    const errorText = doc.querySelector<HTMLElement>('[data-lead-error]')?.textContent ?? '';
    assert.match(errorText, /таймаут/i);
    assert.doesNotMatch(errorText, /дубликат/i, 'нельзя обещать отсутствие дублей без постоянного KV');

    /* 2. Человек выбирает другой шаблон — № 53. */
    doc.querySelector<HTMLButtonElement>('#s53 [data-open-template]')!.click();
    assert.equal(
      doc.querySelector('[data-template-modal-doc]')?.textContent,
      'Табель учёта рабочего времени Т-12',
    );

    nameInput.value = 'Марина Соколова';
    phoneInput.value = '+7 (961) 302-21-12';
    consent.checked = true;
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 30));

    assert.equal(sentBodies.length, 2);
    assert.deepEqual((sentBodies[1] as { template: { id: string } }).template.id, '53');
    assert.notEqual(
      sentBodies[0].idempotency_key,
      sentBodies[1].idempotency_key,
      'при смене шаблона ключ идемпотентности должен перевыпускаться, иначе вернётся старый талон',
    );

    /* 3. Заявка на № 53 реально ушла и показан её талон, а не талон № 02. */
    assert.equal(form.hidden, true);
    assert.equal(successBox.hidden, false);
    assert.match(successBox.textContent ?? '', /K-1124-0053/);
    assert.doesNotMatch(successBox.textContent ?? '', /дубликат/i);
  } finally {
    globalThis.fetch = prevFetch;
    cleanup();
  }
});

test('лайтбокс предпросмотра отцентрирован и открывается широко — без второго ползунка', () => {
  /* Жалоба: окно прижималось к левому краю, а страница не читалась без
     горизонтальной прокрутки. Причина смещения — глобальный сброс
     `*, *::before, *::after { margin: 0 }`, который перебивает стандартное
     `dialog { margin: auto }`. Проверяем по собранному CSS: важно именно
     итоговое правило, а не намерение в исходнике. */
  const previewModal = mountShablonyDom().doc.getElementById('template-preview-modal');
  assert.ok(previewModal, 'лайтбокс должен быть в собранной странице');

  const css = readFileSync(builtShablonyPath, 'utf8')
    .match(/<link[^>]+href="([^"]+\.css)"/g)
    ?.map((tag) => tag.match(/href="([^"]+)"/)![1])
    .map((href) => resolve(REPO_ROOT, href.replace(/^\//, '')))
    .filter((file) => existsSync(file))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n') ?? '';
  assert.ok(css.length > 0, 'должны найтись стили собранной страницы');

  /* Astro добавляет к селекторам атрибут области действия
     (`[data-astro-cid-...]`), поэтому берём текст первого правила с этим
     префиксом — без регулярных выражений с экранированием. */
  const rule = (selector: string): string => {
    const at = css.indexOf(selector);
    if (at < 0) return '';
    const open = css.indexOf('{', at);
    const close = css.indexOf('}', open);
    return open < 0 || close < 0 ? '' : css.slice(open + 1, close);
  };

  /* 1. Центрирование по горизонтали и вертикали. */
  const dialog = rule('.template-preview-modal[');
  assert.match(dialog, /margin:auto/, 'без margin:auto окно снова прижмётся к левому краю');
  assert.match(dialog, /position:fixed/, 'диалог должен позиционироваться относительно экрана');
  assert.match(dialog, /inset:0/, 'inset:0 вместе с margin:auto центрирует окно');
  assert.match(dialog, /height:fit-content/, 'иначе вертикальные авто-отступы не работают');

  /* 2. Ширина: 92vw, но не шире 920px. */
  assert.match(dialog, /width:92vw/);
  assert.match(dialog, /max-width:920px/);

  /* 3. Один вертикальный ползунок: страница занимает всю ширину окна. */
  const viewport = rule('.template-preview__viewport[');
  assert.match(viewport, /overflow-x:hidden/);
  assert.match(viewport, /overflow-y:auto/);
  const img = rule('.template-preview__img[');
  assert.match(img, /width:100%/, 'картинка должна сразу занимать ширину окна');
});

test('карточка № 01: одна прямая кнопка «Скачать DOCX» с Google Drive, без PDF и без запроса', () => {
  /* Требование владельца: у бесплатного № 01 остаётся ОДНА прямая кнопка на
     редактируемый DOCX в Google Drive. Старой «Скачать PDF» и кнопки
     «Запросить обновлённый DOCX» быть не должно. */
  const { doc, cleanup } = mountShablonyDom();
  try {
    const card = doc.getElementById('s01');
    assert.ok(card, 'карточка № 01 должна быть на странице');

    const links = [...card.querySelectorAll<HTMLAnchorElement>('a.template-download')];
    assert.equal(links.length, 1, 'у № 01 должна быть ровно одна кнопка скачивания');
    const download = links[0];
    assert.equal(
      download.getAttribute('href'),
      'https://drive.google.com/uc?export=download&id=1kJOeCWe6MjMgFuq1dGzuOXVzKy0t7hPR',
      'ссылка должна вести на DOCX в Google Drive',
    );
    assert.match(download.textContent ?? '', /Скачать DOCX/);
    assert.equal(download.hasAttribute('download'), false, 'это внешний файл, атрибут download не нужен');
    assert.equal(download.getAttribute('target'), '_blank');
    assert.match(download.getAttribute('rel') ?? '', /noopener/);

    /* Старых элементов быть не должно. */
    assert.equal(card.querySelector('a.template-download[href$=".pdf"]'), null, 'старой кнопки PDF у № 01 нет');
    assert.equal(card.querySelector('.template-format-note'), null, 'лишней подписи про формат у № 01 нет');
    assert.equal(card.querySelector('button[data-open-template]'), null, 'кнопки «Запросить обновлённый DOCX» у № 01 нет');
    assert.equal(doc.querySelectorAll('button[data-open-template][data-template-package="free"]').length, 0);

    /* Остальные бесплатные карточки по-прежнему отдают свои PDF. */
    const otherPdf = doc.querySelectorAll<HTMLAnchorElement>('#s11 a.template-download[download]');
    assert.equal(otherPdf.length, 1, 'бесплатные PDF остальных позиций не тронуты');
  } finally {
    cleanup();
  }
});

test('зум предпросмотра расширяет само окно до 96vw, а шапка «КАДРЫ-ПРО» в миниатюре не обрезана', () => {
  const { dom, doc, cleanup } = mountShablonyDom();
  try {
    const previewModal = doc.getElementById('template-preview-modal') as HTMLDialogElement;
    const zoomBtn = previewModal.querySelector<HTMLButtonElement>('[data-preview-zoom]')!;

    doc.querySelector<HTMLButtonElement>('#s08 .template-tile__thumb-btn[data-open-preview]')!.click();
    assert.equal(previewModal.classList.contains('is-zoomed'), false, 'обычный режим — 92vw/920px');

    zoomBtn.click();
    assert.equal(previewModal.classList.contains('is-zoomed'), true, 'класс чтения должен висеть на самом окне');
    assert.equal(
      previewModal.querySelector('[data-preview-viewport]')!.classList.contains('is-zoomed'),
      true,
      'класс остаётся и на области просмотра (совместимость)',
    );

    zoomBtn.click();
    assert.equal(previewModal.classList.contains('is-zoomed'), false, 'повторное нажатие возвращает обычный размер');
    assert.equal(zoomBtn.getAttribute('aria-pressed'), 'false');
    previewModal.querySelector<HTMLButtonElement>('[data-close-preview]')!.click();

    /* По собранному CSS: окно в режиме чтения — 96vw, картинка при этом
       остаётся по ширине окна (без горизонтального скролла). */
    const css = readFileSync(builtShablonyPath, 'utf8')
      .match(/<link[^>]+href="([^"]+\.css)"/g)!
      .map((tag) => tag.match(/href="([^"]+)"/)![1])
      .map((href) => resolve(REPO_ROOT, href.replace(/^\//, '')))
      .filter((file) => existsSync(file))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    /* Первое правило, в тексте которого встречается маркер селектора. Astro
       ставит атрибут области действия в разных местах селектора, поэтому ищем
       по фрагменту и берём первое совпадение с ожидаемым свойством. */
    const block = (selector: string, mustMatch?: RegExp): string => {
      let from = 0;
      while (true) {
        const at = css.indexOf(selector, from);
        if (at < 0) return '';
        const open = css.indexOf('{', at);
        const close = css.indexOf('}', open);
        if (open < 0 || close < 0) return '';
        const body = css.slice(open + 1, close);
        if (!mustMatch || mustMatch.test(body)) return body;
        from = at + selector.length;
      }
    };
    const zoomedModal = block('is-zoomed', /width:96vw/);
    assert.match(zoomedModal, /width:96vw/);
    assert.match(zoomedModal, /max-width:96vw/);
    const zoomedImg = block('is-zoomed .template-preview__img', /width:100%/);
    assert.match(zoomedImg, /width:100%/, 'картинка не должна становиться шире окна');

    /* Миниатюры 01–10: шапка логотипа видна целиком. */
    const hdImg = block('thumb-btn--hd', /object-position:top center/);
    assert.match(hdImg, /object-position:top center/, 'логотип «КАДРЫ-ПРО» срезался при кадрировании по центру');
    assert.match(block('template-tile__visual', /object-position:top center/), /object-position:top center/);

    /* Никаких «двух ползунков»: горизонтальной прокрутки в области просмотра нет. */
    const viewport = block('.template-preview__viewport', /overflow-x:hidden/);
    assert.match(viewport, /overflow-x:hidden/);
  } finally {
    cleanup();
  }
});

test('hero обещает «20 бесплатных шаблонов», а ссылки Google Drive на платные № 02–10 не попадают на сайт', () => {
  const { doc, cleanup } = mountShablonyDom();
  try {
    const proof = doc.querySelector('.templates-proof');
    assert.ok(proof, 'блок цифр в hero должен быть на странице');
    assert.match(proof.textContent ?? '', /20\s*бесплатных шаблонов/);
    assert.doesNotMatch(proof.textContent ?? '', /бесплатных PDF/);
  } finally {
    cleanup();
  }

  /* Платные DOCX № 02–10 живут только в relay: на сайте их быть не должно. */
  const paidDriveIds = [
    '1dOCzlh7d70wOR7iFU-ZfnBbP5tbZ8nYN',
    '1RPMEB4PnXmtr3qby_jlEoCdRQ9vQc2_K',
    '1CDmvPgQcsEDfr3rs2ht5dYz1uMnQQccc',
    '1xxZg0ZaTR4MWAxdK_JfG8ElpylaJW9AV',
    '1PWufUYizv0BXytVIDulEw1mTSRJ1U355',
    '174nNeqgl99fczfLTtbNuo5cF4YgwEQ2E',
    '1TgXDpTeIlGUEQc1OknJizlztRFo2ZL89',
    '1zuGlmyTkFAW1rUW_PHfcTCKH3bl6utmF',
    '1EcDZ4rgi2d7CoQxhO6ysxeac4TMmzUx3',
  ];
  for (const file of ['shablony.html', 'preview/shablony.html']) {
    const full = resolve(REPO_ROOT, file);
    if (!existsSync(full)) continue;
    const html = readFileSync(full, 'utf8');
    const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)]
      .map((m) => resolve(REPO_ROOT, m[1].replace(/^\//, '')))
      .filter((f) => existsSync(f))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    for (const id of paidDriveIds) {
      assert.ok(!html.includes(id), `${file}: ссылка на платный DOCX (${id}) попала в разметку`);
      assert.ok(!scripts.includes(id), `${file}: ссылка на платный DOCX (${id}) попала в скрипт`);
    }
    /* Ссылка бесплатного № 01 на сайте быть должна. */
    assert.ok(html.includes('1kJOeCWe6MjMgFuq1dGzuOXVzKy0t7hPR'), `${file}: у № 01 нет прямой ссылки на DOCX`);
  }
});

test('обещание DOCX ограничено подтверждёнными № 01–10: старые карточки обещают только PDF', () => {
  const { doc, cleanup } = mountShablonyDom();
  try {
    const previewModal = doc.getElementById('template-preview-modal') as HTMLDialogElement;
    const caption = previewModal.querySelector<HTMLElement>('[data-preview-modal-caption]')!;

    /* Подтверждённые позиции 01–10: подпись про редактируемый DOCX.
       № 01 — бесплатная позиция, у которой скачивается PDF прежнего образца:
       подпись обязана называть формат, иначе кнопка «Скачать PDF» рядом с
       обещанием DOCX читается как несоответствие. */
    for (let i = 1; i <= 10; i++) {
      const id = String(i).padStart(2, '0');
      const trigger = doc.querySelector<HTMLElement>(`#s${id} [data-open-preview]`);
      assert.ok(trigger, `нет триггера предпросмотра у #s${id}`);
      assert.equal(trigger.dataset.previewDocx, '1', `#s${id} должен быть помечен как подтверждённый DOCX`);
      trigger.click();
      const free = trigger.dataset.previewFree === '1';
      if (free) {
        /* Бесплатный № 01: DOCX скачивается сразу, поэтому подпись называет
           именно его, а не PDF и не «по заявке». */
        assert.match(caption.textContent ?? '', /Редактируемый DOCX можно скачать сразу/i, `#s${id}: у бесплатной позиции скачивается DOCX`);
        assert.doesNotMatch(caption.textContent ?? '', /PDF прежнего образца/i, `#s${id}: старый PDF больше не предлагается`);
      } else {
        assert.match(caption.textContent ?? '', /пришлёт редактируемый DOCX вручную/i, `#s${id}: ожидалась подпись про DOCX`);
      }
      assert.doesNotMatch(caption.textContent ?? '', /актуальный/i, `#s${id}: без приёмки слово «актуальный» не обещаем`);
      previewModal.querySelector<HTMLButtonElement>('[data-close-preview]')!.click();
    }

    /* Все остальные карточки с превью (№ 14–62): DOCX не подтверждён. */
    const others = [...doc.querySelectorAll<HTMLElement>('[data-open-preview]')]
      .filter((el) => !/^0[1-9]$|^10$/.test(el.dataset.previewId ?? ''));
    assert.ok(others.length >= 30, `ожидались старые карточки с превью, найдено ${others.length}`);

    for (const trigger of others) {
      const id = trigger.dataset.previewId ?? '';
      assert.equal(trigger.dataset.previewDocx, '0', `#s${id} не должен обещать DOCX`);
      trigger.click();
      const text = caption.textContent ?? '';
      assert.doesNotMatch(text, /пришлёт редактируемый DOCX/i, `#s${id}: DOCX для этой позиции не подготовлен`);
      assert.match(text, /пришлёт документ \(PDF\) вручную/i);
      assert.match(text, /DOCX для этой позиции пока не подготовлен/i);
      previewModal.querySelector<HTMLButtonElement>('[data-close-preview]')!.click();
    }

    /* В собранном HTML обещание DOCX встречается только в подтверждённом блоке. */
    const rawHtml = readFileSync(builtShablonyPath, 'utf8');
    const docxPromises = (rawHtml.match(/data-preview-docx="1"/g) ?? []).length;
    assert.equal(docxPromises, 20, 'по 2 триггера (миниатюра + кнопка) на 10 подтверждённых карточек');
  } finally {
    cleanup();
  }
});

test('неоднозначная старая запись: предупреждение вместо автоповтора, дубль не создаётся', async () => {
  const { dom, doc, cleanup } = mountShablonyDom();
  const prevFetch = globalThis.fetch;
  const sent: Record<string, unknown>[] = [];
  let call = 0;

  /* Сервер нашёл запись прежнего формата: заявка под этим ключом уже была, но
     что именно отправляли — неизвестно. Он ответил 422 + `idempotency_legacy`
     (не 2xx и не 409, чтобы и старый клиент не счёл это успехом и не повторил)
     и НИЧЕГО не доставил. Новый клиент показывает предупреждение и не
     повторяет отправку: иначе при потерянном ответе появлялся молчаливый дубль. */
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    call++;
    sent.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    return new Response(
      JSON.stringify({
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
            + 'Повторно ничего не отправлено, чтобы не создать дубль. Если вы выбрали другой шаблон или изменили данные — нажмите «Отправить» ещё раз: заявка уйдёт как новая, с другим номером. Если сомневаетесь — позвоните: +7 (961) 302-21-12.',
        },
      }),
      { status: 422, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    const form = doc.getElementById('template-lead-form') as HTMLFormElement;
    const successBox = doc.querySelector<HTMLElement>('[data-lead-success="template-lead-form"]')!;
    const errorBox = doc.querySelector<HTMLElement>('[data-lead-error="template-lead-form"]')!;

    doc.querySelector<HTMLButtonElement>('#s02 [data-open-template]')!.click();
    (form.querySelector('[name="name"]') as HTMLInputElement).value = 'Марина Соколова';
    (form.querySelector('[name="phone"]') as HTMLInputElement).value = '+7 (961) 302-21-12';
    (form.querySelector('[name="consent"]') as HTMLInputElement).checked = true;

    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 30));

    assert.equal(sent.length, 1, 'никакого автоматического повтора быть не должно');
    assert.equal(call, 1);

    assert.equal(errorBox.hidden, false, 'предупреждение должно быть видно');
    assert.equal(errorBox.getAttribute('data-level'), 'warning');
    assert.match(errorBox.textContent ?? '', /уже отправлялась раньше/i);
    assert.match(errorBox.textContent ?? '', /K-1121-4242/);
    assert.match(errorBox.textContent ?? '', /ничего не отправлено, чтобы не создать дубль/i);
    assert.match(errorBox.textContent ?? '', /могла быть уже доставлена/i);
    assert.match(errorBox.textContent ?? '', /другой шаблон/i);

    assert.equal(successBox.hidden, true, 'успех не показываем: доставка не подтверждена');
    assert.equal(form.hidden, false, 'форма остаётся заполненной — человек решает сам');

    /* Осознанная повторная отправка человеком: ключ перевыпущен заранее, жмём
       «Отправить» ещё раз — теперь сервер примет заявку как новую. */
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response(
        JSON.stringify({ ticket: 'K-1124-0777', status: 'accepted', duplicate: false, delivered: { telegram: true, email: false } }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 30));

    assert.equal(sent.length, 2);
    assert.notEqual(sent[0].idempotency_key, sent[1].idempotency_key, 'повтор человека идёт с новым ключом');
    assert.equal(successBox.hidden, false);
    assert.match(successBox.textContent ?? '', /K-1124-0777/);
  } finally {
    globalThis.fetch = prevFetch;
    cleanup();
  }
});
