/**
 * Проверенный серверный каталог платных кадровых шаблонов.
 *
 * Пока автоматической оплаты и выдачи из R2 нет, Мария получает заявку
 * в Telegram и на почту и отправляет документ покупателю вручную.
 * Публичная сборка сайта НЕ содержит DOCX и PDF платных документов — только
 * водяные превью первой страницы. Поэтому в уведомлении Марии ссылка на старый
 * PDF из публичного GitHub помечена как ориентир: покупателю Мария отправляет
 * редактируемый DOCX вручную после согласования оплаты и собственной проверки
 * документа (юридическая приёмка комплекта автоматикой не подтверждена).
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

/**
 * Комплект редактируемых DOCX для № 01–10 — манифест с закреплёнными хешами.
 *
 * Что здесь доказано: файлы существуют и их содержимое зафиксировано (SHA-256
 * каждого файла снят с комплекта `agents/agent-02/docx-01-10` коммита
 * c70ac32e5f54404483357e33f0bc2de0f9ee315d) и побайтово соответствует
 * опубликованным превью 01.jpg–10.jpg. Хеши лежат прямо в коде, чтобы проверки
 * не зависели от чужой ветки: удаление ветки не должно ломать деплой relay.
 *
 * Что здесь НЕ доказано: юридическая и визуальная приёмка документов владельцем.
 * Поэтому нигде (ни в лайтбоксе, ни в уведомлении) не обещается «актуальный»
 * DOCX: Мария перед отправкой сама проверяет документ и присылает его вручную.
 */
export interface DocxPackageEntry {
  readonly id: string;
  readonly filename: string;
  /** SHA-256 файла в комплекте 01–10. */
  readonly sha256: string;
}

export const DOCX_PACKAGE_COMMIT = 'c70ac32e5f54404483357e33f0bc2de0f9ee315d';

export const DOCX_PACKAGE: readonly DocxPackageEntry[] = [
  { id: '01', filename: '01_Бессрочный_трудовой_договор.docx', sha256: '72538e6581f8e1c4e538775413bc87523abeeb96c4bed9a5c9862bdc5d6ed74f' },
  { id: '02', filename: '02_Срочный_трудовой_договор.docx', sha256: '16cb14a04885b3b784c30d9903005205beb28b7b0268d5cf089cea40458414ea' },
  { id: '03', filename: '03_Полная_индивидуальная_материальная_ответственность.docx', sha256: '8a81dc4a621052f3fc27a28bf7d50fb691129dcf6d9dc46f50231e5f66103bac' },
  { id: '04', filename: '04_Трудовой_договор_с_иностранным_работником.docx', sha256: 'efab165eeb52288ae90d3fd42ae564dbe7d30c11b6cac59b80bc9be6469e1ac3' },
  { id: '05', filename: '05_Трудовой_договор_о_дистанционной_работе.docx', sha256: 'ea0b3591b249cdda6932a9cbfe65b2975166cce3e6046e575ce08f1fb45d6539' },
  { id: '06', filename: '06_Трудовой_договор_на_неполное_рабочее_время.docx', sha256: 'e159e2dd88f913a476bfb22a48384a11f348b7fbe31a745ed83265cd9185d116' },
  { id: '07', filename: '07_Трудовой_договор_с_ненормированным_рабочим_днём.docx', sha256: 'c76da310bec7092079e13520eed0bb9eb6eb83bd2ebbf64cbe52bc98ddbe8af3' },
  { id: '08', filename: '08_Трудовой_договор_с_руководителем_организации.docx', sha256: 'a4f05e79f126b4c3e5ad840f1ab6cefc7b44ee92da7b3c4b4fce2875a04b84ed' },
  { id: '09', filename: '09_Трудовой_договор_по_совместительству.docx', sha256: '50280b5351df3878884774e7094b1a7205dcf7b46744533bb90e6b7904b8c556' },
  { id: '10', filename: '10_Сезонный_трудовой_договор.docx', sha256: 'bcdca5ebfa83263b3092ec9bee2c83e24267e94f762cbf02dc208e69816ee266' },
];

/** Позиции, для которых комплект DOCX существует (№ 01–10). */
export const DOCX_READY_IDS: ReadonlySet<string> = new Set(DOCX_PACKAGE.map((entry) => entry.id));

/** Есть ли DOCX для позиции каталога (01…64). */
export function hasConfirmedDocx(id: string | null | undefined): boolean {
  if (!id) return false;
  return DOCX_READY_IDS.has(String(id).replace(/^t/i, '').padStart(2, '0'));
}

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
  'Ссылка только для удобства Марии — ведёт на публичный GitHub (коммит ac75af6, не защищённая выдача и не секрет; покупателю не показывается). Это СТАРЫЙ PDF, а не редактируемый DOCX: что отправить покупателю — в задании ниже.';

/**
 * Что именно делать Марии — одинаково в Telegram и в письме.
 *
 * ВАЖНО: обещание DOCX даётся только там, где он подтверждён (№ 01–10). Для
 * остальных 34 платных позиций в репозитории есть лишь старый PDF образца
 * 27.03.2026, поэтому задание звучит иначе — отправить проверенный PDF,
 * а DOCX обещать нельзя.
 */
export const MARIA_DOCX_HANDOFF_NOTE =
  'Вышлите покупателю редактируемый DOCX из комплекта 01–10 вручную после согласования оплаты — в открытой сборке DOCX нет. Перед отправкой проверьте документ: юридическая приёмка комплекта за вами.';

export const MARIA_FREE_DOCX_HANDOFF_NOTE =
  'Клиент просит DOCX бесплатного шаблона (PDF он скачивает сам): отправьте ему редактируемый DOCX из комплекта 01–10 вручную на почту — в открытой сборке DOCX нет. Перед отправкой проверьте документ.';

export const MARIA_LEGACY_PDF_HANDOFF_NOTE =
  'DOCX для этой позиции не подтверждён: в репозитории есть только PDF образца 27.03.2026. Отправьте покупателю проверенный PDF (ссылка выше) и не обещайте редактируемый DOCX, пока комплект не выложен.';

export const FULL_BUNDLE_HANDOFF_NOTE =
  'Архива полного набора в репозитории нет: соберите комплект вручную после согласования оплаты и отправьте покупателю.';

/** Задание для Марии по конкретной заявке на шаблон. */
export function templateHandoffNote(req: TemplateRequest): string {
  if (req.package === 'full') return FULL_BUNDLE_HANDOFF_NOTE;
  if (req.package === 'free') {
    return hasConfirmedDocx(req.id) ? MARIA_FREE_DOCX_HANDOFF_NOTE : MARIA_LEGACY_PDF_HANDOFF_NOTE;
  }
  if (req.package === 'email') {
    return 'Пакет из 25 шаблонов за email: соберите архив вручную после согласования и отправьте на почту покупателю.';
  }
  return hasConfirmedDocx(req.id) ? MARIA_DOCX_HANDOFF_NOTE : MARIA_LEGACY_PDF_HANDOFF_NOTE;
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
  /** Существует ли редактируемый DOCX для позиции (комплект № 01–10). */
  docxReady: boolean;
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
      docxReady: false,
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
      docxReady: hasConfirmedDocx(req.id),
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
      docxReady: false,
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
    docxReady: hasConfirmedDocx(entry.id),
  };
}
