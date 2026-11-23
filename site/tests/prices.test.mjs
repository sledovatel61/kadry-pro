import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validatePriceList, checkPriceSync } from '../scripts/check-prices-sync.mjs';

const root = new URL('../', import.meta.url);
const prices = JSON.parse(readFileSync(new URL('../content/prices.json', import.meta.url), 'utf8'));

test('прайс соответствует схеме и содержит актуальный набор позиций', () => {
  const result = validatePriceList(prices);
  assert.equal(Array.isArray(result), false);
  assert.deepEqual(result.errors, []);
  assert.ok(result.count >= 45);
});

test('есть опорные цены для страниц услуг и статей Агента 03', () => {
  const all = new Map(prices.groups.flatMap((group) => group.items.map((item) => [`${group.id}.${item.id}`, item.price])));
  assert.equal(all.get('audit.express'), 7900);
  assert.equal(all.get('audit.git_prep'), 15000);
  assert.equal(all.get('consult.hour'), 3000);
});

test('нет неразрешённых токенов и не возвращены старые пакеты шаблонов', () => {
  const result = checkPriceSync(prices, fileURLToPath(root));
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(prices.groups.find((g) => g.id === 'templates').items.some((i) => [5000, 8000].includes(i.price)), false);
});

test('валидатор обнаруживает повтор и отрицательную цену', () => {
  const bad = structuredClone(prices);
  bad.groups[0].items[0].price = -1;
  const result = validatePriceList(bad);
  assert.ok(result.errors.some((e) => e.includes('некорректная цена')));
});
