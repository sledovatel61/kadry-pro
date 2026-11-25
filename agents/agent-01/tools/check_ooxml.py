# -*- coding: utf-8 -*-
"""Проверка порядка элементов в pPr / tcPr / tblPr / rPr (схема OOXML).
Word строго следит за последовательностью детей этих элементов: нарушение
вызывает сообщение «нечитаемое содержимое» при открытии файла."""

import sys, glob, zipfile
from lxml import etree
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

PPR=['pStyle','keepNext','keepLines','pageBreakBefore','framePr','widowControl','numPr',
'suppressLineNumbers','pBdr','shd','tabs','suppressAutoHyphens','kinsoku','wordWrap',
'overflowPunct','topLinePunct','autoSpaceDE','autoSpaceDN','bidi','adjustRightInd',
'snapToGrid','spacing','ind','contextualSpacing','mirrorIndents','suppressOverlap','jc',
'textDirection','textAlignment','textboxTightWrap','outlineLvl','divId','cnfStyle','rPr',
'sectPr','pPrChange']
TCPR=['cnfStyle','tcW','gridSpan','hMerge','vMerge','tcBorders','shd','noWrap','tcMar',
'textDirection','tcFitText','vAlign','hideMark','headers','cellIns','cellDel','cellMerge','tcPrChange']
TBLPR=['tblStyle','tblpPr','tblOverlap','bidiVisual','tblStyleRowBandSize','tblStyleColBandSize',
'tblW','jc','tblCellSpacing','tblInd','tblBorders','shd','tblLayout','tblCellMar','tblLook',
'tblCaption','tblDescription','tblPrChange']
RPR=['rStyle','rFonts','b','bCs','i','iCs','caps','smallCaps','strike','dstrike','outline',
'shadow','emboss','imprint','noProof','snapToGrid','vanish','webHidden','color','spacing','w',
'kern','position','sz','szCs','highlight','u','effect','bdr','shd','fitText','vertAlign','rtl',
'cs','em','lang','eastAsianLayout','specVanish','oMath','rPrChange']

SEQ={'pPr':PPR,'tcPr':TCPR,'tblPr':TBLPR,'rPr':RPR}
problems=[]
for path in sys.argv[1:]:
    z=zipfile.ZipFile(path)
    for part in ('word/document.xml','word/footer1.xml','word/footer2.xml','word/header1.xml'):
        if part not in z.namelist(): continue
        root=etree.fromstring(z.read(part))
        for name,seq in SEQ.items():
            for el in root.iter(W+name):
                kids=[etree.QName(c).localname for c in el if isinstance(c.tag,str)]
                idx=[]
                for k in kids:
                    if k not in seq:
                        problems.append((path,part,name,'UNKNOWN:'+k)); continue
                    idx.append(seq.index(k))
                if idx!=sorted(idx):
                    problems.append((path,part,name,'ORDER: '+','.join(kids)))
                dupes={k for k in kids if kids.count(k)>1}
                if dupes:
                    problems.append((path,part,name,'DUP: '+','.join(dupes)))
print(f"проверено файлов: {len(sys.argv)-1}, нарушений: {len(problems)}")
for p in problems[:25]: print(' ', p[0].split('/')[-1], p[1], p[2], p[3])
