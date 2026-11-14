#!/usr/bin/env python3
"""Maintainer script: split Servier Medical Art PowerPoint kits so every drawing
sits alone on its own slide (no master graphics, transparent background).

  python3 scripts/ingest/servier_split_kits.py <kits-dir> <out-dir>

Writes <out-dir>/<Kit>.split.pptx and <out-dir>/<Kit>.items.json (one record per
page of the split deck: kit, source slide, slide title, nearby label, EMU bbox).
"""
import copy, json, os, re, sys, zipfile
from lxml import etree

NS = {
    'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
}
REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'
SLIDE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide'
SLIDE_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'
q = lambda tag: '{%s}%s' % (NS[tag.split(':')[0]], tag.split(':')[1])


def text_of(el):
    return re.sub(r'\s+', ' ', ' '.join(t.text or '' for t in el.iter(q('a:t')))).strip()


def bbox(el):
    xfrm = None
    for path in ('p:spPr/a:xfrm', 'p:grpSpPr/a:xfrm', 'p:xfrm', './/a:xfrm'):
        xfrm = el.find(path, NS)
        if xfrm is not None: break
    if xfrm is None: return None
    off, ext = xfrm.find('a:off', NS), xfrm.find('a:ext', NS)
    if off is None or ext is None: return None
    x, y, w, h = int(off.get('x')), int(off.get('y')), int(ext.get('cx')), int(ext.get('cy'))
    return (x, y, w, h) if w > 0 and h > 0 else None


def is_label(el):
    """Text-only shapes (titles, captions, notes) are labels, not drawings."""
    tag = etree.QName(el).localname
    if tag != 'sp': return False
    if el.find('p:nvSpPr/p:nvPr/p:ph', NS) is not None: return True
    if not text_of(el): return False
    sppr = el.find('p:spPr', NS)
    filled = sppr is not None and (sppr.find('a:solidFill', NS) is not None or sppr.find('a:gradFill', NS) is not None or sppr.find('a:blipFill', NS) is not None)
    custom = sppr is not None and sppr.find('a:custGeom', NS) is not None
    return not filled and not custom


def drawing_candidates(tree):
    items, labels = [], []
    for el in tree:
        tag = etree.QName(el).localname
        if tag in ('nvGrpSpPr', 'grpSpPr', 'extLst'): continue
        b = bbox(el)
        if b is None:
            if tag == 'sp' and text_of(el): labels.append((text_of(el), (0, -1, 0, 0)))  # title placeholder
            continue
        if tag in ('graphicFrame', 'contentPart'): continue
        if is_label(el):
            labels.append((text_of(el), b)); continue
        if tag == 'cxnSp': continue  # stand-alone connector lines are slide furniture
        if tag == 'pic':
            emb = el.find('.//a:blip', NS)
            if emb is None: continue
        if b[2] < 300_000 and b[3] < 300_000: continue  # < ~0.8 cm: bullets, dots
        items.append((el, b))
    return items, labels


def nearest_label(b, labels):
    x, y, w, h = b
    best, score = None, None
    for text, (lx, ly, lw, lh) in labels:
        if not text or len(text) > 80: continue
        overlap = min(x + w, lx + lw) - max(x, lx)
        if overlap < min(w, lw) * 0.3: continue
        gap = ly - (y + h) if ly >= y + h * 0.5 else y - (ly + lh)
        if gap < -h * 0.2 or gap > max(h * 0.6, 600_000): continue
        s = abs(gap)
        if score is None or s < score: best, score = text, s
    return best


def blank_template(xml: bytes) -> bytes:
    """Layouts and masters keep their structure but lose decorative shapes and backgrounds."""
    root = etree.fromstring(xml)
    tree = root.find('p:cSld/p:spTree', NS)
    if tree is not None:
        for child in list(tree):
            if etree.QName(child).localname not in ('nvGrpSpPr', 'grpSpPr'): tree.remove(child)
    cSld = root.find('p:cSld', NS)
    if cSld is not None:
        old = cSld.find('p:bg', NS)
        if old is not None: cSld.remove(old)
        bg = etree.Element(q('p:bg')); cSld.insert(0, bg)
        bgpr = etree.SubElement(bg, q('p:bgPr')); etree.SubElement(bgpr, q('a:noFill')); etree.SubElement(bgpr, q('a:effectLst'))
    return etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)


def split(kit_path, out_dir):
    kit = os.path.splitext(os.path.basename(kit_path))[0]
    zin = zipfile.ZipFile(kit_path)
    names = set(zin.namelist())
    pres = etree.fromstring(zin.read('ppt/presentation.xml'))
    prels = etree.fromstring(zin.read('ppt/_rels/presentation.xml.rels'))
    ctypes = etree.fromstring(zin.read('[Content_Types].xml'))
    rid_target = {r.get('Id'): r.get('Target') for r in prels}
    sld_list = pres.find('p:sldIdLst', NS)
    order = [rid_target[s.get(q('r:id'))] for s in sld_list]

    new_parts, records = {}, []
    counter = 0
    for slide_no, target in enumerate(order, 1):
        part = 'ppt/' + target if not target.startswith('/') else target[1:]
        rels_part = part.replace('slides/', 'slides/_rels/') + '.rels'
        root = etree.fromstring(zin.read(part))
        tree = root.find('p:cSld/p:spTree', NS)
        items, labels = drawing_candidates(tree)
        title = next((t for t, _ in sorted(labels, key=lambda l: (l[1][1], l[1][0])) if t), '')
        # Build one light skeleton per slide (no shapes, no background, no master graphics),
        # then add a single drawing to each copy.
        skeleton = copy.deepcopy(root)
        skeleton.set('showMasterSp', '0')
        s_tree = skeleton.find('p:cSld/p:spTree', NS)
        for child in list(s_tree):
            if etree.QName(child).localname not in ('nvGrpSpPr', 'grpSpPr'): s_tree.remove(child)
        cSld = skeleton.find('p:cSld', NS)
        old_bg = cSld.find('p:bg', NS)
        if old_bg is not None: cSld.remove(old_bg)
        bg = etree.Element(q('p:bg')); cSld.insert(0, bg)
        bgpr = etree.SubElement(bg, q('p:bgPr')); etree.SubElement(bgpr, q('a:noFill')); etree.SubElement(bgpr, q('a:effectLst'))
        for index, (el, b) in enumerate(items):
            counter += 1
            new_root = copy.deepcopy(skeleton)
            new_root.find('p:cSld/p:spTree', NS).append(copy.deepcopy(el))
            name = f'ppt/slides/split{counter}.xml'
            new_parts[name] = etree.tostring(new_root, xml_declaration=True, encoding='UTF-8', standalone=True)
            if rels_part in names:
                new_parts[name.replace('slides/', 'slides/_rels/') + '.rels'] = zin.read(rels_part)
            records.append({'kit': kit, 'slide': slide_no, 'index': index + 1, 'title': title,
                            'label': nearest_label(b, labels), 'emu': b, 'page': counter})

    # Rebuild slide list, relationships and content types for the split slides only.
    for s in list(sld_list): sld_list.remove(s)
    for r in list(prels):
        if r.get('Type') == SLIDE_REL: prels.remove(r)
    for o in list(ctypes):
        if o.get('ContentType') == SLIDE_CT: ctypes.remove(o)
    for i in range(1, counter + 1):
        rid = f'rIdSplit{i}'
        etree.SubElement(prels, '{%s}Relationship' % REL_NS, Id=rid, Type=SLIDE_REL, Target=f'slides/split{i}.xml')
        sid = etree.SubElement(sld_list, q('p:sldId')); sid.set('id', str(10000 + i)); sid.set(q('r:id'), rid)
        etree.SubElement(ctypes, '{%s}Override' % CT_NS, PartName=f'/ppt/slides/split{i}.xml', ContentType=SLIDE_CT)

    out = os.path.join(out_dir, f'{kit}.split.pptx')
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as zout:
        for n in zin.namelist():
            if re.match(r'ppt/slides/(_rels/)?slide\d+\.xml(\.rels)?$', n): continue
            if n == 'ppt/presentation.xml': data = etree.tostring(pres, xml_declaration=True, encoding='UTF-8', standalone=True)
            elif n == 'ppt/_rels/presentation.xml.rels': data = etree.tostring(prels, xml_declaration=True, encoding='UTF-8', standalone=True)
            elif n == '[Content_Types].xml': data = etree.tostring(ctypes, xml_declaration=True, encoding='UTF-8', standalone=True)
            elif re.match(r'ppt/(slideLayouts|slideMasters)/slide(Layout|Master)\d+\.xml$', n): data = blank_template(zin.read(n))
            else: data = zin.read(n)
            zout.writestr(n, data)
        for n, data in new_parts.items(): zout.writestr(n, data)
    json.dump(records, open(os.path.join(out_dir, f'{kit}.items.json'), 'w'), indent=1)
    return kit, counter


if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    os.makedirs(dst, exist_ok=True)
    total = 0
    for f in sorted(os.listdir(src)):
        if f.endswith('.pptx'):
            kit, n = split(os.path.join(src, f), dst); total += n
            print(f'{kit}: {n} drawings', flush=True)
    print('total', total)
