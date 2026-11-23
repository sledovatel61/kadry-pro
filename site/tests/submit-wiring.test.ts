/**
 * Регрессия: на одну форму не должно быть ДВУХ обработчиков submit.
 *
 * Что случилось в бою: `site.ts` вешал submit на `form[data-lead-form]` и проверял
 * `dataset.leadsBound`, но этот флаг не ставил никто (в `leads-form.ts` он
 * называется `leadWired`). В итоге на одно нажатие срабатывали оба:
 *   — site.ts показывал «Заявка почти ушла — позвоните»;
 *   — leads-form.ts писал настоящий результат.
 * Владелец видел два противоречащих сообщения: «почти ушла» и «не получилось».
 *
 * Тест статический: он читает исходник site.ts и проверяет, что селектор
 * исключает формы заявок. Это дешёвая страховка от возврата того же дефекта —
 * полноценный DOM здесь не нужен.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = readFileSync(join(root, 'src/client/site.ts'), 'utf8');
const leads = readFileSync(join(root, 'src/client/leads-form.ts'), 'utf8');

test('site.ts не дублирует обработчик форм заявок: отбой по флагу leadWired в момент submit', () => {
  /* Ищем строку с querySelectorAll, которая выбирает формы для подстраховки. */
  const line = site
    .split('\n')
    .find((l) => l.includes('querySelectorAll') && l.includes('data-validate'));
  assert.ok(line, 'в site.ts должен остаться обработчик для форм без модуля заявок');

  /* Подстраховка должна покрывать и формы заявок: если leads-form.ts не
     загрузился, форма молча перезагрузила бы страницу. Двойного сообщения нет
     за счёт проверки флага ПРИ ОТПРАВКЕ (порядок загрузки модулей не
     гарантирован — проверять флаг при навешивании нельзя). */
  assert.match(
    line,
    /form\[data-lead-form\]/,
    'селектор должен включать формы заявок — иначе без leads-form.ts они молча перезагрузят страницу',
  );
  assert.match(
    site,
    /if \(form\.dataset\.leadWired === '1'\) return;/,
    'submit в site.ts обязан выходить, если форму уже ведёт leads-form.ts (leadWired)',
  );
});

test('флаг привязки в site.ts убран из кода, а не переименован', () => {
  /* Если вернуть проверку флага, она снова разойдётся с leadWired.
     В комментарии слово осталось намеренно — как объяснение, почему так. */
  /* Упоминание в бэктиках — это объяснение в комментарии, а не проверка.
     Проверкой было бы обращение вида `this.dataset.leadsBound`. */
  assert.doesNotMatch(site, /this\.dataset\.leadsBound/, 'в коде проверки leadsBound быть не должно');
});

test('leads-form.ts по-прежнему помечает свои формы leadWired', () => {
  assert.match(leads, /dataset\.leadWired\s*=\s*'1'/);
});

test('чужие сообщения под формой гасятся перед своим', () => {
  assert.match(
    leads,
    /function clearStrayStatus/,
    'нужен сброс .quick-lead-status, иначе текст site.ts переживёт результат',
  );
  assert.match(leads, /clearStrayStatus\(form\);\s*\n\s*const \{ title, note \} = successText/);
});

test('тексты ошибок называют причину: сеть, таймаут, не-JSON', () => {
  assert.match(leads, /\(сеть\)/, 'сетевая ошибка должна быть отличима от таймаута');
  assert.match(leads, /таймаут/, 'таймаут должен называться таймаутом');
  assert.match(leads, /не JSON/, 'нераспознанный ответ должен быть виден');
});

test('поля ужимаются до лимитов воркера — заявка не теряется на 400', () => {
  /* honeypot > 200 символов давал 400, а блока для этой ошибки на странице нет. */
  assert.match(leads, /honeypot:\s*clip\(/);
  assert.match(leads, /message:\s*2000|LIMIT\s*=\s*\{[^}]*message:\s*2000/);
});
