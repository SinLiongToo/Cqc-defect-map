# CQC Defect Map

A small, static, client-side tool for visualizing semiconductor wafer defect
data from a CSV/TSV/XLSX file: a full wafer die map with defect
highlighting, side by side with a composite die defect map plotting every
defect from every die in the die's local coordinate system.

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
- **Die defect map**: a composite view plotting *every* defect from *every*
  die at its exact (GDS-X, GDS-Y) absolute coordinate, in the shared
  die-local coordinate system (all dies use the same Die Size), with grid
  lines (red by default, denser than before, color customizable via
  **Grid Color**, and toggleable with the ruler's coordinate numbers via
  the header icon) and a ruler (tick marks + µm labels, in absolute
  coordinates matching the tooltips) on both axes — useful for spotting
  systematic vs. random defect clustering across the whole wafer.
  **Selection is per-defect on this plot**: clicking (or Ctrl/Shift-drag
  boxing) a dot highlights exactly that defect (or those defects) —
  picking one corner of a die doesn't light up that die's other, unrelated
  defects elsewhere on the plot. Clicking a die on the **wafer map**
  instead selects that die's *entire* set of defects as a block (it has no
  way to target one specific defect), syncing an outline back there too.
  Either way, a plain click on empty space clears the whole selection, and
  the defect list to the right of the plot always matches exactly what's
  highlighted (labeled per-die when more than one die is represented). All
  of this keeps working after opening Full View — the toolbar (GDS Origin
  Offset, Rotation, Grid Color, coordinate-number toggle) moves into the
  modal along with the plot, rather than being stranded behind it. Starts
  auto-highlighted on the die with the most defects (as a block); "Clear
  selection" drops the highlight but keeps the composite plot visible. A
  **Rotation** control (0°/90°/180°/270°) spins the whole plot to match a
  die's actual physical orientation — grid, ticks, and dots rotate
  together while labels stay upright. The two maps sit side by side on
  wide screens (≥1200px) and stack on narrower ones
- On wide screens, side-by-side maps means the die defect map's own plot +
  list also stack (rather than sitting side by side) between ~1200–1599px,
  where there isn't room for both; at ≥1600px there's room for everything
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
- **GDS origin calibration**: on the die defect map itself, a "GDS Origin
  Offset (µm)" X/Y control (with its own auto-calibrate icon, same pattern
  again) nudges the assumed die center away from the default `dieSize/2` —
  useful when an inspection tool's coordinate output has a consistent
  measurement bias. Auto-calibrate derives the target center purely from
  the loaded data (the min/max midpoint of all defects' GDS-X/GDS-Y) with
  no reference to Die Size, and keeps that absolute center locked in even
  if Die Size is changed afterward — the displayed offset value updates to
  match, but the actual calibrated position doesn't drift. Editing the
  offset fields by hand releases that lock. Tooltips and the ruler still
  show/label the real values from the file; only the plotted position
  shifts.
- **Pareto chart**: below the two maps, counts how often each value of *any*
  loaded column occurs — pick the column from the **Column** dropdown (every
  die_X/die_Y/GDS-X/GDS-Y/ECID field plus every extra column in the file is
  offered; defaults to the first extra column, since that's most often a
  defect classification). Bars are sorted most-to-least common with a
  cumulative-percentage line overlaid, and a dashed 80% reference line marks
  the classic "vital few" cutoff — bars up to that point are highlighted,
  the rest dimmed. Beyond 15 distinct values the tail is collapsed into a
  single "Others (N values)" bucket so the chart and its labels stay
  readable; hovering a bar (or its label) shows the exact count, percentage,
  and cumulative percentage, and the same numbers are listed beside the
  chart. Always reflects every loaded defect regardless of what's selected
  on the wafer/die maps — it answers "what dominates overall," not "what's
  in the current selection."
  **Group by** (optional, defaults to off): pick a second column to split
  each bar into a stacked breakdown by that column's values — e.g. Pareto
  of `defect_class`, each bar broken down by `equipment`. Up to 8 distinct
  values get their own color (a validated, colorblind-safe categorical
  palette, checked against this app's actual light/dark chart backgrounds);
  beyond that, the rest collapse into a shared gray "Other" segment rather
  than inventing more colors. A given value always gets the same color
  everywhere on the chart, regardless of which bar it appears in. A legend
  appears whenever 2+ series are shown, and every bar's exact per-segment
  counts are also listed in the panel beside the chart — color is never the
  only way to read a value. The "vital few" highlighting still applies on
  top, as an opacity difference, independent of the segment colors — it
  answers "does this whole bar matter" while the colors answer "what's it
  made of."
- **Trend chart**: sits beside the Pareto chart, counting defect rows per
  date. The **Date column** dropdown only offers columns whose header
  contains "date" (case-insensitive) — if none exist, it's disabled with an
  explanatory message instead of guessing. Two value formats are
  recognized: a bare 4-digit **work-week code** (`YYWW` — 2-digit year +
  2-digit ISO week, e.g. `2405` = 2024, week 5, a common fab lot/date-code
  convention), matched and handled *before* anything else, since
  JavaScript's generic date parser would otherwise silently misread it as
  the literal (nonsensical) calendar year 2405; and anything else parseable
  by `new Date(...)`, grouped down to its calendar date (year-month-day) so
  a column with a time-of-day component doesn't produce a near-unique
  bucket per row. Rows with a blank, invalid-week (`WW` outside 1–53), or
  otherwise unparseable value are excluded from the line (with a count of
  how many, below the chart) rather than breaking the timeline. Points are
  plotted in true chronological order (by real timestamp, not label text —
  so e.g. work-week `2352` correctly sorts before `2401`) but only for
  dates/weeks that actually appear in the data — gaps are **not** filled in
  as zero, since the column's real granularity (daily, weekly, per-lot...)
  isn't known. Beyond 12 points, most x-axis text labels are thinned out to
  stay legible; every point is still plotted and shows its exact date/count
  on hover.
- **Full view**: every plot — wafer map, die defect map, Pareto chart, and
  Trend chart — has its own icon in its header that opens it in a large
  shared modal (the same live SVG/list elements are reparented in and back
  out on close, not cloned, so no data, state, or interactivity is ever
  lost). Still scoped/filtered exactly the same as inline; just bigger.
- **User guide**: a help icon in the top bar opens a modal with a quick
  getting-started walkthrough and the full file format reference (moved
  out of the sidebar to keep it uncluttered).
- Dark / light theme toggle (persisted locally), responsive layout for
  desktop and mobile
- **Version footer**: the page footer shows the app's version and when it
  was last updated, bumped by hand on each release (there's no build step
  to derive it automatically).

## Usage

1. Open `index.html` (locally, or via the GitHub Pages URL above).
2. Upload your defect file (CSV, TSV, or XLSX) at the top of the sidebar.
   For text files, if it doesn't look right, check **File Encoding** —
   it's auto-set when a BOM is detected, otherwise pick the encoding your
   export tool used and it re-parses immediately. For XLSX workbooks with
   multiple sheets, pick the right one from **Sheet**.
3. Set **Wafer Size**, **Die Size X/Y**, and **Notch Direction** to match
   your data (before or after uploading — both work).
4. Hover dies on the wafer map to inspect coordinates; click a die to
   highlight all of its defects in the die defect map (side by side, or
   below it on narrower screens) — or click an individual dot there to
   highlight just that one defect. Ctrl/Cmd/Shift-click (or -drag a box) on
   either map adds more to the selection instead of replacing it; click
   empty space to clear the whole selection.
5. Click the full-view icon in any plot's header (wafer map, die defect
   map, Pareto chart, Trend chart) to inspect it at a larger size, or the
   help icon in the top bar for a walkthrough and the file format reference
   at any time.
6. Scroll down to the **Pareto Chart** and pick any column from the
   dropdown to see which of its values dominate across every loaded defect;
   the **Trend Chart** beside it does the same over time, for any column
   whose name contains "date".

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

**Blank cells**: a blank/empty numeric cell is never silently treated as
`0`. The two coordinate pairs are handled independently:
- A row with a blank/non-numeric `die_X` or `die_Y` can't be attributed to
  any die, so it's dropped entirely — it won't appear on either map.
- A row with valid `die_X`/`die_Y` but a blank/non-numeric `GDS-X` or
  `GDS-Y` still counts toward that die's defect count on the **wafer map**
  (color, hover, stats) — it's only excluded from being plotted as a dot on
  the **die defect map**, where it instead appears in the defect list with
  `N/A` and a "not plotted" note.

A note below the file picker reports how many rows fell into each category,
if any.

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

## Terminology

A file can have more than one column with "date" in its name, each meaning
something different along a typical fab-to-field timeline — worth knowing
which is which before picking one for the Trend Chart:

- **Fab date** — when the die itself was manufactured at the fab.
- **Date code** — when the device was assembled/packaged. Normally on or
  after the fab date, but that ordering isn't guaranteed if the assembly
  used leftover (older) die stock.
- **Return date** — when the part came back for CQC analysis. Typically
  around six months after the date code, if the return cycle is relatively
  quick.

**Die defect map** plots each defect's physical location from
failure-analysis results, showing which circuit or which physical layer is
affected. **Wafer map** shows the defect distribution across the whole
wafer — useful for spotting any commonality in the wafer's physical layout,
and worth comparing against the fab's own wafer defect map (if available)
to see whether a pattern originated at the fab or downstream.

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
  converted to a centered offset for plotting
  (`(gdsX - dieSizeX*1000/2 - gdsOffsetX) / 1000`), but tooltips always
  show the original absolute value from the file, and the ruler's tick
  labels show that same absolute value at each tick's position — both
  unaffected by the GDS Origin Offset, which only shifts where a given
  value lands, not what's displayed for it.
- **Die defect map scale never clips real data**: the plot's scale is based
  on whichever is larger, Die Size or the actual spread of loaded
  GDS-X/GDS-Y around the calibrated center. An SVG's root element clips
  anything past its viewBox by default, so if the scale were based on Die
  Size alone, a defect further out than Die Size wouldn't just render
  outside the drawn die-outline rectangle as intended — it could silently
  vanish. The die outline itself is still drawn at its true (possibly much
  smaller) size in this scale, so it's visually obvious when Die Size
  doesn't match the data — check the Die Size hint banner in that case.

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

## Versioning

`APP_VERSION` and `APP_UPDATED` near the top of `js/app.js` drive the
version/updated-date line in the page footer. There's no build step to
derive either automatically, so they're bumped by hand as part of shipping
any change — see the `ship` skill (`.claude/skills/ship/SKILL.md`), which
includes this as one of its steps.
