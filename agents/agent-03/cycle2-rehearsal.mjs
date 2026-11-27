/**
 * А3, цикл 2: офлайн-репетиция двух тестовых заявок через НАСТОЯЩИЙ код воркера.
 *
 * ЧТО ЭТО. Точный прогон тех двух payload'ов, которые собрал бы браузер на
 * kadry-pro.ru, через `relay/src/index.ts` с подменённым сетевым слоем:
 * Telegram и Resend отвечают 200, наружу ничего не уходит. Результат:
 * HTTP-статус, талон, каналы и полный текст обоих уведомлений.
 *
 * ЧЕГО ЭТО НЕ ДОКАЗЫВАЕТ. Это НЕ боевая отправка. Реальная доставка, реальные
 * секреты, реальная версия воркера и реальная почта здесь не участвуют.
 * В отчёте результат помечен как «репетиция», а не как «доставлено».
 *
 * Запуск: cd relay && node --experimental-strip-types ../agents/agent-03/cycle2-rehearsal.mjs
 */
const REPO = '/home/user/kadry-pro';
const SITE = `${REPO}/site`;

/* ---------- 1. payload'ы собирает клиентский код сборки, а не литералы ---------- */
const { JSDOM } = await import(`${SITE}/node_modules/jsdom/lib/api.js`);
process.env.PUBLIC_LEADS_ENDPOINT = 'https://kadry-leads.ats439.workers.dev';
const { buildPayload } = await import(`${SITE}/src/client/leads-form.ts`);
const { wireTemplateModal } = await import(`${SITE}/src/client/template-modal.ts`);
const { readFileSync } = await import('node:fs');

/* Услуга: /services.html, форма #lead-services. */
const serviceDom = new JSDOM(readFileSync(`${SITE}/pages-dist/services.html`, 'utf8'), {
  url: 'https://kadry-pro.ru/services.html',
});
const sf = serviceDom.window.document.querySelector('form[data-lead-form]');
sf.querySelector('[name=name]').value = 'ТЕСТ А3 Услуга';
sf.querySelector('[name=phone]').value = '+7 (961) 000-00-01';
sf.querySelector('[name=comment]').value = 'ТЕСТ — проверка доставки заявки с услуги. Не обрабатывать.';
sf.querySelector('[name=consent]').checked = true;
const servicePayload = buildPayload(sf);

/* Шаблон № 59: карточка → предпросмотр → «Оставить заявку». */
const tplDom = new JSDOM(readFileSync(`${SITE}/pages-dist/shablony.html`, 'utf8'), {
  url: 'https://kadry-pro.ru/shablony.html',
});
const td = tplDom.window.document;
wireTemplateModal(td);
td.querySelector('#s59 [data-open-preview]').dispatchEvent(new tplDom.window.MouseEvent('click', { bubbles: true }));
td.querySelector('[data-preview-order]').dispatchEvent(new tplDom.window.MouseEvent('click', { bubbles: true }));
const tf = td.querySelector('#template-lead-form');
tf.querySelector('[name=name]').value = 'ТЕСТ А3 Шаблон 59';
tf.querySelector('[name=phone]').value = '+7 (961) 000-00-02';
tf.querySelector('[name=email]').value = 'test@example.ru';
tf.querySelector('[name=consent]').checked = true;
const templatePayload = buildPayload(tf);

/* idempotency_key браузер выдаёт сам; здесь добавляем, как это делает submit. */
const uuid = () => crypto.randomUUID();
servicePayload.idempotency_key = uuid();
servicePayload.form_started_at = Date.now() - 15_000;
templatePayload.idempotency_key = uuid();
templatePayload.form_started_at = Date.now() - 15_000;

/* ---------- 2. прогон через настоящий воркер ---------- */
const { default: worker, resetMemoryStore } = await import(`${REPO}/relay/src/index.ts`);
resetMemoryStore();

const delivered = [];
globalThis.fetch = (async (input, init) => {
  const url = String(input);
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  delivered.push({ url, body });
  if (url.includes('api.telegram.org')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});

const env = {
  ALLOWED_ORIGINS: 'https://kadry-pro.ru,https://www.kadry-pro.ru',
  SITE_NAME: 'Кадры-Про',
  CONSENT_VERSION: '2026-11-21',
  BOT_TOKEN: 'rehearsal-not-a-secret',
  TELEGRAM_CHAT_ID: '-1000000000000',
  EMAIL_TO: 'rehearsal@example.invalid',
  EMAIL_FROM: 'rehearsal@example.invalid',
  RESEND_API_KEY: 'rehearsal-not-a-secret',
  TELEGRAM_API_BASE: 'https://api.telegram.org',
};

async function send(payload, label, ip) {
  const res = await worker.fetch(new Request('https://kadry-leads.ats439.workers.dev/leads', {
    method: 'POST',
    headers: { origin: 'https://kadry-pro.ru', 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify(payload),
  }), env);
  const body = await res.json();
  console.log(`\n########## ${label} ##########`);
  console.log('payload →', JSON.stringify(payload));
  console.log('HTTP', res.status, '|', JSON.stringify(body));
  return body;
}

const sBody = await send(servicePayload, 'РЕПЕТИЦИЯ · заявка на услугу', '203.0.113.201');
const tBody = await send(templatePayload, 'РЕПЕТИЦИЯ · заявка на шаблон № 59', '203.0.113.202');

/* ---------- 3. что именно уйдёт в каждый канал ---------- */
console.log('\n########## ДОСТАВЛЕННЫЕ УВЕДОМЛЕНИЯ ##########');
for (const [i, d] of delivered.entries()) {
  const kind = d.url.includes('telegram') ? 'TELEGRAM' : 'EMAIL';
  console.log(`\n--- ${i + 1}. ${kind} ---`);
  if (kind === 'TELEGRAM') console.log(d.body.text);
  else {
    console.log('to:', d.body.to, '| subject:', d.body.subject);
    console.log(String(d.body.html || d.body.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500));
  }
}

/* ---------- 4. сверки ---------- */
console.log('\n########## СВЕРКИ ##########');
const tg = delivered.filter((d) => d.url.includes('telegram')).map((d) => d.body.text);
const mails = delivered.filter((d) => !d.url.includes('telegram'));

const checks = [
  ['услуга: HTTP 201 и талон выдан', sBody.status === 'accepted' && /^K-\d{4}-\d{4}$/.test(sBody.ticket), sBody.ticket],
  ['шаблон: HTTP 201 и талон выдан', tBody.status === 'accepted' && /^K-\d{4}-\d{4}$/.test(tBody.ticket), tBody.ticket],
  ['талоны разные', sBody.ticket !== tBody.ticket, `${sBody.ticket} / ${tBody.ticket}`],
  ['услуга: обе ветки доставки подтверждены', sBody.delivered?.telegram === true && sBody.delivered?.email === true, JSON.stringify(sBody.delivered)],
  ['шаблон: обе ветки доставки подтверждены', tBody.delivered?.telegram === true && tBody.delivered?.email === true, JSON.stringify(tBody.delivered)],
  ['клиенту не вернули ни одной ссылки', !JSON.stringify(sBody).includes('drive.google.com') && !JSON.stringify(tBody).includes('drive.google.com'), '—'],
  ['шаблон: номер 59 в уведомлении', tg[1].includes('ID: <code>59</code>'), '—'],
  ['шаблон: название совпадает с карточкой', tg[1].includes('Подготовка к проверке ГИТ'), '—'],
  ['шаблон: цена 500 ₽ (не 1 ₽ из браузера)', tg[1].includes('500 ₽') && !/[^\d]1 ₽/.test(tg[1]), '—'],
  ['шаблон: ссылка DOCX на Google Drive есть', /drive\.google\.com/.test(tg[1]), '—'],
  ['шаблон: предупреждение о старом PDF есть', /СТАРЫЙ PDF-образец/.test(tg[1]), '—'],
  ['шаблон: письмо содержит ссылку DOCX', mails.some((m) => /drive\.google\.com/.test(String(m.body.html || ''))), '—'],
  ['услуга: выбранное значение дошло как есть', tg[0].includes('Услуга: subscription'), 'в уведомлении «subscription», хотя тариф не выбирали'],
];
let failed = 0;
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail && detail !== '—' ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}
console.log(`\nИтог сверок: ${checks.length - failed}/${checks.length}`);
if (failed) process.exitCode = 1;
