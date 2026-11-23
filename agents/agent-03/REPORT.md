# Агент 03 — шлюз заявок, живые отзывы, кабинет `/manage/`

**Главное.** Formspree больше не нужен: заявки со всех форм сайта, калькулятора и
магазина шаблонов идут в прослойку `relay/` и падают **сразу в Telegram-группу
Марии и копией на почту**. Платные и email-шаблоны не лежат в статике — ссылку на
скачивание выдаёт только воркер по подписанному одноразовому адресу. Отзывы живые:
стартовый файл пустой (ни одного выдуманного отзыва), новый отзыв публикуется сразу,
а Мария может скрыть спам и ответить из кабинета. Кабинет `/manage/` — четыре
вкладки с телефона: Прайс, Кейсы, Отзывы, Полезное/Статьи с RSS.

Ветка: `arena/4a8011ca-kadry-pro` (от `main` @ `ba0e432`). В `main` не коммитил,
PR не создавал.

## Что сделано

### 1. Прослойка `relay/` (Cloudflare Worker, 12 модулей, 27 тестов)

Заменяет Formspree и принимает **все** формы с атрибутом `[data-lead-form]`:
консультацию, калькулятор (со штатом, зарплатой, тарифом и экономией), заказ
платного шаблона и запрос шаблона за email.

| Маршрут | Что делает |
|---|---|
| `POST /leads` | заявка → Telegram + письмо. Ответ `201 {ticket, duplicate, delivered:{telegram,email}, download?}` |
| `GET /health` | жив ли воркер и видит ли Telegram/почту (им пользуется workflow) |
| `GET /files/:token` | подписанная ссылка на платный файл: 24 часа, подпись HMAC, 410 после срока |
| `POST /reviews` | новый отзыв публикуется сразу, ответ `201` |
| `GET /reviews` | опубликованные отзывы для страниц сайта |
| `GET /reviews/inbox` | журнал отзывов для кабинета (по токену GitHub) |
| `POST /reviews/moderate` | `hide` / `publish` / `delete` — только по токену GitHub |
| `POST /reviews/reply` | ответ Марии, виден под отзывом |

Защита от спама и мусора: ловушка-honeypot и «слишком быстрое» заполнение (меньше
4 секунд) получают такой же `201`, но никуда не уходят; лимит по IP — 5 заявок и
3 отзыва за 10 минут; строгая валидация полей; защита от повторной отправки по
ключу `idempotency_key` (двойной клик не создаёт две заявки); проверка `Origin`;
версия согласия `2026-11-21` (старая версия получает `400`).

### 2. Живые отзывы

- `site/content/reviews.json` — **пустой стартовый файл** (выдуманных отзывов нет).
- `site/src/shared/reviews-schema.ts` — схема с честным пустым состоянием, средняя
  оценка на пустом списке не рисуется.
- `site/src/components/ReviewsSection.astro` — блок для главной, «Обо мне» и
  «Кейсов». Пусто — говорит «Пока на сайте нет отзывов» и предлагает оставить первый.
- `site/src/components/ReviewModal.astro` — одна форма отзыва на страницу
  (`<dialog>`), подключена к `relay/`, ставит оценку звёздами.
- `site/src/client/reviews-live.ts` — подтягивает живые отзывы в уже открытую
  страницу, без дублей; `site/src/client/review-form.ts` — отправка и понятные
  ошибки по-русски.
- `site/scripts/check-reviews.mjs` — гейт: ловит `demo: true` и «рыбные» тексты,
  падает в `--strict`.

### 3. Кабинет `/manage/` — 4 вкладки с телефона

`site/src/pages/manage/index.astro` + `site/src/client/manage.ts` +
`site/src/styles/manage.css`. Вход — личный токен GitHub (fine-grained, только
этот репозиторий, право **Contents: Read and write**). Токен лежит только в
браузере Марии и уходит только на `api.github.com` и в прослойку.

| Вкладка | Что умеет |
|---|---|
| **1. Прайс** | читает `site/content/prices.json`, правит числа, «Сохранить» = один коммит |
| **2. Кейсы** | `site/content/cases.json`: новый кейс, правка, порядок ↑↓, черновик/публикация, удаление |
| **3. Отзывы** | живые отзывы из прослойки: скрыть, вернуть, ответить, удалить |
| **4. Полезное** | `site/content/articles.json`: статья, черновик, предпросмотр с подставленными ценами, удаление |

Сохранение — один коммит в репозиторий (дерево → коммит → сдвиг ветки). Если в
этот момент кто-то сохранил своё, кабинет делает **один повтор** и только потом
честно говорит «Кто-то сохранил изменения одновременно»: чужую правку молча не
перезаписываем.

### 4. Статьи «Полезное» и RSS

- `site/content/articles.json` — 2 настоящие статьи из живых страниц сайта:
  «Штрафы ГИТ за кадровые документы в 2026 году» (`shtrafy-git.html`) и
  «Работодатель требует „по собственному“: как я выиграла 47 дней» (`trudovoy-spor.html`).
- `site/src/pages/articles/[slug].astro` — страница статьи: оглавление из `##`,
  разметка **BlogPosting**, canonical, Open Graph, «другие разборы».
- `site/src/pages/articles/index.astro` — список с фильтром по категориям.
- `site/src/pages/articles/rss.xml.ts` — лента RSS 2.0, свежие сверху, до 20 статей.
- `site/src/pages/articles/_markdown.ts` — безопасный Markdown и подстановка
  `{{price:id}}` из прайса (цена живёт в одном месте, в статье — токен).
- `site/scripts/check-articles.mjs` — гейт: неизвестный токен цены ломает прогон,
  цена, написанная руками, — предупреждение.

### 5. Проверки и тесты

```
relay:  npx tsc --noEmit  → чисто;  node --test test/*.test.ts  → 27/27
site:   72/72 теста (manage 35, leads 25, reviews 12)
        node scripts/check-reviews.mjs   → пройдено
        node scripts/check-cases.mjs     → пройдено
        node scripts/check-articles.mjs  → пройдено
```

Дополнительно страницы собраны и проверены в черновом Astro-проекте: `/manage.html`,
`/articles.html`, обе статьи и `rss.xml` собираются без ошибок; кабинет прогнан в
настоящем DOM с подменённой сетью — все четыре вкладки, предпросмотр статьи и
сохранение одним коммитом работают.

## Что нужно сделать владельцу (по шагам)

### Шаг 1. Задеплоить прослойку (один раз, ~10 минут)

1. Зарегистрироваться на [cloudflare.com](https://dash.cloudflare.com) (бесплатно).
2. Создать бота: в Telegram написать **@BotFather** → `/newbot` → имя → получить токен.
3. Создать группу для заявок, добавить туда бота, написать в группе любое сообщение.
   Затем открыть `https://api.telegram.org/bot<ТОКЕН>/getUpdates` и взять
   `chat.id` (это отрицательное число вида `-1001234567890`).
4. В GitHub репозитория `sledovatel61/kadry-pro`: **Settings → Secrets and variables
   → Actions → New repository secret** и добавить:

   | Секрет | Обязателен | Что это |
   |---|---|---|
   | `CLOUDFLARE_API_TOKEN` | да | токен Cloudflare с шаблоном «Edit Cloudflare Workers» |
   | `BOT_TOKEN` | да | токен бота от @BotFather |
   | `TELEGRAM_CHAT_ID` | да | id группы заявок (отрицательное число) |
   | `FILE_TOKEN_SECRET` | да | любая длинная случайная строка (подпись ссылок на платные файлы) |
   | `CLOUDFLARE_ACCOUNT_ID` | нет | если не задан, workflow определит сам |
   | `BREVO_API_KEY` или `RESEND_API_KEY` | нет | копия заявок на почту |
   | `EMAIL_TO` / `EMAIL_FROM` | нет | адреса почты (по умолчанию `m.perepechay@yandex.ru`) |
   | `REVIEWS_INBOX_KEY` | нет | резервный журнал отзывов |

5. **Actions → Deploy leads relay → Run workflow.** В конце в Summary будет адрес
   воркера вида `https://kadry-leads.kadrypro.workers.dev`.
6. **Settings → Secrets and variables → Actions → Variables → New repository
   variable**: `PUBLIC_LEADS_ENDPOINT` = этот адрес (без слэша в конце).
   После этого формы на сайте начинают отправлять заявки в Telegram.

> Пока `PUBLIC_LEADS_ENDPOINT` не задан, сайт остаётся честной статикой: формы
> показывают телефон и **ничего не отправляют**. Молча «проглотить» заявку нельзя.

### Шаг 2. Вход в кабинет (один раз на устройство)

1. GitHub → **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**.
2. Repository access: **Only select repositories** → `sledovatel61/kadry-pro`.
3. Permissions → Repository permissions → **Contents: Read and write**.
4. Expiration — 90 дней (потом выпустить новый).
5. Открыть `https://kadry-pro.ru/manage/`, вставить токен, нажать «Проверить».

**Токен = доступ к текстам и ценам сайта.** Не пересылать в мессенджерах; на
чужом устройстве после работы нажимать «Выйти» (токен удаляется из браузера).

### Шаг 3. Что нужно от Агента 01 и Агента 02 при сборке

Это не «работы Агента 03», а точки стыковки — без них блоки просто не появятся:

1. **Стили отзывов.** Стили блока отзывов и модалки лежат в
   `agents/agent-03/reviews-styles.css`. Агент 01 добавляет файл в свой
   `site/src/styles/style.css` — иначе блоки будут без оформления.
2. **Вставка отзывов** (Агент 01, три страницы):
   ```astro
   import ReviewsSection from '../components/ReviewsSection.astro';
   import ReviewModal from '../components/ReviewModal.astro';
   ...
   <ReviewsSection id="reviews-home" source="home" />
   <ReviewsSection id="reviews-about" source="about" title="Что говорят клиенты" />
   <ReviewModal page="home" />   <!-- одна на страницу -->
   ```
   Для «Кейсов» — `source="cases"`, `id="reviews-cases"`.
3. **Скрипты форм и отзывов**: `leads-form.ts` подключается на страницах с формами
   (`import '../client/leads-form.ts'` или `wireLeadForms()`), `reviews-live.ts`
   уже импортируется модалкой. Формы должны иметь `data-lead-form` и
   `data-lead-kind` (`consult` | `calculator` | `template` | `subscribe`).
4. **`site/content/prices.json`** ведёт Агент 02. Кабинет читает его как есть,
   подходит и `{ groups: [...] }`, и `{ items: [...] }`. Для статей нужны позиции
   `audit.express` и `audit.git_prep` (токены уже стоят в текстах), для
   «трудовых споров» — `consult.hour`. Если id будут другие — правится текст статьи
   в кабинете или гейт `check-articles.mjs` подскажет, что не нашлось.
5. **Страница «Кейсы»** (Агент 01) собирается из `site/content/cases.json`:
   `publishedCases(file, area?)` даёт отсортированный список, `caseUrl(slug)` — адрес.
6. **`/manage/`** при `build.format: 'file'` собирается в `manage.html`;
   внешние ссылки на кабинет лучше вести на `/manage/` (GitHub Pages отдаст
   `manage.html` и так), а из кабинета «← На сайт» ведёт на `/`.
7. **Список статей** собирается в `articles.html` (а не `articles/index.html`):
   сборка с `format: 'file'` даёт именно такой адрес, на него и ведут все ссылки.

## Границы файлов

Работал строго в зоне Агента 03 (раздел 2 документа оркестрации):
`agents/agent-03/*`, `relay/*`, `.github/workflows/relay.yml`,
`site/content/{reviews,cases,articles}.json`,
`site/src/shared/{leads-endpoint,reviews-schema,cases-schema,articles-schema}.ts`,
`site/src/client/{leads-form,reviews-live,review-form,manage}.ts`,
`site/src/components/{ReviewsSection,ReviewModal}.astro`,
`site/src/styles/manage.css`, `site/src/pages/manage/*`,
`site/src/pages/articles/*`, `site/scripts/check-{reviews,cases,articles}.mjs`,
`site/tests/{manage,reviews,leads}.test.ts`.

Два вспомогательных модуля, которые поначалу лежали вне списка, **влиты в файлы
своей зоны**, чтобы не занимать чужие имена:

- разбор ошибок приёмника и расчёт калькулятора → в `site/src/shared/leads-endpoint.ts`;
- Markdown статей и подстановка цен → в `site/src/pages/articles/_markdown.ts`.

Корневые файлы старого сайта (`index.html`, `style.css`, `script.js`, `shablony/*`,
`CNAME`, `AGENTS.md`) не тронуты. `/tmp/ats` не коммитился. `relay/.gitignore`
добавлен, чтобы `node_modules` воркера (331 МБ) не попал в репозиторий.

## Что осталось за мной (вне моей зоны)

- Вставить блоки отзывов на три страницы и подключить `reviews-styles.css` — Агент 01.
- `site/content/prices.json` — Агент 02 (кабинет и статьи уже готовы его читать).
- Прогнать всё вместе, собрать `pages-dist` и выложить превью — Агент 04.

## Известные ограничения

- Кабинет правит файлы **в ветке `main`** (поле `branch` в `MANAGE_CONFIG`, `site/src/pages/manage/index.astro`).
  Пока владелец смотрит превью с другой ветки, правки из кабинета на превью не
  попадут — это ожидаемо; после переключения домена всё совпадёт.
- Для кейсов с картинками и обложек статей полей пока нет: тексты и результаты есть,
  медиа добавим, когда Агент 01 утвердит папку изображений.
- Почта — дубль, а не основной канал: если ключ почты не задан, заявки всё равно
  приходят в Telegram (и наоборот: при сбое Telegram заявка уходит письмом).
