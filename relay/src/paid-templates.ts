/**
 * Проверенный серверный каталог платных кадровых шаблонов.
 *
 * Пока автоматической оплаты и выдачи из R2 нет, Мария получает заявку
 * в Telegram и на почту и отправляет документ покупателю вручную.
 * Публичная сборка сайта НЕ содержит DOCX и PDF платных документов — только
 * водяные превью первой страницы. Поэтому в уведомлении Марии ссылка на старый
 * PDF из публичного GitHub помечена как ориентир: покупателю нужно отправить
 * актуальный редактируемый DOCX вручную после согласования оплаты.
 *
 * Правила безопасности:
 *   1. Название, цена и имя файла берутся ТОЛЬКО из этого серверного списка
 *      (цене и произвольным ссылкам из браузера не доверяем).
 *   2. Прямая ссылка ведёт на фиксированный коммит в публичном GitHub,
 *      в котором проверено наличие всех 44 PDF. После удаления shablony/*.pdf
 *      из ветки main при выпуске сайта ссылки для Марии продолжат работать.
 *   3. Для неизвестного ID (включая бесплатные ID) и для полного пакета
 *      ссылка НЕ формируется: проверенного архива из 64 документов в git нет
 *      (есть только free-bundle-20.zip на 20 бесплатных и email-bundle.zip на 25).
 *   4. Ссылка предназначена только для удобства Марии и никогда не возвращается
 *      покупателю в ответе /leads.
 */
import type { TemplatePackage, TemplateRequest } from './validate.ts';

export const PAID_TEMPLATES_REPO = 'sledovatel61/kadry-pro';
export const PAID_TEMPLATES_COMMIT = 'ac75af6c9352be4c874cc84650e0401c59216e7c';

export interface PaidTemplateEntry {
  readonly id: string;
  readonly title: string;
  readonly price: number;
  readonly filename: string;
}

export const FULL_BUNDLE_OFFER = {
  title: 'Полный набор из 64 шаблонов',
  price: 3500,
} as const;

export const PAID_TEMPLATES: readonly PaidTemplateEntry[] = [
  { id: '02', title: 'Срочный трудовой договор', price: 500, filename: '02_Срочный_трудовой_договор.pdf' },
  { id: '03', title: 'Договор с материальной ответственностью', price: 500, filename: '03_Договор_с_мат_ответственностью.pdf' },
  { id: '04', title: 'Договор с иностранным гражданином', price: 500, filename: '04_Договор_с_иностранцем.pdf' },
  { id: '05', title: 'Договор с удалённым сотрудником', price: 500, filename: '05_Договор_с_удаленным.pdf' },
  { id: '06', title: 'Договор на 0,5 ставки', price: 500, filename: '06_Договор_0_5_ставки.pdf' },
  { id: '07', title: 'Договор с ненормированным рабочим днём', price: 500, filename: '07_Договор_ненормированный_день.pdf' },
  { id: '08', title: 'Договор с директором (генеральным директором)', price: 500, filename: '08_Договор_с_директором.pdf' },
  { id: '09', title: 'Договор с совместителем', price: 500, filename: '09_Договор_с_совместителем.pdf' },
  { id: '10', title: 'Сезонный трудовой договор', price: 500, filename: '10_Сезонный_трудовой_договор.pdf' },
  { id: '14', title: 'Приказ об увольнении за прогул', price: 500, filename: '14_Prikaz_ob_uvolnenii_za_progul.pdf' },
  { id: '15', title: 'Приказ о переводе на другую должность', price: 500, filename: '15_Prikaz_o_perevode_na_druguyu_dolzhnost.pdf' },
  { id: '16', title: 'Приказ о дисциплинарном взыскании', price: 500, filename: '16_Prikaz_o_disciplinarnom_vzyskanii.pdf' },
  { id: '18', title: 'Приказ об учебном отпуске', price: 500, filename: '18_Prikaz_o_uchebnom_otpuske.pdf' },
  { id: '20', title: 'Приказ о временном переводе', price: 500, filename: '20_Prikaz_o_vremennom_perevode.pdf' },
  { id: '21', title: 'Приказ о командировке', price: 500, filename: '21_Prikaz_o_komandirovke.pdf' },
  { id: '22', title: 'Приказ о присвоении разряда', price: 500, filename: '22_Prikaz_o_prisvoenii_razryada.pdf' },
  { id: '23', title: 'ПВТР — Правила внутреннего трудового распорядка', price: 500, filename: '23_ПВТР_Правила_внутреннего_трудового_распорядка.pdf' },
  { id: '24', title: 'Положение об оплате труда', price: 500, filename: '24_Положение_об_оплате_труда.pdf' },
  { id: '25', title: 'Положение о премировании', price: 500, filename: '25_Положение_о_премировании.pdf' },
  { id: '26', title: 'Положение об аттестации персонала', price: 500, filename: '26_Положение_об_аттестации_персонала.pdf' },
  { id: '28', title: 'Положение о персональных данных ФЗ-152', price: 500, filename: '28_Положение_о_персональных_данных_ФЗ-152.pdf' },
  { id: '30', title: 'Положение об охране труда', price: 500, filename: '30_Положение_об_охране_труда.pdf' },
  { id: '31', title: 'Положение о воинском учёте', price: 500, filename: '31_Положение_о_воинском_учете.pdf' },
  { id: '33', title: 'Должностная инструкция генерального директора', price: 500, filename: '33_Должностная_инструкция_генерального_директора.pdf' },
  { id: '34', title: 'Должностная инструкция бухгалтера', price: 500, filename: '34_Должностная_инструкция_бухгалтера.pdf' },
  { id: '35', title: 'Должностная инструкция менеджера по продажам', price: 500, filename: '35_Должностная_инструкция_менеджера_по_продажам.pdf' },
  { id: '36', title: 'Должностная инструкция администратора', price: 500, filename: '36_Должностная_инструкция_администратора.pdf' },
  { id: '38', title: 'Должностная инструкция кассира', price: 500, filename: '38_Должностная_инструкция_кассира.pdf' },
  { id: '39', title: 'Должностная инструкция охранника', price: 500, filename: '39_Должностная_инструкция_охранника.pdf' },
  { id: '41', title: 'Соглашение о материальной ответственности', price: 500, filename: '41_Соглашение_материальная_ответственность.pdf' },
  { id: '42', title: 'Соглашение о полной материальной ответственности', price: 500, filename: '42_Соглашение_полная_мат_ответственность.pdf' },
  { id: '44', title: 'Дополнительное соглашение к трудовому договору', price: 500, filename: '44_Дополнительное_соглашение_к_ТД.pdf' },
  { id: '45', title: 'Соглашение о расторжении трудового договора', price: 500, filename: '45_Соглашение_о_расторжении_ТД.pdf' },
  { id: '46', title: 'Соглашение об обучении и отработке', price: 500, filename: '46_Соглашение_об_обучении_и_отработке.pdf' },
  { id: '48', title: 'Соглашение о дистанционной работе', price: 500, filename: '48_Соглашение_о_дистанционной_работе.pdf' },
  { id: '52', title: 'Журнал материальной ответственности', price: 500, filename: '52_Журнал_материальной_ответственности.pdf' },
  { id: '53', title: 'Табель учёта рабочего времени Т-12', price: 500, filename: '53_Табель_учёта_рабочего_времени_Т12.pdf' },
  { id: '54', title: 'Личная карточка работника Т-2', price: 500, filename: '54_Личная_карточка_работника_Т2.pdf' },
  { id: '55', title: 'Формы воинского учёта 4 и 6', price: 500, filename: '55_Формы_воинского_учёта_4_6.pdf' },
  { id: '56', title: 'Карта СОУТ — спецоценка условий труда', price: 500, filename: '56_Карта_СОУТ_спецоценка.pdf' },
  { id: '59', title: 'Памятка — проверка ГИТ', price: 500, filename: '59_Памятка_проверка_ГИТ.pdf' },
  { id: '60', title: 'Памятка — воинский учёт', price: 500, filename: '60_Памятка_воинский_учёт.pdf' },
  { id: '61', title: 'Инструкция по заполнению ПВТР', price: 500, filename: '61_Инструкция_ПВТР.pdf' },
  { id: '62', title: 'Инструкция по заполнению трудового договора', price: 500, filename: '62_Инструкция_трудовой_договор.pdf' },
];

export const PAID_TEMPLATES_BY_ID: ReadonlyMap<string, PaidTemplateEntry> = new Map(
  PAID_TEMPLATES.map((entry) => [entry.id, entry]),
);

/** Прямая ссылка на PDF в фиксированном коммите GitHub (русские имена кодируются RFC 3986). */
export function buildPaidTemplateGithubUrl(entry: PaidTemplateEntry): string {
  return `https://raw.githubusercontent.com/${PAID_TEMPLATES_REPO}/${PAID_TEMPLATES_COMMIT}/shablony/${encodeURIComponent(entry.filename)}`;
}

export const MARIA_GITHUB_LINK_NOTE =
  'Ссылка только для удобства Марии — ведёт на публичный GitHub (коммит ac75af6, не защищённая выдача и не секрет; покупателю не показывается). Это СТАРЫЙ PDF, а не актуальный DOCX: что отправить покупателю — в задании ниже.';

/** Что именно делать Марии по заявке на платный шаблон — одинаково в Telegram и в письме. */
export const MARIA_DOCX_HANDOFF_NOTE =
  'Вышлите покупателю актуальный редактируемый DOCX вручную после согласования оплаты — в открытой сборке DOCX нет.';

export const MARIA_FREE_DOCX_HANDOFF_NOTE =
  'Клиент просит DOCX бесплатного шаблона (PDF он скачивает сам): отправьте ему актуальный редактируемый DOCX вручную на почту — в открытой сборке DOCX нет.';

/**
 * Одна и та же формулировка задания для Марии в Telegram и в письме.
 * Лайтбокс на сайте обещает редактируемый DOCX после заявки, поэтому
 * уведомление не должно выглядеть так, будто ответ клиенту — старый PDF.
 */
export function templateHandoffNote(pkg: TemplatePackage): string {
  return pkg === 'free' ? MARIA_FREE_DOCX_HANDOFF_NOTE : MARIA_DOCX_HANDOFF_NOTE;
}

export const FULL_BUNDLE_NO_ARCHIVE_NOTE =
  'Подтверждённого архива полного пакета (64 документа) в GitHub нет — ссылка не формируется, отправьте комплект вручную.';

export const UNKNOWN_TEMPLATE_NOTE =
  'ID шаблона не найден в проверенном серверном каталоге платных документов — ссылка не сформирована.';

export interface ResolvedTemplateNotice {
  /** Подтверждена ли позиция серверным каталогом. */
  known: boolean;
  /** Проверенный ID платного шаблона или исходный ID (для пометки Марии). */
  id: string | null;
  /** Название из серверного каталога (или присланное клиентом, если ID неизвестен). */
  title: string;
  /** Цена ТОЛЬКО из серверного каталога; null, если подтвердить по каталогу нельзя. */
  price: number | null;
  /** Проверенное имя PDF-файла в коммите (только для известных платных одиночных ID). */
  filename: string | null;
  /** Прямая ссылка на файл в фиксированном коммите GitHub (только для Марии). */
  githubUrl: string | null;
  /** Пояснение к ссылке (или причине её отсутствия) для уведомления Марии. */
  linkNote: string | null;
}

/** Сверка заявки на шаблон с серверным каталогом без доверия цене из браузера. */
export function resolveTemplateNotice(req: TemplateRequest): ResolvedTemplateNotice {
  if (req.package === 'full') {
    return {
      known: true,
      id: null,
      title: FULL_BUNDLE_OFFER.title,
      price: FULL_BUNDLE_OFFER.price,
      filename: null,
      githubUrl: null,
      linkNote: FULL_BUNDLE_NO_ARCHIVE_NOTE,
    };
  }

  if (req.package === 'email' || req.package === 'free') {
    return {
      known: true,
      id: req.id,
      title: req.title,
      price: 0,
      filename: null,
      githubUrl: null,
      linkNote: null,
    };
  }

  /* package === 'single': ищем строго в проверенном списке 44 платных ID. */
  const entry = req.id ? PAID_TEMPLATES_BY_ID.get(req.id) : undefined;
  if (!entry) {
    return {
      known: false,
      id: req.id,
      title: req.title,
      price: null,
      filename: null,
      githubUrl: null,
      linkNote: UNKNOWN_TEMPLATE_NOTE,
    };
  }

  return {
    known: true,
    id: entry.id,
    title: entry.title,
    price: entry.price,
    filename: entry.filename,
    githubUrl: buildPaidTemplateGithubUrl(entry),
    linkNote: MARIA_GITHUB_LINK_NOTE,
  };
}
