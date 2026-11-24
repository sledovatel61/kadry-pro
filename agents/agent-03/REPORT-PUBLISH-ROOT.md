# Handoff Агенту 04 — технический перенос сайта из `/preview/` в корень `kadry-pro.ru`

## 1. Идентификаторы

- **Рабочая ветка:** `arena/4a8011ca-kadry-pro`
- **Коммит переноса корня:** `da1ee82fbbeb1ecd43d3cbadf8d9f68da1d71848` (`da1ee82`)
- **Базовый production-коммит `main` до переноса (зафиксирован для отката):** `ac75af6c9352be4c874cc84650e0401c59216e7c` (`ac75af6`, «PR #9: фикс 409, K-1123, leadWired»)
- **Исходный снимок старого статического сайта в истории git:** `ba0e4323be0830816704a2e9a6b9c13449b4cf38` (`ba0e432`)

## 2. Реальный механизм публикации GitHub Pages (проверено через `gh api`)

`GET /repos/sledovatel61/kadry-pro/pages`:
- `build_type`: `"legacy"`
- `source`: `{ "branch": "main", "path": "/" }`
- `cname`: `"kadry-pro.ru"`, `https_enforced`: `true` (сертификат действителен до `2027-02-12`)
- Активный деплой: системный `pages build and deployment` (`dynamic/pages/pages-build-deployment`) на каждый коммит в `main` — раздаёт корень `/` напрямую с учётом `.nojekyll`.
- `.github/workflows/pages.yml` (`Publish client preview`) привязан только к `preview/github-pages` и использует `actions/deploy-pages@v5` — **не запускался и не переключался**.
- `.github/workflows/relay.yml` запускается только при изменениях `relay/**` или самого workflow — в этой ветке эти пути **не затронуты** (`git diff origin/main -- relay/ .github/` пуст).

## 3. Что подготовлено в ветке

1. **Слияние с актуальным `main` (`ac75af6`):** сохранены все последние фиксы приёма заявок (`leadWired` в момент submit, `honeypotSource()` по K-1123, ротация ключа при `409`, честные статусы таймаута и каналов).
2. **Корневая сборка Astro (`site/pages-dist` → корень репозитория `/`):**
   - Базовый путь `/` (без `/preview/`), `PUBLIC_LEADS_ENDPOINT=https://kadry-leads.ats439.workers.dev` зашит в клиентский бандл (`/assets/reviews-live.IyLc3V8W.js`).
   - Выгружены 25 HTML-файлов (все 18 прежних адресов + `404.html`, `consent.html`, `articles.html`, 2 статьи в `articles/*.html`, `manage.html`, `manage/index.html`), `sitemap.xml` (17 корневых URL), `robots.txt`, `CNAME` (`kadry-pro.ru`), `.nojekyll`, `yandex_22774c0af65b478b.html`, а также папки `assets/`, `fonts/`, `img/`, `styles/`, `shablony/free/`, `shablony/previews/`, `shablony/free-bundle-20.zip`.
   - Добавлен воспроизводимый скрипт `site/scripts/export-root.mjs` (`npm run build:root`, `npm run root:export`, `npm run check:root`).
3. **Аудит и сохранение старых ресурсов / совместимости:**
   - `/preview/` пересобран из той же сборки и сохранён полностью рабочим (с `noindex, nofollow` только внутри `preview/`).
   - `logo.png` (используется JSON-LD на `about/audit/cases/contact` и скриптом `site/scripts/build-images.mjs`) — **сохранён**.
   - `images/maria-perepechay.png` (мастер-исходник для `site/scripts/build-images.mjs`) — **сохранён**.
   - `CNAME`, `.nojekyll`, `yandex_22774c0af65b478b.html`, `favicon.ico`, `favicon.png`, `logo.jpg`, а также старые корневые `style.css`, `script.js`, `shablony.css`, `trudovoy-spor.css` (на случай вкладок со старым кэшем HTML в минуту выкладки) — **сохранены**.
   - В корневой `shablony/`: **сохранены все 20 бесплатных PDF по старым прямым адресам** `/shablony/<имя>.pdf` (которые были открыто связаны на старом `shablony.html` и индексировались поиском) вдобавок к новым `/shablony/free/<имя>.pdf` и `/shablony/free-bundle-20.zip`. Закрыт открытый доступ только к 44 платным PDF (по 500 ₽) и `email-bundle.zip` во исполнение Гейта Г2 (`SCORECARD.md`, `relay/src/files.ts`); сами файлы полностью сохранены в истории git (`ac75af6` / `ba0e432`).

## 4. Порядок интеграции для Агента 04

1. Проверить ветку локально или в CI:
   ```bash
   git fetch origin main arena/4a8011ca-kadry-pro
   git diff origin/main..origin/arena/4a8011ca-kadry-pro -- relay/ .github/
   # ожидание: пусто (relay, секреты и workflows не менялись)
   cd site && npm run check:root && node scripts/export-subfolder-preview.mjs --check-only && npm run check && npm test && npm run typecheck
   ```
2. Зафиксировать страховочный тег текущего прода перед слиянием (рекомендуется):
   ```bash
   git tag prod-before-astro-root ac75af6c9352be4c874cc84650e0401c59216e7c
   git push origin prod-before-astro-root
   ```
3. Влить `arena/4a8011ca-kadry-pro` в `main` штатным PR (`--merge`, чтобы сохранить merge-коммит для одношагового `git revert -m 1`). Источник GitHub Pages **не менять** — `pages build and deployment` автоматически опубликует обновлённый корень `/` на `https://kadry-pro.ru/` за ~1 минуту.
4. После статуса `built` в `gh api repos/sledovatel61/kadry-pro/pages` выполнить живую проверку (см. §7).

## 5. Порядок отката (без `git reset --hard` и без переписывания истории)

### Вариант А — полный откат публикации одной командой (штатный)
Если ветка влита в `main` merge-коммитом `<MERGE_SHA>`:
```bash
git checkout main && git pull origin main
git revert -m 1 <MERGE_SHA> --no-edit
git push origin main
```
*(Если использовался squash-merge с коммитом `<SQUASH_SHA>` — без `-m 1`: `git revert <SQUASH_SHA> --no-edit && git push origin main`.)*

GitHub Pages автоматически пересоберёт `main:/` и вернёт прежний сайт состояния `ac75af6` (включая все 18 старых HTML и старое содержимое `shablony/`).

### Вариант Б — точечное восстановление любого старого файла из истории git
Все файлы до переноса неизменно хранятся в коммите `ac75af6c9352be4c874cc84650e0401c59216e7c` (и исходном `ba0e432`):
```bash
git checkout ac75af6c9352be4c874cc84650e0401c59216e7c -- index.html services.html shablony/
git commit -m "Возврат выбранных файлов из ac75af6"
git push origin main
```

## 6. Результаты автоматических проверок

| Проверка | Результат |
|---|---|
| `PUBLIC_LEADS_ENDPOINT=https://kadry-leads.ats439.workers.dev npm run build:preview` | ✅ 23 маршрута Astro → 26 обязательных адресов, 168 файлов (8.10 МБ) |
| `npm run root:export` / `npm run check:root` (`export-root.mjs`) | ✅ 168/168 файлов совпадают с `pages-dist`; 18 индексируемых страниц имеют `index, follow` и **0 `noindex`**; 6 служебных (`404`, `manage`, `thank-you*`, `bundle-download`) — `noindex, nofollow`; **0 ссылок на `/preview`** в корневых HTML/CSS/JS/`sitemap.xml`/`robots.txt`; все canonical ведут на `https://kadry-pro.ru/...`; `PUBLIC_LEADS_ENDPOINT` зашит; 0 битых локальных и абсолютных ссылок; 20 старых бесплатных PDF сохранены |
| `node scripts/export-subfolder-preview.mjs --check-only` | ✅ `preview/`: 25 HTML, 168 файлов, 156 локальных ссылок, непереписанных корневых `0`, битых `0`, везде `noindex, nofollow` |
| `npm run check` (`contrast`, `prices`, `templates`, `reviews`, `cases`, `articles`, `analytics`, `media`, `nav`, `pages`) | ✅ Все 10 гейтов зелёные (0 ошибок, 0 предупреждений) |
| `site`: `npm test` + `npm run typecheck` | ✅ `145/145` тестов пройдены, `tsc` без ошибок |
| `relay`: `npm test` + `tsc --noEmit` | ✅ `44/44` тестов пройдены, `tsc` без ошибок; код `relay/` не менялся |
| Мобильные формы и док в корневых HTML | ✅ Проверены все 24 HTML в корне: 12 форм `[data-lead-form]`, все поля телефона `type="tel"` с маской, чекбоксы ПДн и ловушки на месте, мобильный док на 22 страницах, ссылок на `formspree` — `0`, шапка и кнопки на `320px/375px/768px` проверены `check:nav` |

## 7. Что нельзя подтвердить автоматически до публикации в `main`

1. **Фактический деплой GitHub Pages после merge в `main`** и обновление CDN-кэша на `https://kadry-pro.ru/` (и отсутствие редиректов/ошибок TLS на живом домене).
2. **Живая сквозная доставка заявки с корневого домена `https://kadry-pro.ru/`** (`Origin: https://kadry-pro.ru` → воркер `https://kadry-leads.ats439.workers.dev/leads` → фактическое получение сообщения Марией в Telegram и копии на почту; по условию задачи проверяется отдельной тестовой заявкой после публикации с подтверждением Марии).
3. **Поведение мобильной клавиатуры, автозаполнения iOS/Android и касаний дока на реальном телефоне.**
4. **Переиндексация обновлённых страниц и `sitemap.xml` в Яндекс.Вебмастере и Google Search Console** (проверочный файл `yandex_22774c0af65b478b.html` сохранён без изменений).
5. **Наличие внешних закладок у прошлых клиентов на старый `shablony/email-bundle.zip` или прямые URL платных PDF** (при необходимости любой файл восстанавливается одной командой из `ac75af6`, а для защищённой автовыдачи платных пакетов через `/files/` владельцу в будущем потребуется раскомментировать R2-бакет `TEMPLATES` в `relay/wrangler.toml`).
6. **Обновление корня после будущих правок в `/manage/`:** поскольку источник Pages сохранён в режиме `legacy` (`main:/`), коммиты кабинета `/manage/` меняют `site/content/*.json`, а для пересборки корневого HTML сейчас требуется запуск `cd site && npm run build:root` (переключение на автоматический CI-пересборщик сознательно не делалось без отдельного решения).
