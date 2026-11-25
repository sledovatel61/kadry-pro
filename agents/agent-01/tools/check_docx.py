# -*- coding: utf-8 -*-
"""Проверка готового .docx: структура, запрещённые строки, водяные знаки, поля."""
import sys, zipfile, re, glob, os
from docx import Document

FORBIDDEN = [
    # устаревшие цены / даты
    r"12 000\s*₽", r"от\s*12\s*000", r"14 000\s*₽", r"22 440", r"25 440",
    r"©\s*2025", r"©\s*2024", r"kadry-pro\.ru\s*\|\s*\+7", r"\+7 \(961\)",
    r"1 500 ₽", r"500 ₽", r"2 500 ₽", r"3 500 ₽", r"5 000 ₽", r"1 000 ₽",
    # неверные нормы
    r"ст\.\s*212\s*ТК", r"статьей\s*212",
    r"до завершения СОУТ[^.]{0,40}(признаются|считаются)[^.]{0,20}допустимыми",
    r"Приложение\s*№\s*\d[^к]*(к\s*настоящему|Договору|Трудовому)",
    r"\(Приложение\s*№\s*\d\)",
    r"неотъемлемыми приложениями", r"является неотъемлемой частью",
    r"5-КГ19-87", r"33-40853", r"ПП\s*№\s*382", r"№\s*382/498",
    r"п\.\s*3\s*ч\.\s*1\s*ст\.\s*278", r"п\.\s*3\s*ст\.\s*278",
    r"ст\.\s*312\.3\s*ТК[^.]{0,80}компенсац",
    r"компенсац[^.]{0,80}ст\.\s*312\.3\s*ТК",
    r"не более 35\s*₽", r"лимит[а-я]*\s*35\s*₽",
    r"автоматическ[а-я]+\s+недействительн",
    r"безусловн[а-я]+\s+штраф",
    r"lawful",
]

REQUIRED_MARK = "Примечание Марии Перепечай"
CLOSING_MARK = "kadry-pro.ru"

REPORT = []


def doc_text(doc):
    parts = []
    for p in doc.paragraphs:
        parts.append(p.text)
    for t in doc.tables:
        for r in t.rows:
            for c in r.cells:
                for p in c.paragraphs:
                    parts.append(p.text)
    for s in doc.sections:
        for p in s.footer.paragraphs:
            parts.append(p.text)
        for p in s.header.paragraphs:
            parts.append(p.text)
    return "\n".join(parts)


def has_watermark(path):
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        if any(n.startswith("word/media/") for n in names):
            return True, "media files present"
        for n in names:
            if n.endswith(".xml"):
                data = z.read(n).decode("utf-8", "ignore")
                if "<w:background" in data and 'w:color="' in data:
                    pass
        # header watermark typical: v:shape with watermarks in header xml
        for n in names:
            if re.match(r"word/header\d*\.xml", n):
                data = z.read(n).decode("utf-8", "ignore")
                if "watermark" in data.lower() or "WordArt" in data:
                    return True, "header watermark"
    return False, ""


def check(path):
    errs = []
    warns = []
    doc = Document(path)
    text = doc_text(doc)
    for pat in FORBIDDEN:
        for m in re.finditer(pat, text, re.I):
            snippet = text[max(0, m.start() - 45): m.end() + 45].replace("\n", " ")
            errs.append(f"запрещённый фрагмент /{pat}/: …{snippet}…")
    wm, why = has_watermark(path)
    if wm:
        errs.append(f"водяной знак: {why}")
    if REQUIRED_MARK not in text:
        errs.append("нет ни одного блока «Примечание Марии Перепечай»")
    if CLOSING_MARK not in text:
        errs.append("нет финального блока со ссылкой на kadry-pro.ru")
    if "юридическую силу" not in text:
        warns.append("нет формулировки о двух экземплярах")
    n_notes = text.count(REQUIRED_MARK)
    stats = {
        "абзацев": len(doc.paragraphs),
        "таблиц": len(doc.tables),
        "знаков": len(text),
        "примечаний": n_notes,
        "страниц_оценка": round(len(text) / 2600, 1),
    }
    return errs, warns, stats


def main(paths):
    ok = True
    for p in sorted(paths):
        errs, warns, stats = check(p)
        name = os.path.basename(p)
        status = "OK  " if not errs else "FAIL"
        print(f"[{status}] {name}  {stats}")
        for e in errs:
            print("   ✗", e)
            ok = False
        for w in warns:
            print("   ⚠", w)
    return 0 if ok else 1


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        args = glob.glob(os.path.join(os.path.dirname(__file__), "..",
                                      "docx-01-10", "*.docx"))
    sys.exit(main(args))
