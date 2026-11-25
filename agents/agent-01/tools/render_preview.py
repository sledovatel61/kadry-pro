# -*- coding: utf-8 -*-
"""Рендер предпросмотра шаблона в PDF/PNG через PyMuPDF Story (без LibreOffice).
Оценка количества страниц и визуальная проверка вёрстки."""

import sys, os, glob
import pymupdf

PAGE = pymupdf.paper_rect("a4")

CSS = """
body { font-family: "DejaVu Serif"; font-size: 10.5pt; line-height: 1.15; }
p { margin: 0 0 1.5px 0; }
.h-title { text-align: center; font-weight: bold; font-size: 14pt; margin: 0 0 2px 0; }
.subtitle { text-align: center; font-style: italic; font-size: 10pt; color: #404040;
            margin: 0 0 6px 0; }
.h1 { font-weight: bold; font-size: 10.5pt; margin: 11px 0 5px 0;
      border-bottom: 0.5px solid #a6a6a6; padding-bottom: 2px; }
.li { margin-left: 42px; text-indent: -14px; margin-bottom: 1.5px; }
.cb { margin-left: 16px; text-indent: -16px; margin-bottom: 1.5px; font-size: 9.5pt; }
.note { background: #fff3e0; border-left: 4px solid #b08968; padding: 7px 10px;
        margin: 5px 0 7px 0; font-size: 9pt; line-height: 1.05; }
.note .nt { font-weight: bold; color: #7a4a10; margin-bottom: 3px; }
.note p { margin: 0 0 2px 0; }
.variant { background: #eef2f7; border-left: 2px solid #7a8ca3; padding: 7px 10px;
           margin: 5px 0 7px 0; font-size: 9pt; line-height: 1.05; }
.variant .nt { font-weight: bold; color: #2f4563; margin-bottom: 3px; }
.variant p { margin: 0 0 2px 0; }
table.grid { border-collapse: collapse; width: 100%; font-size: 9pt; margin: 5px 0; }
table.grid td, table.grid th { border: 0.5px solid #999; padding: 2px 3px; vertical-align: top; }
table.grid th { background: #e8e8e8; text-align: center; font-weight: bold; }
table.req { border-collapse: collapse; width: 100%; font-size: 8.5pt; margin: 5px 0; }
table.req td, table.req th { border: 0.5px solid #999; padding: 2px 3px; vertical-align: top; }
table.req th { background: #e8e8e8; text-align: center; font-weight: bold; }
.divider { border-top: 0.5px solid #a6a6a6; margin: 8px 0 12px 0; }
"""


def build(html_path, pdf_path):
    html = open(html_path, encoding="utf-8").read()
    # Берём только тело .page, приводим к простому html для Story
    start = html.index('<div class="page"')
    end = html.index('<div class="footer"')
    body = html[start:end]
    body = body[body.index(">") + 1:]
    # убрать служебную метку предпросмотра
    if '<span class="tag">' in body:
        i = body.index('<span class="tag">')
        j = body.index("</span>", i) + len("</span>")
        body = body[:i] + body[j:]
    doc_html = f"<html><head><style>{CSS}</style></head><body>{body}</body></html>"
    # Story не понимает абсолютное позиционирование и flex
    story = pymupdf.Story(html=doc_html, user_css=CSS)
    writer = pymupdf.DocumentWriter(pdf_path)
    where = pymupdf.Rect(70, 56, 530, 785)  # поля ~2.5/1.5/2/2 см
    more = 1
    pages = 0
    while more:
        dev = writer.begin_page(PAGE)
        more, _ = story.place(where)
        story.draw(dev)
        writer.end_page()
        pages += 1
        if pages > 60:
            break
    writer.close()
    return pages


def to_png(pdf_path, png_prefix, scale=1.6, max_pages=3):
    d = pymupdf.open(pdf_path)
    out = []
    for i in range(min(d.page_count, max_pages)):
        pix = d[i].get_pixmap(dpi=int(72 * scale))
        p = f"{png_prefix}-p{i+1}.png"
        pix.save(p)
        out.append(p)
    return out, d.page_count


if __name__ == "__main__":
    html_path, out_base = sys.argv[1], sys.argv[2]
    n = build(html_path, out_base + ".pdf")
    imgs, total = to_png(out_base + ".pdf", out_base)
    print(f"{os.path.basename(out_base)}: страниц={total}, png={len(imgs)}")
