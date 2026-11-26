#!/usr/bin/env python3
"""DOCX -> PDF для комплекта № 53–64: минимальный рендерер на reportlab.

Word/LibreOffice в песочнице нет, поэтому разметку собираем вручную по OOXML:
стили абзацев (Title/Subtitle/Heading1/Clause/Note*/Service/Signature),
таблицы TableGrid с повтором шапки и вертикальными объединениями,
блоки «Примечание Марии Перепечай» (заливка + левая линия), колонтитул «Стр. N»,
секции с разной ориентацией (у № 53 рабочие листы — альбомные) и гиперссылки.

Запуск (из каталога с DOCX):
    PYTHONPATH=/tmp/pylibs python3 docx2pdf.py 63_Сроки_хранения_кадровых_документов.docx 63.pdf

Отчёт о сборке и проверке: agents/agent-02/PDF-53-64-SITE.md
"""
import re, sys, zipfile
from xml.etree import ElementTree as ET

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, PageTemplate,
                                Paragraph, Spacer, Table, TableStyle)

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
REL = '{http://schemas.openxmlformats.org/package/2006/relationships}'

FONT_DIR = '/usr/share/fonts/truetype/dejavu'
pdfmetrics.registerFont(TTFont('Sans', f'{FONT_DIR}/DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('Sans-Bold', f'{FONT_DIR}/DejaVuSans-Bold.ttf'))
pdfmetrics.registerFontFamily('Sans', normal='Sans', bold='Sans-Bold',
                              italic='Sans', boldItalic='Sans-Bold')

TW = 1 / 20.0  # twip -> pt
# DejaVu Sans шире Calibri примерно на 5–7 %: слегка уменьшаем кегль, чтобы
# строки и переносы совпадали с исходным DOCX, а не расползались по страницам.
SIZE_FACTOR = 0.92


def attr(el, name, default=None):
    if el is None:
        return default
    return el.get(W + name, default)


def parse_styles(z):
    root = ET.fromstring(z.read('word/styles.xml'))
    out = {}
    for st in root.iter(W + 'style'):
        sid = attr(st, 'styleId')
        ppr = st.find(W + 'pPr')
        rpr = st.find(W + 'rPr')
        d = {'before': 0.0, 'after': 0.0, 'line': 1.0, 'left': 0.0, 'right': 0.0,
             'size': 11.5, 'color': '#202E36', 'bold': False, 'italic': False,
             'align': TA_LEFT, 'keepNext': False, 'border': None, 'shade': None}
        if ppr is not None:
            sp = ppr.find(W + 'spacing')
            if sp is not None:
                d['before'] = float(attr(sp, 'before', 0)) * TW
                d['after'] = float(attr(sp, 'after', 0)) * TW
                line = attr(sp, 'line')
                if line:
                    d['line'] = float(line) / 240.0
            ind = ppr.find(W + 'ind')
            if ind is not None:
                d['left'] = float(attr(ind, 'left', 0)) * TW
                d['right'] = float(attr(ind, 'right', 0)) * TW
            jc = attr(ppr.find(W + 'jc'), 'val')
            if jc == 'center':
                d['align'] = TA_CENTER
            d['keepNext'] = ppr.find(W + 'keepNext') is not None
            bd = ppr.find(W + 'pBdr')
            if bd is not None:
                left = bd.find(W + 'left')
                if left is not None:
                    d['border'] = (attr(left, 'color', '4B8989'), float(attr(left, 'sz', 16)) / 8.0)
            shd = ppr.find(W + 'shd')
            if shd is not None and attr(shd, 'fill'):
                d['shade'] = '#' + attr(shd, 'fill')
        if rpr is not None:
            sz = attr(rpr.find(W + 'sz'), 'val')
            if sz:
                d['size'] = float(sz) / 2.0
            col = attr(rpr.find(W + 'color'), 'val')
            if col:
                d['color'] = '#' + col
            b = rpr.find(W + 'b')
            d['bold'] = b is not None and attr(b, 'val', '1') not in ('0', 'false')
            i = rpr.find(W + 'i')
            d['italic'] = i is not None and attr(i, 'val', '1') not in ('0', 'false')
        out[sid] = d
    return out


def run_text(run, rels):
    """Собирает inline-разметку одного run."""
    parts = []
    for ch in run:
        tag = ch.tag
        if tag == W + 't':
            parts.append(ch.text or '')
        elif tag == W + 'tab':
            parts.append('    ')
        elif tag == W + 'br':
            parts.append('<br/>')
        elif tag == W + 'noBreakHyphen':
            parts.append('-')
    text = ''.join(parts)
    if not text:
        return ''
    rpr = run.find(W + 'rPr')
    esc = (text.replace('&', '&amp;').replace('<br/>', '\x00')
               .replace('<', '&lt;').replace('>', '&gt;').replace('\x00', '<br/>'))
    if rpr is not None:
        col = attr(rpr.find(W + 'color'), 'val')
        b = rpr.find(W + 'b')
        bold = b is not None and attr(b, 'val', '1') not in ('0', 'false')
        i = rpr.find(W + 'i')
        ital = i is not None and attr(i, 'val', '1') not in ('0', 'false')
        if bold:
            esc = f'<b>{esc}</b>'
        if ital:
            esc = f'<i>{esc}</i>'
        if col and col.lower() not in ('202e36', '000000'):
            esc = f'<font color="#{col}">{esc}</font>'
    return esc


def para_inline(p, rels):
    chunks = []
    for node in p:
        if node.tag == W + 'r':
            chunks.append(run_text(node, rels))
        elif node.tag == W + 'hyperlink':
            inner = ''.join(run_text(r, rels) for r in node.findall(W + 'r'))
            target = rels.get(node.get(R + 'id'))
            if target and inner:
                chunks.append(f'<link href="{target}" color="#165E63">{inner}</link>')
            else:
                chunks.append(inner)
    return ''.join(chunks).strip()


def parse_paragraph(p, rels):
    ppr = p.find(W + 'pPr')
    style = attr(ppr.find(W + 'pStyle'), 'val', 'Normal') if ppr is not None else 'Normal'
    d = {'style': style, 'text': para_inline(p, rels)}
    if ppr is not None:
        bd = ppr.find(W + 'pBdr')
        if bd is not None:
            left = bd.find(W + 'left')
            if left is not None:
                d['border'] = attr(left, 'color', '4B8989')
        shd = ppr.find(W + 'shd')
        if shd is not None and attr(shd, 'fill'):
            d['shade'] = '#' + attr(shd, 'fill')
    return d


def parse_table(tbl, rels):
    grid = [float(attr(g, 'w', 0)) * TW for g in tbl.iter(W + 'gridCol')]
    rows = []
    for tr in tbl.findall(W + 'tr'):
        trpr = tr.find(W + 'trPr')
        header = trpr is not None and trpr.find(W + 'tblHeader') is not None
        cells = []
        for tc in tr.findall(W + 'tc'):
            tcpr = tc.find(W + 'tcPr')
            vm = None
            width = grid[len(cells)] if len(cells) < len(grid) else None
            if tcpr is not None:
                v = tcpr.find(W + 'vMerge')
                if v is not None:
                    vm = attr(v, 'val', 'continue')  # 'restart' | 'continue'
                shd = tcpr.find(W + 'shd')
                fill = '#' + attr(shd, 'fill') if shd is not None and attr(shd, 'fill') else None
                w = tcpr.find(W + 'tcW')
                if w is not None and attr(w, 'type') == 'dxa':
                    width = float(attr(w, 'w', 0)) * TW
            else:
                fill = None
            paras = [parse_paragraph(p, rels) for p in tc.findall(W + 'p')]
            cells.append({'paras': paras, 'vmerge': vm, 'fill': fill, 'width': width})
        rows.append({'cells': cells, 'header': header})
    sizes = [float(v) / 2.0 for v in re.findall(r'<w:sz w:val="(\d+)"', ET.tostring(tbl, encoding='unicode'))]
    return {'grid': grid, 'rows': rows, 'size': min(sizes) if sizes else 9.5}


def sect_geometry(sect):
    pg = sect.find(W + 'pgSz') if sect is not None else None
    mar = sect.find(W + 'pgMar') if sect is not None else None
    page_w = float(attr(pg, 'w', 11906)) * TW if pg is not None else A4[0]
    page_h = float(attr(pg, 'h', 16838)) * TW if pg is not None else A4[1]
    margins = {k: float(attr(mar, k, 964)) * TW for k in ('top', 'bottom', 'left', 'right')}
    return {'page': (page_w, page_h), 'margins': margins}


def parse_docx(path):
    z = zipfile.ZipFile(path)
    rels = {}
    if 'word/_rels/document.xml.rels' in z.namelist():
        rr = ET.fromstring(z.read('word/_rels/document.xml.rels'))
        for rel in rr:
            if rel.get('Target', '').startswith('http'):
                rels[rel.get('Id')] = rel.get('Target')
    styles = parse_styles(z)
    doc = ET.fromstring(z.read('word/document.xml'))
    body = doc.find(W + 'body')
    blocks = []
    for node in body:
        if node.tag == W + 'p':
            ppr = node.find(W + 'pPr')
            sect = ppr.find(W + 'sectPr') if ppr is not None else None
            blocks.append(('p', parse_paragraph(node, rels)))
            if sect is not None:
                blocks.append(('sect', sect_geometry(sect)))
        elif node.tag == W + 'tbl':
            blocks.append(('tbl', parse_table(node, rels)))
    final = body.find(W + 'sectPr')
    geo = sect_geometry(final)
    return {'blocks': blocks, 'styles': styles,
            'page': geo['page'], 'margins': geo['margins'], 'zip': z}


def paragraph_style(block, styles):
    sid = block['style']
    base = styles.get(sid, styles.get('Normal', {}))
    size = base.get('size', 11.5)
    leading = size * 1.28 * base.get('line', 1.0)
    name = 'st_' + sid
    return ParagraphStyle(
        name=name,
        fontName='Sans-Bold' if base.get('bold') else 'Sans',
        fontSize=size,
        leading=leading,
        textColor=colors.HexColor(base.get('color', '#202E36')),
        spaceBefore=base.get('before', 0),
        spaceAfter=base.get('after', 0),
        leftIndent=base.get('left', 0),
        rightIndent=base.get('right', 0),
        alignment=base.get('align', TA_LEFT),
        allowWidows=0, allowOrphans=0,
    )


def scaled_style(sid, styles, out_w, geo):
    """Стиль абзаца с учётом ширины полосы набора текущей секции."""
    base = styles.get(sid, styles.get('Normal', {}))
    scale = 1.0
    size = base.get('size', 11.5) * SIZE_FACTOR
    return ParagraphStyle(
        name='st_' + sid,
        fontName='Sans-Bold' if base.get('bold') else 'Sans',
        fontSize=size,
        leading=size * 1.21 * base.get("line", 1.0),
        textColor=colors.HexColor(base.get('color', '#202E36')),
        spaceBefore=base.get('before', 3) * scale,
        spaceAfter=base.get('after', 4) * scale,
        leftIndent=base.get('left', 0) * scale,
        rightIndent=base.get('right', 0) * scale,
        alignment=base.get('align', TA_LEFT),
        allowWidows=0, allowOrphans=0,
    )


def build_story(blocks, styles, geo):
    page_w = geo['page'][0]
    margin_l = geo['margins']['left']
    margin_r = geo['margins']['right']
    content_w = page_w - margin_l - margin_r
    story = []
    cache = {}

    def pstyle(sid):
        if sid not in cache:
            cache[sid] = scaled_style(sid, styles, content_w, geo)
        return cache[sid]

    i = 0
    while i < len(blocks):
        kind, block = blocks[i]
        if kind == 'p':
            sid = block['style']
            if sid in ('Notelabel', 'Notetext'):
                group = []
                while i < len(blocks) and blocks[i][0] == 'p' and blocks[i][1]['style'] in ('Notelabel', 'Notetext'):
                    group.append(blocks[i][1])
                    i += 1
                inner = [Paragraph(b['text'], pstyle(b['style'])) for b in group if b['text']]
                box = Table([[inner]], colWidths=[content_w])
                box.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#EEF5F5')),
                    ('LINEBEFORE', (0, 0), (0, -1), 1.6, colors.HexColor('#4B8989')),
                    ('LEFTPADDING', (0, 0), (-1, -1), 9),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 6),
                    ('TOPPADDING', (0, 0), (-1, -1), 4),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
                    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ]))
                story.append(Spacer(1, 4))
                story.append(box)
                story.append(Spacer(1, 5))
                continue
            if not block['text']:
                i += 1
                continue
            if sid in ('Service', 'Signature'):
                group = []
                while i < len(blocks) and blocks[i][0] == 'p' and blocks[i][1]['style'] in ('Service', 'Signature'):
                    group.append(blocks[i][1])
                    i += 1
                inner = [Paragraph(b['text'], pstyle(b['style'])) for b in group if b['text']]
                story.append(KeepTogether(inner))
                continue
            para = Paragraph(block['text'], pstyle(sid))
            if sid == 'Title':
                box = Table([[para]], colWidths=[content_w])
                box.setStyle(TableStyle([
                    ('LINEBELOW', (0, 0), (-1, -1), 0.9, colors.HexColor('#4F81BD')),
                    ('LEFTPADDING', (0, 0), (-1, -1), 0),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 0),
                    ('TOPPADDING', (0, 0), (-1, -1), 0),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                ]))
                story.append(box)
                i += 1
                continue
            story.append(para)
            i += 1
            continue

        if kind == 'sect':
            i += 1
            continue

        # ---- таблица
        # Кегль таблицы берём из w:sz документа (в OOXML — полупункты), ширину
        # колонок — из w:tblGrid, приведённую к ширине полосы набора.
        scale = 1.0
        widths = [w for w in block['grid'] if w]
        if not widths:
            widths = [1.0] * max(1, len(block['rows'][0]['cells']))
        total = sum(widths)
        widths = [w / total * content_w for w in widths]
        # если разметка колонок не совпадает с числом ячеек — равные доли
        if any(len(r['cells']) != len(widths) for r in block['rows']):
            widths = [content_w / max(1, len(block['rows'][0]['cells']))] * len(block['rows'][0]['cells'])
        # минимальная ширина: самое длинное слово ячейки не должно переноситься
        cell_fs = block.get('size', 9.5) * SIZE_FACTOR
        mins = []
        for ci in range(len(widths)):
            need = 0.0
            for row in block['rows']:
                if ci < len(row['cells']):
                    for p in row['cells'][ci]['paras']:
                        for word in re.split(r'\s+', p['text']):
                            wpt = pdfmetrics.stringWidth(word, 'Sans-Bold' if row['header'] else 'Sans', cell_fs)
                            need = max(need, wpt + 9)
            mins.append(min(max(need, 14.0), content_w * 0.5))
        # добираем узким колонкам ширину из самой широкой (не больше 50% полосы)
        for _ in range(60):
            deficit = sum(max(0.0, m - w) for m, w in zip(mins, widths))
            if deficit < 0.5:
                break
            donor = max(range(len(widths)), key=lambda k: widths[k])
            if widths[donor] - mins[donor] <= 0.5:
                break
            take = min(widths[donor] - mins[donor], deficit)
            widths[donor] -= take
            need_total = sum(max(0.0, m - w) for m, w in zip(mins, widths))
            for k in range(len(widths)):
                if widths[k] < mins[k] and need_total > 0:
                    add = take * (mins[k] - widths[k]) / need_total
                    widths[k] += add
        total_w = sum(widths)
        widths = [w / total_w * content_w for w in widths]
        cell_style = ParagraphStyle('cell', fontName='Sans', fontSize=cell_fs,
                                    leading=cell_fs * 1.25, textColor=colors.HexColor('#202E36'))
        hdr_style = ParagraphStyle('cellh', parent=cell_style, fontName='Sans-Bold')
        rows_out, spans, pending = [], [], {}
        cmds = [
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#8496A0')),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LEFTPADDING', (0, 0), (-1, -1), 4.5),
            ('RIGHTPADDING', (0, 0), (-1, -1), 4.5),
            ('TOPPADDING', (0, 0), (-1, -1), 2.2),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 2.2),
        ]
        for ri, row in enumerate(block['rows']):
            out_row = []
            for ci, cell in enumerate(row['cells']):
                paras = [Paragraph(p['text'], hdr_style if row['header'] else cell_style)
                         for p in cell['paras'] if p['text']]
                out_row.append(paras or [Paragraph('', cell_style)])
                if cell['fill']:
                    cmds.append(('BACKGROUND', (ci, ri), (ci, ri), colors.HexColor(cell['fill'])))
                if cell['vmerge'] == 'restart':
                    pending[ci] = ri
                elif cell['vmerge'] == 'continue' and ci in pending:
                    spans.append((ci, pending[ci], ri))
            rows_out.append(out_row)
        for ci, r0, r1 in spans:
            cmds.append(('SPAN', (ci, r0), (ci, r1)))
        header_rows = sum(1 for r in block['rows'] if r['header'])
        tbl = Table(rows_out, colWidths=widths, repeatRows=header_rows, hAlign='CENTER')
        tbl.setStyle(TableStyle(cmds))
        story.append(Spacer(1, 4))
        story.append(tbl)
        story.append(Spacer(1, 4))
        i += 1
    return story


def build(path, out_path):
    data = parse_docx(path)
    blocks = data['blocks']
    styles = data['styles']

    # В OOXML sectPr в конце абзаца описывает секцию, которая ЗАКАНЧИВАЕТСЯ на нём,
    # то есть действует для содержимого ВЫШЕ. Последняя секция — body-level sectPr.
    sections = []
    buf = []
    for kind, block in blocks:
        if kind == 'sect':
            sections.append((block, buf))
            buf = []
        else:
            buf.append((kind, block))
    sections.append(({'page': data['page'], 'margins': data['margins']}, buf))

    templates, stories = [], []
    for idx, (geo, sbuf) in enumerate(sections):
        page = geo['page']
        margins = geo['margins']

        def make_footer(page=page, margins=margins):
            def footer(canvas, doc):
                canvas.saveState()
                canvas.setFont('Sans', 8.5)
                canvas.setFillColor(colors.HexColor('#5A6B75'))
                canvas.drawRightString(page[0] - margins['right'], margins['bottom'] * 0.55,
                                       f'Стр. {doc.page}')
                canvas.restoreState()
            return footer

        frame = Frame(margins['left'], margins['bottom'],
                      page[0] - margins['left'] - margins['right'],
                      page[1] - margins['top'] - margins['bottom'], id=f'body{idx}',
                      leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        templates.append(PageTemplate(id=f's{idx}', frames=[frame], pagesize=page,
                                      onPage=make_footer()))
        stories.append(build_story(sbuf, styles, geo))

    first_geo = sections[0][0]
    doc = BaseDocTemplate(out_path, pagesize=first_geo['page'],
                          leftMargin=first_geo['margins']['left'],
                          rightMargin=first_geo['margins']['right'],
                          topMargin=first_geo['margins']['top'],
                          bottomMargin=first_geo['margins']['bottom'])
    doc.addPageTemplates(templates)

    from reportlab.platypus import NextPageTemplate, PageBreak
    story = []
    for idx, sect_story in enumerate(stories):
        if idx == 0:
            story.append(NextPageTemplate(f's{idx}'))
        else:
            story.extend([NextPageTemplate(f's{idx}'), PageBreak()])
        story.extend(sect_story)
    total = sum(len(stories), 0) if False else None
    doc.build(story)


if __name__ == '__main__':
    build(sys.argv[1], sys.argv[2])
