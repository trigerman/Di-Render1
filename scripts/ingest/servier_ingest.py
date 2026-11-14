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
CONVERSION = 'Converted from the Servier Medical Art PowerPoint kit to SVG (LibreOffice + pdftocairo); tiny gradient textures flattened to solid colours'


def convert(kit_split, work):
    """One LibreOffice profile per worker so conversions can run in parallel."""
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
    todo = [k for k in kits if not os.path.exists(os.path.join(work, 'split', os.path.splitext(os.path.basename(k))[0] + '.items.json'))]
    with cf.ProcessPoolExecutor(max_workers=2) as pool:
        for result in pool.map(split, todo, [os.path.join(work, 'split')] * len(todo)):
            print('split', result, flush=True)
    # 2. convert (2 workers)
    splits = sorted(glob.glob(os.path.join(work, 'split', '*.split.pptx')))
    with cf.ThreadPoolExecutor(max_workers=2) as pool:
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
                if rid in ids: continue
                svg_path = os.path.join(work, 'svg', kname, f"{rec['page']}.svg")
                if not os.path.exists(svg_path): reasons['missing page'] += 1; continue
                raw = open(svg_path, encoding='utf-8', errors='replace').read()
                if len(raw) > 6_000_000: reasons['too large'] += 1; continue
                cleaned = page.evaluate('raw => window.pdfSvgClean(raw)', raw)
                if not cleaned['ok']: reasons[cleaned['error'][:50]] += 1; continue
                if len(re.findall(r'<(path|rect|circle|ellipse|polygon|polyline|line|text)\b', cleaned['svg'])) < 2:
                    reasons['single-shape fragment'] += 1; continue
                if len(cleaned['svg'].encode()) > base.MAX_BYTES: reasons['too large'] += 1; continue
                res = page.evaluate('raw => window.ingest(raw)', cleaned['svg'])
                if not res['ok']: reasons[res['error'][:50]] += 1; continue
                if res['fingerprint'] in prints: reasons['duplicate'] += 1; continue
                prints.add(res['fingerprint'])
                title = (rec.get('label') or rec.get('title') or short.replace('-', ' ')).strip()
                title = re.sub(r'\s+', ' ', title)[:200]
                used_names[title] += 1
                name = title if used_names[title] == 1 else f'{title} – {used_names[title]}'
                svg_b = res['svg'].encode('utf-8')
                integ = base.sha_upper(svg_b)
                open(os.path.join(base.ARTWORK, integ[7:].lower() + '.svg'), 'wb').write(svg_b)
                ids.add(rid)
                changes = sorted(set(res['changes']) | {CONVERSION})
                added.append({
                    'id': rid, 'title': name, 'description': f"{name}, a Servier Medical Art drawing from the {short.replace('-', ' ')} kit.",
                    'keywords': base.keywords(name, category, ('servier', 'servier medical art', short.replace('-', ' ').lower())),
                    'category': category, 'file': base.slug(rid, 110) + '.svg', 'integrity': integ,
                    'source': {'provider': 'Servier Medical Art', 'sourceUrl': 'https://smart.servier.com/',
                               'assetUrl': 'https://smart.servier.com/', 'retrievedAt': today,
                               'revision': f'{kname}.pptx sha256 {kit_sha[:16]}', 'upstreamPath': f"{kname}.pptx#slide{rec['slide']}/item{rec['index']}"},
                    'creator': {'name': 'Servier Medical Art', 'url': 'https://smart.servier.com/'},
                    'license': LICENSE,
                    'attribution': {'text': f"{name} by Servier Medical Art (https://smart.servier.com/), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).",
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
