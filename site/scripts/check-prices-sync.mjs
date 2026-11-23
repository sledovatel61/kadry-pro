#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = resolve(fileURLToPath(new URL('.', import.meta.url)));
const siteRoot = resolve(scriptDir, '..');
const pricesPath = resolve(siteRoot, 'content/prices.json');
const schemaPath = resolve(siteRoot, 'content/prices.schema.json');

export function validatePriceList(prices) {
  const errors = [];
  if (!prices || prices.schema_version !== 1 || prices.currency !== 'RUB' || !/^\d{4}-\d{2}-\d{2}$/.test(prices.updated_at ?? '')) errors.push('обязательны schema_version=1, currency=RUB и updated_at YYYY-MM-DD');
  if (!Array.isArray(prices?.groups) || prices.groups.length === 0) return [...errors, 'groups должен быть непустым массивом'];
  const groups = new Set();
  const all = new Set();
  let count = 0;
  for (const group of prices.groups) {
    if (!group?.id || !group?.title || !Array.isArray(group.items) || group.items.length === 0) { errors.push('у каждой группы должны быть id, title и непустой items'); continue; }
    if (groups.has(group.id)) errors.push(`повтор группы: ${group.id}`);
    groups.add(group.id);
    for (const item of group.items) {
      count++;
      if (!item?.id || !item?.name || !(item.price === null || (Number.isInteger(item.price) && item.price >= 0))) errors.push(`некорректная цена: ${group.id}.${item?.id ?? '?'}`);
      const key = `${group.id}.${item.id}`.toLowerCase();
      if (all.has(key)) errors.push(`повтор позиции: ${key}`);
      all.add(key);
    }
  }
  for (const key of ['audit.express', 'audit.git_prep', 'consult.hour']) if (!all.has(key)) errors.push(`нет обязательной позиции ${key}`);
  if (prices.groups.some((g) => g.id === 'templates' && g.items.some((item) => /пакет|набор/i.test(item.name) && [5000, 8000].includes(item.price)))) errors.push('устаревшая цена пакета шаблонов 5 000/8 000 ₽');
  return { errors, count, ids: all };
}

export function checkPriceSync(prices, root = siteRoot) {
  const validation = validatePriceList(prices);
  const errors = Array.isArray(validation) ? validation : [...validation.errors];
  const ids = Array.isArray(validation) ? new Set() : validation.ids;
  // Только авторский контент статей содержит ценовые токены. Исходники рендерера
  // и кабинета сами упоминают синтаксис {{price:id}} и не являются ценами.
  const articlePath = resolve(root, 'content/articles.json');
  const paths = existsSync(articlePath) ? [articlePath] : [];
  for (const path of paths) {
    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(/\{\{price:([a-z0-9_.-]+)\}\}/gi)) {
      if (!ids.has(match[1].toLowerCase())) errors.push(`${relative(root, path)}: неизвестная цена ${match[1]}`);
    }
  }
  return { ok: errors.length === 0, errors, count: Array.isArray(validation) ? 0 : validation.count };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const prices = JSON.parse(readFileSync(pricesPath, 'utf8'));
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') throw new Error('JSON Schema draft 2020-12 is not declared');
    const result = checkPriceSync(prices);
    if (!result.ok) { console.error('Проверка прайса не пройдена:\n- ' + result.errors.join('\n- ')); process.exitCode = 1; }
    else console.log(`Прайс проверен: ${result.count} позиций, токены синхронизированы.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
