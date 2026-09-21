# CQC Defect Map

A small, static, client-side tool for visualizing semiconductor wafer defect
data from a CSV/TSV/XLSX file: a full wafer die map with defect
highlighting, and a second, always-visible die defect map showing exact
in-die defect locations.

Everything runs in the browser — the file never leaves your machine.

**Live demo:** `https://SinLiongToo.github.io/Cqc-defect-map/`

## Features

- Set wafer size (8" / 12"), die size (X/Y mm), scribe lane width (µm),
  edge exclusion (mm), and notch direction
- Upload (or drag & drop) a defect file as **CSV, TSV, or Excel (.xlsx/.xls)**
  — comma, tab, semicolon or pipe delimited text files are auto-detected
- Multi-sheet XLSX workbooks show a **Sheet** picker; the first sheet loads
  by default
- Automatic UTF-8/UTF-16 byte-order-mark (BOM) detection for text files,
  plus a manual encoding selector (Big5, GBK/GB18030, Shift-JIS,
  Windows-1252) for files saved in other locale encodings
- **Wafer map**: every die that geometrically fits the wafer, computed from
  wafer size, die size, and scribe lane width (die pitch = die size +
  scribe lane), with dies containing defects color-coded by defect count.
  Dies inside the edge exclusion ring are dimmed/dashed and excluded from
  the "usable dies" count, with the ring itself drawn as a dashed circle.
  Hover a die to see its (die_X, die_Y) coordinate, defect count, ECID(s)
  if present, and edge-exclusion status
- **Die defect map**: always-visible second view plotting each defect of the
  selected die at its exact (GDS-X, GDS-Y) absolute coordinate, with a
  ruler (tick marks + µm labels, labeled in absolute coordinates to match)
  on both axes, and a hover tooltip and
  list showing ECID (if present) plus every column from the CSV for that
  defect. Click any die on the wafer map to inspect it here; it starts
  auto-selected to the die with the most defects. If the selected die has
  no recorded defects, the plot/ruler are hidden and a plain text message
  is shown instead
- **Wafer center offset**: a die index offset (X/Y) that shifts which
  physical die the wafer's geometric center maps to, in case a fab's die
  numbering doesn't put the wafer center at the simple auto-computed
  midpoint. Set it manually, or click the auto-center icon to derive it
  from the loaded data (centers on the midpoint of the die_X/die_Y range
  actually present in the file)
- **Die size validation**: since GDS-X/GDS-Y are absolute and can't exceed
  the true die size, the app checks loaded data against the current Die
  Size setting and shows a suggestion banner (with a one-click Apply) if
  the data implies a larger die than what's set. An auto-calibrate icon
  next to Die Size (same pattern as the wafer map's auto-center icon) lets
  you recompute it from the loaded data on demand, not just when it's too
  small. Wafer size and scribe lane can't be inferred this way — there's
  no signal for either in typical die_X/die_Y + GDS-X/Y data — so those
  stay manual, with sensible defaults.
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
| Die column index | `die_X`, `X coordinate` | non-negative integer grid index of the die on the wafer (not mm) |
| Die row index | `die_Y`, `Y coordinate` | non-negative integer grid index of the die on the wafer |
| Defect X coordinate | `GDS-X` | in **µm, absolute — origin at the die's own corner**, range `[0, dieSizeX]` |
| Defect Y coordinate | `GDS-Y` | in **µm, absolute — origin at the die's own corner**, range `[0, dieSizeY]` |
| ECID / chip ID *(optional)* | `ECID`, `CQC number`, `CQC ID`, `CQC` | shown prominently in both maps' hover tooltips if present |

Any other columns (defect class, size, etc.) are preserved and shown in the
defect tooltip and detail list in the die defect map — no fixed schema
beyond the columns above.

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
same data in both formats (12", 5mm x 5mm die — the UI's default settings;
note the die indices are centered around 31 to match the first-quadrant
convention below).

## Assumptions / conventions

- **Wafer diameter**: 8" → 200 mm, 12" → 300 mm (standard nominal fab sizes,
  not a literal inch-to-mm conversion).
- **Die pitch = die size + scribe lane**: the physical center-to-center
  spacing between adjacent dies is `dieSize + scribeLaneWidth` (scribe lane
  converted from µm to mm), not the bare die size — dies are drawn at their
  actual size with the scribe lane as the gap between them.
- **Die grid origin (first quadrant)**: `die_X`/`die_Y` are non-negative,
  0-based indices into the theoretical grid's bounding square — die
  `(0, 0)` is the grid's corner, not the wafer center. The wafer center
  falls at index `(centerX, centerY)`, where `centerX`/`centerY` are
  auto-computed as half the total die columns/rows spanning the wafer
  diameter (`ceil(waferRadius / pitchX) + 1`, and likewise for Y) **plus**
  the Wafer Center offset (0 by default). A die's physical center relative
  to the wafer center is therefore
  `((die_X - centerX) * pitchX, (die_Y - centerY) * pitchY)` mm. A die is
  drawn if any part of its footprint overlaps the wafer circle (so partial
  edge dies are included, matching typical wafer map tools).
- **Edge exclusion**: a die counts as usable only if its farthest corner
  from the wafer center stays within `waferRadius - edgeExclusion` — i.e.
  the whole die must clear the exclusion ring, not just its center. Dies
  that don't clear it are still drawn (for visual completeness) but shown
  dimmed with a dashed outline, and are excluded from the "usable dies"
  stat. The exclusion boundary itself is drawn as a dashed circle inside
  the wafer edge.
- **Notch direction**: rotates the entire wafer map (circle + die grid +
  notch mark) in 90° steps — Down = 0°, Right = 90°, Up = 180°, Left = 270°
  (clockwise) — as a visual/orientation reference. It does not remap which
  die index is which; it only changes where the notch appears relative to
  the fixed die grid.
- **Defect location**: `GDS-X`/`GDS-Y` are **absolute** die-local coordinates
  in µm, with the origin at the die's own corner — so the die's center sits
  at `(dieSizeX/2, dieSizeY/2)` in that coordinate system, and valid values
  fall within `[0, dieSizeX]` / `[0, dieSizeY]` once converted to mm (e.g.
  `[0, 5000] µm` for a 5mm die, center at `2500 µm`). The die defect map
  still renders the die as a centered box internally, so each value is
  converted to a centered offset for plotting (`gdsX/1000 - dieSizeX/2`),
  but tooltips and the ruler's tick labels always show the original
  absolute value from the file, not the centered offset.

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
