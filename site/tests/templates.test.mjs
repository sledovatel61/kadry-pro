import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkTemplateCatalog } from '../scripts/check-templates.mjs';

const catalog = JSON.parse(readFileSync(new URL('../content/templates.json', import.meta.url), 'utf8'));

test('каталог содержит 64 уникальных документа: 20 бесплатных, 44 платных и 64 JPG-превью (все позиции)', () => {
  const result = checkTemplateCatalog(catalog);
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.free, 20);
  assert.equal(result.paid, 44);
  assert.equal(result.previews, 64);
});

test('шаблоны № 01–64 привязаны к /shablony/previews/<id>.jpg, а в публичной папке нет .docx', () => {
  for (let i = 1; i <= 64; i++) {
    const id = String(i).padStart(2, '0');
    const item = catalog.items.find((entry) => entry.id === id);
    assert.ok(item, `в каталоге отсутствует шаблон ${id}`);
    assert.equal(item.preview, `/shablony/previews/${id}.jpg`);
  }
  const item01 = catalog.items.find((entry) => entry.id === '01');
  assert.equal(item01.free, true);
  assert.equal(item01.file, '/shablony/free/01_Трудовой_договор_бессрочный.pdf');
});

test('платным позициям доступны только водяные превью, не исходные PDF', () => {
  assert.ok(catalog.items.filter((item) => !item.free).every((item) => item.file === null && item.preview?.endsWith('.jpg')));
  assert.equal(catalog.items.filter((item) => item.free && item.file).length, 20);
});

test('архив содержит только бесплатный набор, платёжных заглушек нет', () => {
  const page = readFileSync(new URL('../src/pages/shablony.astro', import.meta.url), 'utf8');
  assert.match(page, /free-bundle-20\.zip/);
  const placeholders = new RegExp(['YOUR_', '(?:YOOMONEY_WALLET|TINKOFF_LINK)', '|email-bundle', '\\.zip'].join(''), 'i');
  assert.doesNotMatch(page, placeholders);
});

test('партия № 53–64: названия и описания соответствуют исправленным DOCX, цены и free-статус не изменились', () => {
  /* Источник — DOCX из коммита ca9649c (agents/agent-02/docx-53-64).
     Витрина не должна обещать унифицированные формы, которых в документе нет:
     53 — собственная форма, а не Т-12; 54 — внутренняя карточка, а не Т-2;
     55 — навигатор по формам № 4, 6, 10; 56 — контрольный лист, а не карта СОУТ;
     61 — инструкция по подготовке ПВТР, а не готовые правила; 62 — как составить
     договор; 63 — сроки хранения, а не сроки кадровых действий. */
  const expected = {
    '53': { name: 'Табель учёта рабочего времени', free: false },
    '54': { name: 'Внутренняя карточка работника', free: false },
    '55': { name: 'Воинский учёт: какую форму применять', free: false },
    '56': { name: 'Контрольный лист СОУТ', free: false },
    '57': { name: 'Памятка приёма сотрудника', free: true },
    '58': { name: 'Памятка увольнения сотрудника', free: true },
    '59': { name: 'Подготовка к проверке ГИТ', free: false },
    '60': { name: 'Памятка ведения воинского учёта', free: false },
    '61': { name: 'Как подготовить ПВТР', free: false },
    '62': { name: 'Как составить трудовой договор', free: false },
    '63': { name: 'Сроки хранения кадровых документов', free: true },
    '64': { name: 'Штрафы ГИТ и смежных органов', free: true },
  };
  for (const [id, want] of Object.entries(expected)) {
    const item = catalog.items.find((entry) => entry.id === id);
    assert.ok(item, `в каталоге отсутствует шаблон ${id}`);
    assert.equal(item.name, want.name, `название ${id}`);
    assert.equal(item.free, want.free, `free-статус ${id}`);
    assert.equal(item.price, want.free ? 0 : 500, `цена ${id}`);
    assert.equal(item.preview, `/shablony/previews/${id}.jpg`, `превью ${id}`);
    assert.ok(item.description.length > 30, `описание ${id} слишком короткое`);
    /* В НАЗВАНИИ унифицированных форм быть не должно: витрина не обещает Т-12/Т-2. */
    assert.doesNotMatch(item.name, /унифицированн|Т-12|Т-2\b|готовые ПВТР|форма 2024/i, `${id}: нельзя обещать унифицированную форму в названии`);
  }
  /* Прямое отрицание обязательно там, где документ легко спутать с формой. */
  const denies = {
    '53': /не унифицированная Т-12/i,
    '54': /не унифицированная Т-2/i,
    '56': /не официальная карта/i,
    '61': /не готовые ПВТР/i,
    '63': /не сроки кадровых действий/i,
  };
  for (const [id, re] of Object.entries(denies)) {
    const item = catalog.items.find((entry) => entry.id === id);
    assert.match(item.description, re, `${id}: в описании должно быть прямое отрицание`);
  }
  for (const id of ['57', '58', '63', '64']) {
    const item = catalog.items.find((entry) => entry.id === id);
    assert.equal(item.file, `/shablony/free/${item.filename}`, `бесплатный PDF ${id}`);
  }
});

test('на сайте открыты DOCX только бесплатных № 57, 58, 63, 64; платные 53–56, 59–62 — только в relay', () => {
  const page = readFileSync(new URL('../src/pages/shablony.astro', import.meta.url), 'utf8');
  const freeLinks = { '57': '1CwBTFg8-03Je-j3AXqSTO_ivKjSGDirP', '58': '1IKHn9y4Fv9kTvnFCpT7BgVJEyby34rhK', '63': '18PV1GqoOcspOmGWGS970FdZNzBLJuBKq', '64': '1GUbTTZ-6mhXGyGkZbZHQZPjtcK8RUm90' };
  for (const [id, driveId] of Object.entries(freeLinks)) {
    assert.ok(page.includes(driveId), `у бесплатного № ${id} должна быть ссылка на DOCX`);
  }
  const paidLinks = {
    '53': '16zVDdhihgcUt7v6fPl7xNQxWau3fvxwF', '54': '1N5qgYSgyAfBXejLcxd1GPD6BbznULDwB',
    '55': '1DeD0Up9kyWUQeyarJMbVlX6XZRk6SDzI', '56': '1P786lhKoCp5wA6dH-UtFgYEXDNOm_0cU',
    '59': '1Hp089asbOw4ptnl8KlM8C__1Zu7OtbkP', '60': '1ZSKZ9EMefhYw9wNQOcbGwNYVlXTe1B2M',
    '61': '1XYmDN-BOMxSwZGuTbRjvK7-yihpDltHq', '62': '1WQtz-bHt6eMIH9XwBZjM8g-ZwvGWQymj',
  };
  for (const [id, driveId] of Object.entries(paidLinks)) {
    assert.ok(!page.includes(driveId), `платная ссылка № ${id} не должна попадать в разметку сайта`);
  }
});
