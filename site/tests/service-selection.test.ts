import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { preselectContactService } from '../src/shared/service-selection.ts';

const require = createRequire(import.meta.url);
type LocalWindow = Window & typeof globalThis & { close(): void };
type LocalJSDOM = { window: LocalWindow };
const JSDOM = (require('jsdom') as {
  JSDOM: new (html: string, options: { url: string }) => LocalJSDOM;
}).JSDOM;

const SITE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const servicesSource = readFileSync(join(SITE_ROOT, 'src/pages/services.astro'), 'utf8');
const contactSource = readFileSync(join(SITE_ROOT, 'src/pages/contact.astro'), 'utf8');
const siteClient = readFileSync(join(SITE_ROOT, 'src/client/site.ts'), 'utf8');
const SUBSCRIPTION_SERVICES = [
  'subscription_start',
  'subscription_business',
  'subscription_max',
] as const;

/** Read the JSON-escaped body string embedded by a static Astro page. */
function astroBody(source: string, marker: string): string {
  const markerStart = source.indexOf(marker);
  assert.notEqual(markerStart, -1, `Astro page should contain ${marker}`);
  const start = markerStart + marker.length;
  assert.equal(source[start], '"', 'Astro body should be a JSON string literal');

  let end = start + 1;
  for (; end < source.length; end += 1) {
    if (source[end] !== '"') continue;
    let backslashes = 0;
    for (let cursor = end - 1; cursor >= start && source[cursor] === '\\'; cursor -= 1) {
      backslashes += 1;
    }
    if (backslashes % 2 === 0) break;
  }

  assert.ok(end < source.length, 'Astro body string should be closed');
  return JSON.parse(source.slice(start, end + 1)) as string;
}

const servicesHtml = astroBody(servicesSource, 'const content = renderPriceToken(');
const contactMarkup = astroBody(contactSource, 'const content = ');
const contactServiceValues = [...contactMarkup.matchAll(/<option value="([^"]*)"/g)]
  .map((match) => match[1])
  .filter((value): value is string => typeof value === 'string');
const builtServicesPath = join(SITE_ROOT, 'pages-dist/services.html');
const builtContactPath = join(SITE_ROOT, 'pages-dist/contact.html');
const hasBuiltPages = existsSync(builtServicesPath) && existsSync(builtContactPath);

function makeSelect(values: readonly string[] = contactServiceValues) {
  return { options: values.map((value) => ({ value })), value: '' };
}

test('tariff links carry a service value offered by the contact form', () => {
  for (const service of SUBSCRIPTION_SERVICES) {
    assert.ok(
      servicesHtml.includes(`href="/contact.html?service=${service}"`),
      `services tariff CTA should preserve ${service} in the contact URL`,
    );
    assert.ok(
      contactServiceValues.includes(service),
      `contact.astro should offer ${service} as a selectable value`,
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

test('built tariff click → contact preselection → intercepted request preserves each service', { skip: !hasBuiltPages }, async () => {
  const builtServicesHtml = readFileSync(builtServicesPath, 'utf8');
  const builtContactHtml = readFileSync(builtContactPath, 'utf8');
  const originalEndpoint = process.env.PUBLIC_LEADS_ENDPOINT;
  const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];

  /* A dummy endpoint plus a fetch stub guarantees no request can reach the real Worker. */
  process.env.PUBLIC_LEADS_ENDPOINT = 'https://lead.test.invalid';
  Reflect.deleteProperty(globalThis, 'document');
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      });
      return {
        status: 201,
        headers: new Headers(),
        json: async () => ({ ticket: 'LOCAL-TEST' }),
      } as Response;
    },
  });

  try {
    /* Import with no global document, then explicitly wire each isolated local DOM. */
    const { wireLeadForms } = await import('../src/client/leads-form.ts');

    for (const service of SUBSCRIPTION_SERVICES) {
      const listing = new JSDOM(builtServicesHtml, { url: 'https://kadry-pro.test/services.html' });
      const link = listing.window.document.querySelector<HTMLAnchorElement>(
        `a[href="/contact.html?service=${service}"]`,
      );
      assert.ok(link, `built page should have the ${service} tariff CTA`);

      let clickedHref = '';
      link.addEventListener('click', (event: Event) => {
        event.preventDefault();
        clickedHref = link.href;
      });
      link.click();
      assert.ok(clickedHref, `click should navigate to the ${service} contact URL`);

      const contact = new JSDOM(builtContactHtml, { url: clickedHref });
      const requestedService = new URL(contact.window.location.href).searchParams.get('service');
      const select = contact.window.document.querySelector<HTMLSelectElement>('select[name="service"]');
      const form = contact.window.document.querySelector<HTMLFormElement>('form[data-lead-form]');
      assert.ok(select, 'built contact page should contain the service selector');
      assert.ok(form, 'built contact page should contain a lead form');
      assert.equal(preselectContactService(select, requestedService), true);
      assert.equal(select.value, service, 'the selected tariff should be visible in the contact form');

      const name = form.querySelector<HTMLInputElement>('[name="name"]');
      const phone = form.querySelector<HTMLInputElement>('[name="phone"]');
      const consent = form.querySelector<HTMLInputElement>('[name="consent"]');
      assert.ok(name && phone && consent);
      name.value = 'Локальный тест';
      phone.value = '+7 (961) 302-21-12';
      consent.checked = true;

      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        writable: true,
        value: contact.window.document,
      });
      wireLeadForms();
      const before = requests.length;
      form.dispatchEvent(new contact.window.Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      assert.equal(requests.length, before + 1, 'the submit handler should issue one intercepted request');
      assert.equal(requests[before].url, 'https://lead.test.invalid/leads');
      assert.equal(requests[before].body.service, service, 'the captured request should contain the selected tier');
      assert.equal(requests[before].body.kind, 'consult', 'the existing contact-form contract is unchanged');
      contact.window.close();
      listing.window.close();
    }

    const quickPage = new JSDOM(builtServicesHtml, { url: 'https://kadry-pro.test/services.html' });
    const quickForm = quickPage.window.document.querySelector<HTMLFormElement>('#lead-services');
    assert.ok(quickForm, 'built services page should contain its quick lead form');
    assert.equal(quickForm.querySelector('[name="service"]'), null, 'generic quick lead must not carry a default service');
    assert.notEqual(quickForm.dataset.service, 'subscription');

    const quickName = quickForm.querySelector<HTMLInputElement>('[name="name"]');
    const quickPhone = quickForm.querySelector<HTMLInputElement>('[name="phone"]');
    const quickConsent = quickForm.querySelector<HTMLInputElement>('[name="consent"]');
    assert.ok(quickName && quickPhone && quickConsent);
    quickName.value = 'Локальный тест';
    quickPhone.value = '+7 (961) 302-21-12';
    quickConsent.checked = true;

    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      writable: true,
      value: quickPage.window.document,
    });
    wireLeadForms();
    const beforeQuickLead = requests.length;
    quickForm.dispatchEvent(new quickPage.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(requests.length, beforeQuickLead + 1, 'quick lead submit should also be intercepted locally');
    assert.equal(requests[beforeQuickLead].url, 'https://lead.test.invalid/leads');
    assert.equal(requests[beforeQuickLead].body.service, undefined, 'quick lead must omit service instead of sending subscription');
    assert.notEqual(requests[beforeQuickLead].body.service, 'subscription');
    quickPage.window.close();
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
    if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch);
    else Reflect.deleteProperty(globalThis, 'fetch');
    if (originalEndpoint === undefined) delete process.env.PUBLIC_LEADS_ENDPOINT;
    else process.env.PUBLIC_LEADS_ENDPOINT = originalEndpoint;
  }
});
