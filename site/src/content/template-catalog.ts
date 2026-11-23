export type TemplateItem = { id: string; title: string; priceToken: string; preview: string; paid: boolean };

// Only preview images are linked publicly; source PDFs are never exposed by this catalogue.
export const templateCatalog: TemplateItem[] = [
  { id: 'employment-contract', title: 'Трудовой договор', priceToken: 'template.single', preview: '/previews/employment-contract-page-1-watermarked.webp', paid: true },
  { id: 'personnel-order', title: 'Приказ о приёме на работу', priceToken: 'template.single', preview: '/previews/personnel-order-page-1-watermarked.webp', paid: true },
];

export function getTemplateDownload(item: TemplateItem): null {
  // Paid files must be delivered only by a verified payment/download service, never static hosting.
  return item.paid ? null : null;
}
