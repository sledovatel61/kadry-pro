export const settings = {
  owner: { name: 'Мария Перепечай', telegram: '@Mariya061', phone: '+7 961 302-21-12', email: 'm.perepechay@yandex.ru', inn: '613400944153', taxStatus: 'Самозанятая (НПД)' },
  analytics: { yandexMetrikaId: '108237323', ga4Id: 'G-76SCLJTYNF' },
  consent: { policyVersion: '2026-11-23', cookieName: 'kadry_pro_consent', maxAgeSeconds: 15552000 },
} as const;

export type SiteSettings = typeof settings;
