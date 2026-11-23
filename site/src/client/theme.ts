/**
 * Переключение палитры — временный инструмент превью.
 *
 * Палитры живут в CSS (style.css, блок html[data-theme='…']). Здесь только
 * три вещи: применить выбор, запомнить его и подсветить активную кнопку.
 *
 * Ключ в localStorage намеренно с префиксом preview: перед запуском сайта
 * для клиентов эту логику вместе с ThemePreviewBar.astro можно удалить,
 * и у посетителей не останется «залипшей» палитры из предпросмотра.
 */

export const THEME_KEY = 'kadrypro-preview-theme';

/** Пять утверждённых палитр. Порядок = порядок кнопок в плашке. */
export const THEMES = ['sage', 'gold', 'cobalt', 'amber', 'teal'] as const;
export type ThemeName = (typeof THEMES)[number];

export function isTheme(value: unknown): value is ThemeName {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

export function readTheme(): ThemeName {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (isTheme(saved)) return saved;
  } catch {
    /* приватный режим или запрет хранилища — просто остаёмся на теме по умолчанию */
  }
  return 'sage';
}

export function applyTheme(name: ThemeName): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', name);

  /* Цвет адресной строки на телефоне подхватывает фон темы */
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const bg = getComputedStyle(root).getPropertyValue('--bg-primary').trim();
    if (bg) meta.setAttribute('content', bg);
  }

  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-theme-set]')) {
    btn.setAttribute('aria-pressed', btn.dataset.themeSet === name ? 'true' : 'false');
  }

  try {
    localStorage.setItem(THEME_KEY, name);
  } catch {
    /* запомнить не удалось — не критично */
  }

  document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: name } }));
}

function init(): void {
  const bar = document.getElementById('theme-bar');
  if (!bar) return;

  /* Кнопки могли отрисоваться раньше, чем сработал THEME_INIT в <head>,
     поэтому синхронизируем подсветку ещё раз */
  const current = isTheme(document.documentElement.getAttribute('data-theme'))
    ? (document.documentElement.getAttribute('data-theme') as ThemeName)
    : readTheme();
  for (const btn of bar.querySelectorAll<HTMLButtonElement>('[data-theme-set]')) {
    btn.setAttribute('aria-pressed', btn.dataset.themeSet === current ? 'true' : 'false');
  }

  bar.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-theme-set]');
    if (!btn) return;
    const next = btn.dataset.themeSet;
    if (isTheme(next)) applyTheme(next);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
