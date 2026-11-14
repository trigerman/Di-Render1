import './dom-environment.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import manifest from '../app/src/assets/packs/library-manifest.json' with {type:'json'};
import {sha256,svgFingerprint} from '../app/src/domain/assets/svgFingerprint.ts';
import {sanitizeSvg} from '../app/src/domain/assets/sanitize.ts';
import {assetMetadataSchema} from '../app/src/domain/assets/schema.ts';
import {normalizeLibrarySvg} from '../scripts/normalize-library-svg.mjs';
import {adaptCuratedDrawing} from '../scripts/curated-library-adaptations.mjs';
import {getSeedAssetUrl,getSeedSvg,seedCatalog} from '../app/src/assets/catalog.ts';
import {assetTaxonomy,compareAssetsByTaxonomy,getAssetTaxonomyForCategory,groupAssetsByTopic} from '../app/src/domain/assets/taxonomy.ts';
import legacy from '../app/src/assets/packs/local-cc0.json' with {type:'json'};
import {parseProject} from '../app/src/domain/project/schema.ts';
import {createProject} from '../app/src/domain/project/factory.ts';

test('synchronous SHA-256 matches independent crypto across UTF-8 and padding boundaries',()=>{
  for(const text of ['', 'abc', 'αβ DNA μm 🧬', ...Array.from({length:140},(_,n)=>'x'.repeat(n)), 'a'.repeat(100_000)])
    assert.equal(sha256(text),createHash('sha256').update(text).digest('hex'));
});
test('SVG fingerprint ignores serialization order while binding paths and text',()=>{
  const a='<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><text x="1" y="2">α</text></svg>';
  const b='<svg height="10" width="20" xmlns="http://www.w3.org/2000/svg"><text y="2" x="1">α</text></svg>';
  assert.equal(svgFingerprint(a),svgFingerprint(b));
  assert.notEqual(svgFingerprint(a),svgFingerprint(a.replace('α','β')));
  assert.notEqual(svgFingerprint(a),svgFingerprint(a.replace('x="1"','x="3"')));
});
test('previous-release portable drawings retain their pinned provenance after catalogue expansion',()=>{
  for(const {file,integrity,evidence,...asset} of legacy){
    const project=createProject();project.assets=[asset];
    assert.equal(parseProject(project).assets[0].verified,true,asset.title);
  }
});
test('every shipped public drawing has strict validation, integrity and approved provenance',()=>{
  assert.ok(manifest.length>300);
  assert.equal(new Set(manifest.map(x=>x.id)).size,manifest.length);
  assert.ok(new Set(manifest.map(x=>x.category)).size>=25);
  for(const record of manifest){
    const {fingerprint,evidence,verified,...metadata}=record;assetMetadataSchema.parse(metadata);
    assert.ok(['CC0-1.0','CC-BY-4.0','CC-BY-3.0','CC-BY-SA-3.0','CC-BY-SA-4.0','MIT','Public-Domain'].includes(record.license.id),record.license.id);
    assert.ok(getAssetTaxonomyForCategory(record.category),record.category);
    // Servier drawings ship only from the Bioicons vector edition, credited under CC BY 3.0.
    // Servier drawings ship either from the Bioicons vector edition (CC BY 3.0) or, since Di-Render 0.3,
    // converted from Servier's own PowerPoint kits (CC BY 4.0). Both credit Servier with its URL.
    if(/servier/i.test(JSON.stringify(record))){
      if(record.source.provider==='Servier Medical Art'){
        assert.equal(record.license.id,'CC-BY-4.0');
        assert.match(record.attribution.text,/Servier Medical Art \(https:\/\/smart\.servier\.com\/\).*CC BY 4\.0/);
      } else {
        assert.equal(record.source.provider,'Servier Medical Art via Bioicons');assert.equal(record.license.id,'CC-BY-3.0');
        assert.match(record.attribution.text,/Servier Medical Art \(https:\/\/smart\.servier\.com\/\).*CC BY 3\.0/);
      }
    }
    if(record.source.provider==='NIH BioArt Source')assert.match(record.attribution.text,/NIAID NIH BioArt Source\. bioart\.niaid\.nih\.gov\/bioart\/\d+/);
    const url=getSeedAssetUrl(record);assert.match(url,/^\/artwork\/[a-f0-9]{64}\.svg$/);
    const raw=readFileSync('app/public-browser'+url,'utf8');
    assert.equal('sha256-'+createHash('sha256').update(raw).digest('hex').toUpperCase(),record.integrity,record.title);
    assert.equal(svgFingerprint(sanitizeSvg(raw).svg),fingerprint,record.title);
    assert.equal(verified,true);
    if(record.source.provider==='NIH BioArt Source')assert.ok(Number.isInteger(evidence.upstreamFile.file));
    else assert.match(evidence.upstreamBlob,/^[a-f0-9]{40}$/);
  }
});
test('library shelves hold every drawing once, in taxonomy order when browsing and match order when ranked',()=>{
  const topics=groupAssetsByTopic([...seedCatalog].sort(compareAssetsByTaxonomy));
  assert.deepEqual(topics.map(x=>x.id),assetTaxonomy.map(x=>x.id));
  assert.equal(new Set(topics.flatMap(topic=>topic.shelves.flatMap(shelf=>shelf.assets))).size,seedCatalog.length);
  const byName=new Intl.Collator('en',{sensitivity:'base',numeric:true}).compare;
  for(const topic of topics){
    const names=topic.shelves.map(shelf=>shelf.category);assert.deepEqual(names,[...names].sort(byName));
    assert.equal(topic.count,topic.shelves.reduce((sum,shelf)=>sum+shelf.assets.length,0));
    for(const shelf of topic.shelves)assert.ok(shelf.assets.every(asset=>asset.category===shelf.category&&getAssetTaxonomyForCategory(asset.category).id===topic.id));
  }
  const [virus,otherVirus]=seedCatalog.filter(x=>x.category==='Viruses'),animal=seedCatalog.find(x=>x.category==='Animals');
  const ranked=groupAssetsByTopic([animal,virus,{...otherVirus,category:'Unlisted'},otherVirus]);
  assert.deepEqual(ranked.map(topic=>[topic.id,topic.shelves.map(shelf=>[shelf.category,shelf.assets.length])]),
    [['anatomy-organisms',[['Animals',1]]],['microbes-viruses',[['Viruses',2]]],['other',[['Unlisted',1]]]]);
});
test('browsing shelves list NIH BioArt drawings before other sources, each in title order',()=>{
  const byName=new Intl.Collator('en',{sensitivity:'base',numeric:true}).compare;
  const shelves=groupAssetsByTopic([...seedCatalog].sort(compareAssetsByTaxonomy)).flatMap(topic=>topic.shelves);
  assert.ok(shelves.some(({assets})=>assets[0].source.provider==='NIH BioArt Source'&&assets.at(-1).source.provider!=='NIH BioArt Source'));
  for(const {assets} of shelves){
    const nih=assets.filter(x=>x.source.provider==='NIH BioArt Source');
    assert.deepEqual(assets.slice(0,nih.length),nih);
    for(const part of [nih,assets.slice(nih.length)]){const titles=part.map(x=>x.title);assert.deepEqual(titles,[...titles].sort(byName));}
  }
});
test('maintainer normalization preserves CSS cascade, gradient stops and local references',()=>{
  const raw='<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><style>.a{fill:red}.a,.b{fill:blue;stroke:#fff}</style><linearGradient id="0色"><stop offset="0" stop-color="#fff"/></linearGradient><radialGradient id="paint" xlink:href="#0色"/></defs><path class="a" data-name="editor" style="fill:url(#paint);opacity:.5" d="M0 0L10 10"/></svg>';
  const safe=sanitizeSvg(normalizeLibrarySvg(raw).svg).svg;
  const doc=new DOMParser().parseFromString(safe,'image/svg+xml');
  assert.equal(doc.querySelector('path').getAttribute('fill'),'url(#paint)');
  assert.equal(doc.querySelector('path').getAttribute('stroke'),'#fff');
  assert.equal(doc.querySelector('path').getAttribute('opacity'),'0.5');
  assert.equal(doc.querySelector('radialGradient stop').getAttribute('stop-color'),'#fff');
  assert.doesNotMatch(safe,/xlink:href|<style|class=|data-name=/);
});
test('maintainer normalization rewrites ElementTree namespace prefixes before reference checks',()=>{
  const raw='<ns0:svg xmlns:ns0="http://www.w3.org/2000/svg" xmlns:ns1="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"><metadata><license>Public Domain</license></metadata><ns0:path d="M0 0L10 10" fill="#000"/></ns0:svg>';
  const normalized=normalizeLibrarySvg(raw),safe=sanitizeSvg(normalized.svg).svg;
  assert.ok(normalized.changes.includes('XML namespace prefixes normalized'));
  assert.doesNotMatch(safe,/ns0|ns1|metadata|license/);
  assert.equal(new DOMParser().parseFromString(safe,'image/svg+xml').querySelector('path').getAttribute('d'),'M0 0L10 10');
  assert.throws(()=>normalizeLibrarySvg(raw.replace('<ns0:path','<ns0:linearGradient id="g" ns1:href="other.svg#g"/><ns0:path')),/External reference/);
});
test('normalization never admits active content, unsupported rendering or cyclic templates',()=>{
  for(const content of ['<script/>','<image href="https://evil.invalid/a"/>','<path onload="steal()"/>',
    '<style>@import url(https://evil.invalid);</style>', '<defs><linearGradient id="a" href="#b"/><linearGradient id="b" href="#a"/></defs>',
    '<filter/>','<path style="mix-blend-mode:plus-lighter" d="M0 0L1 1"/>'])
    assert.throws(()=>sanitizeSvg(normalizeLibrarySvg('<svg xmlns="http://www.w3.org/2000/svg">'+content+'</svg>').svg));
});
test('maintainer normalization keeps CSS blending in style, where browsers apply it, and drops its defaults',()=>{
  const raw='<svg xmlns="http://www.w3.org/2000/svg"><defs><style>.a{isolation:isolate}.b{fill:#bfbebe;mix-blend-mode:multiply}.c{mix-blend-mode:normal;isolation:auto}</style></defs><g class="a"><path d="M0 0L10 10" fill="#82a0c4"/><path class="b" d="M0 0L5 5"/><path class="c" d="M1 1L2 2"/></g></svg>';
  const safe=sanitizeSvg(normalizeLibrarySvg(raw).svg).svg;
  const [group,,shade,plain]=new DOMParser().parseFromString(safe,'image/svg+xml').querySelectorAll('g, path');
  assert.equal(group.getAttribute('style'),'isolation: isolate');
  assert.equal(shade.getAttribute('style'),'mix-blend-mode: multiply');assert.equal(shade.getAttribute('fill'),'#bfbebe');
  assert.equal(plain.hasAttribute('style'),false);
  assert.doesNotMatch(safe,/mix-blend-mode="|isolation="/);
});

test('curated incubator is available as a credited vector adaptation without weakening filter rejection',()=>{
  const record=manifest.find(x=>x.id==='bioicons-lab-apparatus-kehan-incubator-e4cc4f80');
  assert.ok(record,'Incubator must be available in the public library');
  assert.equal(record.license.id,'CC0-1.0');
  assert.match(record.attribution.modificationNotes,/three Gaussian-blurred gloss highlights replaced/);
  const raw=readFileSync('app/public-browser'+getSeedAssetUrl(record),'utf8');
  const doc=new DOMParser().parseFromString(sanitizeSvg(raw).svg,'image/svg+xml');
  assert.equal(doc.querySelectorAll('filter').length,0);
  for(const id of ['rect18093','rect13368','rect13368-1'])assert.equal(doc.getElementById(id)?.localName,'rect');
  assert.equal(doc.getElementById('path505').getAttribute('d').trim(),'m 37.684111,60.092845 v 89.682525 l 23.726044,23.75422 V 36.367256 Z');
  assert.throws(()=>adaptCuratedDrawing(record,'<svg/>'),/reviewed source bytes/);
  const hostile='<svg xmlns="http://www.w3.org/2000/svg"><filter/></svg>';
  assert.equal(adaptCuratedDrawing({id:'private-drawing'},hostile).svg,hostile);
  assert.throws(()=>sanitizeSvg(hostile));
});
test('clipping nested in groups is accepted; clipping inside clip paths or under other clipped elements is not',()=>{
  const svg='<svg xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="a"><rect width="20" height="20"/></clipPath><clipPath id="b"><rect width="10" height="10"/></clipPath></defs><g clip-path="url(#a)"><g clip-path="url(#b)"><path d="M0 0L10 10"/></g></g></svg>';
  assert.doesNotThrow(()=>sanitizeSvg(svg));
  assert.doesNotThrow(()=>sanitizeSvg(svg.replace('clip-path="url(#a)"','style="clip-path:url(#a)"')));
  // A clipped group is clipped in user space; bounding-box units would need its rendered bounds.
  assert.throws(()=>sanitizeSvg(svg.replace('<clipPath id="a">','<clipPath id="a" clipPathUnits="objectBoundingBox">')),/nested clipping/);
  assert.throws(()=>sanitizeSvg(svg.replace('<rect width="10" height="10"/>','<rect width="10" height="10" clip-path="url(#a)"/>')),/nested clipping/);
  assert.throws(()=>sanitizeSvg(svg.replace(/<g clip.*<\/g><\/g>/,'<text clip-path="url(#a)"><tspan clip-path="url(#b)">x</tspan></text>')),/nested clipping/);
  assert.doesNotThrow(()=>sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="a"><stop offset="0" style="stop-color:rgb(255,0,0);stop-opacity:0.5"/></linearGradient></defs><rect width="20" height="20" fill="url(#a)"/></svg>'));
});
test('asset loader only fetches manifest paths and rejects MIME or integrity failures',async()=>{
  const record=seedCatalog[0],path=getSeedAssetUrl(record),raw=readFileSync('app/public-browser'+path,'utf8');
  const original=globalThis.fetch;const calls=[];
  try{
    globalThis.fetch=async(url)=>{calls.push(url);return new Response(raw,{headers:{'content-type':'image/svg+xml'}});};
    await getSeedSvg({...record,source:{...record.source,assetUrl:'https://evil.invalid/'},integrity:'sha256-'+'0'.repeat(64)});
    assert.deepEqual(calls,[path]);
    globalThis.fetch=async()=>new Response('<html/>',{headers:{'content-type':'text/html'}});
    await assert.rejects(getSeedSvg(record),/could not be loaded/);
    globalThis.fetch=async()=>new Response(raw.replace('<svg','<svg opacity="0.5"'),{headers:{'content-type':'image/svg+xml'}});
    await assert.rejects(getSeedSvg(record),/integrity check/);
    await assert.rejects(getSeedSvg({...record,id:'unlisted'}),/not in the local pack/);
  }finally{globalThis.fetch=original;}
});
