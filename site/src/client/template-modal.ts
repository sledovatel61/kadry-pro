/**
 * Модальное окно заявки на конкретный платный шаблон (или весь набор) на /shablony.html.
 *
 * Оплаты и автоматической выдачи на сайте пока нет: форма передаёт выбранный
 * шаблон в единый модуль `leads-form.ts` (`data-lead-kind="template"`), а
 * сервер `relay/` сверяет цену и название по собственному каталогу и присылает
 * уведомление Марии в Telegram и на почту.
 */

export interface SelectedTemplateInfo {
  id: string | null;
  title: string;
  package: 'single' | 'full';
  price: number;
}

export function readTriggerTemplate(trigger: HTMLElement): SelectedTemplateInfo | null {
  const pkgRaw = (trigger.dataset.templatePackage ?? 'single').trim();
  const pkg: 'single' | 'full' = pkgRaw === 'full' ? 'full' : 'single';
  const idRaw = (trigger.dataset.templateId ?? '').trim();
  const title = (trigger.dataset.templateTitle ?? '').trim();
  const priceNum = Number(trigger.dataset.templatePrice ?? '0');
  if (!title || !Number.isFinite(priceNum) || priceNum < 0) return null;
  if (pkg === 'single' && !idRaw) return null;
  return {
    id: pkg === 'full' ? null : idRaw,
    title,
    package: pkg,
    price: Math.round(priceNum),
  };
}

export function wireTemplateModal(doc: Document = document): void {
  const modal = doc.getElementById('template-lead-modal') as HTMLDialogElement | null;
  const form = doc.getElementById('template-lead-form') as HTMLFormElement | null;
  if (!modal || !form) return;
  if (modal.dataset.templateModalWired === '1') return;
  modal.dataset.templateModalWired = '1';

  const badgeEl = modal.querySelector<HTMLElement>('[data-template-modal-badge]');
  const docTitleEl = modal.querySelector<HTMLElement>('[data-template-modal-doc]');
  const priceEl = modal.querySelector<HTMLElement>('[data-template-modal-price]');
  const successBox = modal.querySelector<HTMLElement>('[data-lead-success]');
  const errorBox = modal.querySelector<HTMLElement>('[data-lead-error]');
  let lastTrigger: HTMLElement | null = null;

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
      badgeEl.textContent = info.package === 'full'
        ? 'Полный набор · 64 документа'
        : `Платный шаблон · № ${info.id}`;
    }
    if (docTitleEl) docTitleEl.textContent = info.title;
    if (priceEl) priceEl.textContent = `${info.price.toLocaleString('ru-RU')} ₽`;

    if (typeof modal.showModal === 'function') modal.showModal();
    else modal.setAttribute('open', '');

    const firstInput = form.querySelector<HTMLInputElement>('[name="name"]');
    firstInput?.focus({ preventScroll: true });
  };

  const closeModal = (): void => {
    if (typeof modal.close === 'function' && modal.hasAttribute('open')) modal.close();
    else modal.removeAttribute('open');
    lastTrigger?.focus({ preventScroll: true });
  };

  doc.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
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

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  modal.addEventListener('close', () => {
    lastTrigger?.focus({ preventScroll: true });
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => wireTemplateModal());
  } else {
    wireTemplateModal();
  }
}
