# Publishing figures made with Di-Render

Short version: **you can publish figures made with Di-Render in journals, theses,
posters and books, including commercial ones, without paying anyone or asking
permission**, as long as you:

1. keep the credit line that Di-Render generates in the figure caption or
   acknowledgments (License panel › *Copy legend*, or *ATTRIBUTIONS.md*), and
2. don't use ShareAlike (CC BY-SA) drawings when your journal publishes under
   CC BY or asks for copyright transfer. Di-Render flags them, and the library's
   *Journal-safe* licence filter hides them.

> Di-Render records licence metadata and applies each source's published terms.
> It is not legal advice. When a journal's instructions disagree with this page,
> follow the journal.

## What each source allows

| Source (items) | Licence | Commercial and journal use | What you must do | Official terms |
|---|---|---|---|---|
| Servier Medical Art kits (4,264) | CC BY 4.0 | Yes, including commercial publications | Credit Servier Medical Art with a link to the licence, and say "adapted" if you changed it | [smart.servier.com/terms-of-use](https://smart.servier.com/terms-of-use), [FAQ](https://smart.servier.com/using-smart-images-what-you-can-do) |
| Servier via Bioicons (1,369) | CC BY 3.0 | Yes | Same credit | [Bioicons](https://github.com/duerrsimon/bioicons) |
| Reactome Icon Library (1,651) | CC BY 4.0 | Yes | Credit Reactome and the icon author | [Reactome licence](https://reactome.org/pages/about/license-agreement/) |
| NIH BioArt Source (706) | Public domain (5 are CC BY 4.0) | Yes | Credit appreciated; required for the CC BY items | [bioart.niaid.nih.gov/terms](https://bioart.niaid.nih.gov/terms) |
| Bioicons (918) | Per icon: CC0, CC BY, MIT, CC BY-SA | Yes | Credit each CC BY or MIT icon's author | [bioicons.com](https://bioicons.com) |
| BioDraws (179) | **CC BY-SA 4.0** | Only where the journal accepts CC BY-SA | See *ShareAlike* below | [biodraws.com](https://biodraws.com) |
| Protein structures from the PDB | CC0 | Yes | Cite the PDB ID, the structure paper, Mol* and RCSB PDB | [RCSB PDB policies](https://www.rcsb.org/pages/policies) |
| AlphaFold DB models | CC BY 4.0 | Yes | Cite Jumper et al. 2021 and the AlphaFold DB paper | [AlphaFold DB licence](https://alphafold.ebi.ac.uk/download) |
| Molecules drawn from SMILES | Your own drawing | Yes | Citing SmilesDrawer is courteous | — |
| Di-Render itself | Apache-2.0 (the software) | — | Nothing: the licence covers the code, not your figures | [LICENSE](../LICENSE) |

All CC BY material in the library is compatible with every major journal model:
CC BY open access (PLOS, eLife, Nature Communications, Frontiers…), hybrid,
and subscription journals that take copyright transfer. The CC BY licence stays
attached to the drawings themselves; you are licensing your figure, not the icons.

## ShareAlike (CC BY-SA)

CC BY-SA requires that anything you build from the drawing is shared under the
same licence. A figure that contains a BY-SA drawing must therefore be CC BY-SA.
PLOS's policy states that it cannot accept CC BY-SA, CC BY-NC or CC BY-ND
material, and journals that take copyright transfer have the same problem.

What Di-Render does about it:

- BY-SA drawings show a **BY-SA** badge in the library (202 of 9,087).
- *Filters › License › Journal-safe (no ShareAlike)* hides them.
- The License panel and status bar warn when a figure contains one.

Your options: replace it with a journal-safe drawing, publish in a venue that
accepts BY-SA, or ask the creator for permission under CC BY.

## How this compares with BioRender

| | Di-Render | BioRender free plan | BioRender paid plan |
|---|---|---|---|
| Publish in journals | Yes | **No** | Yes, with a per-figure publication licence |
| Cost | Free | Free | Subscription |
| Proof of rights | Open licences + generated attribution report | — | Publication licence PDF |
| Reuse of individual icons by readers | Allowed (CC BY) | — | Not allowed: readers can't extract icons |

BioRender's pricing FAQ states that figures made on the free plan can't be used
for publications or commercial use. Its CC BY guidance lets readers reuse a
whole figure but not extract individual BioRender icons.

## If a journal asks for proof

Send them:

1. the **ATTRIBUTIONS.md** file Di-Render exports (every drawing, its creator,
   source URL, licence URL and modifications), and
2. links to the official terms in the table above.

Servier, for example, says it doesn't issue permission letters because the CC BY 4.0
licence is itself the legal permission. The same applies to every CC BY and
public-domain source here.

## Example legend

> Illustrations adapted from Servier Medical Art (https://smart.servier.com/),
> licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).
> Receptor icon by Cristoffer Sevilla, Reactome Icon Library
> (https://reactome.org/icon-lib), licensed under CC BY 4.0. Structure: PDB ID
> 1TUP (RCSB Protein Data Bank, RCSB.org); rendered with Mol* (Sehnal et al.,
> Nucleic Acids Res. 2021).
