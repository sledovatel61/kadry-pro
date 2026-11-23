/**
 * Тесты отзывов (Агент 03).
 *
 * Главное правило владельца: выдуманных отзывов быть не может. Поэтому тесты
 * бьют именно по честности и по «что увидит человек»:
 *   • пустой файл — не ошибка: блок говорит «пока нет отзывов»;
 *   • отзыв с `demo: true` или «рыбным» текстом ловится гейтом;
 *   • скрытый отзыв не попадает на сайт, но остаётся в журнале;
 *   • средняя оценка не появляется на пустом списке (иначе это выдумка);
 *   • склонения «1 отзыв / 2 отзыва / 5 отзывов» не врут.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseReviewsFile,
  publishedReviews,
  reviewsStats,
  plural,
  EMPTY_REVIEWS_FILE,
  type SiteReview,
} from '../src/shared/reviews-schema.ts';
// Гейт написан как .mjs и не имеет типов (проверяем только типы .ts-модулей)
import { checkReviewsFile } from '../scripts/check-reviews.mjs';

const GOOD = (over: Partial<SiteReview> = {}): SiteReview => ({
  id: 'r-2026-11-20-001',
  author: 'Павел И.',
  text: 'Мария за неделю навела порядок в кадровых документах, штрафов от ГИТ нет.',
  rating: 5,
  source: 'site',
  status: 'published',
  published_at: '2026-11-20',
  reply: null,
  ...over,
} as SiteReview);

/** Временный файл для гейта: реальный `content/reviews.json` не трогаем. */
function tempFile(data: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'kadry-reviews-'));
  const path = join(dir, 'reviews.json');
  writeFileSync(path, typeof data === 'string' ? data : JSON.stringify(data, null, 2), 'utf8');
  return path;
}

test('пустой файл отзывов — честное стартовое состояние', () => {
  const parsed = parseReviewsFile({ version: 1, updated_at: '2026-11-21', items: [] });
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(publishedReviews(parsed.file), []);

  const stats = reviewsStats([]);
  assert.equal(stats.average, null, 'средняя оценка на пустом списке не выдумывается');
  assert.equal(stats.count, 0);
});

test('стартовый файл проекта пуст: ни одного отзыва', () => {
  assert.deepEqual(EMPTY_REVIEWS_FILE.items, []);
  const parsed = parseReviewsFile(EMPTY_REVIEWS_FILE);
  assert.deepEqual(parsed.errors, []);
});

test('опубликованные отзывы сортируются от новых к старым', () => {
  const parsed = parseReviewsFile({
    version: 1,
    items: [
      GOOD({ id: 'r-1', published_at: '2026-10-01' }),
      GOOD({ id: 'r-2', published_at: '2026-11-20' }),
      GOOD({ id: 'r-3', published_at: '2026-11-05' }),
    ],
  });
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(publishedReviews(parsed.file).map((r) => r.id), ['r-2', 'r-3', 'r-1']);
});

test('скрытый отзыв не попадает на сайт', () => {
  const parsed = parseReviewsFile({
    version: 1,
    items: [GOOD({ id: 'r-live' }), GOOD({ id: 'r-hidden', status: 'hidden' })],
  });
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(publishedReviews(parsed.file).map((r) => r.id), ['r-live']);
  assert.equal(parsed.file.items.length, 2, 'в журнале скрытый остаётся');
});

test('средняя оценка считается по опубликованным и округляется', () => {
  const parsed = parseReviewsFile({
    version: 1,
    items: [GOOD({ id: 'r-1', rating: 5 }), GOOD({ id: 'r-2', rating: 4 }), GOOD({ id: 'r-3', rating: 4 })],
  });
  const stats = reviewsStats(publishedReviews(parsed.file));
  assert.equal(stats.count, 3);
  assert.equal(stats.average, 4.3);
});

test('битая запись отзыва не проходит схему', () => {
  const parsed = parseReviewsFile({
    version: 1,
    items: [
      { id: 'r-1', author: 'П', text: 'коротко', rating: 9, source: 'site', status: 'published', published_at: '2026-11-20' },
      { id: 'r-2', author: 'Павел И.', text: 'Нормальный текст отзыва про работу со мной, всё честно.', rating: 5, source: 'чужое', status: 'published', published_at: '2026-11-20' },
    ],
  });
  /* Две записи — две ошибки, и в тексте видны все четыре поля. */
  assert.equal(parsed.errors.length, 2);
  const text = parsed.errors.join(' ');
  for (const field of ['author', 'text', 'rating', 'source']) {
    assert.match(text, new RegExp(field), `ошибка должна называть поле ${field}`);
  }
});

test('склонения не врут', () => {
  assert.equal(plural(1, 'отзыв', 'отзыва', 'отзывов'), 'отзыв');
  assert.equal(plural(2, 'отзыв', 'отзыва', 'отзывов'), 'отзыва');
  assert.equal(plural(5, 'отзыв', 'отзыва', 'отзывов'), 'отзывов');
  assert.equal(plural(11, 'отзыв', 'отзыва', 'отзывов'), 'отзывов');
  assert.equal(plural(21, 'отзыв', 'отзыва', 'отзывов'), 'отзыв');
  assert.equal(plural(112, 'отзыв', 'отзыва', 'отзывов'), 'отзывов');
});

/* ------------------------------------------------------------------ */
/*  Гейт check-reviews.mjs                                             */
/* ------------------------------------------------------------------ */

test('гейт: пустой файл проходит и предупреждает, а не падает', () => {
  const result = checkReviewsFile(tempFile({ version: 1, updated_at: '', items: [] }));
  assert.equal(result.ok, true);
  assert.equal(result.published, 0);
  assert.match(result.warnings.join(' '), /пока нет/);
});

test('гейт: демо-отзыв ловится и в строгом режиме роняет прогон', () => {
  const file = tempFile({
    version: 1,
    items: [{ ...GOOD(), demo: true }],
  });
  const soft = checkReviewsFile(file);
  assert.equal(soft.ok, true, 'без --strict демо не роняет сборку');
  assert.deepEqual(soft.demo, ['r-2026-11-20-001 (demo)']);

  const strict = checkReviewsFile(file, { strict: true });
  assert.equal(strict.ok, false);
  assert.match(strict.errors.join(' '), /ненастоящие отзывы/);
});

test('гейт: «рыбный» текст ловится даже без флага demo', () => {
  const file = tempFile({
    version: 1,
    items: [{ ...GOOD(), text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod.' }],
  });
  const result = checkReviewsFile(file, { strict: true });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /образец/);
});

test('гейт: битый JSON и отсутствующий файл — не «зелёно»', () => {
  assert.equal(checkReviewsFile(tempFile('{битый')).ok, false);
  const missing = checkReviewsFile(join(tmpdir(), 'нет-такого-файла.json'));
  assert.equal(missing.ok, false);
  assert.match(missing.errors.join(' '), /не найден/);
});

test('гейт: настоящий отзыв проходит строгий режим', () => {
  const result = checkReviewsFile(tempFile({ version: 1, items: [GOOD()] }), { strict: true });
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.published, 1);
  assert.equal(result.hidden, 0);
});
