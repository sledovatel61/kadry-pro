#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const siteRoot = resolve(here, '..');
const srcRoot = resolve(siteRoot, 'src');
const forbidden = [
  /<script\b[^>]*\bsrc\s*=\s*["'][^"']*(?:mc\.yandex\.ru|metrika\/tag\.js|googletagmanager\.com|google-analytics\.com)/i,
  /<link\b[^>]*\bhref\s*=\s*["'][^"']*(?:mc\.yandex\.ru|googletagmanager\.com|google-analytics\.com)/i,
  /(?:preconnect|dns-prefetch)[^>]*(?:yandex|google)/i,
];
function files(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(join(dir, e.name)) : /\.(astro|ts|js)$/.test(e.name) ? [join(dir, e.name)] : []);
}
export function checkAnalyticsSource(root = srcRoot) {
  const errors = [];
  for (const file of files(root)) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of forbidden) if (pattern.test(source)) errors.push(`${relative(root, file)}: сторонняя аналитика загружается без сценария согласия`);
  }
  const consent = readFileSync(resolve(root, 'client/consent.ts'), 'utf8');
  const layoutPath = resolve(root, 'layouts/Base.astro');
  const layout = existsSync(layoutPath) ? readFileSync(layoutPath, 'utf8') : '';
  if (existsSync(layoutPath) && (!/CookieConsent\.astro/.test(layout) || !/ConsentBanner/.test(layout))) errors.push('CookieConsent не подключён к общему Base');
  if (!/function\s+startAnalytics/.test(consent) || !/if\s*\(!analyticsAllowed\)\s*return/.test(consent) || !/if\s*\(analyticsStarted\)/.test(consent)) errors.push('нет закрытого загрузчика аналитики');
  if (!/if\s*\(allow\)\s*startAnalytics\(\)/.test(consent)) errors.push('счётчики должны стартовать только по явному принятию');
  if (!/CONSENT_VERSION/.test(consent) || !/kadry-pro-consent/.test(consent)) errors.push('нет версионированного хранения выбора');
  return { ok: errors.length === 0, errors };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkAnalyticsSource();
  if (!result.ok) { console.error('Проверка аналитики не пройдена:\n- ' + result.errors.join('\n- ')); process.exitCode = 1; }
  else console.log('Аналитика закрыта до согласия; политика подключена без сторонних запросов.');
}
