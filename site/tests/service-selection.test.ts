import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preselectContactService } from '../src/shared/service-selection.ts';

const SITE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const servicesSource = readFileSync(join(SITE_ROOT, 'src/pages/services.astro'), 'utf8');
const contactMarkup = readFileSync(join(SITE_ROOT, 'src/pages/_content/contact.html'), 'utf8');
const siteClient = readFileSync(join(SITE_ROOT, 'src/client/site.ts'), 'utf8');
const SUBSCRIPTION_SERVICES = [
  'subscription_start',
  'subscription_business',
  'subscription_max',
] as const;

/** services.astro keeps the page body as a JSON-escaped string for Astro. */
function servicesMarkup(source: string): string {
  const marker = 'const content = renderPriceToken(';
  const callStart = source.indexOf(marker);
  assert.notEqual(callStart, -1, 'services page should contain its rendered content');
  const start = callStart + marker.length;
  assert.equal(source[start], '"', 'services content should be a JSON string literal');

  let end = start + 1;
  for (; end < source.length; end += 1) {
    if (source[end] !== '"') continue;
    let backslashes = 0;
    for (let cursor = end - 1; cursor >= start && source[cursor] === '\\'; cursor -= 1) {
      backslashes += 1;
    }
    if (backslashes % 2 === 0) break;
  }

  assert.ok(end < source.length, 'services content string should be closed');
  return JSON.parse(source.slice(start, end + 1)) as string;
}

const servicesHtml = servicesMarkup(servicesSource);
const contactServiceValues = [...contactMarkup.matchAll(/<option value="([^"]*)"/g)]
  .map((match) => match[1])
  .filter((value): value is string => typeof value === 'string');

function makeSelect(values: readonly string[] = contactServiceValues) {
  return { options: values.map((value) => ({ value })), value: '' };
}

test('tariff links carry a service value already offered by the contact form', () => {
  for (const service of SUBSCRIPTION_SERVICES) {
    assert.ok(
      servicesHtml.includes(`href="/contact.html?service=${service}"`),
      `services tariff CTA should preserve ${service} in the contact URL`,
    );
    assert.ok(
      contactServiceValues.includes(service),
      `contact form should offer ${service} as a selectable value`,
    );
  }
});

test('contact form preselection accepts only an exact existing option', () => {
  for (const service of SUBSCRIPTION_SERVICES) {
    const select = makeSelect();
    assert.equal(preselectContactService(select, service), true);
    assert.equal(select.value, service);
  }

  const empty = makeSelect();
  assert.equal(preselectContactService(empty, null), false);
  assert.equal(preselectContactService(empty, 'subscription'), false, 'legacy generic value must not be misclassified as a tier');
  assert.equal(preselectContactService(empty, 'not-a-service'), false);
  assert.equal(empty.value, '', 'unknown query values leave the selector blank');
});

test('site startup wires the service query into the contact selector', () => {
  assert.match(siteClient, /urlParams\.get\('service'\)/);
  assert.match(siteClient, /preselectContactService\(serviceSelect, serviceParam\)/);
});

test('services quick lead no longer labels every request as generic subscription', () => {
  assert.doesNotMatch(
    servicesSource,
    /<QuickLeadForm page="services" service="subscription"/,
    'the unqualified quick lead must not report every request as subscription',
  );
});
