#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
export function checkTemplateCatalog(catalog, publicRoot = resolve(root, 'public')) {
  const errors = [];
  if (catalog?.schema_version !== 1 || !Array.isArray(catalog.items) || catalog.items.length !== 64) errors.push('каталог должен содержать 64 позиции схемы v1');
  const free = (catalog?.items ?? []).filter((item) => item.free);
  const paid = (catalog?.items ?? []).filter((item) => !item.free);
  if (free.length !== 20 || paid.length !== 44) errors.push(`ожидаются 20 бесплатных и 44 платных, сейчас ${free.length}/${paid.length}`);
  if (new Set((catalog?.items ?? []).map((item) => item.id)).size !== 64) errors.push('id шаблонов должны быть уникальны');
  if (catalog?.bundle?.file !== '/shablony/free-bundle-20.zip') errors.push('неверный адрес бесплатного архива');
  for (const item of catalog?.items ?? []) {
    if (item.free) {
      if (item.price !== 0 || !item.file?.startsWith('/shablony/free/') || item.preview !== null) errors.push(`${item.id}: у бесплатной карточки должны быть только бесплатный PDF и без превью`);
      else if (!existsSync(join(publicRoot, item.file.replace(/^\//, '')))) errors.push(`${item.id}: бесплатный файл не найден`);
    } else {
      if (item.price !== 500 || item.file !== null || !item.preview?.startsWith('/shablony/previews/')) errors.push(`${item.id}: платная позиция не должна иметь ссылку на полный файл`);
      else if (!existsSync(join(publicRoot, item.preview.replace(/^\//, '')))) errors.push(`${item.id}: водяное превью не найдено`);
    }
  }
  const assetRoot = join(publicRoot, 'shablony');
  const pdfs = [];
  if (existsSync(assetRoot)) {
    const walk = (dir) => readdirSync(dir, { withFileTypes: true }).forEach((entry) => entry.isDirectory() ? walk(join(dir, entry.name)) : entry.name.toLowerCase().endsWith('.pdf') && pdfs.push(join(dir, entry.name)));
    walk(assetRoot);
  }
  if (pdfs.length !== 20) errors.push(`в публичной папке должно быть ровно 20 PDF, найдено ${pdfs.length}`);
  if (pdfs.some((file) => !file.startsWith(join(assetRoot, 'free') + '/'))) errors.push('PDF должен лежать только в каталоге free');
  const zip = join(assetRoot, 'free-bundle-20.zip');
  if (!existsSync(zip)) errors.push('нет архива free-bundle-20.zip');
  else {
    try {
      const members = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
      if (members.length !== 20 || members.some((name) => !name.toLowerCase().endsWith('.pdf'))) errors.push('архив должен содержать только 20 бесплатных PDF');
    } catch { errors.push('не удалось проверить содержимое ZIP'); }
  }
  const previewDir = join(assetRoot, 'previews');
  const previews = existsSync(previewDir) ? readdirSync(previewDir).filter((name) => /\.jpe?g$/i.test(name)) : [];
  if (previews.length !== 44) errors.push(`ожидается 44 водяных превью, найдено ${previews.length}`);
  const page = resolve(root, 'src/pages/shablony.astro');
  if (existsSync(page)) {
    const source = readFileSync(page, 'utf8');
    const forbiddenPaymentText = new RegExp(['YOUR_', '(?:YOOMONEY_WALLET|TINKOFF_LINK)', '|email-bundle', '\\.zip'].join(''), 'i');
    if (forbiddenPaymentText.test(source)) errors.push('обнаружена незаполненная платёжная заглушка или запрещённый архив');
  }
  return { ok: errors.length === 0, errors, free: free.length, paid: paid.length, pdfs: pdfs.length, previews: previews.length };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const catalog = JSON.parse(readFileSync(resolve(root, 'content/templates.json'), 'utf8'));
    const schema = JSON.parse(readFileSync(resolve(root, 'content/templates.schema.json'), 'utf8'));
    if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') throw new Error('JSON Schema draft 2020-12 is not declared');
    const result = checkTemplateCatalog(catalog);
    if (!result.ok) { console.error('Каталог шаблонов не прошёл проверку:\n- ' + result.errors.join('\n- ')); process.exitCode = 1; }
    else console.log(`Шаблоны проверены: ${result.free} бесплатных PDF, ${result.paid} платных превью, в ZIP — бесплатные документы.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
