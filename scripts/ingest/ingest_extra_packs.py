#!/usr/bin/env python3
"""Maintainer script: add Reactome, BioDraws and the remaining Bioicons drawings
to the verified library manifest, using the app's own normalizer + strict sanitizer.

Usage (from repo root, after cloning the sources):
  git clone --depth 1 https://github.com/duerrsimon/bioicons /tmp/bioicons
  git clone --depth 1 https://github.com/reactome/reactome_illustrations /tmp/reactome_illustrations
  git clone --depth 1 https://github.com/biodraws/biodraws /tmp/biodraws
  npx esbuild scripts/ingest/browser-entry.ts --bundle --format=iife \
      --alias:dompurify=./vendor/dompurify/purify.cjs \
      --alias:fabric=./vendor/fabric/dist/index.min.mjs --outfile=/tmp/ingest-bundle.js
  python3 scripts/ingest/ingest_extra_packs.py

Requires Python Playwright with Chromium. Re-running is idempotent: records whose
id already exists in the manifest are skipped.
"""
import datetime, glob, hashlib, json, os, re, subprocess, sys
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MANIFEST = os.path.join(ROOT, 'app/src/assets/packs/library-manifest.json')
ARTWORK = os.path.join(ROOT, 'app/public-browser/artwork')
BUNDLE = os.environ.get('INGEST_BUNDLE', '/tmp/ingest-bundle.js')
TODAY = datetime.date.today().isoformat()
MAX_BYTES = 1_500_000
POLICY = 'svg-v1-library-normalization-v1'
REVIEW = 'pinned open-license metadata and structural acceptance; scientific suitability must be checked by the figure author'

LICENSES = {
    'CC0-1.0': ('CC0 1.0 Universal', 'https://creativecommons.org/publicdomain/zero/1.0/', False),
    'CC-BY-3.0': ('Creative Commons Attribution 3.0 Unported', 'https://creativecommons.org/licenses/by/3.0/', True),
    'CC-BY-4.0': ('Creative Commons Attribution 4.0 International', 'https://creativecommons.org/licenses/by/4.0/', True),
    'CC-BY-SA-3.0': ('Creative Commons Attribution-ShareAlike 3.0 Unported', 'https://creativecommons.org/licenses/by-sa/3.0/', True),
    'CC-BY-SA-4.0': ('Creative Commons Attribution-ShareAlike 4.0 International', 'https://creativecommons.org/licenses/by-sa/4.0/', True),
    'MIT': ('MIT License', 'https://opensource.org/license/mit', True),
}
BIO_LIC = {'cc-0': 'CC0-1.0', 'cc-by-3.0': 'CC-BY-3.0', 'cc-by-4.0': 'CC-BY-4.0',
           'cc-by-sa-3.0': 'CC-BY-SA-3.0', 'cc-by-sa-4.0': 'CC-BY-SA-4.0', 'mit': 'MIT'}
BIO_CAT = {'Amino-Acids': 'Amino Acids', 'Chemo-_and_Bioinformatics': 'Chemo and Bioinformatics',
           'People-Other': 'People Other', 'Molecular_Biology': 'Genetics'}
REACTOME_CAT = {'protein': 'Proteins', 'compound': 'Molecules', 'receptor': 'Receptors channels',
                'cell_element': 'Cells and organelles', 'cell_type': 'Cell types', 'transporter': 'Receptors channels',
                'human_tissue': 'Tissues', 'therapeutic': 'Drugs and therapeutics',
                'background': 'Backgrounds and scenes', 'arrow': 'Arrows and symbols'}
BIODRAWS_CAT = [
    ('Human physiology', r'\beye\b|retina|cone cell|rod cell|amacrine|bipolar|ganglion|cornea|lens|accomod|horizontal cell|muller|optic'),
    ('Amino Acids', r'alanine|arginine|asparagine|aspart|cysteine|glutam|glycine|histidine|isoleucine|leucine|lysine|methionine|phenylalanine|proline|serine|threonine|tryptophan|tyrosine|valine'),
    ('Lab apparatus', r'plate|well|tube|flask|pipett|dish|beaker|centrifug|microscope|bottle|rack|incubator'),
    ('Developmental biology', r'embryo|blastocyst|zygote|morula|gastrul|oocyte|sperm|fertili|blastula|neurula'),
    ('Receptors channels', r'antiporter|symporter|uniporter|channel|receptor|transporter|pump'),
    ('Proteins', r'protein|enzyme|kinase|antibod|ligase|polymerase'),
    ('Nucleic acids', r'\bdna\b|\brna\b|chromosome|nucleotide|\bgene\b|plasmid'),
    ('Cells and organelles', r'cell|mitochond|nucleus|golgi|reticulum|vesicle|lysosome|membrane|organelle'),
]

def slug(s, n=60):
    s = re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')
    return s[:n].strip('-') or 'item'

def title(s):
    s = re.sub(r'[_]+', ' ', s); s = re.sub(r'\s+', ' ', s).strip()
    return s[:1].upper() + s[1:]

def git_blob(data: bytes):
    return hashlib.sha1(b'blob %d\0' % len(data) + data).hexdigest()

def sha_upper(data: bytes):
    return 'sha256-' + hashlib.sha256(data).hexdigest().upper()

def keywords(name, cat, extra=()):
    words = [w for w in re.findall(r'[a-z0-9]+', name.lower()) if len(w) > 1][:12]
    out = []
    for w in [name.lower(), *words, cat.lower(), *extra]:
        if w and w not in out: out.append(w[:200])
    return out[:20] or [cat.lower()]

def candidates(existing_paths):
    out = []
    # ---- remaining Bioicons ----
    rev = subprocess.check_output(['git', '-C', '/tmp/bioicons', 'rev-parse', 'HEAD'], text=True).strip()
    authors = json.load(open('/tmp/bioicons/static/icons/authors.json'))
    for p in sorted(glob.glob('/tmp/bioicons/static/icons/*/*/*/*.svg')):
        rel = p[len('/tmp/bioicons/'):]
        if rel in existing_paths: continue
        _, _, licdir, catdir, authdir, fname = rel.split('/')
        lic = BIO_LIC.get(licdir)
        if not lic: continue
        author = authdir.replace('_', ' ').replace('--', ' ').strip()
        servier = 'servier' in author.lower()
        if servier and lic != 'CC-BY-3.0': continue
        name = title(os.path.splitext(fname)[0])
        cat = BIO_CAT.get(catdir, title(catdir.replace('-', ' ')))
        if servier:
            prov, creator, curl = 'Servier Medical Art via Bioicons', 'Servier Medical Art', 'https://smart.servier.com/'
            attr = f"{name} by Servier Medical Art (https://smart.servier.com/), vector edition distributed via Bioicons, licensed under CC BY 3.0 Unported (https://creativecommons.org/licenses/by/3.0/)."
            desc = f"{name}, a Servier Medical Art drawing from the vector edition distributed by Bioicons."
            kw_extra = ('servier', 'servier medical art')
            rid = f"servier-x-{slug(catdir, 24)}-{slug(name, 50)}"
        else:
            prov, creator = 'Bioicons', author
            curl = authors.get(authdir.replace('_', ' ')) or authors.get(author)
            curl = curl if isinstance(curl, str) and curl.startswith('https://') else None
            attr = f"{name} by {author}, distributed via Bioicons under {LICENSES[lic][0]}."
            desc = f"{name}, a reusable scientific vector illustration from Bioicons."
            kw_extra = ()
            rid = f"bioicons-x-{slug(catdir, 24)}-{slug(author, 20)}-{slug(name, 50)}"
        out.append(dict(path=p, id=rid, title=name, category=cat, provider=prov, creator=creator, creator_url=curl,
                        lic=lic, attribution=attr, description=desc, kw=keywords(name, cat, kw_extra),
                        sourceUrl=f'https://github.com/duerrsimon/bioicons/blob/{rev}/{rel}',
                        assetUrl=f'https://raw.githubusercontent.com/duerrsimon/bioicons/{rev}/{rel}', revision=rev, upstream=rel))
    # ---- Reactome ----
    rev = subprocess.check_output(['git', '-C', '/tmp/reactome_illustrations', 'rev-parse', 'HEAD'], text=True).strip()
    for p in sorted(glob.glob('/tmp/reactome_illustrations/icons/*.svg')):
        meta_p = p[:-4] + '.xml'
        meta = open(meta_p, encoding='utf-8', errors='ignore').read() if os.path.exists(meta_p) else ''
        if '<skip>true' in meta: continue
        rid = os.path.basename(p)[:-4]
        m = re.search(r'<name>(.*?)</name>', meta, re.S)
        name = re.sub(r'\s+', ' ', (m.group(1) if m else rid).replace('&amp;', '&')).strip()
        cats = re.findall(r'<category>(.*?)</category>', meta)
        cat = REACTOME_CAT.get(cats[0], 'Proteins') if cats else 'Proteins'
        dm = re.search(r'<person role="designer"(?: url="([^"]*)")?>(.*?)</person>', meta)
        designer = dm.group(2).strip() if dm else 'Reactome'
        durl = dm.group(1) if dm and dm.group(1) and dm.group(1).startswith('https://') else None
        dsc = re.search(r'<description>(.*?)</description>', meta, re.S)
        desc = re.sub(r'\s+', ' ', dsc.group(1)).strip()[:800] if dsc and dsc.group(1).strip() else f"{name}, an icon from the Reactome Icon Library."
        rel = f'icons/{rid}.svg'
        out.append(dict(path=p, id=f"reactome-{rid.lower()}-{slug(name, 60)}", title=name, category=cat,
                        provider='Reactome Icon Library', creator=designer, creator_url=durl, lic='CC-BY-4.0',
                        attribution=f"{name} ({rid}) by {designer}, Reactome Icon Library (https://reactome.org/icon-lib), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).",
                        description=desc, kw=keywords(name, cat, ('reactome', *[c.replace('_', ' ') for c in cats])),
                        sourceUrl=f'https://github.com/reactome/reactome_illustrations/blob/{rev}/{rel}',
                        assetUrl=f'https://raw.githubusercontent.com/reactome/reactome_illustrations/{rev}/{rel}', revision=rev, upstream=rel))
    # ---- BioDraws ----
    rev = subprocess.check_output(['git', '-C', '/tmp/biodraws', 'rev-parse', 'HEAD'], text=True).strip()
    for p in sorted(glob.glob('/tmp/biodraws/*.svg')):
        base = os.path.splitext(os.path.basename(p))[0]
        name = title(re.sub(r'^biodraws?_', '', base, flags=re.I))
        cat = next((c for c, rx in BIODRAWS_CAT if re.search(rx, name, re.I)), 'General items')
        rel = os.path.basename(p)
        from urllib.parse import quote
        out.append(dict(path=p, id=f"biodraws-{slug(name, 90)}", title=name, category=cat, provider='BioDraws',
                        creator='BioDraws', creator_url='https://biodraws.com/', lic='CC-BY-SA-4.0',
                        attribution=f"{name}, BioDraws (https://biodraws.com/), licensed under CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).",
                        description=f"{name}, a scientific vector illustration from BioDraws.", kw=keywords(name, cat, ('biodraws',)),
                        sourceUrl=f'https://github.com/biodraws/biodraws/blob/{rev}/{quote(rel)}',
                        assetUrl=f'https://raw.githubusercontent.com/biodraws/biodraws/{rev}/{quote(rel)}', revision=rev, upstream=rel))
    return out

def main():
    manifest = json.load(open(MANIFEST, encoding='utf-8'))
    ids = {r['id'] for r in manifest}
    existing_paths = {r['source'].get('upstreamPath') for r in manifest}
    todo = [c for c in candidates(existing_paths) if c['id'] not in ids]
    print('candidates', len(todo))
    bundle = open(BUNDLE, encoding='utf-8').read()
    added, failed, reasons = [], 0, {}
    with sync_playwright() as pw:
        exe = os.environ.get('CHROME') or ('/usr/bin/google-chrome' if os.path.exists('/usr/bin/google-chrome') else None)
        browser = pw.chromium.launch(executable_path=exe, args=['--no-sandbox']) if exe else pw.chromium.launch()
        page = browser.new_page()
        page.set_content('<!doctype html><html><body></body></html>')
        page.add_script_tag(content=bundle)
        for k, c in enumerate(todo):
            raw_b = open(c['path'], 'rb').read()
            if len(raw_b) > MAX_BYTES:
                failed += 1; reasons['too large'] = reasons.get('too large', 0) + 1; continue
            raw = raw_b.decode('utf-8', errors='replace').lstrip('﻿')
            res = page.evaluate('raw => window.ingest(raw)', raw)
            if not res['ok']:
                failed += 1; key = res['error'][:60]; reasons[key] = reasons.get(key, 0) + 1; continue
            svg_b = res['svg'].encode('utf-8')
            integ = sha_upper(svg_b)
            open(os.path.join(ARTWORK, integ[7:].lower() + '.svg'), 'wb').write(svg_b)
            uid = c['id'][:118] if c['id'] not in ids else c['id'][:110] + '-' + git_blob(raw_b)[:7]
            while uid in ids: uid = uid[:-1] + 'x'
            ids.add(uid)
            name, url, req = LICENSES[c['lic']]
            changes = res['changes']
            added.append({
                'id': uid, 'title': c['title'][:300], 'description': c['description'], 'keywords': c['kw'],
                'category': c['category'], 'file': slug(uid, 110) + '.svg', 'integrity': integ,
                'source': {'provider': c['provider'], 'sourceUrl': c['sourceUrl'], 'assetUrl': c['assetUrl'],
                           'retrievedAt': TODAY, 'revision': c['revision'], 'upstreamPath': c['upstream']},
                'creator': {'name': c['creator'] or 'Unknown creator', 'url': c['creator_url']},
                'license': {'id': c['lic'], 'name': name, 'url': url, 'attributionRequired': req},
                'attribution': {'text': c['attribution'], 'modified': bool(changes),
                                'modificationNotes': ('; '.join(changes) + '.') if changes else None},
                'verified': True, 'fingerprint': res['fingerprint'],
                'evidence': {'originalIntegrity': sha_upper(raw_b), 'upstreamBlob': git_blob(raw_b), 'policy': POLICY,
                             'changes': changes, 'review': REVIEW},
            })
            if k % 250 == 0: print(f'{k}/{len(todo)} accepted={len(added)} rejected={failed}', flush=True)
        browser.close()
    manifest.extend(added)
    json.dump(manifest, open(MANIFEST, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    open(MANIFEST, 'a').write('\n')
    from collections import Counter
    print('added', len(added), 'rejected', failed)
    print('by provider', Counter(r['source']['provider'] for r in added))
    print('top rejection reasons', sorted(reasons.items(), key=lambda x: -x[1])[:8])

if __name__ == '__main__':
    main()
