#!/usr/bin/env python3
"""Maintainer script: add Servier Medical Art PowerPoint kits to the verified library.

  python3 scripts/ingest/servier_ingest.py <kits-dir> <work-dir>

Pipeline: split each kit so every drawing is alone on a slide (servier_split_kits.py)
→ LibreOffice PDF → pdftocairo SVG per page → browser cleanup (inline glyphs, solid
fills for tiny gradient rasters, crop) → the same normalizer / strict grammar / Fabric
checks as every library drawing → manifest records (CC BY 4.0, credited to Servier).

Needs: LibreOffice (soffice), poppler (pdftocairo), Python Playwright + Chromium and
/tmp/ingest-bundle.js (see ingest_extra_packs.py). Idempotent: existing ids are skipped.
"""
import concurrent.futures as cf, glob, hashlib, json, os, re, subprocess, sys, datetime
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from servier_split_kits import split  # noqa: E402
import ingest_extra_packs as base  # noqa: E402

KIT_CATEGORY = {
    'Animals': 'Animals', 'Arteries-atherothrombosis': 'Cardiovascular system', 'Arteries-pathophysiology': 'Cardiovascular system',
    'Arteries-physiology': 'Cardiovascular system', 'Heart-pathophysiology': 'Cardiovascular system', 'Heart-physiology': 'Cardiovascular system',
    'Veins': 'Cardiovascular system', 'Blood-immunology': 'Blood Immunology', 'Lymphatic-system': 'Blood Immunology',
    'Bone-fractures': 'Musculoskeletal system', 'Bone-structure': 'Musculoskeletal system', 'Bones': 'Musculoskeletal system',
    'Muscles': 'Musculoskeletal system', 'Cell-membrane': 'Cell membrane', 'Chemistry': 'Chemistry', 'Dermatology': 'Dermatology',
    'Diabetes': 'Endocrinology', 'Endocrinology': 'Endocrinology', 'Dietetics': 'Nutrition', 'Digestive-system': 'Digestive system',
    'Drugs': 'Drugs and therapeutics', 'ENT': 'ENT and ophthalmology', 'Ophthalmology': 'ENT and ophthalmology',
    'Embryology': 'Developmental biology', 'Reproduction': 'Reproductive system', 'Emergency-equipment': 'Medical equipment',
    'Medical-equipment': 'Medical equipment', 'General-items': 'General items', 'Risk-Factors': 'General items', 'Genetics': 'Genetics',
    'Infectiology': 'Microbiology', 'Microbiology-cell-culture': 'Microbiology', 'Parasitology': 'Parasites',
    'Intracellular-components': 'Intracellular components', 'Lab-apparatus': 'Lab apparatus', 'Lipids': 'Molecules',
    'Medical-acts': 'Procedures', 'Paraclinical-exams': 'Procedures', 'Nervous-system': 'Neuroscience', 'Neural-cells': 'Neuroscience',
    'Nucleic-acids': 'Nucleic acids', 'Oncology': 'Oncology', 'People': 'People Other', 'Receptors-channels': 'Receptors channels',
    'Respiratory-system': 'Respiratory system', 'Scientific-graphs': 'Scientific graphs', 'Tissues': 'Tissues',
    'Urinary-system': 'Urinary system', 'World-maps': 'Maps',
}
LICENSE = {'id': 'CC-BY-4.0', 'name': 'Creative Commons Attribution 4.0 International',
           'url': 'https://creativecommons.org/licenses/by/4.0/', 'attributionRequired': True}
_NUMBER = re.compile(r'-?\d+\.\d{2,}')
_GEOMETRY = re.compile(r'(\s(?:d|points)=")([^"]*)(")')  # never transforms: matrix factors need full precision


def _fmt(value):
    text = ('%.2f' % value).rstrip('0').rstrip('.')
    return '0' if text in ('-0', '') else text


_TOKEN = re.compile(r'[MLCZmlcz]|-?\d*\.?\d+(?:e-?\d+)?')


def _simplify_path(d, step):
    """Snap absolute M/L/C/Z path data (pdftocairo's output) to the grid and drop segments
    that collapse to a point after snapping; anything else is only rounded."""
    tokens = _TOKEN.findall(d)
    if any(t in 'mlcz' for t in tokens if t.isalpha()):
        return None
    snap = lambda v: round(float(v) / step) * step
    out, i, cur, cmd, start = [], 0, None, None, None
    while i < len(tokens):
        t = tokens[i]
        if t.isalpha():
            cmd = t; i += 1
            if cmd == 'Z':
                out.append('Z'); cur = start
            continue
        size = {'M': 2, 'L': 2, 'C': 6}.get(cmd)
        if size is None or i + size > len(tokens): return None
        pts = [snap(v) for v in tokens[i:i + size]]; i += size
        end = (pts[-2], pts[-1])
        if cmd != 'M' and cur is not None and all(abs(pts[k] - cur[k % 2]) < 1e-9 for k in range(size)):
            continue  # zero-length after snapping
        out.append(cmd + ' ' + ' '.join(_fmt(v) for v in pts))
        cur = end
        if cmd == 'M': start = end; cmd = 'L'  # extra pairs after M are implicit lines
    return ' '.join(out)


def compact_coordinates(svg, step=0.1):
    """Snap path data to a grid of `step` points (0.1-0.5 pt is invisible at figure scale)
    and drop the zero-length segments that snapping leaves behind."""
    def path(match):
        simplified = _simplify_path(match.group(2), step) if match.group(1).endswith('d="') else None
        if simplified is None:
            simplified = re.sub(r'\s+', ' ', _NUMBER.sub(lambda n: _fmt(round(float(n.group(0)) / step) * step), match.group(2))).strip()
        return match.group(1) + simplified + match.group(3)
    return _GEOMETRY.sub(path, svg)


CONVERSION = 'Converted from the Servier Medical Art PowerPoint kit to SVG (LibreOffice + pdftocairo); tiny gradient textures flattened to solid colours'


def convert(kit_split, work):
    """Convert one split kit; a kit that fails (e.g. out of memory) is logged and skipped."""
    try:
        return _convert(kit_split, work)
    except Exception as error:  # noqa: BLE001
        name = os.path.basename(kit_split).replace('.split.pptx', '')
        print(f'FAILED {name}: {str(error)[:120]}', flush=True)
        return name, 0


def _convert(kit_split, work):
    """One LibreOffice profile per kit so conversions can run in parallel."""
    name = os.path.basename(kit_split).replace('.split.pptx', '')
    pdf = os.path.join(work, 'pdf', name + '.split.pdf')
    if not os.path.exists(pdf):
        profile = 'file://' + os.path.join(work, 'lo-profiles', name)
        subprocess.run(['soffice', f'-env:UserInstallation={profile}', '--headless', '--convert-to', 'pdf',
                        '--outdir', os.path.join(work, 'pdf'), kit_split], check=True, capture_output=True, timeout=1800)
    svgdir = os.path.join(work, 'svg', name)
    os.makedirs(svgdir, exist_ok=True)
    pages = int(re.search(r'Pages:\s+(\d+)', subprocess.run(['pdfinfo', pdf], capture_output=True, text=True).stdout).group(1))
    for page in range(1, pages + 1):
        out = os.path.join(svgdir, f'{page}.svg')
        if not os.path.exists(out):
            subprocess.run(['pdftocairo', '-svg', '-f', str(page), '-l', str(page), pdf, out], check=True, capture_output=True, timeout=300)
    return name, pages


def main():
    kits_dir, work = sys.argv[1], sys.argv[2]
    for d in ('split', 'pdf', 'svg'): os.makedirs(os.path.join(work, d), exist_ok=True)
    kits = sorted(glob.glob(os.path.join(kits_dir, '*.pptx')))
    # 1. split
    # A kit needs splitting unless both its item list and its split deck exist (an interrupted
    # run can leave the list without the deck, and the kit would then be skipped silently).
    def split_done(k):
        stem = os.path.join(work, 'split', os.path.splitext(os.path.basename(k))[0])
        return os.path.exists(stem + '.items.json') and os.path.exists(stem + '.split.pptx')
    todo = [k for k in kits if not split_done(k)]
    with cf.ProcessPoolExecutor(max_workers=2) as pool:
        for result in pool.map(split, todo, [os.path.join(work, 'split')] * len(todo)):
            print('split', result, flush=True)
    # 2. convert (2 workers)
    splits = sorted(glob.glob(os.path.join(work, 'split', '*.split.pptx')))
    with cf.ThreadPoolExecutor(max_workers=int(os.environ.get("SERVIER_WORKERS", "2"))) as pool:
        for name, pages in pool.map(lambda s: convert(s, work), splits):
            print('converted', name, pages, flush=True)
    # 3. clean + admit
    from playwright.sync_api import sync_playwright
    manifest = json.load(open(base.MANIFEST, encoding='utf-8'))
    ids = {r['id'] for r in manifest}
    prints = {r.get('fingerprint') for r in manifest}
    today = datetime.date.today().isoformat()
    added, reasons = [], Counter()
    with sync_playwright() as pw:
        exe = '/usr/bin/google-chrome' if os.path.exists('/usr/bin/google-chrome') else None
        browser = pw.chromium.launch(executable_path=exe, args=['--no-sandbox']) if exe else pw.chromium.launch()
        page = browser.new_page()
        page.set_content('<!doctype html><html><body></body></html>')
        page.add_script_tag(content=open(base.BUNDLE, encoding='utf-8').read())
        for kit in kits:
            kname = os.path.splitext(os.path.basename(kit))[0]
            short = kname.replace('SMART-', '')
            category = KIT_CATEGORY.get(short, 'General items')
            kit_bytes = open(kit, 'rb').read()
            kit_sha = hashlib.sha256(kit_bytes).hexdigest()
            blob = base.git_blob(kit_bytes)
            records = json.load(open(os.path.join(work, 'split', kname + '.items.json')))
            used_names = Counter()
            for rec in records:
                rid = f"servier-kit-{base.slug(short, 30)}-s{rec['slide']}-{rec['index']}"
                if rid in ids:
                    # Count existing titles so new drawings never reuse a name within the kit.
                    used_names[re.sub(r'\s+', ' ', (rec.get('label') or rec.get('title') or short.replace('-', ' ')).strip())[:200]] += 1
                    continue
                svg_path = os.path.join(work, 'svg', kname, f"{rec['page']}.svg")
                if not os.path.exists(svg_path):
                    reasons['missing page'] += 1
                    print(f'WARNING missing page {svg_path}', flush=True); continue
                raw = open(svg_path, encoding='utf-8', errors='replace').read()
                if len(raw) > 16_000_000:
                    reasons['too large'] += 1; print(f'too large {rid}: raw page {len(raw) // 1024} KB', flush=True); continue
                cleaned = page.evaluate('raw => window.pdfSvgClean(raw)', raw)
                if not cleaned['ok']: reasons[cleaned['error'][:50]] += 1; continue
                if len(re.findall(r'<(path|rect|circle|ellipse|polygon|polyline|line|text)\b', cleaned['svg'])) < 2:
                    reasons['single-shape fragment'] += 1; continue
                svg_text, compacted = cleaned['svg'], None
                for step in (0.1, 0.25, 0.5):
                    if len(svg_text.encode()) <= base.MAX_BYTES: break
                    svg_text, compacted = compact_coordinates(cleaned['svg'], step), step
                if len(svg_text.encode()) > base.MAX_BYTES:
                    reasons['too large'] += 1
                    print(f'too large {rid}: {len(svg_text.encode()) // 1024} KB after rounding', flush=True); continue
                res = page.evaluate('raw => window.ingest(raw)', svg_text)
                if not res['ok']: reasons[res['error'][:50]] += 1; continue
                # Servier's blue callout pointers (one #0070c0 line + head) are filed as arrows, not under the slide's topic.
                served = res['svg']
                pointer = (len(re.findall(r'<(path|rect|circle|ellipse|polygon|polyline|line)\b', served)) <= 4 and len(served) < 4000
                           and set(c.lower() for c in re.findall(r'(?:fill|stroke)[=:]"?\s*(#[0-9a-fA-F]{6})', served)) == {'#0070c0'})
                item_category = 'Arrows and symbols' if pointer else category
                if res['fingerprint'] in prints: reasons['duplicate'] += 1; continue
                prints.add(res['fingerprint'])
                title = 'Callout arrow' if pointer else (rec.get('label') or rec.get('title') or short.replace('-', ' ')).strip()
                title = re.sub(r'\s+', ' ', title)[:200]
                used_names[title] += 1
                name = title if used_names[title] == 1 else f'{title} – {used_names[title]}'
                svg_b = res['svg'].encode('utf-8')
                integ = base.sha_upper(svg_b)
                open(os.path.join(base.ARTWORK, integ[7:].lower() + '.svg'), 'wb').write(svg_b)
                ids.add(rid)
                changes = sorted(set(res['changes']) | {CONVERSION} | ({f'Path coordinates rounded to {compacted} pt to fit the 1.5 MB drawing limit'} if compacted else set()))
                added.append({
                    'id': rid, 'title': name, 'description': f"{name}, a Servier Medical Art drawing from the {short.replace('-', ' ')} kit.",
                    'keywords': base.keywords(name, item_category, ('servier', 'servier medical art', short.replace('-', ' ').lower()) + (('arrow', 'pointer', 'callout') if pointer else ())),
                    'category': item_category, 'file': base.slug(rid, 110) + '.svg', 'integrity': integ,
                    'source': {'provider': 'Servier Medical Art', 'sourceUrl': 'https://smart.servier.com/',
                               'assetUrl': 'https://smart.servier.com/', 'retrievedAt': today,
                               'revision': f'{kname}.pptx sha256 {kit_sha[:16]}', 'upstreamPath': f"{kname}.pptx#slide{rec['slide']}/item{rec['index']}"},
                    'creator': {'name': 'Servier Medical Art', 'url': 'https://smart.servier.com/'},
                    'license': LICENSE,
                    'attribution': {'text': f"{name} adapted from Servier Medical Art (https://smart.servier.com/), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).",
                                    'modified': True, 'modificationNotes': '; '.join(changes) + '.'},
                    'verified': True, 'fingerprint': res['fingerprint'],
                    'evidence': {'originalIntegrity': 'sha256-' + kit_sha.upper(), 'upstreamBlob': blob, 'policy': base.POLICY,
                                 'changes': changes, 'review': base.REVIEW},
                })
            print(f'{short}: total added so far {len(added)}', flush=True)
        browser.close()
    manifest.extend(added)
    json.dump(manifest, open(base.MANIFEST, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    open(base.MANIFEST, 'a').write('\n')
    print('added', len(added))
    print('by category', Counter(r['category'] for r in added).most_common())
    print('rejections', reasons.most_common(12))


if __name__ == '__main__':
    main()
