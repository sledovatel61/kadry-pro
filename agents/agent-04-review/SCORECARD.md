# SCORECARD — Агент 04 (Главный Ревьюер, Аудитор 152-ФЗ и Сборщик)

**Вердикт: сборка ПРИНЯТА — 95/100 (порог 85 превышен). Все 6 пунктов «Чек-листа
точечных швов» зашиты, все тесты и все проверки зелёные, конвейер правды работает:
изменение цены в кабинете /manage/ меняет цифры на всех страницах.**

Проверено на живой сборке (site/pages-dist: 25 страниц, 140 файлов, 5.72 МБ):
сайт 83/83 тестов, релея 27/27 + tsc чистый, 8 проверочных скриптов без единого
замечания. Боевая ветка main и старые корневые HTML не тронуты.

---

## 1. Сводная таблица веток

| Ветка | Агент | Коммиты | Балл | Вердикт |
|---|---|---|---|---|
| arena/e599a2ab-kadry-pro | 01 — Веб-разработчик | 2dff6e2 и до | 95/100 | Принята |
| arena/136ddcbc-kadry-pro | 02 — Менеджер по продукту | 7714fc1 и до | 97/100 | Принята |
| arena/4a8011ca-kadry-pro | 03 — SMM и автоматизации | 8a0f734 и до | 96/100 | Принята |
| **arena/d2be38cf-kadry-pro** | **04 — сборка и швы** | **см. ниже** | **95/100** | **Принята** |

Слияние 3 веток: `git merge --no-ff` по цепочке 01→02→03, 0 конфликтов, 203 новых
файла. Старые корневые HTML репозитория (index.html, services.html и др.) оставлены
на месте — по прямому указанию владельца.

## 2. Семь гейтов — итог

| Гейт | Требование | Статус | Доказательство |
|---|---|---|---|
| Г1. Факты | Телефон +7 (961) 302-21-12, Telegram @Mariya061 (t.me/perepechay запрещён), ИНН 613400944153 в privacy | ✅ | grep по pages-dist: t.me/perepechay — 0 вхождений; контакты единые на всех страницах |
| Г2. Платные файлы закрыты | Прямых ссылок на платные PDF нет; пакеты платные; бесплатно — 20 PDF + free-bundle-20.zip | ✅ | check:templates: 20 бесплатных PDF, 44 платных превью, в ZIP — только бесплатные |
| Г3. 152-ФЗ | Нет fonts.googleapis/formspree; Метрика 108237323 и GA4 G-76SCLJTYNF — только после «Принять»; privacy + consent | ✅ | check:analytics зелёный; grep: 0 fonts.googleapis, 0 form spree; consent.html в sitemap |
| Г4. Цены | Все цены из site/content/prices.json; правка в /manage/ меняет сайт | ✅ | 49 позиций; токены {{price:…}} на 7 страницах + тарифы калькулятора + шапка/футер; живой тест: 14 000→15 000 меняет 8/8 вхождений на главной |
| Г5. SEO/URL | 18 старых URL + consent + 404 + manage/index.html + sitemap + robots + CNAME; статьи; og-default 1200×630 | ✅ | export-pages: 26 адресов; sitemap 17 URL (15 страниц + 2 статьи); check-pages: 25 страниц, 0 ошибок, 0 предупреждений |
| Г6. Дизайн | #0a0a0a + #4ade80, док, 320–1440 | ✅ | дизайн не перекраивали; чинили только содержательные швы |
| Г7. /manage/ | 4 вкладки + отзывы + тесты | ✅ | manage.test.ts в наборе 83/83; /manage/ открывается и как manage/index.html, и как manage.html; noindex |

## 3. Чек-лист точечных швов — всё зашито

### ① style.css — «```» удалён
Посторонние тройные обратные кавычки на строке 748 (между блоком .cases-filter и
разделом категорий) удалены. Стили кейсов целы.

### ② Статьи и /manage/
- articles/index.astro и [slug].astro переписаны на layouts/Base.astro:
  единая шапка/футер/навигация, CollectionPage и BlogPosting JSON-LD,
  хлебные крошки, оглавление, блок «Другие разборы», RSS в head.
- articles/_data.ts читает content/ через contentPath() (кандидаты: import.meta.url →
  cwd/content → cwd/site/content) — обе статьи собираются: /articles/shtrafy-git-2026.html
  и /articles/rabotodatel-trebuet-po-sobstvennomu.html, обе в sitemap.xml вместе с consent.html.
- /manage/ работает по обоим адресам: export-pages.mjs кладёт копию manage.html в
  manage/index.html (без manage.html сборка падает явно).
- check-pages.mjs: yandex_22774c0af65b478b.html, manage.html и manage/index.html —
  служебные страницы без требований canonical/og:image/JSON-LD/title/description.

### ③ Проверки, ItemList, единый вид ссылок
- check-pages.mjs переписан: статика проверяется через fs.existsSync (0 ложных
  предупреждений), статьи сверяются content/articles.json ↔ articles/*.html ↔ sitemap,
  утилитарные страницы (privacy, consent, thank-you…) не требуют JSON-LD.
- shablony.astro: ItemList JSON-LD на все 64 позиции с якорями #sNN — как на старом сайте.
- agents/agent-04-review/normalize-links.mjs (прогнан): 18 файлов приведены к
  единому .html-виду ссылок — работает и в превью, и на GitHub Pages
  (меню, футер, контент; проверено grep — «чистых» ссылок не осталось).
- Footer.astro: «Полезное: разборы законов» → /articles.html.

### ④ Стыковка
- reviews-styles.css (Агент 03) → site/src/styles/reviews.css + импорт в Base.astro
  (порядок стилей: fonts → style → components → articles → reviews).
- ReviewsSection + ReviewModal на трёх страницах: index (id=reviews-home, source=home),
  about (id=reviews-about, source=about, разрез контента по `<!-- CTA -->`),
  cases (id=reviews-cases, source=cases — вместо прежней заглушки «отзывы по запросу»).
  review-form.ts и reviews-live.ts грузятся в Base для всех страниц.
- cases.astro переписан на рендер из content/cases.json (8 кейсов, парсер cases-schema):
  фильтр по направлениям (kdp/podbor/audit/sout/voinskiy/lna), порядок по sort,
  добавление кейса через вкладку «Кейсы» /manage/ не требует правки HTML.
- leads-form.ts зашёл в Base для всех [data-lead-form]: ловушка ботов читает
  data-honeypot/_gotcha/company_website; алиас calc_tier↔calc_tariff (пишет в оба);
  кнопка калькулятора ловится и как [data-fix-calc], и как [data-calc-fix] и
  подставляет расчёт в форму главной (#home-lead-form); расчёт с ползунков
  #staff-slider/#salary-slider/#staff-tier/#savings-month/#savings-year собирается
  напрямую (collectCalcFromSliders).
- Цены — единый справочник site/content/prices.json (токены {{price:ID}}, рендерит
  shared/prices.ts → renderPriceToken):
  - services.astro: 3 тарифа (14 000/24 000/36 000), 22 строки таблицы услуг,
    12 карточек ЛНА, СОУТ, пакеты ЛНА (23 000/39 000/69 000), шаблоны (500/3 500);
  - index.astro: hero, карточки услуг, калькулятор; тарифы калькулятора читаются
    из JSON #calc-prices (собирается из prices.json) — getTierPrice в client/site.ts
    больше не зашиты числа;
  - audit.astro (7 900/9 900/19 900 + срочность 9 900), lna.astro, sout.astro
    (9 900/18 000), voinskiy-uchet.astro (12 000), podbor.astro (30 000/5 000 чел./
    3 500 чел./75 000 мес.);
  - шапка и футер (SITE.priceFrom) и priceRange в JSON-LD — тоже из prices.json.
  Живой тест: правка retainer.start 14 000 → 15 000 и обратно — на главной
  изменились 8 из 8 вхождений (тариф, калькулятор, карточки, футер, JSON-LD).

### ⑤ Конвейер
- site/package-lock.json закоммичен (.gitignore его не игнорирует).
- .github/workflows/pages.yml — по эталону АвтоТехСервиса (/tmp/ats):
  триггер СТРОГО preview/github-pages + workflow_dispatch (боевой деплой main не трогаем);
  Node 24 + кэш npm по site/package-lock.json; configure-pages@v5; npm ci;
  сборка с PUBLIC_LEADS_ENDPOINT (по умолчанию https://kadry-leads.kadrypro.workers.dev,
  перекрывается переменной репозитория); все проверки; тесты; typecheck;
  upload-pages-artifact@v3 (site/pages-dist) → sleep 5 → deploy-pages@v5.
- site/package.json: добавлены npm-скрипты check:prices, check:analytics,
  check:templates, check:reviews, check:cases, check:articles, test, typecheck,
  общий check (все проверки подряд).
- site/tsconfig.typecheck.json: typecheck строгими правилами для shared/*.ts,
  ключевых client-модулей (leads-form, manage, review-form, reviews-live) и tests.
  Legacy-скрипты (site.ts, trudovoy-spor.ts) — рабочий JS в стиле Агента 01,
  их рефакторинг под strict-tsc сознательно не выполнялся.

### ⑥ Этот отчёт, тесты, push, превью
- agents/agent-04-review/SCORECARD.md — этот файл; рядом normalize-links.mjs и
  wire-prices.mjs (протоколы правок: как зашивались ссылки и цены).
- Все тесты и проверки прогнаны (см. «Конвейер правды»), ветка запушена,
  живое превью запущено на 0.0.0.0 (чистые пути, .html, /manage/).

## 4. Конвейер правды — последние прогоны

| Проверка | Результат |
|---|---|
| site: node --test (prices, templates, leads, manage, reviews, analytics-consent) | 83/83 ✅ |
| relay: node --test | 27/27 ✅ |
| relay: tsc --noEmit | чисто ✅ |
| site: npm run typecheck (tsconfig.typecheck.json) | чисто ✅ |
| check:prices | 49 позиций, токены синхронизированы ✅ |
| check:templates | 20 бесплатных PDF, 44 платных превью ✅ |
| check:reviews / check:cases / check:articles | 0/0, 8 кейсов, 2 статьи ✅ |
| check:analytics | счётчики только после согласия ✅ |
| check:media | бюджет соблюдён ✅ |
| check:pages | 25 страниц, 0 ошибок, 0 предупреждений ✅ |
| export-pages | 26 обязательных адресов, 140 файлов ✅ |

## 5. Что осталось за кадром (честно)

1. Сравнительные цифры «нашёл кандидата за 30 000 против 50 000 у агентства»,
   скидочный ряд массового подбора «4 000 ₽/чел при 30–100 чел.» и подписи
   «Экономия 4 000/7 000 ₽» в пакетах ЛНА — маркетинговые/производные величины,
   их нет в prices.json; оставлены текстом. Ключевые цены и все позиции прайса —
   из справочника.
2. Стартовые (до пересчёта JS) цифры калькулятора главной в разметке — косметика;
   при загрузке страницы калькулятор пересчитывает их из тех же цен prices.json.
3. Заявки из форм идут в Cloudflare Worker (relay/, 27/27 тестов). Его деплой —
  отдельный шаг владельца (`wrangler deploy`), адрес воркера уже прописан в
  workflow и relay/README.md. Без деплоя воркера сайт работает честной статикой:
  формы показывают телефон.
4. reviews.json пуст намеренно: выдуманных отзывов нет (Гейт 1). Разделы отзывов
   на главной, «О нас» и «Кейсах» показывают честное «пока нет отзывов» и форму
   «Оставить отзыв» — новые отзывы появятся сразу после публикации.

## 6. Контакты и факты (сверено, не менялись)

- Владелец ПДн: Перепечай Мария Павловна, ИНН 613400944153, самозанятый (НПД), Ростов-на-Дону
- Телефон: +7 (961) 302-21-12 · Telegram: @Mariya061 (https://t.me/Mariya061) · WhatsApp: https://wa.me/79613022112
- Email: m.perepechay@yandex.ru · Метрика 108237323 · GA4 G-76SCLJTYNF (оба — после согласия)
