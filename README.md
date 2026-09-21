# CQC Defect Map

A small, static, client-side tool for visualizing semiconductor wafer defect
data from a CSV file: a full wafer die map with defect highlighting, and a
per-die zoom view showing exact in-die defect locations.

Everything runs in the browser — the CSV never leaves your machine.

**Live demo:** `https://SinLiongToo.github.io/Cqc-defect-map/`

## Features

- Set wafer size (8" / 12"), die size (X/Y mm), and notch direction
- Upload (or drag & drop) a defect CSV
- Full wafer map: every die that geometrically fits the wafer, computed from
  wafer + die size, with dies containing defects color-coded by defect count
- Hover a die to see its (die_X, die_Y) coordinate and defect count
- Click a die to open the Die Inspector: a zoomed view plotting each defect
  at its exact (GDS-X, GDS-Y) offset from the die center, with a hover
  tooltip and list showing every column from the CSV for that defect
- Dark / light theme toggle (persisted locally), responsive layout for
  desktop and mobile

## Usage

1. Open `index.html` (locally, or via the GitHub Pages URL above).
2. Set **Wafer Size**, **Die Size X/Y**, and **Notch Direction** to match your data.
3. Upload your defect CSV.
4. Hover dies on the wafer map to inspect coordinates; click a die to see its
   defects in detail.

## CSV format

One row per defect. Column names are matched case-insensitively and ignore
spaces/underscores/hyphens, so any of the listed aliases work:

| Meaning | Accepted column names | Notes |
|---|---|---|
| Die column index | `die_X`, `X coordinate` | integer grid index of the die on the wafer (not mm) |
| Die row index | `die_Y`, `Y coordinate` | integer grid index of the die on the wafer |
| Defect X offset | `GDS-X` | in **mm, relative to the die center** |
| Defect Y offset | `GDS-Y` | in **mm, relative to the die center** |

Any additional columns (defect class, size, ID, etc.) are preserved and shown
in the defect tooltip and detail list in the Die Inspector — no fixed schema
beyond the four columns above.

A sample file is provided at [`sample-data/sample_defects.csv`](sample-data/sample_defects.csv)
(12", 5mm x 5mm die — the UI's default settings).

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

Plain HTML/CSS/JS, no build step. CSV parsing via
[PapaParse](https://www.papaparse.com/) (CDN). Wafer and die visuals are
rendered as SVG for crisp, resolution-independent hover/click interaction.

```
index.html
css/style.css
js/app.js
sample-data/sample_defects.csv
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
