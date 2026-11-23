import { settings } from '../server/settings';

type Choice = 'all' | 'necessary';
type SavedChoice = { choice: Choice; version: string; savedAt: string };
const { cookieName, maxAgeSeconds, policyVersion } = settings.consent;
const storageKey = `${cookieName}_v1`;

function readChoice(): SavedChoice | null {
  try {
    const item = JSON.parse(localStorage.getItem(storageKey) || 'null') as SavedChoice | null;
    return item?.version === policyVersion && ['all', 'necessary'].includes(item.choice) ? item : null;
  } catch { return null; }
}

function saveChoice(choice: Choice): void {
  const saved: SavedChoice = { choice, version: policyVersion, savedAt: new Date().toISOString() };
  localStorage.setItem(storageKey, JSON.stringify(saved));
  document.cookie = `${cookieName}=${encodeURIComponent(JSON.stringify(saved))}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  if (choice === 'all') loadAnalytics();
}

function loadAnalytics(): void {
  const { yandexMetrikaId, ga4Id } = settings.analytics;
  if (yandexMetrikaId && !document.querySelector('[data-consent-analytics="ym"]')) {
    const script = document.createElement('script');
    script.dataset.consentAnalytics = 'ym';
    script.src = `https://mc.yandex.ru/metrika/tag.js?id=${encodeURIComponent(yandexMetrikaId)}`;
    script.async = true;
    document.head.append(script);
    script.addEventListener('load', () => {
      const ym = (window as Window & { ym?: (...args: unknown[]) => void }).ym;
      ym?.(Number(yandexMetrikaId), 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true });
    });
  }
  if (ga4Id && !document.querySelector('[data-consent-analytics="ga4"]')) {
    const script = document.createElement('script');
    script.dataset.consentAnalytics = 'ga4';
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4Id)}`;
    script.async = true;
    document.head.append(script);
    script.addEventListener('load', () => {
      const w = window as Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
      w.dataLayer = w.dataLayer || [];
      w.gtag = (...args: unknown[]) => w.dataLayer?.push(args);
      w.gtag('js', new Date());
      w.gtag('config', ga4Id);
    });
  }
}

export function initializeConsent(root: HTMLElement): void {
  if (readChoice()) { if (readChoice()?.choice === 'all') loadAnalytics(); return; }
  root.hidden = false;
  root.querySelector<HTMLButtonElement>('[data-consent="all"]')?.addEventListener('click', () => { saveChoice('all'); root.hidden = true; });
  root.querySelector<HTMLButtonElement>('[data-consent="necessary"]')?.addEventListener('click', () => { saveChoice('necessary'); root.hidden = true; });
}
