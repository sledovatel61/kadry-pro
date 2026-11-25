# -*- coding: utf-8 -*-
"""
docx_kit — минимальный конструктор редактируемых .docx для серии шаблонов
kadry-pro.ru (партия 01–10, правовой срез 24.11.2026).

Особенности:
* A4, поля 2,5 / 1,5 / 2 / 2 см, Times New Roman 10,5 пт, интерлиньяж 1,1.
* Блок «Примечание Марии Перепечай» — отдельная таблица с заливкой и
  утолщённой левой границей, чтобы визуально не смешиваться с текстом договора.
* Вариативные блоки («Вариант А / Вариант Б») — таблица со светлой заливкой.
* Никаких водяных знаков, цен, устаревших дат и ссылок на «неотъемлемые
  приложения» внутри файла.
"""

from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING, WD_TAB_ALIGNMENT
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.section import WD_SECTION
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

FONT = "Times New Roman"

NOTE_FILL = "FFF3E0"       # тёплый песочный — примечания
VARIANT_FILL = "EEF2F7"     # холодный серо-голубой — варианты
LINE = "B08968"             # акцентная линия примечания
VARIANT_LINE = "7A8CA3"
GREY_LINE = "808080"


# ---------------------------------------------------------------- низкий уровень
# ---------------------------------------------------------------- порядок по схеме
_PPR_SEQ = ["w:pStyle", "w:keepNext", "w:keepLines", "w:pageBreakBefore", "w:framePr",
            "w:widowControl", "w:numPr", "w:suppressLineNumbers", "w:pBdr", "w:shd",
            "w:tabs", "w:suppressAutoHyphens", "w:kinsoku", "w:wordWrap",
            "w:overflowPunct", "w:topLinePunct", "w:autoSpaceDE", "w:autoSpaceDN",
            "w:bidi", "w:adjustRightInd", "w:snapToGrid", "w:spacing", "w:ind",
            "w:contextualSpacing", "w:mirrorIndents", "w:suppressOverlap", "w:jc",
            "w:textDirection", "w:textAlignment", "w:textboxTightWrap",
            "w:outlineLvl", "w:divId", "w:cnfStyle", "w:rPr", "w:sectPr",
            "w:pPrChange"]

_TCPR_SEQ = ["w:cnfStyle", "w:tcW", "w:gridSpan", "w:hMerge", "w:vMerge",
             "w:tcBorders", "w:shd", "w:noWrap", "w:tcMar", "w:textDirection",
             "w:tcFitText", "w:vAlign", "w:hideMark", "w:headers", "w:cellIns",
             "w:cellDel", "w:cellMerge", "w:tcPrChange"]

_TBLPR_SEQ = ["w:tblStyle", "w:tblpPr", "w:tblOverlap", "w:bidiVisual",
              "w:tblStyleRowBandSize", "w:tblStyleColBandSize", "w:tblW", "w:jc",
              "w:tblCellSpacing", "w:tblInd", "w:tblBorders", "w:shd",
              "w:tblLayout", "w:tblCellMar", "w:tblLook", "w:tblCaption",
              "w:tblDescription", "w:tblPrChange"]


_TRPR_SEQ = ["w:cnfStyle", "w:divId", "w:gridBefore", "w:gridAfter", "w:wBefore",
             "w:wAfter", "w:cantSplit", "w:trHeight", "w:tblHeader",
             "w:tblCellSpacing", "w:jc", "w:hidden", "w:ins", "w:del",
             "w:trPrChange"]


def _put(parent, child, seq):
    """Вставить child в parent с соблюдением порядка элементов схемы OOXML."""
    tag = child.tag.split("}")[-1]
    qname = "w:" + tag
    for old in parent.findall(qn(qname)):
        parent.remove(old)
    idx = seq.index(qname)
    successors = seq[idx + 1:]
    parent.insert_element_before(child, *successors)


def _el(tag, **attrs):
    e = OxmlElement(tag)
    for k, v in attrs.items():
        e.set(qn(k), v)
    return e


def _set_cell_shading(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = _el("w:shd", **{"w:val": "clear", "w:color": "auto", "w:fill": fill})
    _put(tcPr, shd, _TCPR_SEQ)


def _set_cell_margins(cell, top=120, bottom=120, left=170, right=170):
    tcPr = cell._tc.get_or_add_tcPr()
    mar = OxmlElement("w:tcMar")
    for name, val in (("top", top), ("start", left), ("bottom", bottom), ("end", right)):
        node = _el("w:" + name, **{"w:w": str(val), "w:type": "dxa"})
        mar.append(node)
    _put(tcPr, mar, _TCPR_SEQ)


def _cell_borders(cell, left=None, top=None, bottom=None, right=None):
    tcPr = cell._tc.get_or_add_tcPr()
    borders = OxmlElement("w:tcBorders")
    for name, spec in (("left", left), ("top", top), ("bottom", bottom), ("right", right)):
        if spec is None:
            node = _el("w:" + name, **{"w:val": "nil"})
        else:
            sz, color = spec
            node = _el("w:" + name, **{"w:val": "single", "w:sz": str(sz),
                                       "w:space": "0", "w:color": color})
        borders.append(node)
    _put(tcPr, borders, _TCPR_SEQ)


def _table_no_borders(table):
    tbl = table._tbl
    tblPr = tbl.tblPr
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        borders.append(_el("w:" + edge, **{"w:val": "nil"}))
    _put(tblPr, borders, _TBLPR_SEQ)


def _table_full_width(table, width_twips=9500):
    tbl = table._tbl
    tblPr = tbl.tblPr
    w = _el("w:tblW", **{"w:w": str(width_twips), "w:type": "dxa"})
    _put(tblPr, w, _TBLPR_SEQ)
    layout = _el("w:tblLayout", **{"w:type": "fixed"})
    _put(tblPr, layout, _TBLPR_SEQ)


def _row_props(row, *, cant_split=True, header=False):
    """Строка таблицы не рвётся между страницами; шапка повторяется."""
    trPr = row._tr.get_or_add_trPr()
    if cant_split:
        _put(trPr, _el("w:cantSplit"), _TRPR_SEQ)
    if header:
        _put(trPr, _el("w:tblHeader"), _TRPR_SEQ)
    return row


def _keep_with_next(par, on=True):
    pPr = par._p.get_or_add_pPr()
    _put(pPr, _el("w:keepNext", **{"w:val": "1" if on else "0"}), _PPR_SEQ)


def _shade_paragraph(par, fill):
    pPr = par._p.get_or_add_pPr()
    _put(pPr, _el("w:shd", **{"w:val": "clear", "w:color": "auto", "w:fill": fill}), _PPR_SEQ)


def add_field(par, instr):
    """Вставка поля Word (PAGE / NUMPAGES и т. п.)."""
    run = par.add_run()
    r = run._r
    fld_begin = _el("w:fldChar", **{"w:fldCharType": "begin"})
    instr_el = OxmlElement("w:instrText")
    instr_el.set(qn("xml:space"), "preserve")
    instr_el.text = instr
    fld_sep = _el("w:fldChar", **{"w:fldCharType": "separate"})
    t = OxmlElement("w:t")
    t.text = "1"
    fld_end = _el("w:fldChar", **{"w:fldCharType": "end"})
    r.append(fld_begin)
    r.append(instr_el)
    r.append(fld_sep)
    r.append(t)
    r.append(fld_end)
    return run


# ---------------------------------------------------------------- конструктор
class Doc:
    def __init__(self, title, subtitle=None, meta_title=None):
        self.d = Document()
        self.title = title
        self._setup_page()
        self._setup_styles()
        self._setup_core(title, meta_title or title)
        self._add_footer()
        if title:
            self.h_title(title)
        if subtitle:
            self.subtitle(subtitle)

    # ---- служебное
    def _setup_page(self):
        s = self.d.sections[0]
        s.page_width = Cm(21)
        s.page_height = Cm(29.7)
        s.left_margin = Cm(2.5)
        s.right_margin = Cm(1.5)
        s.top_margin = Cm(2.0)
        s.bottom_margin = Cm(2.0)
        s.header_distance = Cm(1.0)
        s.footer_distance = Cm(1.0)

    def _setup_styles(self):
        st = self.d.styles["Normal"]
        st.font.name = FONT
        st.font.size = Pt(10.5)
        st.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
        st.element.rPr.rFonts.set(qn("w:cs"), FONT)
        pf = st.paragraph_format
        pf.line_spacing = 1.1
        pf.space_after = Pt(1.5)
        pf.space_before = Pt(0)
        pf.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        self._setup_doc_defaults()

    def _setup_doc_defaults(self):
        """Базовые установки документа: Times New Roman и русский язык проверки
        орфографии — чтобы Word не подчёркивал текст как англоязычный."""
        styles_el = self.d.styles.element
        rPrDefault = styles_el.find(qn("w:docDefaults")).find(qn("w:rPrDefault"))
        rPr = rPrDefault.find(qn("w:rPr"))
        if rPr is None:
            rPr = OxmlElement("w:rPr")
            rPrDefault.append(rPr)
        fonts = rPr.find(qn("w:rFonts"))
        if fonts is None:
            fonts = OxmlElement("w:rFonts")
            rPr.insert(0, fonts)
        for attr in ("w:asciiTheme", "w:eastAsiaTheme", "w:hAnsiTheme", "w:cstheme"):
            if fonts.get(qn(attr)) is not None:
                del fonts.attrib[qn(attr)]
        fonts.set(qn("w:ascii"), FONT)
        fonts.set(qn("w:eastAsia"), FONT)
        fonts.set(qn("w:hAnsi"), FONT)
        fonts.set(qn("w:cs"), FONT)
        for tag, val in (("w:sz", "21"), ("w:szCs", "21")):
            el = rPr.find(qn(tag))
            if el is None:
                el = OxmlElement(tag)
                rPr.append(el)
            el.set(qn("w:val"), val)
        lang = rPr.find(qn("w:lang"))
        if lang is None:
            lang = OxmlElement("w:lang")
            rPr.append(lang)
        lang.set(qn("w:val"), "ru-RU")
        lang.set(qn("w:eastAsia"), "ru-RU")
        lang.set(qn("w:bidi"), "ar-SA")
        pPrDefault = styles_el.find(qn("w:docDefaults")).find(qn("w:pPrDefault"))
        pPr = pPrDefault.find(qn("w:pPr"))
        if pPr is not None:
            sp = pPr.find(qn("w:spacing"))
            if sp is not None:
                sp.set(qn("w:after"), "30")
                sp.set(qn("w:line"), "264")
                sp.set(qn("w:lineRule"), "auto")

    def _setup_core(self, title, subject):
        cp = self.d.core_properties
        cp.title = title
        cp.subject = subject
        cp.author = "Мария Перепечай"
        cp.last_modified_by = "Мария Перепечай"
        cp.category = "Кадровые шаблоны kadry-pro.ru"
        cp.comments = ("Редактируемый шаблон. Правовой срез: 24.11.2026. "
                       "Индивидуальная настройка и разработка ЛНА — kadry-pro.ru")
        cp.keywords = "трудовой договор; кадровое делопроизводство; шаблон; ТК РФ"
        cp.language = "ru-RU"

    def _add_footer(self):
        sec = self.d.sections[0]
        p = sec.footer.paragraphs[0]
        p.text = ""
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.line_spacing = 1.0
        p.paragraph_format.tab_stops.add_tab_stop(Cm(16.9), WD_TAB_ALIGNMENT.RIGHT)
        r = p.add_run("Шаблон Марии Перепечай · kadry-pro.ru")
        r.font.size = Pt(8)
        r.font.name = FONT
        r.font.color.rgb = RGBColor(0x60, 0x60, 0x60)
        r2 = p.add_run("\tСтр. ")
        r2.font.size = Pt(8)
        r2.font.name = FONT
        r2.font.color.rgb = RGBColor(0x60, 0x60, 0x60)
        f1 = add_field(p, " PAGE ")
        f1.font.size = Pt(8)
        f1.font.name = FONT
        f1.font.color.rgb = RGBColor(0x60, 0x60, 0x60)
        r3 = p.add_run(" из ")
        r3.font.size = Pt(8)
        r3.font.name = FONT
        r3.font.color.rgb = RGBColor(0x60, 0x60, 0x60)
        f2 = add_field(p, " NUMPAGES ")
        f2.font.size = Pt(8)
        f2.font.name = FONT
        f2.font.color.rgb = RGBColor(0x60, 0x60, 0x60)

    def _run(self, par, text, *, bold=False, italic=False, size=None,
             color=None, caps=False, underline=False):
        r = par.add_run(text)
        r.font.name = FONT
        r._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
        r.bold = bold
        r.italic = italic
        r.font.size = Pt(size) if size else Pt(10.5)
        if color:
            r.font.color.rgb = RGBColor(*color)
        if caps:
            r.font.all_caps = True
        r.underline = underline
        return r

    # ---- блоки
    def h_title(self, text):
        p = self.d.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(2)
        _keep_with_next(p)
        self._run(p, text, bold=True, size=14)

    def subtitle(self, text):
        p = self.d.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(8)
        _keep_with_next(p)
        self._run(p, text, italic=True, size=10.5, color=(0x40, 0x40, 0x40))

    def meta(self, left, right):
        """Строка «г. ____ ... «___» ____ 20__ г.» с правым табулятором."""
        p = self.d.add_paragraph()
        p.paragraph_format.tab_stops.add_tab_stop(Cm(16.9), WD_TAB_ALIGNMENT.RIGHT)
        p.paragraph_format.space_after = Pt(8)
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        self._run(p, left)
        self._run(p, "\t" + right)

    def h1(self, text, *, page_break=False):
        p = self.d.add_paragraph()
        if page_break:
            p.paragraph_format.page_break_before = True
            _put(p._p.get_or_add_pPr(), _el("w:pageBreakBefore"), _PPR_SEQ)
        p.paragraph_format.space_before = Pt(11)
        p.paragraph_format.space_after = Pt(5)
        p.paragraph_format.line_spacing = 1.0
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        _keep_with_next(p)
        pPr = p._p.get_or_add_pPr()
        pbdr = OxmlElement("w:pBdr")
        pbdr.append(_el("w:bottom", **{"w:val": "single", "w:sz": "6",
                                       "w:space": "2", "w:color": "A6A6A6"}))
        _put(pPr, pbdr, _PPR_SEQ)
        self._run(p, text, bold=True, size=10.5, color=(0x1A, 0x1A, 0x1A))

    def h2(self, text):
        p = self.d.add_paragraph()
        p.paragraph_format.space_before = Pt(6)
        p.paragraph_format.space_after = Pt(3)
        _keep_with_next(p)
        self._run(p, text, bold=True, size=11)

    def p(self, text, *, bold_prefix=None, indent=0.0, space_after=1.5, align=None,
          italic=False, size=None):
        par = self.d.add_paragraph()
        if indent:
            par.paragraph_format.left_indent = Cm(indent)
        par.paragraph_format.space_after = Pt(space_after)
        if align == "center":
            par.alignment = WD_ALIGN_PARAGRAPH.CENTER
        elif align == "left":
            par.alignment = WD_ALIGN_PARAGRAPH.LEFT
        elif align == "right":
            par.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        if bold_prefix:
            self._run(par, bold_prefix, bold=True, size=size)
        self._run(par, text, italic=italic, size=size)
        return par

    def li(self, text, *, indent=1.0, marker="— ", bold_lead="", size=None):
        par = self.d.add_paragraph()
        pf = par.paragraph_format
        pf.left_indent = Cm(indent + 0.5)
        pf.first_line_indent = Cm(-0.5)
        pf.space_after = Pt(1.5)
        self._run(par, marker, size=size)
        if bold_lead:
            self._run(par, bold_lead, bold=True, size=size)
        self._run(par, text, size=size)
        return par

    def checkbox(self, text, *, indent=0.0, size=10):
        par = self.d.add_paragraph()
        pf = par.paragraph_format
        pf.left_indent = Cm(indent + 0.55)
        pf.first_line_indent = Cm(-0.55)
        pf.space_after = Pt(2)
        self._run(par, "☐ ", size=size)
        self._run(par, text, size=size)
        return par

    def blank(self, text="", *, size=9, space_after=6):
        par = self.d.add_paragraph()
        par.paragraph_format.space_after = Pt(space_after)
        self._run(par, text, size=size)
        return par

    def hr(self):
        p = self.d.add_paragraph()
        p.paragraph_format.space_before = Pt(2)
        p.paragraph_format.space_after = Pt(2)
        pPr = p._p.get_or_add_pPr()
        pbdr = OxmlElement("w:pBdr")
        pbdr.append(_el("w:bottom", **{"w:val": "single", "w:sz": "6",
                                       "w:space": "1", "w:color": GREY_LINE}))
        _put(pPr, pbdr, _PPR_SEQ)

    # ---- врезки
    def note(self, paragraphs, title="Примечание Марии Перепечай", *, items=True):
        """Выделенный блок примечания, визуально отделённый от текста договора."""
        if isinstance(paragraphs, str):
            paragraphs = [paragraphs]
        table = self.d.add_table(rows=1, cols=1)
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        _table_no_borders(table)
        _table_full_width(table)
        _row_props(table.rows[0])
        cell = table.cell(0, 0)
        _set_cell_shading(cell, NOTE_FILL)
        _set_cell_margins(cell, top=130, bottom=130, left=200, right=180)
        _cell_borders(cell, left=(24, LINE))
        cell.paragraphs[0].text = ""
        first = cell.paragraphs[0]
        first.paragraph_format.space_after = Pt(3)
        first.paragraph_format.line_spacing = 1.05
        _keep_with_next(first)
        self._run(first, title, bold=True, size=9, color=(0x7A, 0x4A, 0x10))
        for i, txt in enumerate(paragraphs):
            par = cell.add_paragraph()
            pf = par.paragraph_format
            pf.space_after = Pt(2)
            pf.line_spacing = 1.05
            par.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            if items and txt.startswith(("—", "•", "✓")):
                pf.left_indent = Cm(0.45)
                pf.first_line_indent = Cm(-0.45)
            self._run(par, txt, size=9)
        self._after_table()

    def variant(self, heading, paragraphs):
        """Вариативный блок: сторона выбирает один из вариантов."""
        if isinstance(paragraphs, str):
            paragraphs = [paragraphs]
        table = self.d.add_table(rows=1, cols=1)
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        _table_no_borders(table)
        _table_full_width(table)
        _row_props(table.rows[0])
        cell = table.cell(0, 0)
        _set_cell_shading(cell, VARIANT_FILL)
        _set_cell_margins(cell, top=110, bottom=110, left=200, right=180)
        _cell_borders(cell, left=(12, VARIANT_LINE))
        first = cell.paragraphs[0]
        first.text = ""
        first.paragraph_format.space_after = Pt(3)
        first.paragraph_format.line_spacing = 1.05
        _keep_with_next(first)
        self._run(first, heading, bold=True, size=9, color=(0x2F, 0x45, 0x63))
        for txt in paragraphs:
            par = cell.add_paragraph()
            pf = par.paragraph_format
            pf.space_after = Pt(2)
            pf.line_spacing = 1.05
            par.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            if txt.startswith(("—", "•", "☐")):
                pf.left_indent = Cm(0.45)
                pf.first_line_indent = Cm(-0.45)
            self._run(par, txt, size=9)
        self._after_table()

    def _after_table(self):
        """Технический абзац-«воздух» после таблицы (в WORD таблицы склеиваются)."""
        p = self.d.add_paragraph()
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.line_spacing = 1.0
        r = p.add_run("")
        r.font.size = Pt(2)

    def table(self, headers, rows, widths=None, *, font_size=9.5, header_fill="E8E8E8"):
        n = len(headers)
        table = self.d.add_table(rows=1, cols=n)
        table.style = "Table Grid"
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        _row_props(table.rows[0], header=True)
        hdr = table.rows[0].cells
        for i, h in enumerate(headers):
            hdr[i].text = ""
            par = hdr[i].paragraphs[0]
            par.alignment = WD_ALIGN_PARAGRAPH.CENTER
            par.paragraph_format.space_after = Pt(0)
            self._run(par, h, bold=True, size=font_size)
            _set_cell_shading(hdr[i], header_fill)
        for row in rows:
            new_row = table.add_row()
            _row_props(new_row)
            cells = new_row.cells
            for i, val in enumerate(row):
                cells[i].text = ""
                par = cells[i].paragraphs[0]
                par.paragraph_format.space_after = Pt(0)
                par.paragraph_format.line_spacing = 1.0
                par.alignment = WD_ALIGN_PARAGRAPH.LEFT
                self._run(par, str(val), size=font_size)
        if widths:
            for r in table.rows:
                for i, w in enumerate(widths):
                    r.cells[i].width = Cm(w)
        self._after_table()

    # ---- финал
    def closing(self, text=None):
        """Унифицированный финальный блок без цен."""
        self.hr()
        p = self.d.add_paragraph()
        p.paragraph_format.space_before = Pt(4)
        p.paragraph_format.space_after = Pt(3)
        p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        self._run(p, "Индивидуальная настройка этого документа", bold=True, size=9.5)
        self._run(
            p,
            " и разработка сопутствующих локальных нормативных актов "
            "(должностной инструкции, перечня должностей, положения об оплате труда "
            "и иных) выполняются отдельно — это самостоятельная услуга. "
            "Заказать настройку договора под вашу ситуацию и разработку ЛНА можно "
            "у Марии Перепечай на сайте ",
            size=9.5,
        )
        self._run(p, "kadry-pro.ru", bold=True, size=9.5)
        self._run(p, ".", size=9.5)
        p2 = self.d.add_paragraph()
        p2.paragraph_format.space_after = Pt(0)
        p2.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        self._run(
            p2,
            "Документ является редактируемым шаблоном. Перед применением проверьте "
            "его на соответствие вашим локальным нормативным актам и фактическим "
            "обстоятельствам. Правовой срез: 24 ноября 2026 года.",
            italic=True, size=8.5, color=(0x50, 0x50, 0x50),
        )

    def save(self, path):
        self.d.save(path)
        return path
