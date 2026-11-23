/**
 * Тесты кабинета `/manage/` (Агент 03).
 *
 * Кабинет — единственное место, где Мария меняет цены и тексты сайта, поэтому
 * здесь важны не «красивые» тесты, а защита от дорогих ошибок:
 *   • правка одной цены не должна переписывать остальной прайс;
 *   • новый кейс или статья не должны затирать соседние записи;
 *   • сохранение при гонке не должно молча перетирать чужую правку;
 *   • «Токен истёк» должно звучать по-русски, а не «HTTP 401».
 *
 * Сеть подменена: `GithubStore` принимает фейковый transport, наружу ничего не идёт.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  ManageError,
  GithubStore,
  applyPriceEdits,
  articleWarnings,
  buildArticle,
  buildCase,
  buildReply,
  clampRating,
  fromBase64,
  githubErrorText,
  moderationRequest,
  moveCase,
  moscowStamp,
  parsePrice,
  priceGroups,
  priceLookup,
  priceTokensIn,
  readPageConfig,
  refUpdateOutcome,
  removeArticle,
  removeCase,
  renderMarkdown,
  rub,
  slugify,
  tabFromHash,
  toBase64,
  upsertArticle,
  knownPriceKeys,
  upsertCase,
} from '../src/client/manage.ts';

/* ------------------------------------------------------------------ */
/*  Прайс                                                              */
/* ------------------------------------------------------------------ */

const PRICE_FILE = {
  version: 1,
  updated_at: '2026-11-01',
  groups: [
    {
      id: 'audit',
      title: 'Аудит',
      items: [
        { id: 'express', name: 'Экспресс-аудит', price: 7900 },
        { id: 'full', name: 'Полный аудит', price: 19900 },
      ],
    },
    {
      id: 'самозанятость',
      title: 'Консультации',
      items: [{ id: 'hour', name: 'Консультация, час', amount: 3000 }],
    },
  ],
};

test('прайс: читаются группы и цены, плоский список тоже', () => {
  const groups = priceGroups(PRICE_FILE);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].title, 'Аудит');
  assert.equal(groups[0].items[0].price, 7900);
  /* `amount` вместо `price` — тоже цена, а не пустота. */
  assert.equal(groups[1].items[0].price, 3000);

  const flat = priceGroups({ items: [{ id: 'doc', name: 'Договор', price: 2000 }] });
  assert.equal(flat.length, 1);
  assert.equal(flat[0].id, 'all');
  assert.equal(flat[0].items[0].price, 2000);
});

test('прайс: мусор вместо файла не ломает вкладку', () => {
  assert.deepEqual(priceGroups(null), []);
  assert.deepEqual(priceGroups('текст'), []);
  assert.deepEqual(priceGroups({ groups: 'нет' }), []);
});

test('правка одной цены не переписывает остальные', () => {
  const next = applyPriceEdits(PRICE_FILE, [{ group: 'audit', id: 'express', price: 8900 }]);
  const groups = priceGroups(next);
  assert.equal(groups[0].items[0].price, 8900, 'изменённая цена');
  assert.equal(groups[0].items[1].price, 19900, 'соседняя цена не тронута');
  assert.equal(groups[1].items[0].price, 3000, 'другая группа не тронута');
  /* Исходный объект остался прежним: правка идёт в копию. */
  const untouched = PRICE_FILE.groups[0].items[0] as { price?: number };
  assert.equal(untouched.price, 7900);
});

test('пустое поле цены превращается в «по запросу», а не в 0', () => {
  assert.equal(parsePrice(''), null);
  assert.equal(parsePrice('   '), null);
  assert.equal(parsePrice('14 000'), 14000);
  assert.equal(parsePrice('14\u00a0000 ₽'), 14000);
  assert.equal(parsePrice('7900,50'), 7900.5);
  assert.equal(parsePrice('-100'), null, 'отрицательная цена — не цена');

  const next = applyPriceEdits(PRICE_FILE, [{ group: 'audit', id: 'full', price: null }]);
  assert.equal(priceGroups(next)[0].items[1].price, null);
});

test('подстановка цен знает и «группа.позиция», и короткий id', () => {
  const lookup = priceLookup(PRICE_FILE);
  assert.equal(lookup.get('audit.express'), 7900);
  assert.equal(lookup.get('express'), 7900);
  assert.equal(lookup.get('audit.full'), 19900);
  assert.equal(lookup.get('самозанятость.hour'), 3000);
  assert.equal(lookup.get('нет.такой'), undefined);
});

test('кириллица в id цены не выпадает из проверки', () => {
  const keys = knownPriceKeys(PRICE_FILE);
  assert.ok(keys.has('самозанятость.hour'));
  assert.ok(keys.has('hour'));
  const warnings = articleWarnings('Час консультации — {{price:самозанятость.hour}}', PRICE_FILE);
  assert.deepEqual(warnings, [], 'русский id найден, предупреждений нет');
});

test('одинаковый короткий id в разных группах не подставляется наугад', () => {
  const lookup = priceLookup({
    groups: [
      { id: 'a', items: [{ id: 'base', price: 1000 }] },
      { id: 'b', items: [{ id: 'base', price: 2000 }] },
    ],
  });
  assert.equal(lookup.get('a.base'), 1000);
  assert.equal(lookup.get('b.base'), 2000);
  assert.equal(lookup.get('base'), undefined, 'неоднозначный id — лучше никак, чем неверно');
});

/* ------------------------------------------------------------------ */
/*  Кейсы                                                              */
/* ------------------------------------------------------------------ */

test('кейс: хорошие поля собираются в запись', () => {
  const built = buildCase({
    title: 'Кадровая служба с нуля для ЧОО',
    area: 'kdp',
    client: 'Частная охранная организация',
    task: 'Нужна кадровая служба с нуля: приём, увольнения, воинский учёт.',
    actions: 'Собрали документы, обучили инспектора, настроили 1С.',
    results: 'Штат 1000+ сотрудников\n0 штрафов за год',
    published_at: '2026-07-01',
    sort: 30,
    status: 'published',
  }, true);
  assert.deepEqual(built.errors, []);
  assert.equal(built.item?.slug, 'kadrovaya-sluzhba-s-nulya-dlya-choo');
  assert.deepEqual(built.item?.results, ['Штат 1000+ сотрудников', '0 штрафов за год']);
  assert.equal(built.item?.status, 'published');
});

test('кейс: пустые поля объясняют, что исправить', () => {
  const built = buildCase({ title: 'Кейс', area: 'чужое', task: 'мало', actions: '', results: '' }, true);
  assert.equal(built.item, null);
  const text = built.errors.join(' ');
  assert.match(text, /Название — 5–120/);
  assert.match(text, /Задача клиента/);
  assert.match(text, /результат/);
  assert.match(text, /направление/i);
});

test('кейс: правка сохраняет прежний адрес, даже если название изменилось', () => {
  const built = buildCase({
    title: 'Совсем другое название',
    area: 'podbor',
    task: 'Подобрать 15 продавцов в сеть магазинов за месяц.',
    actions: 'Запустили вакансию, провели 40 собеседований, вышли 15 человек.',
    results: '15 человек вышли',
  }, false, '15-prodavcov');
  assert.deepEqual(built.errors, []);
  assert.equal(built.item?.slug, '15-prodavcov', 'старые ссылки не должны умереть');
});

test('кейс: новый добавляется, существующий заменяется, соседи целы', () => {
  const file = { version: 1, cases: [
    { slug: 'one', title: 'Первый', sort: 10 },
    { slug: 'two', title: 'Второй', sort: 20 },
  ] };

  const added = upsertCase(file, {
    slug: 'three', title: 'Третий', area: 'kdp', client: '', task: 'т', actions: 'д',
    results: ['1'], published_at: '2026-01-01', sort: 30, status: 'published',
  });
  assert.equal((added.cases as unknown[]).length, 3);

  const replaced = upsertCase(file, {
    slug: 'two', title: 'Второй (правка)', area: 'kdp', client: '', task: 'т', actions: 'д',
    results: ['1'], published_at: '2026-01-01', sort: 20, status: 'draft',
  });
  const cases = replaced.cases as { slug: string; title: string }[];
  assert.equal(cases.length, 2, 'правка не добавила дубль');
  assert.equal(cases.find((c) => c.slug === 'two')?.title, 'Второй (правка)');
  assert.equal(cases.find((c) => c.slug === 'one')?.title, 'Первый');
});

test('удаление и смена порядка не ломают остальные кейсы', () => {
  const file = { version: 1, cases: [
    { slug: 'a', title: 'А', sort: 10 },
    { slug: 'b', title: 'Б', sort: 20 },
    { slug: 'c', title: 'В', sort: 30 },
  ] };
  const removed = removeCase(file, 'b');
  assert.deepEqual((removed.cases as { slug: string }[]).map((c) => c.slug), ['a', 'c']);

  const moved = moveCase(file, 'c', 'up').cases as { slug: string; sort: number }[];
  assert.deepEqual(moved.map((c) => c.slug), ['a', 'c', 'b']);
  assert.deepEqual(moved.map((c) => c.sort), [10, 20, 30], 'sort перенумерован подряд');
});

/* ------------------------------------------------------------------ */
/*  Статьи                                                             */
/* ------------------------------------------------------------------ */

const BODY = `${'Абзац про штрафы и проверки ГИТ. '.repeat(20)}

## Что проверит инспектор

- трудовые договоры
- локальные акты

Экспресс-аудит стоит {{price:audit.express}}, полный — {{price:audit.full}}.`;

test('статья: слаги латиницей, дата по Москве, статус соблюдён', () => {
  const built = buildArticle({
    title: 'Штрафы ГИТ за кадровые документы в 2026 году',
    excerpt: 'Разбор штрафов трудовой инспекции: за что наказывают и как подготовиться к проверке.',
    category: 'shtrafy',
    body_md: BODY,
    status: 'published',
  }, true, '', new Date('2026-11-21T06:30:00Z'));
  assert.deepEqual(built.errors, []);
  assert.equal(built.item?.slug, 'shtrafy-git-za-kadrovye-dokumenty-v-2026-godu');
  assert.equal(built.item?.published_at, '2026-11-21 09:30', 'UTC 06:30 = Москва 09:30');
  assert.equal(built.item?.updated_at, '2026-11-21 09:30');
});

test('статья: черновик без даты — норма, публикация без даты ставит текущую', () => {
  const draft = buildArticle({
    title: 'Черновик разбора',
    excerpt: 'Короткое описание будущей статьи про воинский учёт для организаций.',
    category: 'kadry',
    body_md: BODY,
    status: 'draft',
  }, true);
  assert.equal(draft.item?.published_at, null);

  const published = buildArticle({
    title: 'Опубликовано сейчас',
    excerpt: 'Короткое описание статьи, которую публикуем прямо сейчас из кабинета.',
    category: 'kadry',
    body_md: BODY,
    status: 'published',
  }, true);
  assert.match(String(published.item?.published_at), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test('статья: слишком короткое описание и текст не сохраняются', () => {
  const built = buildArticle({
    title: 'Ок',
    excerpt: 'мало',
    category: 'чужое',
    body_md: 'мало',
  }, true);
  assert.equal(built.item, null);
  const text = built.errors.join(' ');
  assert.match(text, /Заголовок/);
  assert.match(text, /Описание/);
  assert.match(text, /Текст статьи/);
  assert.match(text, /категорию/i);
});

test('статья: сохранение не теряет соседние статьи', () => {
  const file = { version: 1, updated_at: '2026-11-01 10:00', items: [
    { slug: 'old', title: 'Старая', status: 'published' },
  ] };
  const built = buildArticle({
    title: 'Новый разбор законов',
    excerpt: 'Описание нового разбора для клиентов: что изменилось и как реагировать.',
    category: 'shtrafy',
    body_md: BODY,
    status: 'published',
  }, true, '', new Date('2026-11-21T09:00:00Z'));
  const next = upsertArticle(file, built.item!);
  const items = next.items as { slug: string }[];
  assert.equal(items.length, 2);
  assert.equal(items[0].slug, 'old', 'старая статья на месте');
  assert.equal(next.updated_at, '2026-11-21 12:00');
});

test('статья: удаление убирает только свою', () => {
  const file = { version: 1, items: [{ slug: 'a' }, { slug: 'b' }] };
  assert.deepEqual((removeArticle(file, 'a').items as { slug: string }[]).map((a) => a.slug), ['b']);
});

test('токены цен находятся, а неизвестные — предупреждают', () => {
  assert.deepEqual(priceTokensIn('Стоит {{price:audit.express}} и {{price:consult.hour|от}}').sort(),
    ['audit.express', 'consult.hour']);

  const warnings = articleWarnings('Аудит {{price:audit.express}}, тест {{price:no-such.price}}', PRICE_FILE);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /no-such\.price/);
  assert.match(warnings[0], /по запросу/);
});

test('заголовок первого уровня в тексте — предупреждение, а не тишина', () => {
  const warnings = articleWarnings('# Мой заголовок\n\nтекст', PRICE_FILE);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /первого уровня/);
});

test('Markdown предпросмотра: заголовки, списки, цены и защита от HTML', () => {
  const html = renderMarkdown('## Раздел\n\n- пункт **жирный**\n- второй\n\n<script>alert(1)</script>\n\nЦена {{price:audit.express}}', PRICE_FILE);
  assert.match(html, /<h2>Раздел<\/h2>/);
  assert.match(html, /<li>пункт <strong>жирный<\/strong><\/li>/);
  assert.match(html, /7&nbsp;900&nbsp;₽/);
  assert.doesNotMatch(html, /<script>/, 'HTML из текста не исполняется');
  assert.match(html, /&lt;script&gt;/);
});

test('Markdown: таблица и неизвестная цена', () => {
  const html = renderMarkdown('| Что | Сколько |\n|---|---|\n| Аудит | {{price:audit.express}} |\n| Тест | {{price:нет}} |', PRICE_FILE);
  assert.match(html, /<th>Что<\/th>/);
  assert.match(html, /7&nbsp;900&nbsp;₽/);
  assert.match(html, /по&nbsp;запросу/);
});

test('рубли форматируются с неразрывным пробелом', () => {
  assert.equal(rub(7900), '7\u00a0900\u00a0₽');
  assert.equal(rub(19900), '19\u00a0900\u00a0₽');
});

/* ------------------------------------------------------------------ */
/*  Отзывы                                                             */
/* ------------------------------------------------------------------ */

test('ответ на отзыв: пустой — убрать, длинный — отказ', () => {
  assert.deepEqual(buildReply('   '), { reply: null, error: null });
  assert.equal(buildReply('Спасибо за отзыв!').reply, 'Спасибо за отзыв!');
  assert.match(String(buildReply('а'.repeat(601)).error), /600/);
  /* Лишние пробелы схлопываются: в KV не должно лежать «Ответ  с   двойными». */
  assert.equal(buildReply('Спасибо   за  отзыв').reply, 'Спасибо за отзыв');
});

test('оценка всегда целая от 0 до 5', () => {
  assert.equal(clampRating('4.6'), 5);
  assert.equal(clampRating(9), 5);
  assert.equal(clampRating(-3), 0);
  assert.equal(clampRating('нет'), 0);
});

test('запросы модерации совпадают с маршрутами воркера', () => {
  assert.deepEqual(moderationRequest('hide', 'r1'), { path: '/reviews/moderate', body: { id: 'r1', action: 'hide' } });
  assert.deepEqual(moderationRequest('delete', 'r1'), { path: '/reviews/moderate', body: { id: 'r1', action: 'delete' } });
  assert.deepEqual(moderationRequest('reply', 'r1', 'Спасибо'), { path: '/reviews/reply', body: { id: 'r1', reply: 'Спасибо' } });
});

/* ------------------------------------------------------------------ */
/*  Адреса, слаги, вкладки                                             */
/* ------------------------------------------------------------------ */

test('слаги: кириллица, пробелы и кавычки превращаются в адрес', () => {
  assert.equal(slugify('Работодатель требует «по собственному»'), 'rabotodatel-trebuet-po-sobstvennomu');
  assert.equal(slugify('Штрафы ГИТ — 2026!'), 'shtrafy-git-2026');
  assert.equal(slugify('   '), '');
  assert.equal(slugify('а'.repeat(100)).length, 60);
});

test('вкладка берётся из адреса, неизвестная — «Прайс»', () => {
  assert.equal(tabFromHash('#cases'), 'cases');
  assert.equal(tabFromHash('#reviews'), 'reviews');
  assert.equal(tabFromHash('#articles'), 'articles');
  assert.equal(tabFromHash('#чужое'), 'prices');
  assert.equal(tabFromHash(''), 'prices');
});

test('дата кабинета — московская, круглый год', () => {
  assert.equal(moscowStamp(new Date('2026-01-15T23:10:00Z')), '2026-01-16 02:10');
  assert.equal(moscowStamp(new Date('2026-07-01T00:00:00Z')), '2026-07-01 03:00');
});

/* ------------------------------------------------------------------ */
/*  Ошибки GitHub                                                      */
/* ------------------------------------------------------------------ */

test('ошибки GitHub объясняются по-русски', () => {
  assert.match(githubErrorText(401), /Токен/);
  assert.match(githubErrorText(403), /Contents: Read and write/);
  assert.match(githubErrorText(409), /одновременно/);
  assert.match(githubErrorText(429), /подождать/);
  assert.match(githubErrorText(503), /недоступен/);
});

test('гонка при сдвиге ветки: повтор, а не молчаливая перезапись', () => {
  assert.equal(refUpdateOutcome(200), 'ok');
  assert.equal(refUpdateOutcome(422), 'retry');
  assert.equal(refUpdateOutcome(409), 'retry');
  assert.equal(refUpdateOutcome(403), 'fail');
});

/* ------------------------------------------------------------------ */
/*  GitHub-клиент с поддельной сетью                                   */
/* ------------------------------------------------------------------ */

interface Call { url: string; method: string; body?: unknown }

/**
 * Поддельный транспорт: отвечает как GitHub на чтение и запись одного файла.
 * `conflictOnce` — первый PATCH ветки отвечает 422 (кто-то успел раньше).
 */
function fakeGithub(options: { conflictOnce?: boolean; failRead?: number } = {}) {
  const calls: Call[] = [];
  let patches = 0;
  const fileText = JSON.stringify({ version: 1, items: [] });

  const transport = async (url: string, init: { method?: string; body?: string } = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    const reply = (status: number, payload: unknown) => ({
      status,
      ok: status >= 200 && status < 300,
      text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
      headers: { get: () => null },
    });

    if (method === 'GET' && /\/user$/.test(url)) return reply(200, { login: 'maria' });
    if (method === 'GET' && url.includes('/contents/')) {
      if (options.failRead) return reply(options.failRead, { message: 'nope' });
      return reply(200, { content: toBase64(fileText), sha: 'blob-read' });
    }
    /* Пока ветку не сдвинули — `parent-0`; после успешного PATCH вершина новая. */
    const moved = patches > 0;
    if (method === 'GET' && url.includes('/git/ref/heads/')) {
      return reply(200, { object: { sha: moved ? 'parent-1' : 'parent-0' } });
    }
    if (method === 'GET' && url.includes('/git/commits/')) {
      return reply(200, { tree: { sha: `tree-${url.endsWith('parent-1') ? 1 : 0}` } });
    }
    if (method === 'POST' && url.endsWith('/git/blobs')) return reply(201, { sha: 'blob-new' });
    if (method === 'POST' && url.endsWith('/git/trees')) return reply(201, { sha: 'tree-new' });
    if (method === 'POST' && url.endsWith('/git/commits')) return reply(201, { sha: 'commit-new' });
    if (method === 'PATCH' && url.includes('/git/refs/heads/')) {
      patches += 1;
      if (options.conflictOnce && patches === 1) return reply(422, { message: 'Update is not a fast forward' });
      return reply(200, { object: { sha: 'commit-new' } });
    }
    return reply(404, { message: 'unknown route' });
  };

  return { transport, calls, patches: () => patches };
}

test('чтение файла возвращает JSON и sha', async () => {
  const fake = fakeGithub();
  const store = new GithubStore({ repo: 'a/b', branch: 'main' }, fake.transport);
  store.setToken('test-token');
  const file = await store.readFile('site/content/articles.json');
  assert.deepEqual(file.json, { version: 1, items: [] });
  assert.equal(file.sha, 'blob-read');
  const call = fake.calls.find((c) => c.url.includes('/contents/'));
  assert.match(String(call?.url), /ref=main/);
});

test('истёкший токен — понятный текст, а не «HTTP 401»', async () => {
  const fake = fakeGithub({ failRead: 401 });
  const store = new GithubStore({ repo: 'a/b', branch: 'main' }, fake.transport);
  store.setToken('bad');
  await assert.rejects(
    () => store.readFile('site/content/cases.json'),
    (error: unknown) => error instanceof ManageError && error.status === 401 && /Токен/.test(error.message),
  );
});

test('запись файла: коммит, сдвиг ветки и повтор при гонке', async () => {
  const fake = fakeGithub({ conflictOnce: true });
  const store = new GithubStore({ repo: 'a/b', branch: 'main' }, fake.transport);
  store.setToken('t');
  const saved = await store.writeFile('site/content/cases.json', { version: 1, cases: [{ slug: 'x' }] }, 'Кейсы: тест');
  assert.equal(saved.commit, 'commit-new');
  assert.equal(fake.patches(), 2, 'первый PATCH отклонён, второй прошёл');
  const commitCalls = fake.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/git/commits'));
  assert.equal(commitCalls.length, 2, 'после конфликта коммит собран заново');
  assert.equal((commitCalls[0].body as { message: string }).message, 'Кейсы: тест');
  /* Первый коммит опирался на старую вершину, второй — уже на новую:
     иначе повтор упёрся бы в тот же конфликт. */
  assert.deepEqual((commitCalls[0].body as { parents: string[] }).parents, ['parent-0']);
  assert.deepEqual((commitCalls[1].body as { parents: string[] }).parents, ['parent-1']);
});

test('кодирование UTF-8 переживает кириллицу', () => {
  const text = 'Привет, Мария! Ёжик — «кавычки» и тире';
  assert.equal(fromBase64(toBase64(text)), text);
  assert.equal(fromBase64(toBase64('')), '');
});

test('конфиг страницы читается из разметки, мусор игнорируется', () => {
  const doc = {
    getElementById: (id: string) => (id === 'manage-config'
      ? { textContent: JSON.stringify({ repo: 'x/y', branch: 'dev', leadsBase: 'https://w', casesPath: 'c.json', лишнее: 1 }) }
      : null),
  } as unknown as Document;
  const config = readPageConfig(doc);
  assert.equal(config.repo, 'x/y');
  assert.equal(config.branch, 'dev');
  assert.equal(config.leadsBase, 'https://w');
  assert.equal(config.casesPath, 'c.json');
  /* Лишние ключи из разметки в конфиг не попадают, а пустой конфиг даёт дефолты. */
  assert.deepEqual(Object.keys(readPageConfig(null)), []);
  assert.equal(DEFAULT_CONFIG.branch, 'main');
  assert.equal(DEFAULT_CONFIG.repo, 'sledovatel61/kadry-pro');

  const broken = { getElementById: () => ({ textContent: '{битый' }) } as unknown as Document;
  assert.deepEqual(readPageConfig(broken), {});
  assert.deepEqual(readPageConfig(null), {});
});
