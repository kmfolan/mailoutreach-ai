# Dock B Survey — Grade Point Transitions

One-off deliverable, unrelated to the MailOutreach AI application code.

Converts every grade point on the `Dock_B_Survey_Surface_ll_a (Model)` survey sheet from
decimal-feet elevations to a rise/drop in inches, so the transitions don't have to be
worked out by hand.

## Files

| File | What it is |
|---|---|
| `Dock_B_Grade_Transitions_1-8.pdf` | 2 pages — the original drawing, then a one-page legend converting all 163 points to the nearest **1/8 in.** |
| `Dock_B_Grade_Transitions.pdf` | 8-page long form: conversion method, abbreviation key, summary by point type, all 163 points by number, Shoring points sorted deepest-first, and the source drawing (rounded to the nearest 1/4 in.) |
| `Dock_B_Grade_Transitions.csv` | Same data as a flat table for spreadsheet use |
| `points.py` | The transcribed point list — `(point_id, elevation_ft, description, note)` |
| `mksimple.py` | Builds the 2-page drawing + 1/8 in. legend PDF |
| `mkpdf.py` | Builds the 8-page PDF |

## Method

Elevations are decimal feet relative to the site datum of `0.000` (the sheet's 0.000
"test" shot, pt. 5). Each value is multiplied by 12 to give the vertical transition in
inches, then rounded to the nearest quarter inch for field use. Negative means the point
sits below datum (step down); positive means step up.

Example — pt. 167, Shoring, −0.650 ft → −0.650 × 12 = −7.8 in. →
**Drops down 7.8 inches (~7 3/4 in.)**

## Transcription caveats

The source PDF is a flat raster with no text layer, so every label was read off the
drawing image. Three items need confirming on site and are flagged in red in the tables:

- **Pts. 101 / 102 (EP)** — the two labels print on top of each other. Separated by pixel
  analysis as 101 = +0.066 and 102 = +0.019; confirm which number goes with which value.
- **One "new" point at +0.250** — its point number is overstruck by linework and is
  illegible. By elimination it is most likely pt. 32.
- **Pts. 1, 2, 12, 17, 27 and 146** do not appear anywhere on the sheet.

Callouts were not placed onto the drawing itself: automated label location only resolved
about 85% of the points reliably, and a partially annotated construction drawing is worse
than an unannotated one. Doing that properly needs the DWG or the surveyor's point CSV
(northing / easting / elevation / description).

## Regenerating

Both scripts expect `content300.png` — a 300 dpi render of the survey sheet — alongside them.

```bash
pip install reportlab pymupdf pillow
python mksimple.py   # 2-page drawing + 1/8 in. legend
python mkpdf.py      # 8-page long form
```
