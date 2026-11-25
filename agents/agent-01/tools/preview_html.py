# -*- coding: utf-8 -*-
"""Предпросмотр .docx в виде HTML: имитирует A4-страницу, шрифт, отступы,
заливки примечаний и вариативных блоков. Нужен для визуальной проверки."""

import sys, os, glob, html
from docx import Document
from docx.shared import Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn

CSS = """
* { box-sizing: border-box; }
body { background:#e9ecef; margin:0; padding:24px 0;
       font-family:"Times New Roman", "Liberation Serif", serif; }
.page { width:21cm; min-height:29.7cm; padding:2cm 1.5cm 2cm 2.5cm;
        margin:0 auto 18px; background:#fff;
        box-shadow:0 2px 10px rgba(0,0,0,.18); position:relative;
        font-size:11pt; line-height:1.15; text-align:justify; }
.page p { margin:0 0 3pt; }
.h-title { text-align:center; font-weight:bold; font-size:14pt; margin-bottom:2pt; }
.subtitle { text-align:center; font-style:italic; font-size:10.5pt; color:#404040; }
.h1 { font-weight:bold; font-size:11.5pt; margin:14pt 0 5pt;
      padding-bottom:2pt; border-bottom:0.5pt solid #a6a6a6; }
.h2 { font-weight:bold; font-size:11pt; margin:6pt 0 3pt; }
.li { margin-left:1.5cm; text-indent:-0.5cm; margin-bottom:2pt; }
.cb { margin-left:0.55cm; text-indent:-0.55cm; margin-bottom:2pt; font-size:10pt; }
.note { background:#fff3e0; border-left:3.5pt solid #b08968;
        padding:7pt 10pt; margin:5pt 0 7pt; font-size:9pt; line-height:1.08; }
.note .nt { font-weight:bold; color:#7a4a10; margin-bottom:3pt; }
.note p { margin:0 0 2pt; text-align:justify; }
.variant { background:#eef2f7; border-left:2pt solid #7a8ca3;
           padding:7pt 10pt; margin:5pt 0 7pt; font-size:9pt; line-height:1.08; }
.variant .nt { font-weight:bold; color:#2f4563; margin-bottom:3pt; }
.variant p { margin:0 0 2pt; }
table.grid { border-collapse:collapse; width:100%; font-size:9.5pt; margin:6pt 0; }
table.grid td, table.grid th { border:0.5pt solid #999; padding:3pt 4pt;
                               vertical-align:top; }
table.grid th { background:#e8e8e8; text-align:center; font-weight:bold; }
table.req { border-collapse:collapse; width:100%; font-size:8.5pt; margin:6pt 0; }
table.req td, table.req th { border:0.5pt solid #999; padding:3pt 4pt;
                             vertical-align:top; }
table.req th { background:#e8e8e8; text-align:center; font-weight:bold; font-size:9pt; }
.footer { position:absolute; left:2.5cm; right:1.5cm; bottom:1cm;
          font-size:8pt; color:#606060; display:flex;
          justify-content:space-between; }
.hr { border-top:0.5pt solid #808080; margin:6pt 0; }
.tag { position:absolute; top:0; left:0; background:#1c7c54; color:#fff;
       font:600 8px/1.6 -apple-system,Segoe UI,sans-serif; padding:2px 8px;
       letter-spacing:.06em; }
@media print { body{background:#fff;padding:0} .page{box-shadow:none;margin:0}
               .tag{display:none} }
"""


def cell_fill(cell):
    tcPr = cell._tc.tcPr
    if tcPr is None:
        return None
    shd = tcPr.find(qn("w:shd"))
    if shd is None:
        return None
    return shd.get(qn("w:fill"))


def run_html(r):
    t = html.escape(r.text)
    if not t:
        return ""
    style = []
    if r.bold:
        style.append("font-weight:bold")
    if r.italic:
        style.append("font-style:italic")
    if r.underline:
        style.append("text-decoration:underline")
    if r.font.size:
        style.append(f"font-size:{r.font.size.pt}pt")
    if r.font.color and r.font.color.rgb:
        style.append(f"color:#{r.font.color.rgb}")
    if r.font.all_caps:
        style.append("text-transform:uppercase")
    sp = ";".join(style)
    return f"<span style='{sp}'>{t}</span>" if sp else t


def para_html(p, cls=""):
    txt = "".join(run_html(r) for r in p.runs)
    align = p.alignment
    style = []
    if align == WD_ALIGN_PARAGRAPH.CENTER:
        style.append("text-align:center")
    elif align == WD_ALIGN_PARAGRAPH.LEFT:
        style.append("text-align:left")
    elif align == WD_ALIGN_PARAGRAPH.RIGHT:
        style.append("text-align:right")
    pf = p.paragraph_format
    if pf.left_indent is not None and pf.left_indent.pt > 0:
        style.append(f"margin-left:{pf.left_indent.pt:.1f}pt")
    if pf.first_line_indent is not None and pf.first_line_indent.pt != 0:
        style.append(f"text-indent:{pf.first_line_indent.pt:.1f}pt")
    if pf.space_before is not None and pf.space_before.pt:
        style.append(f"margin-top:{pf.space_before.pt:.1f}pt")
    if pf.space_after is not None and pf.space_after.pt:
        style.append(f"margin-bottom:{pf.space_after.pt:.1f}pt")
    # нижняя отчёркивание заголовка
    if p._p.pPr is not None and p._p.pPr.find(qn("w:pBdr")) is not None:
        style.append("border-bottom:0.5pt solid #a6a6a6")
        style.append("padding-bottom:2pt")
    if not txt.strip():
        txt = "&nbsp;"
    attrs = f" class='{cls}'" if cls else ""
    return f"<p{attrs} style='{';'.join(style)}'>{txt}</p>"


def table_html(t):
    ncols = len(t.columns)
    # одностолбцовая таблица = врезка
    fill = cell_fill(t.rows[0].cells[0]) if t.rows else None
    if ncols == 1:
        cell = t.rows[0].cells[0]
        cls = "note" if fill == "FFF3E0" else "variant"
        inner = []
        for i, p in enumerate(cell.paragraphs):
            txt = "".join(run_html(r) for r in p.runs)
            if not txt.strip():
                continue
            if i == 0 and txt.strip():
                inner.append(f"<div class='nt'>{txt}</div>")
            else:
                inner.append(para_html(p))
        return f"<div class='{cls}'>{''.join(inner)}</div>"

    # таблица реквизитов — первая строка как заголовок
    head = t.rows[0].cells
    is_req = (fill is not None and len(t.rows) > 3)
    cls = "req" if is_req else "grid"
    out = [f"<table class='{cls}'><tr>"]
    for c in head:
        out.append("<th>" + "".join(run_html(r) for p in c.paragraphs
                                    for r in p.runs) + "</th>")
    out.append("</tr>")
    for row in t.rows[1:]:
        out.append("<tr>")
        for c in row.cells:
            txt = "<br>".join("".join(run_html(r) for r in p.runs)
                              for p in c.paragraphs)
            out.append(f"<td>{txt}</td>")
        out.append("</tr>")
    out.append("</table>")
    return "".join(out)


def convert(path, out_path, page_break_every=None):
    doc = Document(path)
    body = []
    # проходим по телу в исходном порядке (абзацы + таблицы)
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    for child in doc.element.body.iterchildren():
        tag = child.tag.split("}")[-1]
        if tag == "p":
            p = Paragraph(child, doc)
            txt = p.text.strip()
            style = None
            if p.alignment == WD_ALIGN_PARAGRAPH.CENTER and p.runs and \
                    p.runs[0].bold and p.runs[0].font.size and \
                    p.runs[0].font.size.pt >= 14:
                style = "h-title"
            elif p.alignment == WD_ALIGN_PARAGRAPH.CENTER and p.runs and \
                    p.runs[0].italic:
                style = "subtitle"
            elif p.runs and p.runs[0].bold and p.runs[0].font.size and \
                    p.runs[0].font.size.pt >= 11.5 and txt and txt == txt.upper():
                style = "h1"
            elif p.runs and p.runs[0].text in ("— ", "☐ ") and p.paragraph_format.left_indent:
                style = "cb" if p.runs[0].text.startswith("☐") else "li"
            if not txt:
                continue  # технический «воздух» после таблицы
            body.append(para_html(p, style or ""))
        elif tag == "tbl":
            body.append(table_html(Table(child, doc)))

    # разбиваем на страницы по ~2500 знаков для удобного просмотра
    text_len = sum(len(p.text) for p in doc.paragraphs)
    html_doc = f"""<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<title>{html.escape(os.path.basename(out_path))}</title>
<style>{CSS}</style></head><body>
<div class="page"><span class="tag">ПРЕДПРОСМОТР · A4 · 1 страница = 1 лист Word (приблизительно)</span>
{''.join(body)}
<div class="footer"><span>Шаблон Марии Перепечай · kadry-pro.ru</span>
<span>Стр. 1</span></div></div>
</body></html>"""
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html_doc)
    return text_len


if __name__ == "__main__":
    src = sys.argv[1]
    out = sys.argv[2]
    print(convert(src, out))
