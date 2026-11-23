import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { checkAnalyticsSource } from '../scripts/check-analytics.mjs';

const source = readFileSync(new URL('../src/client/consent.ts', import.meta.url), 'utf8');
const withoutImports = source.replace(/^import .*;\s*/m, '').split("if (typeof document !== 'undefined')")[0];
const runnable = transformSync(`const ANALYTICS = { yandexMetrikaId: '108237323', ga4MeasurementId: 'G-76SCLJTYNF' };\nconst CONSENT_VERSION = '2026-11-21';\n${withoutImports}`, {
  loader: 'ts', format: 'iife', globalName: 'ConsentModule', target: 'es2022',
}).code + '\nwindow.__ConsentModule = ConsentModule;';
function page() {
  const dom = new JSDOM('<!doctype html><html><head></head><body><aside data-cookie-consent hidden><button data-consent-accept>Принять</button><button data-consent-reject>Не принимать</button></aside><button data-consent-manage hidden data-consent-reopen>Настройки</button></body></html>', { url: 'https://kadry-pro.ru/', runScripts: 'outside-only' });
  dom.window.eval(runnable);
  dom.window.__ConsentModule.initConsent();
  return dom;
}

 test('страницы не подключают аналитику до согласия', () => {
  const result = checkAnalyticsSource();
  assert.equal(result.ok, true, result.errors.join('\n'));
});

test('отказ пользователя даёт ноль запросов к Метрике и GA4', () => {
  const dom = page();
  assert.equal(dom.window.document.querySelector('[data-cookie-consent]').hidden, false, 'баннер должен быть показан');
  dom.window.document.querySelector('[data-consent-reject]').click();
  assert.equal(dom.window.document.querySelectorAll('script[src*="yandex"],script[src*="google"]').length, 0);
  assert.deepEqual(JSON.parse(dom.window.localStorage.getItem('kadry-pro-consent')), {
    version: '2026-11-21', analytics: false, decidedAt: JSON.parse(dom.window.localStorage.getItem('kadry-pro-consent')).decidedAt,
  });
  dom.window.close();
});

test('оба счётчика добавляются только после явного нажатия «Принять»', () => {
  const dom = page();
  assert.equal(dom.window.document.querySelectorAll('script[src*="yandex"],script[src*="google"]').length, 0);
  dom.window.document.querySelector('[data-consent-accept]').click();
  const scripts = [...dom.window.document.querySelectorAll('script[src]')].map((script) => script.src);
  assert.equal(scripts.length, 2);
  assert.ok(scripts.some((src) => src.includes('mc.yandex.ru/metrika/tag.js?id=108237323')));
  assert.ok(scripts.some((src) => src.includes('googletagmanager.com/gtag/js?id=G-76SCLJTYNF')));
  assert.equal(JSON.parse(dom.window.localStorage.getItem('kadry-pro-consent')).analytics, true);
  dom.window.close();
});

test('предыдущее или устаревшее решение не запускает счётчики самовольно', () => {
  const denied = page();
  denied.window.localStorage.setItem('kadry-pro-consent', JSON.stringify({ version: '2026-11-21', analytics: false }));
  denied.window.__ConsentModule.initConsent();
  assert.equal(denied.window.document.querySelectorAll('script[src]').length, 0);
  assert.equal(denied.window.document.querySelector('[data-cookie-consent]').hidden, true);
  denied.window.close();

  const stale = page();
  stale.window.localStorage.setItem('kadry-pro-consent', JSON.stringify({ version: '2026-01-01', analytics: true }));
  stale.window.__ConsentModule.initConsent();
  assert.equal(stale.window.document.querySelectorAll('script[src]').length, 0);
  assert.equal(stale.window.document.querySelector('[data-cookie-consent]').hidden, false);
  stale.window.close();
});
