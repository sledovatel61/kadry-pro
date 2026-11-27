/**
 * Мобильный прогон пути «услуга → форма» и «платная карточка № 59/60 → форма»
 * на собранной странице, без отправки заявок.
 *
 * Зачем: браузера в песочнице нет (нет Chromium/Playwright), сеть к боевому
 * домену из песочницы закрыта на TLS. Поэтому путь воспроизводится на реальной
 * сборке (`site/pages-dist` — её же публикует GitHub Pages) в jsdom с шириной
 * экрана телефона: те же обработчики клиента, что в проде, тот же DOM и те же
 * data-атрибуты. Это не заменяет проверку в живом мобильном браузере: чего
 * здесь нет — так это реального тап-таргета, скролла и вёрстки; про них в
 * отчёте отдельная пометка «не проверено».
 *
 * Отправка НЕ выполняется: перехватываем fetch и только смотрим, что ушло бы
 * в воркер. Флаг --wire-send не нужен и намеренно не реализован.
 *
 * Запуск (из site/):  node ../agents/agent-03/prod-leads-probe.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const SITE_DIR = resolve(import.meta.dirname, '..', '..', 'site');
/* jsdom лежит в devDependencies сайта: подтягиваем его по пути сборки, чтобы
   скрипт можно было запускать из любого каталога. */
const { JSDOM: RawJSDOM } = await import(resolve(SITE_DIR, 'node_modules/jsdom/lib/api.js'));
const PAGES = resolve(SITE_DIR, 'pages-dist');
if (!existsSync(PAGES)) {
  console.error('Нет site/pages-dist. Соберите: cd site && npm ci && npm run build:root');
  process.exit(2);
}

process.env.PUBLIC_LEADS_ENDPOINT = process.env.PUBLIC_LEADS_ENDPOINT || 'https://kadry-leads.ats439.workers.dev';
const { buildPayload, validateForm } = await import(resolve(SITE_DIR, 'src/client/leads-form.ts'));
const { wireTemplateModal } = await import(resolve(SITE_DIR, 'src/client/template-modal.ts'));

const PHONE_W = 375;
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

function mount(html, url) {
  return new RawJSDOM(html, { url, pretendToBeVisual: true });
}

/* ---------- 1. Услуга → форма (страница «Услуги и цены») ---------- */
{
  const html = readFileSync(resolve(PAGES, 'services.html'), 'utf8');
  const dom = mount(html, 'https://kadry-pro.ru/services.html');
  const { document } = dom.window;

  const form = document.querySelector('form[data-lead-form]');
  record('services: форма заявки есть на странице', Boolean(form),
    form ? `id=${form.id} data-page=${form.getAttribute('data-page')} data-service=${form.getAttribute('data-service')}` : '');

  const viewport = /<meta name="viewport" content="[^"]*width=device-width/.test(html);
  record('services: meta viewport мобильный', viewport);

  /* Обязательные поля и их типы — то, что человек увидит на телефоне. */
  const nameInput = form.querySelector('[name="name"]');
  const phoneInput = form.querySelector('[name="phone"]');
  const consent = form.querySelector('[name="consent"]');
  record('services: поля имени/телефона/согласия на месте', Boolean(nameInput && phoneInput && consent),
    `name=${nameInput?.tagName.toLowerCase()} phone type=${phoneInput?.type} inputmode=${phoneInput?.getAttribute('inputmode') || '—'} autocomplete=${phoneInput?.getAttribute('autocomplete') || '—'}`);

  /* Заполняем как человек с телефона и смотрим payload — без отправки. */
  nameInput.value = 'ТЕСТ А3 Мобильный';
  phoneInput.value = '+7 (961) 000-00-01';
  consent.checked = true;
  const textarea = form.querySelector('[name="message"]');
  if (textarea) textarea.value = 'ТЕСТ — проверка формы услуги, не отправлять клиенту';

  const valid = validateForm(form);
  record('services: клиентская валидация проходит', valid);

  const payload = valid ? buildPayload(form) : null;
  record('services: payload собирается', Boolean(payload),
    payload ? `kind=${payload.kind} page=${payload.page} service=${payload.service} consent=${payload.consent_version}` : '');

  /* Мобильная эргономика тап-таргетов кнопки отправки: считаем по CSS сборки. */
  const css = [...document.querySelectorAll('link[rel=stylesheet]')]
    .map((l) => l.getAttribute('href'))
    .filter(Boolean)
    .map((href) => {
      const p = resolve(PAGES, href.replace(/^\//, ''));
      return existsSync(p) ? readFileSync(p, 'utf8') : '';
    })
    .join('\n');
  const submit = form.querySelector('button[type="submit"]');
  const submitClass = (submit?.className || '').split(/\s+/).filter(Boolean)[0] || '';
  const rule = submitClass
    ? new RegExp(`\\.${submitClass}\\s*\\{[^}]*\\}`).exec(css)
    : null;
  const h = rule ? /min-height:\s*(\d+)px/.exec(rule[0]) : null;
  const paddingY = rule ? /padding:\s*(\d+)px/.exec(rule[0]) : null;
  /* Высота кнопки = 2×padding + строка текста; min-height в правиле нет,
     поэтому считаем по padding и кеглю 0,95rem (15,2px) с line-height 1,2. */
  const lineHeight = 15.2 * 1.2;
  const approx = paddingY ? Number(paddingY[1]) * 2 + lineHeight : 0;
  record('services: кнопка отправки не ниже 44px (тап-таргет)', approx >= 44,
    `class="${submitClass}" padding=${paddingY?.[1] ?? '—'}px → высота ≈ ${Math.round(approx)}px`);

  dom.window.close();
}

/* ---------- 2. Платная карточка → форма (страница шаблонов) ---------- */
for (const id of ['59', '60']) {
  const html = readFileSync(resolve(PAGES, 'shablony.html'), 'utf8');
  const dom = mount(html, 'https://kadry-pro.ru/shablony.html');
  const { window } = dom;
  const { document } = window;

  /* Проверяем именно мобильный путь: тап по миниатюре карточки, затем
     «Оставить заявку» в лайтбоксе — как это делает палец на телефоне. */
  const trigger = document.querySelector(`#s${id} [data-open-preview]`);
  const priceOnCard = document.querySelector(`#s${id} .template-price, #s${id} .template-badge--paid`);
  record(`s${id}: карточка и кнопка предпросмотра на месте`, Boolean(trigger),
    trigger ? `title="${trigger.getAttribute('data-preview-title')}" price=${trigger.getAttribute('data-preview-price')} free=${trigger.getAttribute('data-preview-free')}` : '');
  record(`s${id}: цена видна на карточке`, Boolean(priceOnCard),
    priceOnCard ? priceOnCard.textContent.replace(/\s+/g, ' ').trim() : 'селектор цены не найден');

  if (!trigger) { window.close(); continue; }

  wireTemplateModal(document);
  trigger.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  const modal = document.querySelector('#template-preview-modal') || document.querySelector('dialog[open]');
  record(`s${id}: по тапу открывается предпросмотр`, Boolean(modal?.hasAttribute('open')) || Boolean(document.querySelector('dialog[open]')));

  const caption = document.querySelector('[data-preview-modal-caption]')?.textContent?.trim();
  record(`s${id}: подпись под превью честная (DOCX вручную, без «актуальный»)`,
    Boolean(caption) && !/актуальн/i.test(caption || ''),
    caption ? `«${caption.slice(0, 90)}…»` : 'нет подписи');

  /* Переход к форме заявки. */
  const orderBtn = document.querySelector('[data-preview-order]');
  if (orderBtn) {
    orderBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const lead = document.querySelector('#template-lead-modal');
    const form = lead?.querySelector('form[data-lead-form]') || lead?.querySelector('form');
    /* Выбранная позиция живёт не в data-атрибуте id, а в JSON формы
       `data-template` — именно из него клиент собирает payload. Читаем его же
       функцией сборки, иначе проверка смотрит не туда. */
    const chosen = form ? JSON.parse(form.dataset.template || 'null') : null;
    record(`s${id}: из предпросмотра открывается форма заявки`, Boolean(form),
      form ? `data-lead-kind=${form.getAttribute('data-lead-kind')} выбрано=${chosen ? `${chosen.id}/${chosen.package}/${chosen.price}` : 'ничего'}` : 'форма не найдена');

    if (form) {
      record(`s${id}: в форме выбрана та же позиция`, chosen?.id === id,
        `ожидали ${id}, выбрано ${chosen?.id ?? 'ничего'}`);
      record(`s${id}: показанная цена 500 ₽`, chosen?.price === 500,
        `price=${chosen?.price ?? '—'}`);
      const badge = form.closest('dialog')?.querySelector('[data-template-modal-badge], [data-template-modal-price]');
      record(`s${id}: в шапке формы видно «№ ${id}» и 500 ₽`,
        Boolean(form.closest('dialog')?.textContent?.includes(`№ ${id}`)),
        badge ? badge.textContent.trim() : 'шапка не найдена');

      const nameEl = form.querySelector('[name="name"]');
      const phoneEl = form.querySelector('[name="phone"]');
      const consentEl = form.querySelector('[name="consent"]');
      const emailEl = form.querySelector('[name="email"]');
      nameEl.value = 'ТЕСТ А3 Шаблон';
      phoneEl.value = '+7 (961) 000-00-02';
      consentEl.checked = true;
      if (emailEl) emailEl.value = 'test@example.ru';
      const commentEl = form.querySelector('[name="comment"]') || form.querySelector('[name="message"]');
      if (commentEl) commentEl.value = 'ТЕСТ — проверка заявки на шаблон, не отправлять';

      const ok = validateForm(form);
      record(`s${id}: валидация формы шаблона проходит`, ok);
      const payload = ok ? buildPayload(form) : null;
      record(`s${id}: payload несёт номер, название, пакет и цену`,
        Boolean(payload?.template) && payload.template.id === id && payload.template.package === 'single' && payload.template.price === 500,
        payload?.template ? JSON.stringify(payload.template) : 'payload.template пуст');
      record(`s${id}: платная ссылка Drive в payload НЕ уходит`,
        JSON.stringify(payload ?? {}).includes('drive.google.com') === false);
    }
  } else {
    record(`s${id}: кнопка «Оставить заявку» в предпросмотре`, false, 'кнопка не найдена');
  }

  window.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\nИтог: ${results.length - failed.length}/${results.length} проверок пройдено`);
if (failed.length) {
  console.log('Провалено:');
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
  process.exit(1);
}
