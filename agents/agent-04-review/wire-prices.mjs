/**
 * wire-prices.mjs — стыковка Агента 04: подключает цены на страницах
 * к единому справочнику site/content/prices.json через токены
 * {{price:ID}} (рендерит site/src/shared/prices.ts → renderPriceToken).
 *
 * Как это работает:
 *  - строка контента страницы оборачивается в renderPriceToken(...);
 *  - все ключевые цифры (тарифы, пакеты, услуги) заменяются на токены;
 *  - правка цены в /manage/ («Прайс» → prices.json → пересборка)
 *    меняет цифры на ВСЕХ страницах сразу.
 *
 * Одноразовый инструмент (после прогона в исходниках уже стоят токены).
 * Запуск: node agents/agent-04-review/wire-prices.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PAGES = path.join(ROOT, 'site/src/pages');

let problems = 0;

function patch(file, ops) {
  const p = path.join(PAGES, file);
  let text = fs.readFileSync(p, 'utf8');
  const original = text;

  // 1) Импорт рендера токенов цен
  const importAnchor = "import Base from '../layouts/Base.astro';";
  if (!text.includes("from '../shared/prices.ts'")) {
    if (!text.includes(importAnchor)) throw new Error(`${file}: нет импорта Base`);
    text = text.replace(
      importAnchor,
      importAnchor + "\nimport { renderPriceToken, formatPrice, getPrice } from '../shared/prices.ts';",
    );
  }

  // 2) Оборачиваем строку контента в renderPriceToken(...)
  if (!text.includes('const content = renderPriceToken(')) {
    const startNeedle = 'const content = "';
    const endNeedle = '";\n---';
    const si = text.indexOf(startNeedle);
    const ei = text.indexOf(endNeedle, si);
    if (si < 0 || ei < 0) throw new Error(`${file}: не нашёл границы строки content`);
    text =
      text.slice(0, si) +
      'const content = renderPriceToken("' +
      text.slice(si + startNeedle.length, ei) +
      '");\n---' +
      text.slice(ei + endNeedle.length);
  }

  // 3) Последовательная замена карточек [«название» → ID] по порядку появления
  if (ops.cards) {
    let i = 0;
    text = text.replace(/(service-card-price\\">)[0-9][0-9 ]* ₽/g, (whole, prefix) => {
      const id = ops.cards[i++];
      if (!id) throw new Error(`${file}: карточек больше, чем токенов`);
      return `${prefix}{{price:${id}}}`;
    });
    if (i !== ops.cards.length) {
      console.error(`✗ ${file}: заменено карточек ${i}, ожидалось ${ops.cards.length}`);
      problems++;
    }
  }

  // 4) Точечные замены по уникальному контексту
  for (const [from, to, count = 1] of ops.pairs ?? []) {
    const n = text.split(from).length - 1;
    if (n !== count) {
      console.error(`✗ ${file}: «${from.slice(0, 60)}…» найдено ${n}, ожидалось ${count}`);
      problems++;
      continue;
    }
    text = text.split(from).join(to);
  }

  if (text !== original) {
    fs.writeFileSync(p, text);
    console.log(`✓ ${file}: обновлён`);
  } else {
    console.log(`= ${file}: без изменений`);
  }
}

const PRICE_RANGE = (id) =>
  `"priceRange":"от " + formatPrice(getPrice('${id}')) + ""`;

patch('index.astro', {
  cards: null,
  pairs: [
    ['14&nbsp;000&nbsp;₽/мес', '{{price:retainer.start}}/мес'],
    ['id=\\"staff-price\\">14 000 ₽/мес', 'id=\\"staff-price\\">{{price:retainer.start}}/мес'],
    ['service-card-price\\">от 14 000 ₽/мес', 'service-card-price\\">от {{price:retainer.start}}/мес'],
    ['service-card-price\\">от 9 900 ₽', 'service-card-price\\">от {{price:sout.up-to-10}}'],
    ['service-card-price\\">от 30 000 ₽', 'service-card-price\\">от {{price:services.recruitment}}'],
    ['service-card-price\\">от 7 900 ₽', 'service-card-price\\">от {{price:audit.express}}'],
    ['service-card-price\\">3 000 ₽/час', 'service-card-price\\">{{price:consult.hour}}/час'],
    ['условий труда от 9 900 ₽', 'условий труда от {{price:sout.up-to-10}}'],
    ['"priceRange":"от 14 000 ₽/мес"', '"priceRange":"от " + formatPrice(getPrice(\'retainer.start\')) + "/мес"'],
    ['бизнеса от 14 000 ₽/мес вместо', 'бизнеса от " + formatPrice(getPrice(\'retainer.start\')) + "/мес вместо'],
  ],
});

patch('services.astro', {
  cards: [
    'lna.pvtr', 'lna.pay', 'lna.bonus', 'lna.attestation', 'lna.personal-data',
    'lna.hr-regulation', 'lna.business-trips', 'lna.nda', 'lna.job-description',
    'lna.ohs-instruction', 'lna.adaptation', 'lna.anti-corruption',
  ],
  pairs: [
    ['pricing-price\\">14 000 ₽ <span', 'pricing-price\\">{{price:retainer.start}} <span'],
    ['pricing-price\\">24 000 ₽ <span', 'pricing-price\\">{{price:retainer.business}} <span'],
    ['pricing-price\\">36 000 ₽ <span', 'pricing-price\\">{{price:retainer.max}} <span'],
    ['Приём на работу</td><td class=\\"price-cell\\">1 800 ₽', 'Приём на работу</td><td class=\\"price-cell\\">{{price:services.hire}}'],
    ['Увольнение</td><td class=\\"price-cell\\">1 200 ₽', 'Увольнение</td><td class=\\"price-cell\\">{{price:services.dismissal}}'],
    ['Перевод</td><td class=\\"price-cell\\">1 200 ₽', 'Перевод</td><td class=\\"price-cell\\">{{price:services.transfer}}'],
    ['Приём иностранца + уведомление МВД</td><td class=\\"price-cell\\">5 000 ₽', 'Приём иностранца + уведомление МВД</td><td class=\\"price-cell\\">{{price:services.foreign-worker}}'],
    ['Ежегодный оплачиваемый отпуск</td><td class=\\"price-cell\\">600 ₽/чел', 'Ежегодный оплачиваемый отпуск</td><td class=\\"price-cell\\">{{price:services.vacation}}/чел'],
    ['Отпуск без сохранения з/п</td><td class=\\"price-cell\\">500 ₽/чел', 'Отпуск без сохранения з/п</td><td class=\\"price-cell\\">{{price:services.unpaid-leave}}/чел'],
    ['Декретный отпуск</td><td class=\\"price-cell\\">2 000 ₽', 'Декретный отпуск</td><td class=\\"price-cell\\">{{price:services.maternity}}'],
    ['Дополнительное соглашение</td><td class=\\"price-cell\\">1 000 ₽', 'Дополнительное соглашение</td><td class=\\"price-cell\\">{{price:services.amendment}}'],
    ['Трудовой договор</td><td class=\\"price-cell\\">2 000 ₽', 'Трудовой договор</td><td class=\\"price-cell\\">{{price:services.employment-contract}}'],
    ['Штатное расписание (Т-3)</td><td class=\\"price-cell\\">2 000 ₽', 'Штатное расписание (Т-3)</td><td class=\\"price-cell\\">{{price:services.staffing-table}}'],
    ['График отпусков</td><td class=\\"price-cell\\">2 500 ₽', 'График отпусков</td><td class=\\"price-cell\\">{{price:services.vacation-schedule}}'],
    ['Табель учёта рабочего времени (до 30 чел)</td><td class=\\"price-cell\\">3 500 ₽/мес', 'Табель учёта рабочего времени (до 30 чел)</td><td class=\\"price-cell\\">{{price:services.timesheet}}/мес'],
    ['Журналы по охране труда (комплект)</td><td class=\\"price-cell\\">3 000 ₽', 'Журналы по охране труда (комплект)</td><td class=\\"price-cell\\">{{price:services.ohs-logs}}'],
    ['Аудит кадрового учёта</td><td class=\\"price-cell\\">от 7 900 ₽', 'Аудит кадрового учёта</td><td class=\\"price-cell\\">от {{price:audit.express}}'],
    ['Подготовка к проверке ГИТ</td><td class=\\"price-cell\\">15 000 ₽', 'Подготовка к проверке ГИТ</td><td class=\\"price-cell\\">{{price:audit.git_prep}}'],
    ['Подготовка к проверке военкомата</td><td class=\\"price-cell\\">12 000 ₽', 'Подготовка к проверке военкомата</td><td class=\\"price-cell\\">{{price:audit.military_prep}}'],
    ['Подбор персонала (закрытие вакансии)</td><td class=\\"price-cell\\">30 000 ₽', 'Подбор персонала (закрытие вакансии)</td><td class=\\"price-cell\\">{{price:services.recruitment}}'],
    ['Консультация (1 час)</td><td class=\\"price-cell\\">3 000 ₽', 'Консультация (1 час)</td><td class=\\"price-cell\\">{{price:consult.hour}}'],
    ['Выезд к клиенту (разово)</td><td class=\\"price-cell\\">2 000 ₽', 'Выезд к клиенту (разово)</td><td class=\\"price-cell\\">{{price:services.visit}}'],
    ['До 10 рабочих мест</td><td class=\\"price-cell\\">9 900 ₽', 'До 10 рабочих мест</td><td class=\\"price-cell\\">{{price:sout.up-to-10}}'],
    ['11–30 рабочих мест</td><td class=\\"price-cell\\">18 000 ₽', '11–30 рабочих мест</td><td class=\\"price-cell\\">{{price:sout.from-11-to-30}}'],
    ['templates-cross-value\\">500 ₽', 'templates-cross-value\\">{{price:templates.single}}'],
    ['templates-cross-value\\">3 500 ₽', 'templates-cross-value\\">{{price:templates.bundle-64}}'],
    ['package-price\\">23 000 ₽', 'package-price\\">{{price:lna.bundle-min}}'],
    ['package-price\\">39 000 ₽', 'package-price\\">{{price:lna.bundle-standard}}'],
    ['package-price\\">69 000 ₽', 'package-price\\">{{price:lna.bundle-full}}'],
    ['"priceRange":"от 14 000 ₽/мес"', '"priceRange":"от " + formatPrice(getPrice(\'retainer.start\')) + "/мес"'],
    ['обслуживание от 14 000 ₽/мес, разр', 'обслуживание от " + formatPrice(getPrice(\'retainer.start\')) + "/мес, разр'],
  ],
});

patch('audit.astro', {
  cards: null,
  pairs: [
    ['pricing-price\\">7 900 ₽', 'pricing-price\\">{{price:audit.express}}'],
    ['pricing-price\\">9 900 ₽', 'pricing-price\\">{{price:audit.standard}}'],
    ['pricing-price\\">19 900 ₽', 'pricing-price\\">{{price:audit.full}}'],
    ['margin: 0;\\">9 900 ₽', 'margin: 0;\\">{{price:audit.urgent}}'],
    ['ёта от 7 900 ₽. Проверка', 'ёта от " + formatPrice(getPrice(\'audit.express\')) + ". Проверка'],
  ],
});

patch('lna.astro', {
  cards: [
    'lna.pvtr', 'lna.pay', 'lna.bonus', 'lna.attestation', 'lna.personal-data',
    'lna.hr-regulation', 'lna.business-trips', 'lna.nda',
  ],
  pairs: [
    ['package-price\\">23 000 ₽', 'package-price\\">{{price:lna.bundle-min}}'],
    ['package-price\\">39 000 ₽', 'package-price\\">{{price:lna.bundle-standard}}'],
    ['package-price\\">69 000 ₽', 'package-price\\">{{price:lna.bundle-full}}'],
    ['"priceRange":"от 3 000 ₽"', '"priceRange":"от " + formatPrice(getPrice(\'lna.job-description\')) + ""'],
    ['не шаблоны. От 3 000 ₽.', 'не шаблоны. От " + formatPrice(getPrice(\'lna.job-description\')) + ".'],
  ],
});

patch('sout.astro', {
  cards: null,
  pairs: [
    ['ГИТ. От 9 900 ₽', 'ГИТ. От {{price:sout.up-to-10}}'],
    ['pricing-price\\">9 900 ₽', 'pricing-price\\">{{price:sout.up-to-10}}'],
    ['pricing-price\\">18 000 ₽', 'pricing-price\\">{{price:sout.from-11-to-30}}'],
    ['"priceRange":"от 14 000 ₽/мес"', '"priceRange":"от " + formatPrice(getPrice(\'retainer.start\')) + "/мес"'],
    ['под ключ. От 9 900 ₽: подбор', 'под ключ. От " + formatPrice(getPrice(\'sout.up-to-10\')) + ": подбор'],
  ],
});

patch('voinskiy-uchet.astro', {
  cards: null,
  pairs: [
    ['service-card-price\\">12 000 ₽', 'service-card-price\\">{{price:audit.military_prep}}', 2],
    ['"priceRange":"от 14 000 ₽/мес"', '"priceRange":"от " + formatPrice(getPrice(\'retainer.start\')) + "/мес"'],
  ],
});

patch('podbor.astro', {
  cards: null,
  pairs: [
    ['pricing-price\\">30 000 ₽', 'pricing-price\\">{{price:services.recruitment}}'],
    ['pricing-price\\">от 5 000 <span class=\\"per\\">₽/чел', 'pricing-price\\">от {{price:services.mass-recruitment}}<span class=\\"per\\">/чел'],
    ['pricing-price\\">от 75 000 <span class=\\"per\\">₽/мес', 'pricing-price\\">от {{price:services.recruitment-subscription}}<span class=\\"per\\">/мес'],
    ['service-card-price\\">от 30 000 ₽', 'service-card-price\\">от {{price:services.recruitment}}', 2],
    ['service-card-price\\">от 5 000 ₽/чел', 'service-card-price\\">от {{price:services.mass-recruitment}}/чел'],
    ['service-card-price\\">от 3 500 ₽/чел', 'service-card-price\\">от {{price:services.shift-recruitment}}/чел'],
    ['price-cell\\">30 000 ₽', 'price-cell\\">{{price:services.recruitment}}'],
    ['price-cell\\">5 000 ₽/чел', 'price-cell\\">{{price:services.mass-recruitment}}/чел', 2],
    ['price-cell\\">от 3 500 ₽/чел', 'price-cell\\">от {{price:services.shift-recruitment}}/чел'],
    ['price-cell\\">75 000 ₽/мес', 'price-cell\\">{{price:services.recruitment-subscription}}/мес'],
    ['comparison-good\\">от 30 000 ₽', 'comparison-good\\">от {{price:services.recruitment}}'],
    ['comparison-good\\">от 5 000 ₽/чел, любые', 'comparison-good\\">от {{price:services.mass-recruitment}}/чел, любые'],
    ['кадров от 30 000 ₽', 'кадров от " + formatPrice(getPrice(\'services.recruitment\')) + "'],
    ['Закрытие вакансий от 30 000 ₽', 'Закрытие вакансий от " + formatPrice(getPrice(\'services.recruitment\')) + "'],
  ],
});

if (problems > 0) {
  console.error(`\nЕсть расхождения: ${problems}. Исправьте пары и перезапустите.`);
  process.exit(1);
}
console.log('\nГотово: цены подтягиваются из site/content/prices.json.');
