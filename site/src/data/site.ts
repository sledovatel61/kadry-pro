/**
 * Единый конфиг фактов сайта (владелец, контакты, реквизиты).
 *
 * Данные владельца утверждены документом ревизии 21.11.2026 (раздел 4).
 * Никаких «своих» телефонов и мессенджеров в страницах быть не должно:
 * старый чужой адрес t.me/perepechay ЗАПРЕЩЁН, единственный Telegram — @Mariya061.
 * Агент 02 положит этот же список в site/src/shared/settings.ts — здесь он
 * нужен раньше, чтобы шапка и подвал собирались без зависимости от его ветки.
 */
export const OWNER = {
  name: 'Мария Перепечай',
  fullName: 'Перепечай Мария Павловна',
  role: 'кадровый специалист · директор по персоналу',
  city: 'Ростов-на-Дону',
  inn: '613400944153',
  status: 'самозанятый (плательщик налога на профессиональный доход, НПД)',
  phone: '+7 (961) 302-21-12',
  phoneHref: 'tel:+79613022112',
  email: 'm.perepechay@yandex.ru',
  telegramHandle: '@Mariya061',
  telegram: 'https://t.me/Mariya061',
  whatsapp: 'https://wa.me/79613022112',
  max: 'https://max.ru/u/f9LHodD0cOLiuQ9EgyjlbHIJwJl6MM59mjwQFfIGh0UQE-CLoaQb-A60M0U',
} as const;

import { getPrice, formatPrice } from '../shared/prices.ts';

export const SITE = {
  name: 'Кадры-Про',
  origin: 'https://kadry-pro.ru',
  // Цена — из единого prices.json (правка в /manage/ меняет шапку и футер)
  priceFrom: 'от ' + formatPrice(getPrice('retainer.start')) + '/мес',
  experience: '14 лет опыта',
  zeroFines: '0 штрафов',
} as const;

/** Пункты меню: одинаковые на десктопе и в мобильном меню (раньше расходились). */
export const NAV = [
  { href: '/', key: 'home', label: 'Главная' },
  { href: '/services.html', key: 'services', label: 'Услуги и цены' },
  { href: '/podbor.html', key: 'podbor', label: 'Подбор кадров' },
  { href: '/about.html', key: 'about', label: 'Обо мне' },
  { href: '/trudovoy-spor.html', key: 'trudovoy-spor', label: 'Трудовые споры' },
  { href: '/cases.html', key: 'cases', label: 'Кейсы' },
  { href: '/shablony.html', key: 'shablony', label: 'Шаблоны' },
  { href: '/contact.html', key: 'contact', label: 'Контакты' },
] as const;
