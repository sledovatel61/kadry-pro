/**
 * Форма «Оставить отзыв»: `[data-review-form]`.
 *
 * Отправка — только в прослойку: `${LEADS_BASE}/reviews`. Без `PUBLIC_LEADS_ENDPOINT`
 * форма честно показывает «отзывы сейчас принимаются по телефону» и ничего не
 * шлёт — своего сервера у сайта нет.
 *
 * Отзыв публикуется сразу (без премодерации): Мария получает уведомление в
 * Telegram и может скрыть спам одной кнопкой в /manage/. Поэтому перед отправкой
 * человек видит это правило и галочку согласия.
 *
 * Ошибки воркера приходят плоско — `{error:'validation', fields:{text:'too_short'}}` —
 * коды переводим в русские тексты под полем.
 */
import {
  CONSENT_VERSION,
  LEADS_BASE,
  leadsFetch,
  leadsUrl,
  parseApiFailure,
  retryAfterSeconds,
} from '../shared/leads-endpoint.ts';

export const REVIEW_FORM_LIMITS = Object.freeze({
  author: { min: 2, max: 40 },
  text: { min: 20, max: 1500 },
});

/** Коды полей воркера → тексты под полем (ключи — как в `relay/src/reviews-validate.ts`). */
export const FIELD_TEXTS: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  author: Object.freeze({
    required: 'Укажите имя',
    too_short: 'Имя — от 2 до 40 символов',
    too_long: 'Имя — до 40 символов',
    link_not_allowed: 'Ссылки в имени не нужны — уберите адрес',
  }),
  text: Object.freeze({
    required: 'Напишите текст отзыва',
    too_short: 'Текст — от 20 знаков: что делали и как всё прошло',
    too_long: 'Текст — до 1500 знаков',
    repeated_lines: 'Похоже на повтор одного и того же — напишите своими словами',
    link_not_allowed: 'Ссылки в отзыве не нужны — уберите http, www, t.me',
  }),
  rating: Object.freeze({
    required: 'Поставьте оценку от 1 до 5',
    out_of_range: 'Поставьте оценку от 1 до 5',
  }),
  consent: Object.freeze({ required: 'Поставьте галочку согласия' }),
  consentVersion: Object.freeze({ required: 'Поставьте галочку согласия' }),
});

/** Текст ошибки по коду поля; неизвестный код — общее сообщение. */
export function fieldText(field: string, code: string): string | null {
  return FIELD_TEXTS[field]?.[code] ?? null;
}

function $<T extends Element>(sel: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(sel);
}

function setError(form: HTMLElement, name: string, message: string): void {
  const box = $<HTMLElement>(`[data-review-error="${name}"]`, form);
  if (box) {
    box.textContent = message;
    box.hidden = !message;
  }
  const input = $(`[name="${name}"]`, form);
  if (input) {
    input.classList.toggle('error', Boolean(message));
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
}

function clearErrors(form: HTMLElement): void {
  form.querySelectorAll<HTMLElement>('[data-review-error]').forEach((el) => {
    el.textContent = '';
    el.hidden = true;
  });
  form.querySelectorAll<HTMLElement>('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
}

/** Оценка: радио `[name="rating"]` или кликабельные звёзды `[data-rating-star]`. */
function ratingValue(form: HTMLElement): number {
  const checked = $<HTMLInputElement>('input[name="rating"]:checked', form);
  if (checked) return Number(checked.value) || 0;
  const value = Number(form.dataset.rating ?? '');
  return Number.isFinite(value) ? value : 0;
}

/** Подключить звёзды: наведение и клик выставляют `form.dataset.rating`. */
function wireStars(form: HTMLElement): void {
  const stars = Array.from(form.querySelectorAll<HTMLElement>('[data-rating-star]'));
  if (!stars.length) return;
  const paint = (value: number): void => {
    for (const star of stars) {
      const n = Number(star.dataset.ratingStar);
      star.classList.toggle('is-on', n <= value);
      star.setAttribute('aria-checked', n === value ? 'true' : 'false');
    }
  };
  for (const star of stars) {
    const n = Number(star.dataset.ratingStar);
    star.addEventListener('mouseenter', () => paint(n));
    star.addEventListener('focus', () => paint(n));
    star.addEventListener('click', () => {
      form.dataset.rating = String(n);
      paint(n);
    });
    star.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      form.dataset.rating = String(n);
      paint(n);
    });
  }
  form.addEventListener('mouseleave', () => paint(ratingValue(form)));
  paint(ratingValue(form));
}

export function wireReviewForm(form: HTMLFormElement): void {
  if (form.dataset.reviewWired === '1') return;
  form.dataset.reviewWired = '1';
  wireStars(form);

  const status = $<HTMLElement>('[data-review-status]', form.parentElement ?? document) ?? $<HTMLElement>('[data-review-status]', form);
  const success = $<HTMLElement>('[data-review-success]', form.parentElement ?? document);

  if (!LEADS_BASE) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (status) {
        status.hidden = false;
        status.textContent = 'Приём отзывов с сайта пока не подключён. Напишите Марии в Telegram @Mariya061 или позвоните +7 (961) 302-21-12.';
      }
    });
    return;
  }

  let busy = false;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy) return;
    clearErrors(form);

    const authorInput = $<HTMLInputElement>('[name="author"]', form);
    const textInput = $<HTMLTextAreaElement>('[name="text"]', form);
    const consent = $<HTMLInputElement>('[name="consent"]', form);
    const author = (authorInput?.value ?? '').trim();
    const text = (textInput?.value ?? '').trim();
    const rating = ratingValue(form);

    let ok = true;
    if (author.length < REVIEW_FORM_LIMITS.author.min) { setError(form, 'author', 'Укажите имя'); ok = false; }
    if (text.length < REVIEW_FORM_LIMITS.text.min) { setError(form, 'text', 'Текст — от 20 знаков'); ok = false; }
    if (!rating) { setError(form, 'rating', 'Поставьте оценку от 1 до 5'); ok = false; }
    if (consent && !consent.checked) { setError(form, 'consent', 'Без согласия опубликовать отзыв нельзя'); ok = false; }
    if (!ok) {
      form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }

    busy = true;
    const button = $<HTMLButtonElement>('button[type="submit"]', form);
    const label = button?.textContent ?? '';
    if (button) {
      button.disabled = true;
      button.textContent = 'Отправляем…';
    }

    const payload = {
      author,
      text,
      rating,
      consent: true,
      consentVersion: form.dataset.consentVersion || CONSENT_VERSION,
      honeypot: ($<HTMLInputElement>('[name="honeypot"]', form)?.value ?? ''),
      page: form.dataset.page || location.pathname.replace(/^\/|\/+$/g, '').replace(/\.html$/, '') || 'otzyvy',
    };

    void (async () => {
      try {
        const res = await leadsFetch(leadsUrl('reviews'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => null) as { ok?: boolean; id?: string } | null;

        if (res.status === 201 && data?.ok) {
          if (success) {
            success.hidden = false;
            success.textContent = 'Спасибо! Отзыв опубликован — он уже виден на сайте.';
          }
          if (status) {
            status.hidden = false;
            status.textContent = 'Отзыв опубликован. Мария увидит его в Telegram.';
          }
          form.reset();
          form.dataset.rating = '';
          wireStars(form);
          /* Свой отзыв показываем сразу, чтобы человек увидел результат. */
          const grid = document.querySelector<HTMLElement>('[data-reviews]');
          if (grid) {
            const { buildCard, updateSummary } = await import('./reviews-live.ts');
            grid.prepend(buildCard({
              id: data.id ?? String(Date.now()),
              author,
              text,
              rating,
              publishedAt: new Date().toISOString(),
            }));
            updateSummary(document, grid);
          }
          return;
        }

        if (res.status === 429) {
          const wait = retryAfterSeconds(res.headers.get('retry-after')) ?? 60;
          if (status) {
            status.hidden = false;
            status.textContent = `Слишком много отзывов с вашего адреса. Попробуйте через ${wait} секунд.`;
          }
          return;
        }

        const failure = parseApiFailure(data);
        if (failure) {
          let touched = false;
          for (const [field, code] of Object.entries(failure.fields)) {
            const message = fieldText(field, code) ?? fieldText(field, 'required');
            if (message) { setError(form, field, message); touched = true; }
          }
          if (touched) {
            form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
            return;
          }
          if (failure.code === 'link_not_allowed') {
            setError(form, 'text', 'Ссылки в отзыве не нужны — уберите адрес');
            return;
          }
          if (status) {
            status.hidden = false;
            status.textContent = failure.message
              || (failure.code === 'origin'
                ? 'Отзыв можно оставить только на сайте kadry-pro.ru.'
                : 'Не получилось отправить отзыв. Попробуйте ещё раз или напишите в Telegram @Mariya061.');
          }
          return;
        }
        if (status) {
          status.hidden = false;
          status.textContent = 'Не получилось отправить отзыв. Попробуйте ещё раз или напишите в Telegram @Mariya061.';
        }
      } catch {
        if (status) {
          status.hidden = false;
          status.textContent = 'Связь прервалась. Проверьте интернет и попробуйте снова, или напишите в Telegram @Mariya061.';
        }
      } finally {
        busy = false;
        if (button) {
          button.disabled = false;
          button.textContent = label;
        }
      }
    })();
  });
}

export function wireReviewForms(): void {
  const forms = document.querySelectorAll<HTMLFormElement>('form[data-review-form]');
  forms.forEach((form) => wireReviewForm(form));
}

if (typeof document !== 'undefined') {
  const run = (): void => wireReviewForms();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
}
