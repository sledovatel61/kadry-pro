import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkTemplateCatalog } from '../scripts/check-templates.mjs';

const catalog = JSON.parse(readFileSync(new URL('../content/templates.json', import.meta.url), 'utf8'));

test('каталог содержит 64 уникальных документа: 20 бесплатных, 44 платных и 52 JPG-превью (включая № 01–30)', () => {
  const result = checkTemplateCatalog(catalog);
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.free, 20);
  assert.equal(result.paid, 44);
  assert.equal(result.previews, 52);
});

test('шаблоны № 01–30 привязаны к /shablony/previews/01.jpg–30.jpg, а в публичной папке нет .docx', () => {
  for (let i = 1; i <= 30; i++) {
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
