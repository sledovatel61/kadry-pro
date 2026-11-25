/**
 * Модальные окна на /shablony.html:
 *   1) `#template-preview-modal` — лайтбокс предпросмотра первой страницы (JPG целиком,
 *      без обрезки, с масштабированием для чтения на телефоне и десктопе и переходом к заявке);
 *   2) `#template-lead-modal` — заявка на конкретный шаблон или весь набор из 64 документов.
 *
 * Оплаты и автоматической выдачи платных файлов на сайте пока нет: форма передаёт
 * выбранный шаблон в единый модуль `leads-form.ts` (`data-lead-kind="template"`), а
 * сервер `relay/` сверяет цену и название по собственному каталогу и присылает
 * уведомление Марии в Telegram и на почту.
 */

export interface SelectedTemplateInfo {
  id: string | null;
  title: string;
  package: 'single' | 'full' | 'free';
  price: number;
}

export interface PreviewTemplateInfo {
  id: string;
  title: string;
  src: string;
  width: number;
  height: number;
  price: number;
  free: boolean;
  fileHref: string | null;
  hasDocx: boolean;
}

export const DOCX_PREVIEW_CAPTION =
  'Первая страница шаблона. Полная версия — редактируемый DOCX без водяного знака.';
export const STANDARD_PREVIEW_CAPTION =
  'Водяное превью первой страницы. Полный документ без водяного знака отправляется после заявки.';

export function readTriggerTemplate(trigger: HTMLElement): SelectedTemplateInfo | null {
  const pkgRaw = (trigger.dataset.templatePackage ?? 'single').trim();
  const pkg: 'single' | 'full' | 'free' =
    pkgRaw === 'full' ? 'full' : pkgRaw === 'free' ? 'free' : 'single';
  const idRaw = (trigger.dataset.templateId ?? '').trim();
  const title = (trigger.dataset.templateTitle ?? '').trim();
  const priceNum = Number(trigger.dataset.templatePrice ?? '0');
  if (!title || !Number.isFinite(priceNum) || priceNum < 0) return null;
  if ((pkg === 'single' || pkg === 'free') && !idRaw) return null;
  return {
    id: pkg === 'full' ? null : idRaw,
    title,
    package: pkg,
    price: Math.round(priceNum),
  };
}

export function readPreviewTrigger(trigger: HTMLElement): PreviewTemplateInfo | null {
  const id = (trigger.dataset.previewId ?? '').trim();
  const title = (trigger.dataset.previewTitle ?? '').trim();
  const src = (trigger.getAttribute('data-src') ?? '').trim();
  if (!id || !title || !src) return null;
  const widthNum = Number(trigger.dataset.previewWidth ?? '1080');
  const heightNum = Number(trigger.dataset.previewHeight ?? '1528');
  const priceNum = Number(trigger.dataset.previewPrice ?? '0');
  const free = trigger.dataset.previewFree === '1';
  const hrefRaw = (trigger.getAttribute('data-href') ?? '').trim();
  const hasDocx = trigger.dataset.previewDocx === '1';
  return {
    id,
    title,
    src,
    width: Number.isFinite(widthNum) && widthNum > 0 ? Math.round(widthNum) : 1080,
    height: Number.isFinite(heightNum) && heightNum > 0 ? Math.round(heightNum) : 1528,
    price: Number.isFinite(priceNum) && priceNum >= 0 ? Math.round(priceNum) : 0,
    free,
    fileHref: free && hrefRaw ? hrefRaw : null,
    hasDocx,
  };
}

function openDialogElement(dialog: HTMLDialogElement): void {
  if (dialog.hasAttribute('open')) return;
  if (typeof dialog.showModal === 'function') {
    try {
      dialog.showModal();
      return;
    } catch {
      /* В тестовых средах без полной поддержки HTMLDialogElement открываем атрибутом. */
    }
  }
  dialog.setAttribute('open', '');
}

function closeDialogElement(dialog: HTMLDialogElement): void {
  if (!dialog.hasAttribute('open')) return;
  if (typeof dialog.close === 'function') {
    try {
      dialog.close();
      return;
    } catch {
      /* Fallback для окружений без dialog.close(). */
    }
  }
  dialog.removeAttribute('open');
}

export function wireTemplateModal(doc: Document = document): void {
  const modal = doc.getElementById('template-lead-modal') as HTMLDialogElement | null;
  const form = doc.getElementById('template-lead-form') as HTMLFormElement | null;
  const previewModal = doc.getElementById('template-preview-modal') as HTMLDialogElement | null;
  if (!modal || !form) return;
  if (modal.dataset.templateModalWired === '1') return;
  modal.dataset.templateModalWired = '1';

  const badgeEl = modal.querySelector<HTMLElement>('[data-template-modal-badge]');
  const docTitleEl = modal.querySelector<HTMLElement>('[data-template-modal-doc]');
  const priceEl = modal.querySelector<HTMLElement>('[data-template-modal-price]');
  const emailOptEl = modal.querySelector<HTMLElement>('[data-template-email-opt]');
  const emailInputEl = form.querySelector<HTMLInputElement>('[name="email"]');
  const successBox = modal.querySelector<HTMLElement>('[data-lead-success]');
  const errorBox = modal.querySelector<HTMLElement>('[data-lead-error]');
  let lastTrigger: HTMLElement | null = null;

  /* Элементы лайтбокса предпросмотра первой страницы */
  const previewBadgeEl = previewModal?.querySelector<HTMLElement>('[data-preview-modal-badge]') ?? null;
  const previewTitleEl = previewModal?.querySelector<HTMLElement>('[data-preview-modal-title]') ?? null;
  const previewViewportEl = previewModal?.querySelector<HTMLElement>('[data-preview-viewport]') ?? null;
  const previewImgEl = previewModal?.querySelector<HTMLImageElement>('[data-preview-modal-img]') ?? null;
  const previewCaptionEl = previewModal?.querySelector<HTMLElement>('[data-preview-modal-caption]') ?? null;
  const previewZoomBtn = previewModal?.querySelector<HTMLButtonElement>('[data-preview-zoom]') ?? null;
  const previewOrderBtn = previewModal?.querySelector<HTMLButtonElement>('[data-preview-order]') ?? null;
  const previewDownloadLink = previewModal?.querySelector<HTMLAnchorElement>('[data-preview-download]') ?? null;
  const previewCloseBtn = previewModal?.querySelector<HTMLButtonElement>('[data-close-preview]') ?? null;
  let lastPreviewTrigger: HTMLElement | null = null;
  let currentPreview: PreviewTemplateInfo | null = null;
  let zoomed = false;

  const setZoom = (nextZoomed: boolean): void => {
    zoomed = nextZoomed;
    if (previewViewportEl) {
      previewViewportEl.classList.toggle('is-zoomed', zoomed);
    }
    if (previewZoomBtn) {
      previewZoomBtn.setAttribute('aria-pressed', String(zoomed));
      previewZoomBtn.textContent = zoomed ? 'По ширине окна −' : 'Крупнее для чтения +';
    }
  };

  const resetModalState = (): void => {
    form.hidden = false;
    if (successBox) {
      successBox.hidden = true;
      successBox.classList.remove('visible');
    }
    if (errorBox) {
      errorBox.hidden = true;
      errorBox.textContent = '';
    }
    form.querySelectorAll<HTMLElement>('[data-error]').forEach((el) => {
      el.hidden = true;
      el.textContent = '';
    });
    form.querySelectorAll<HTMLElement>('[aria-invalid]').forEach((el) => {
      el.classList.remove('error');
      el.removeAttribute('aria-invalid');
    });
  };

  const openFor = (info: SelectedTemplateInfo, trigger: HTMLElement | null): void => {
    lastTrigger = trigger;
    resetModalState();
    form.dataset.template = JSON.stringify({
      id: info.id,
      title: info.title,
      package: info.package,
      price: info.price,
    });
    if (badgeEl) {
      badgeEl.textContent =
        info.package === 'full'
          ? 'Полный набор · 64 документа'
          : info.package === 'free'
            ? `Шаблон № ${info.id} · запрос DOCX`
            : `Платный шаблон · № ${info.id}`;
    }
    if (docTitleEl) docTitleEl.textContent = info.title;
    if (priceEl) {
      priceEl.textContent =
        info.package === 'free' ? 'Бесплатный PDF · запрос DOCX' : `${info.price.toLocaleString('ru-RU')} ₽`;
    }
    if (emailInputEl) {
      emailInputEl.required = info.package === 'free';
    }
    if (emailOptEl) {
      emailOptEl.textContent = info.package === 'free' ? '*' : '(по желанию)';
    }

    openDialogElement(modal);

    const firstInput = form.querySelector<HTMLInputElement>('[name="name"]');
    firstInput?.focus({ preventScroll: true });
  };

  const closeModal = (): void => {
    closeDialogElement(modal);
    lastTrigger?.focus({ preventScroll: true });
  };

  const openPreview = (info: PreviewTemplateInfo, trigger: HTMLElement | null): void => {
    if (!previewModal) return;
    currentPreview = info;
    lastPreviewTrigger = trigger;
    setZoom(false);

    if (previewBadgeEl) {
      previewBadgeEl.textContent = `№ ${info.id} · ${info.free ? 'Бесплатно' : `${info.price.toLocaleString('ru-RU')} ₽`}`;
      previewBadgeEl.classList.toggle('is-free', info.free);
    }
    if (previewTitleEl) {
      previewTitleEl.textContent = info.title;
    }
    if (previewImgEl) {
      previewImgEl.src = info.src;
      previewImgEl.alt = `Первая страница шаблона № ${info.id} «${info.title}»`;
      previewImgEl.width = info.width;
      previewImgEl.height = info.height;
    }
    if (previewCaptionEl) {
      previewCaptionEl.textContent = info.hasDocx ? DOCX_PREVIEW_CAPTION : STANDARD_PREVIEW_CAPTION;
    }
    if (previewDownloadLink) {
      if (info.free && info.fileHref) {
        previewDownloadLink.hidden = false;
        previewDownloadLink.setAttribute('href', info.fileHref);
      } else {
        previewDownloadLink.hidden = true;
        previewDownloadLink.removeAttribute('href');
      }
    }
    if (previewOrderBtn) {
      previewOrderBtn.hidden = false;
      previewOrderBtn.classList.toggle('is-secondary', info.free);
      previewOrderBtn.textContent = info.free
        ? 'Запросить DOCX'
        : `Оставить заявку · ${info.price.toLocaleString('ru-RU')} ₽`;
    }

    openDialogElement(previewModal);
    if (previewViewportEl) {
      previewViewportEl.scrollTop = 0;
      previewViewportEl.scrollLeft = 0;
    }
    previewCloseBtn?.focus({ preventScroll: true });
  };

  const closePreview = (restoreFocus = true): void => {
    if (!previewModal) return;
    closeDialogElement(previewModal);
    if (restoreFocus) {
      lastPreviewTrigger?.focus({ preventScroll: true });
    }
  };

  doc.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    const previewBtn = target.closest<HTMLElement>('[data-open-preview]');
    if (previewBtn) {
      const info = readPreviewTrigger(previewBtn);
      if (!info) return;
      e.preventDefault();
      openPreview(info, previewBtn);
      return;
    }

    if (target.closest('[data-close-preview]')) {
      e.preventDefault();
      closePreview(true);
      return;
    }

    if (target.closest('[data-preview-zoom]')) {
      e.preventDefault();
      setZoom(!zoomed);
      return;
    }

    if (target.closest('[data-preview-order]')) {
      e.preventDefault();
      if (!currentPreview) return;
      const item = currentPreview;
      const originTrigger = lastPreviewTrigger;
      closePreview(false);
      openFor(
        {
          id: item.id,
          title: item.title,
          package: item.free ? 'free' : 'single',
          price: item.free ? 0 : item.price,
        },
        originTrigger,
      );
      return;
    }

    const openBtn = target.closest<HTMLElement>('[data-open-template]');
    if (openBtn) {
      const info = readTriggerTemplate(openBtn);
      if (!info) return;
      e.preventDefault();
      openFor(info, openBtn);
      return;
    }

    if (target.closest('[data-close-template]')) {
      e.preventDefault();
      closeModal();
    }
  });

  /* Клик по самому листу предпросмотра переключает масштаб чтения */
  previewImgEl?.addEventListener('click', () => {
    setZoom(!zoomed);
  });

  /* Закрытие по клику на затемнённый фон вне панели модального окна */
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  modal.addEventListener('close', () => {
    lastTrigger?.focus({ preventScroll: true });
  });

  previewModal?.addEventListener('click', (e) => {
    if (e.target === previewModal) closePreview(true);
  });

  previewModal?.addEventListener('close', () => {
    lastPreviewTrigger?.focus({ preventScroll: true });
  });

  /* Явная обработка клавиши Esc (и для браузеров, и для тестовых DOM-сред) */
  doc.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (modal.hasAttribute('open')) {
      e.preventDefault();
      closeModal();
      return;
    }
    if (previewModal?.hasAttribute('open')) {
      e.preventDefault();
      closePreview(true);
    }
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => wireTemplateModal());
  } else {
    wireTemplateModal();
  }
}
