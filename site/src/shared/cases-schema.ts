/**
 * Кейсы Марии — контракт файла `site/content/cases.json`.
 *
 * Кейсы взяты из живых страниц `cases.html` и `podbor.html` (никаких придуманных
 * историй): сеть из 21 филиала, ЧОО с 1000+ сотрудников, вредные условия труда,
 * четыре проекта по подбору. Поля «задача / что сделано / результаты» — те же,
 * что на сайте, чтобы страница «Кейсы» собиралась из этого файла.
 *
 * Модуль чистый: без `node:fs`. Его импортируют страницы, админка `/manage/`,
 * гейт `site/scripts/check-cases.mjs` и тесты.
 */

export const CASE_AREAS = ['kdp', 'podbor', 'audit', 'sout', 'voinskiy', 'lna'] as const;
export type CaseArea = (typeof CASE_AREAS)[number];

export const CASE_AREAS_TITLE: Record<CaseArea, string> = {
  kdp: 'Кадровое делопроизводство',
  podbor: 'Подбор персонала',
  audit: 'Аудит и проверки ГИТ',
  sout: 'Охрана труда и СОУТ',
  voinskiy: 'Воинский учёт',
  lna: 'Локальные акты',
};

export const CASE_STATUSES = ['published', 'draft'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_LIMITS = Object.freeze({
  slug: [3, 60] as const,
  title: [5, 120] as const,
  task: [10, 600] as const,
  actions: [10, 900] as const,
  results: [1, 6] as const,
  result: [3, 160] as const,
});

export const CASE_SLUG_RE = /^[a-z0-9][a-z0-9-]{2,59}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface SiteCase {
  /** `ladnaya-set-21-filial` — латиницей, из заголовка. */
  slug: string;
  title: string;
  /** Направление: по нему фильтр на странице «Кейсы». */
  area: CaseArea;
  status: CaseStatus;
  /** `YYYY-MM-DD` */
  published_at: string;
  /** Меньше — выше; при равенстве выше свежее. */
  sort: number;
  /** Клиент без названия: «Федеральная сеть фитнес-клубов». */
  client: string;
  /** Задача клиента. */
  task: string;
  /** Что сделала Мария. */
  actions: string;
  /** Измеримые результаты, 1–6 пунктов. */
  results: string[];
}

export interface CasesFile {
  version: number;
  updated_at: string;
  cases: SiteCase[];
}

export interface CasesParseResult {
  file: CasesFile;
  errors: string[];
}

export const EMPTY_CASES_FILE: CasesFile = { version: 1, updated_at: '', cases: [] };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const len = (s: string): number => s.trim().length;

function parseCase(raw: unknown, index: number, errors: string[]): SiteCase | null {
  const at = `cases[${index}]`;
  if (!isObj(raw)) {
    errors.push(`${at}: запись должна быть объектом`);
    return null;
  }
  const bad: string[] = [];

  const slug = str(raw.slug).trim();
  if (!CASE_SLUG_RE.test(slug)) {
    bad.push(`slug: «${slug}» — латиница, цифры и дефисы, 3–60 знаков`);
  }

  const title = str(raw.title).trim();
  if (len(title) < CASE_LIMITS.title[0] || len(title) > CASE_LIMITS.title[1]) {
    bad.push(`title: нужно ${CASE_LIMITS.title[0]}–${CASE_LIMITS.title[1]} знаков`);
  }

  const area = raw.area;
  if (typeof area !== 'string' || !(CASE_AREAS as readonly string[]).includes(area)) {
    bad.push(`area: «${String(area)}» — допустимо ${CASE_AREAS.join(' | ')}`);
  }

  const status = raw.status === undefined ? 'published' : raw.status;
  if (typeof status !== 'string' || !(CASE_STATUSES as readonly string[]).includes(status)) {
    bad.push(`status: «${String(status)}» — допустимо ${CASE_STATUSES.join(' | ')}`);
  }

  const publishedAt = str(raw.published_at).trim();
  if (!isRealDate(publishedAt)) bad.push(`published_at: «${publishedAt}» — нужна дата YYYY-MM-DD`);

  const sort = Number(raw.sort);
  if (!Number.isFinite(sort) || !Number.isInteger(sort)) bad.push('sort: нужно целое число');

  const client = str(raw.client).trim();
  if (client.length > 160) bad.push('client: до 160 знаков');

  const task = str(raw.task).trim();
  if (len(task) < CASE_LIMITS.task[0] || len(task) > CASE_LIMITS.task[1]) {
    bad.push(`task: нужно ${CASE_LIMITS.task[0]}–${CASE_LIMITS.task[1]} знаков`);
  }

  const actions = str(raw.actions).trim();
  if (len(actions) < CASE_LIMITS.actions[0] || len(actions) > CASE_LIMITS.actions[1]) {
    bad.push(`actions: нужно ${CASE_LIMITS.actions[0]}–${CASE_LIMITS.actions[1]} знаков`);
  }

  const resultsRaw = raw.results;
  const results: string[] = [];
  if (!Array.isArray(resultsRaw) || resultsRaw.length < CASE_LIMITS.results[0] || resultsRaw.length > CASE_LIMITS.results[1]) {
    bad.push(`results: нужен список из ${CASE_LIMITS.results[0]}–${CASE_LIMITS.results[1]} пунктов`);
  } else {
    resultsRaw.forEach((r, i) => {
      if (typeof r !== 'string' || len(r) < CASE_LIMITS.result[0] || len(r) > CASE_LIMITS.result[1]) {
        bad.push(`results[${i}]: нужно ${CASE_LIMITS.result[0]}–${CASE_LIMITS.result[1]} знаков`);
      } else {
        results.push(r.trim());
      }
    });
  }

  if (bad.length > 0) {
    errors.push(`${at}: ${bad.join('; ')}`);
    return null;
  }

  return {
    slug,
    title,
    area: area as CaseArea,
    status: status as CaseStatus,
    published_at: publishedAt,
    sort,
    client,
    task,
    actions,
    results,
  };
}

export function parseCasesFile(raw: unknown): CasesParseResult {
  const errors: string[] = [];
  const out: CasesFile = { ...EMPTY_CASES_FILE, cases: [] };

  if (!isObj(raw)) return { file: out, errors: ['cases.json: корень должен быть объектом'] };

  const version = Number(raw.version);
  out.version = Number.isFinite(version) && version > 0 ? version : 1;
  if (typeof raw.updated_at === 'string') out.updated_at = raw.updated_at;

  if (!Array.isArray(raw.cases)) {
    errors.push('cases: нужен массив');
    return { file: out, errors };
  }

  const seen = new Set<string>();
  raw.cases.forEach((item, index) => {
    const parsed = parseCase(item, index, errors);
    if (!parsed) return;
    if (seen.has(parsed.slug)) {
      errors.push(`cases[${index}]: slug «${parsed.slug}» повторяется`);
      return;
    }
    seen.add(parsed.slug);
    out.cases.push(parsed);
  });

  return { file: out, errors };
}

/** Порядок витрины: `sort` по возрастанию, при равенстве — свежее выше. */
export function orderCases(cases: SiteCase[]): SiteCase[] {
  return [...cases].sort((a, b) => {
    if (a.sort !== b.sort) return a.sort - b.sort;
    return a.published_at < b.published_at ? 1 : a.published_at > b.published_at ? -1 : 0;
  });
}

/** Опубликованные кейсы в порядке витрины; `area` — фильтр по направлению. */
export function publishedCases(file: CasesFile, area?: CaseArea): SiteCase[] {
  const list = file.cases.filter((c) => c.status === 'published' && (!area || c.area === area));
  return orderCases(list);
}

/** Сводка по направлениям: сколько кейсов в каждом — для фильтра. */
export function caseCounts(file: CasesFile): Record<CaseArea, number> {
  const out = { kdp: 0, podbor: 0, audit: 0, sout: 0, voinskiy: 0, lna: 0 } as Record<CaseArea, number>;
  for (const c of file.cases) if (c.status === 'published') out[c.area] += 1;
  return out;
}

/** Адрес страницы кейса. Слаг латиницей, поэтому без encodeURI. */
export function caseUrl(slug: string): string {
  return `/cases/${slug}.html`;
}
