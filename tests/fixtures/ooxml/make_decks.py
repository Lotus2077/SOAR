"""Minimal synthetic .pptx fixtures for the deck validity check (standard library only). Usage: make_decks.py OUTDIR"""
import os, sys, zipfile
CT = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
      '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
      '<Override PartName="/ppt/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>')
ROOT_RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
             '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>')
PRES = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>%s</p:sldIdLst></p:presentation>')
PRES_RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
             '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>')
SLIDE = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
         'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree>'
         '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="Chart"><a:extLst><a:ext uri="{FF2B5EF4-FFF2-40B4-BE49-F238E27FC236}"/></a:extLst></p:cNvPr></p:nvGraphicFramePr>'
         '<p:xfrm><a:off x="%s" y="%s"/><a:ext cx="%s" cy="%s"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">'
         '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId1"/></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>')
SLIDE_RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
              '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="%s"/></Relationships>')
def chart(group, grouping, ser_pos, chart_pos):
    g = '<c:grouping val="%s"/>' % grouping if grouping else ''
    sp = '<c:dLbls><c:dLblPos val="%s"/></c:dLbls>' % ser_pos if ser_pos else ''
    cp = '<c:dLbls><c:dLblPos val="%s"/></c:dLbls>' % chart_pos if chart_pos else ''
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" '
            'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:plotArea><c:%s>%s<c:ser><c:idx val="0"/><c:order val="0"/>%s</c:ser>%s</c:%s></c:plotArea></c:chart></c:chartSpace>'
            % (group, g, sp, cp, group))
def write(path, parts):
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in parts.items(): z.writestr(name, data)
def deck(coords=('457200', '457200', '8229600', '5143500'), group='barChart', grouping='clustered', ser_pos=None, chart_pos=None, slides='<p:sldId id="256" r:id="rId1"/>',
         chart_target='../charts/chart1.xml', ct=CT, slide_xml=None):
    return {'[Content_Types].xml': ct, '_rels/.rels': ROOT_RELS, 'ppt/presentation.xml': PRES % slides, 'ppt/_rels/presentation.xml.rels': PRES_RELS,
            'ppt/slides/slide1.xml': slide_xml if slide_xml is not None else SLIDE % coords, 'ppt/slides/_rels/slide1.xml.rels': SLIDE_RELS % chart_target,
            'ppt/charts/chart1.xml': chart(group, grouping, ser_pos, chart_pos)}
FIXTURES = {
    'valid': deck(ser_pos='outEnd'),
    'valid-chart-level-outend-bar': deck(chart_pos='outEnd'),
    'valid-line-top': deck(group='lineChart', grouping='standard', ser_pos='t'),
    'valid-pie-bestfit': deck(group='pieChart', grouping=None, ser_pos='bestFit'),
    'valid-stacked-center': deck(grouping='stacked', ser_pos='ctr'),
    'valid-bar-default-grouping': deck(grouping=None, ser_pos='outEnd'),
    'coordinate': deck(coords=('457200', '1.5', '8229600', '5.4')),
    'bar-top': deck(ser_pos='t'),
    'line-outend-chart-level': deck(group='lineChart', grouping='standard', chart_pos='outEnd'),
    'stacked-outend': deck(grouping='stacked', ser_pos='outEnd'),
    'area-position': deck(group='areaChart', grouping='standard', ser_pos='ctr'),
    'valid-area-chart-level-center': deck(group='areaChart', grouping='standard', chart_pos='ctr'),
    'valid-override-case': dict(deck(ct=CT.replace('/ppt/slides/slide1.xml', '/ppt/Slides/slide1.xml'))),
    'chart-override-missing-bad-pos': deck(ser_pos='t', ct=CT.replace('<Override PartName="/ppt/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>', '')),
    'override-empty-ct': deck(ct=CT.replace('ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"', 'ContentType=""')),
    'bar-standard-top': deck(grouping='standard', ser_pos='t'),
    'slide-outside-ppt-bad-coord': {**{k: v for k, v in deck(coords=('457200', '1.5', '8229600', '5.4')).items() if not k.startswith('ppt/slides/')},
        'slides/slide1.xml': SLIDE % ('457200', '1.5', '8229600', '5.4'), 'slides/_rels/slide1.xml.rels': SLIDE_RELS % '../ppt/charts/chart1.xml',
        '[Content_Types].xml': CT.replace('/ppt/slides/slide1.xml', '/slides/slide1.xml'), 'ppt/_rels/presentation.xml.rels': PRES_RELS.replace('slides/slide1.xml', '../slides/slide1.xml')},
    'huge-target': deck(chart_target='../charts/' + 'x' * 300000 + '.xml'),
    'relationship-missing': deck(chart_target='../charts/chart9.xml'),
    'content-type-missing': dict(deck(), **{'ppt/media/image1.png': b'\x89PNG not really'}),
    'override-without-part': deck(ct=CT.replace('</Types>', '<Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>')),
    'malformed': deck(slide_xml='<p:sld><unclosed>'),
    'no-slides': deck(slides=''),
    'duplicate-slide-id': deck(slides='<p:sldId id="256" r:id="rId1"/><p:sldId id="256" r:id="rId1"/>'),
    'slide-relationship-missing': deck(slides='<p:sldId id="256" r:id="rId7"/>'),
}
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
for name, parts in FIXTURES.items(): write(os.path.join(out, name + '.pptx'), parts)
with open(os.path.join(out, 'not-a-zip.pptx'), 'wb') as f: f.write(b'not a zip')
# A chart patched in place with mode 'a' leaves two entries of one name: the stale defective copy first, the fixed one last.
write(os.path.join(out, 'duplicate-entry.pptx'), deck(ser_pos='t'))
with zipfile.ZipFile(os.path.join(out, 'duplicate-entry.pptx'), 'a', zipfile.ZIP_DEFLATED) as z: z.writestr('ppt/charts/chart1.xml', chart('barChart', 'clustered', 'ctr', None))
print(len(FIXTURES) + 2)
