import priceList from '../../content/prices.json';

export interface PriceItem {
  id: string;
  name: string;
  price: number | null;
  unit?: string;
  note?: string;
}
export interface PriceGroup { id: string; title: string; items: PriceItem[] }
export interface PriceList { schema_version: number; currency: string; updated_at: string; groups: PriceGroup[] }

const prices = priceList as PriceList;
const byId = new Map<string, { item: PriceItem; group: PriceGroup }>();
for (const group of prices.groups) {
  for (const item of group.items) byId.set(`${group.id}.${item.id}`.toLowerCase(), { item, group });
}

/** Серверная подстановка: {{price:audit.express}} или {{price:consult.hour}}. */
export function getPrice(id: string): number | null {
  return byId.get(String(id ?? '').trim().toLowerCase())?.item.price ?? null;
}

export function getPriceItem(id: string): (PriceItem & { group: string }) | undefined {
  const found = byId.get(String(id ?? '').trim().toLowerCase());
  return found ? { ...found.item, group: found.group.title } : undefined;
}

export function formatPrice(value: number | null, currency = '₽'): string {
  if (value === null || !Number.isFinite(value)) return 'по запросу';
  return `${Math.round(value).toLocaleString('ru-RU')} ${currency}`;
}

export function renderPriceToken(text: string): string {
  return text.replace(/\{\{price:([a-z0-9_.-]+)\}\}/gi, (_match, id: string) => {
    const value = getPrice(id);
    return value === null ? 'по запросу' : formatPrice(value);
  });
}

export function listPrices(): PriceList { return prices; }
