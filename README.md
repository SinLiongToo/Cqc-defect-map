# CQC Defect Map

A small, static, client-side tool for visualizing semiconductor wafer defect
data from a CSV/TSV/XLSX file: a full wafer die map with defect
highlighting, and a second, always-visible die defect map showing exact
in-die defect locations.

Everything runs in the browser — the file never leaves your machine.

**Live demo:** `https://SinLiongToo.github.io/Cqc-defect-map/`

## Features

- Set wafer size (8" / 12"), die size (X/Y mm), and notch direction
- Upload (or drag & drop) a defect file as **CSV, TSV, or Excel (.xlsx/.xls)**
  — comma, tab, semicolon or pipe delimited text files are auto-detected
- Multi-sheet XLSX workbooks show a **Sheet** picker; the first sheet loads
  by default
- Automatic UTF-8/UTF-16 byte-order-mark (BOM) detection for text files,
  plus a manual encoding selector (Big5, GBK/GB18030, Shift-JIS,
  Windows-1252) for files saved in other locale encodings
- **Wafer map**: every die that geometrically fits the wafer, computed from
  wafer + die size, with dies containing defects color-coded by defect
  count; hover a die to see its (die_X, die_Y) coordinate and defect count
- **Die defect map**: always-visible second view plotting each defect of the
  selected die at its exact (GDS-X, GDS-Y) offset from the die center, with
  a hover tooltip and list showing every column from the CSV for that
  defect. Click any die on the wafer map to inspect it here; it starts
  auto-selected to the die with the most defects
- Dark / light theme toggle (persisted locally), responsive layout for
  desktop and mobile

## Usage

1. Open `index.html` (locally, or via the GitHub Pages URL above).
2. Set **Wafer Size**, **Die Size X/Y**, and **Notch Direction** to match your data.
3. Upload your defect file (CSV, TSV, or XLSX). For text files, if it
   doesn't look right, check **File Encoding** — it's auto-set when a BOM
   is detected, otherwise pick the encoding your export tool used and it
   re-parses immediately. For XLSX workbooks with multiple sheets, pick the
   right one from **Sheet**.
4. Hover dies on the wafer map to inspect coordinates; click a die to see its
   defects in the die defect map below.

## File format

CSV, TSV and XLSX (.xlsx/.xls) are all accepted. One row per defect. Column
names are matched case-insensitively and ignore spaces/underscores/hyphens,
so any of the listed aliases work, for either format:

| Meaning | Accepted column names | Notes |
|---|---|---|
| Die column index | `die_X`, `X coordinate` | integer grid index of the die on the wafer (not mm) |
| Die row index | `die_Y`, `Y coordinate` | integer grid index of the die on the wafer |
| Defect X offset | `GDS-X` | in **mm, relative to the die center** |
| Defect Y offset | `GDS-Y` | in **mm, relative to the die center** |

Any additional columns (defect class, size, ID, etc.) are preserved and shown
in the defect tooltip and detail list in the die defect map — no fixed
schema beyond the four columns above.

**Delimiters** (CSV/TSV/TXT only): comma, tab, semicolon and pipe are
auto-detected — a `.csv`, `.tsv`, or plain `.txt` extension all work.

**Encoding** (CSV/TSV/TXT only): a UTF-8 or UTF-16 byte-order mark (BOM), if
present, is detected and used automatically. Otherwise the file is decoded
as UTF-8 by default; if your data looks garbled (common with text files
exported by locale-specific tools), switch **File Encoding** to match — Big5
and GBK/GB18030 for Traditional/Simplified Chinese exports, Shift-JIS for
Japanese, or Windows-1252 for Western European ANSI exports. Changing the
selector re-decodes the already-loaded file without needing to re-upload.
XLSX files are binary and unaffected by this setting.

**XLSX sheets**: if a workbook has more than one sheet, a **Sheet** dropdown
appears after upload (hidden for single-sheet workbooks); the first sheet
loads by default and switching sheets re-parses without re-uploading.

Sample files are provided at
[`sample-data/sample_defects.csv`](sample-data/sample_defects.csv) and
[`sample-data/sample_defects.xlsx`](sample-data/sample_defects.xlsx) — the
same data in both formats (12", 5mm x 5mm die — the UI's default settings).

## Assumptions / conventions

- **Wafer diameter**: 8" → 200 mm, 12" → 300 mm (standard nominal fab sizes,
  not a literal inch-to-mm conversion).
- **Die grid origin**: die index `(0, 0)` is centered at the wafer center;
  a die's physical center is `(die_X * dieSizeX, die_Y * dieSizeY)` mm. A die
  is drawn if any part of its footprint overlaps the wafer circle (so partial
  edge dies are included, matching typical wafer map tools).
- **Notch direction**: rotates the entire wafer map (circle + die grid +
  notch mark) in 90° steps — Down = 0°, Right = 90°, Up = 180°, Left = 270°
  (clockwise) — as a visual/orientation reference. It does not remap which
  die index is which; it only changes where the notch appears relative to
  the fixed die grid.
- **Defect location**: `GDS-X`/`GDS-Y` are plotted in mm relative to the
  center of their die, so values should generally fall within
  `[-dieSizeX/2, dieSizeX/2]` and `[-dieSizeY/2, dieSizeY/2]`.

## Tech

Plain HTML/CSS/JS, no build step. CSV/TSV parsing via
[PapaParse](https://www.papaparse.com/), XLSX parsing via
[SheetJS](https://sheetjs.com/) (both via CDN). Wafer and die visuals are
rendered as SVG for crisp, resolution-independent hover/click interaction.

```
index.html
css/style.css
js/app.js
sample-data/sample_defects.csv
sample-data/sample_defects.xlsx
```

## Local development

No build tooling required — just open `index.html` in a browser, or serve
the folder with any static file server, e.g.:

```bash
npx serve .
```

## Deployment

This repo is deployed with GitHub Pages, serving directly from the `main`
branch root.
