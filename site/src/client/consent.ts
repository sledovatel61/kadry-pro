import { ANALYTICS, CONSENT_VERSION } from '../shared/settings';

const STORAGE_KEY = 'kadry-pro-consent';
type ConsentRecord = { version: string; analytics: boolean; decidedAt: string };

function readRecord(): ConsentRecord | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as ConsentRecord;
    return value?.version === CONSENT_VERSION && typeof value.analytics === 'boolean' ? value : null;
  } catch { return null; }
}

function saveRecord(analytics: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: CONSENT_VERSION, analytics, decidedAt: new Date().toISOString() }));
  } catch { /* При запрете хранилища согласие не запоминаем и не включаем аналитику на следующих страницах. */ }
}

let analyticsStarted = false;
let analyticsAllowed = false;

/** Единственное место, где создаются сетевые запросы к счётчикам. */
function startAnalytics(): void {
  if (!analyticsAllowed) return;
  const ymId = ANALYTICS.yandexMetrikaId;
  if (analyticsStarted) {
    const win = window as typeof window & { ym?: (...args: unknown[]) => void; [key: string]: unknown };
    win[`ga-disable-${ANALYTICS.ga4MeasurementId}`] = false;
    win.ym?.(ymId, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: false });
    return;
  }
  analyticsStarted = true;

  type MetrikaFunction = ((...args: unknown[]) => void) & { a?: unknown[][]; l?: number };
  const ym = window as typeof window & { ym?: MetrikaFunction; dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void; [key: string]: unknown };
  if (!ym.ym) {
    const queue: MetrikaFunction = Object.assign((...args: unknown[]) => { queue.a!.push(args); }, { a: [] as unknown[][], l: Date.now() });
    ym.ym = queue;
  }
  ym.ym.l = Date.now();
  const metrika = document.createElement('script');
  metrika.async = true;
  metrika.src = `https://mc.yandex.ru/metrika/tag.js?id=${encodeURIComponent(ymId)}`;
  document.head.append(metrika);
  ym.ym(ymId, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: false });

  ym.dataLayer = ym.dataLayer || [];
  ym.gtag = function (...args: unknown[]) { ym.dataLayer!.push(args); };
  ym.gtag('js', new Date());
  ym.gtag('config', ANALYTICS.ga4MeasurementId, { anonymize_ip: true });
  const ga = document.createElement('script');
  ga.async = true;
  ga.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ANALYTICS.ga4MeasurementId)}`;
  document.head.append(ga);
}

function stopAnalytics(): void {
  analyticsAllowed = false;
  if (!analyticsStarted) return;
  const win = window as typeof window & { ym?: (...args: unknown[]) => void; [key: string]: unknown };
  win[`ga-disable-${ANALYTICS.ga4MeasurementId}`] = true;
  win.ym?.(ANALYTICS.yandexMetrikaId, 'destruct');
}

function setChoice(allow: boolean): void {
  analyticsAllowed = allow;
  saveRecord(allow);
  const banner = document.querySelector<HTMLElement>('[data-cookie-consent]');
  if (banner) banner.hidden = true;
  const manage = document.querySelector<HTMLElement>('[data-consent-manage]');
  if (manage) manage.hidden = false;
  if (allow) startAnalytics();
  else stopAnalytics();
}

export function initConsent(): void {
  const record = readRecord();
  analyticsAllowed = record?.analytics === true;
  if (analyticsAllowed) startAnalytics();

  const banner = document.querySelector<HTMLElement>('[data-cookie-consent]');
  if (banner && !record) banner.hidden = false;
  if (record && banner) banner.hidden = true;
  const manage = document.querySelector<HTMLElement>('[data-consent-manage]');
  if (manage && record) manage.hidden = false;

  document.querySelectorAll<HTMLElement>('[data-consent-accept]').forEach((button) => button.addEventListener('click', () => setChoice(true)));
  document.querySelectorAll<HTMLElement>('[data-consent-reject]').forEach((button) => button.addEventListener('click', () => setChoice(false)));
  document.querySelectorAll<HTMLElement>('[data-consent-reopen]').forEach((button) => button.addEventListener('click', () => {
    if (banner) { banner.hidden = false; banner.querySelector<HTMLElement>('[data-consent-accept]')?.focus(); }
  }));
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initConsent, { once: true });
  else initConsent();
}
