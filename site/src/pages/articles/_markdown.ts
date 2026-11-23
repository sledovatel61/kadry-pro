/**
 * Разбор текста статей «Полезное»: Markdown → HTML и подстановка цен (Агент 03).
 *
 * Живёт рядом со страницами статей, потому что нужен только им и гейту
 * `site/scripts/check-articles.mjs`. Отдельным файлом не выносим: у каждой папки
 * в проекте один хозяин, а `site/src/pages/articles/*` — зона Агента 03.
 *
 * Две задачи:
 *   1. Безопасный Markdown: абзацы, `##`/`###`, списки, `**жирный**`, `*курсив*`,
 *      `` `код` ``, таблицы GFM, ссылки http(s)/mailto/tel. Сырой HTML экранируется —
 *      текст пишет Мария в кабинете, и он не должен уметь вставлять скрипты.
 *   2. Цены: в тексте `{{price:audit.express}}`, число берётся из `prices.json`
 *      (его ведёт Агент 02). Цена живёт в одном месте, статьи не хардкодят суммы.
 *      Неизвестный id честно показывает «по запросу», а гейт ловит его до публикации.
 *
 * `prices.json` понимаем в двух формах — группой и плоским списком; так статья
 * не сломается, какую бы форму ни выбрал Агент 02.
 */

interface AnyRecord {
  [key: string]: unknown;
}

const asRecord = (value: unknown): AnyRecord =>
  (typeof value === 'object' && value !== null && !Array.isArray(value) ? value as AnyRecord : {});

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

const asNumber = (value: unknown): number | null =>
  (typeof value === 'number' && Number.isFinite(value) ? value : null);

interface Entry {
  id: string;
  title: string;
  price: number | null;
}

/** Все позиции прайса плоским списком: `группа.позиция`, `группа`, короткий id. */

export interface PriceLookup {
  /** id позиции прайса → цена в рублях; null — цена «по запросу». */
  price(id: string): number | null;
  /** Подпись для title, например «Аудит, экспресс». */
  title?(id: string): string;
}

export function priceEntries(raw: unknown): Entry[] {
  const root = asRecord(raw);
  const out: Entry[] = [];

  const pushItem = (group: AnyRecord, item: AnyRecord, index: number): void => {
    const itemId = asString(item.id) || `item-${index + 1}`;
    const groupId = asString(group.id);
    const groupTitle = asString(group.title) || groupId;
    const name = asString(item.name) || itemId;
    const price = asNumber(item.price) ?? asNumber(item.amount);
    const title = groupTitle ? `${groupTitle}: ${name}` : name;
    if (groupId) out.push({ id: `${groupId}.${itemId}`, title, price });
    out.push({ id: itemId, title, price });
  };

  if (Array.isArray(root.groups)) {
    root.groups.forEach((rawGroup, gi) => {
      const group = asRecord(rawGroup);
      if (!Array.isArray(group.items)) return;
      group.items.forEach((rawItem, ii) => pushItem(group, asRecord(rawItem), ii));
      if (!group.items.length) out.push({ id: asString(group.id) || `group-${gi + 1}`, title: asString(group.title), price: null });
    });
  } else if (Array.isArray(root.items)) {
    root.items.forEach((rawItem, ii) => {
      const item = asRecord(rawItem);
      const id = asString(item.id) || `item-${ii + 1}`;
      out.push({ id, title: asString(item.name) || id, price: asNumber(item.price) ?? asNumber(item.amount) });
    });
  }

  return out;
}

/**
 * Собрать `PriceLookup` из JSON прайса. Повторяющиеся короткие id отбрасываются:
 * неоднозначная цена хуже, чем честное «по запросу».
 */
export function priceLookupFrom(raw: unknown): PriceLookup {
  const full = new Map<string, Entry>();
  const short = new Map<string, Entry | null>();
  for (const entry of priceEntries(raw)) {
    if (!full.has(entry.id)) full.set(entry.id, entry);
    if (entry.id.includes('.')) continue;
    short.set(entry.id, short.has(entry.id) ? null : entry);
  }

  const find = (rawId: string): Entry | undefined => {
    const id = String(rawId ?? '').trim().toLowerCase();
    if (!id) return undefined;
    const direct = full.get(id) ?? full.get(rawId);
    if (direct) return direct;
    const small = short.get(id);
    return small ?? undefined;
  };

  return {
    price(id: string): number | null {
      const entry = find(id);
      return entry && entry.price !== null ? entry.price : null;
    },
    title(id: string): string {
      return find(id)?.title ?? String(id ?? '');
    },
  };
}

/** Прочитать `prices.json` из строки; битый JSON — честная пустая подстановка. */
export function priceLookup(jsonText: string): PriceLookup {
  try {
    return priceLookupFrom(JSON.parse(jsonText));
  } catch {
    return {
      price: () => null,
      title: (id: string) => String(id ?? ''),
    };
  }
}

/** Все известные id — для подсказок в кабинете и проверки статей. */
export function knownPriceIds(raw: unknown): string[] {
  return [...new Set(priceEntries(raw).map((e) => e.id))];
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 14900 → «14 900 ₽» (неразрывный пробел перед ₽ и в разрядах). */
export function formatRub(value: number): string {
  const rounded = Math.round(value);
  const digits = Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  return `${rounded < 0 ? '−' : ''}${digits}\u00a0₽`;
}

/**
 * Токен цены: `{{price:audit.express}}` → «7 900 ₽», `{{price:audit.express|от}}` → «от 7 900 ₽».
 * Неизвестный id превращается в видимую отметку, а не в пустоту: гейт
 * `check-articles.mjs` ловит такие токены до публикации.
 */
function priceToken(id: string, prefixRaw: string, prices: PriceLookup | null): string {
  const prefix = prefixRaw ? prefixRaw.trim() + '\u00a0' : '';
  if (!prices) return `<span class="price-token" data-price="${esc(id)}">${prefix}—&nbsp;₽</span>`;
  const value = prices.price(id);
  if (value === null || !Number.isFinite(value)) {
    return `<span class="price-token" data-price="${esc(id)}">${prefix}по&nbsp;запросу</span>`;
  }
  const title = prices.title?.(id) ?? '';
  return `<span class="price-token"${title ? ` title="${esc(title)}"` : ''}>${prefix}${formatRub(value)}</span>`;
}

function inline(s: string, prices: PriceLookup | null): string {
  let out = esc(s);
  /* Токены цен — до экранирования знаков разметки, но разметку внутри токена
     никто не ставит; порядок важен только для `**` вокруг цены. */
  out = out.replace(/\{\{price:([a-z0-9_.-]+)(?:\|([^}]*))?\}\}/gi, (_m, id: string, prefix: string) =>
    priceToken(id, prefix ?? '', prices));
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) => {
    if (/^(https?:\/\/|mailto:|tel:|\/)/i.test(url)) {
      const rel = /^https?:\/\//i.test(url) ? ' rel="noopener noreferrer nofollow" target="_blank"' : '';
      return `<a href="${url}"${rel}>${text}</a>`;
    }
    return text;
  });
  return out;
}

/** Транслитерация заголовка в id — та же, что в `articleToc` (иначе ссылки не найдут якорь). */
export function slugHeading(text: string): string {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
    х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };
  return text.toLowerCase().split('').map((c) => map[c] ?? c).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '') || 'razdel';
}

const isRow = (line: string): boolean => /^\|.*\|$/.test(line.trim());
const cells = (line: string): string[] =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isSep = (line: string): boolean => isRow(line) && cells(line).every((c) => /^:?-{2,}:?$/.test(c));

export function mdToHtml(md: string, prices: PriceLookup | null = null): string {
  const lines = String(md ?? '').replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  const usedIds = new Map<string, number>();
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  let lastLi = -1;

  const closeList = () => { if (list) { html.push(`</${list}>`); list = null; lastLi = -1; } };
  const closePara = () => { if (para.length) { html.push(`<p>${inline(para.join(' '), prices)}</p>`); para = []; } };
  const heading = (level: number, text: string) => {
    const base = slugHeading(text.replace(/[*_`]/g, ''));
    const n = (usedIds.get(base) ?? 0) + 1;
    usedIds.set(base, n);
    const id = n === 1 ? base : `${base}-${n}`;
    const tag = level <= 2 ? 'h2' : 'h3';
    html.push(`<${tag} id="${id}">${inline(text, prices)}</${tag}>`);
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trimEnd();
    if (!line.trim()) { closeList(); closePara(); continue; }

    /* Таблица: строка |…|, под ней |---|, затем строки тела. */
    if (isRow(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
      closeList(); closePara();
      const head = cells(line);
      const body: string[][] = [];
      let j = i + 2;
      while (j < lines.length && isRow(lines[j])) { body.push(cells(lines[j])); j += 1; }
      html.push(
        '<div class="post-table-wrap"><table class="post-table"><thead><tr>'
        + head.map((c) => `<th>${inline(c, prices)}</th>`).join('')
        + '</tr></thead><tbody>'
        + body.map((row) => `<tr>${head.map((_h, k) => `<td>${inline(row[k] ?? '', prices)}</td>`).join('')}</tr>`).join('')
        + '</tbody></table></div>',
      );
      i = j - 1;
      continue;
    }

    const h = /^(#{2,3})\s+(.*)$/.exec(line);
    if (h) { closeList(); closePara(); heading(h[1].length, h[2]); continue; }

    if (/^>\s?/.test(line)) { closeList(); closePara(); html.push(`<blockquote>${inline(line.replace(/^>\s?/, ''), prices)}</blockquote>`); continue; }

    const ul = /^[-*]\s+(.*)$/.exec(line);
    if (ul) {
      closePara();
      if (list !== 'ul') { closeList(); html.push('<ul>'); list = 'ul'; }
      html.push(`<li>${inline(ul[1], prices)}</li>`);
      lastLi = html.length - 1;
      continue;
    }
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ol) {
      closePara();
      if (list !== 'ol') { closeList(); html.push('<ol>'); list = 'ol'; }
      html.push(`<li>${inline(ol[1], prices)}</li>`);
      lastLi = html.length - 1;
      continue;
    }
    /* Продолжение пункта с отступом — склеиваем с предыдущим li. */
    if (list && lastLi >= 0 && /^\s{2,}\S/.test(raw)) {
      html[lastLi] = html[lastLi].replace(/<\/li>$/, ` ${inline(line.trim(), prices)}</li>`);
      continue;
    }
    closeList();
    para.push(line.trim());
  }
  closeList(); closePara();
  return html.join('\n');
}

/** Чистый текст анонса: снимает markdown-разметку и токены цен. */
export function plainText(md: string, limit = 0): string {
  let out = String(md ?? '')
    .replace(/\{\{price:([a-z0-9_.-]+)(?:\|([^}]*))?\}\}/gi, '$2')
    .replace(/^#{2,3}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (limit > 0 && out.length > limit) {
    const cut = out.slice(0, limit);
    const at = cut.lastIndexOf(' ');
    out = (at > limit * 0.6 ? cut.slice(0, at) : cut).replace(/[,;:.\-–—]$/, '') + '…';
  }
  return out;
}

/** Список id цен, использованных в тексте — для гейта «все токены существуют». */
export function priceTokensIn(md: string): string[] {
  const out = new Set<string>();
  const re = /\{\{price:([a-z0-9_.-]+)(?:\|[^}]*)?\}\}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(md ?? ''))) !== null) out.add(m[1].toLowerCase());
  return [...out];
}
