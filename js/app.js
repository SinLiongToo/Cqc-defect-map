(() => {
  'use strict';

  /* ===================== Constants ===================== */
  const WAFER_DIAMETER_MM = { 8: 200, 12: 300 };
  const NOTCH_ANGLE_DEG = { down: 0, right: 90, up: 180, left: 270 };
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const WAFER_VIEWBOX = 640;
  const WAFER_MARGIN = 36; // px reserved for notch mark + stroke
  const DIE_VIEWBOX = 480;
  const DIE_MARGIN = 40;

  const HEADER_ALIASES = {
    dieX: ['diex', 'xcoordinate', 'x'],
    dieY: ['diey', 'ycoordinate', 'y'],
    gdsX: ['gdsx'],
    gdsY: ['gdsy'],
  };

  /* ===================== State ===================== */
  const state = {
    waferInch: 12,
    dieSizeX: 5,
    dieSizeY: 5,
    notch: 'down',
    records: [],            // [{dieX, dieY, gdsX, gdsY, raw:{...}}]
    defectsByDie: new Map(),// key "x,y" -> records[]
    selectedDie: null,      // {x,y}
    rawBytes: null,         // Uint8Array of the last-loaded text file, kept for re-decoding on encoding change
    workbook: null,         // SheetJS workbook, kept for re-parsing on sheet change (xlsx/xls only)
  };

  /* ===================== DOM refs ===================== */
  const el = (id) => document.getElementById(id);
  const waferSizeSel = el('waferSize');
  const dieSizeXInput = el('dieSizeX');
  const dieSizeYInput = el('dieSizeY');
  const notchSel = el('notchDir');
  const csvInput = el('csvInput');
  const dropzone = el('dropzone');
  const dropzoneLabel = el('dropzoneLabel');
  const csvFileName = el('csvFileName');
  const csvEncoding = el('csvEncoding');
  const csvEncodingField = el('csvEncodingField');
  const csvEncodingNote = el('csvEncodingNote');
  const sheetSelectField = el('sheetSelectField');
  const sheetSelect = el('sheetSelect');
  const csvError = el('csvError');
  const statsPanel = el('statsPanel');
  const statTotalDies = el('statTotalDies');
  const statDefectDies = el('statDefectDies');
  const statTotalDefects = el('statTotalDefects');
  const legend = el('legend');
  const waferSvg = el('waferSvg');
  const waferEmptyState = el('waferEmptyState');
  const dieCard = el('dieCard');
  const dieCardTitle = el('dieCardTitle');
  const dieSvg = el('dieSvg');
  const dieEmptyState = el('dieEmptyState');
  const dieDefectList = el('dieDefectList');
  const closeDieCard = el('closeDieCard');
  const tooltip = el('tooltip');
  const themeToggle = el('themeToggle');
  const themeIconMoon = el('themeIconMoon');
  const themeIconSun = el('themeIconSun');
  const sidebarToggle = el('sidebarToggle');
  const sidebar = el('sidebar');
  const sidebarBackdrop = el('sidebarBackdrop');

  /* ===================== Theme ===================== */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    themeIconMoon.style.display = theme === 'dark' ? '' : 'none';
    themeIconSun.style.display = theme === 'dark' ? 'none' : '';
    try { localStorage.setItem('cqc-defect-map-theme', theme); } catch (e) { /* ignore */ }
  }

  function initTheme() {
    let theme = 'dark';
    try {
      const stored = localStorage.getItem('cqc-defect-map-theme');
      if (stored === 'dark' || stored === 'light') {
        theme = stored;
      } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        theme = 'light';
      }
    } catch (e) { /* ignore */ }
    applyTheme(theme);
  }

  themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

  /* ===================== Mobile sidebar ===================== */
  function setSidebarOpen(open) {
    sidebar.classList.toggle('open', open);
    sidebarBackdrop.classList.toggle('open', open);
    sidebarToggle.setAttribute('aria-expanded', String(open));
  }
  sidebarToggle.addEventListener('click', () => setSidebarOpen(!sidebar.classList.contains('open')));
  sidebarBackdrop.addEventListener('click', () => setSidebarOpen(false));

  /* ===================== Tooltip ===================== */
  function showTooltip(x, y, text) {
    tooltip.textContent = text;
    tooltip.hidden = false;
    const pad = 14;
    let left = x + pad;
    let top = y + pad;
    const rect = tooltip.getBoundingClientRect();
    if (left + rect.width > window.innerWidth) left = x - rect.width - pad;
    if (top + rect.height > window.innerHeight) top = y - rect.height - pad;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }
  function hideTooltip() { tooltip.hidden = true; }

  /* ===================== CSV parsing ===================== */
  function normalizeHeader(h) {
    return String(h || '').toLowerCase().replace(/[\s_-]+/g, '');
  }

  function matchColumn(headers, aliasList) {
    const normalized = headers.map(normalizeHeader);
    for (const alias of aliasList) {
      const idx = normalized.indexOf(alias);
      if (idx !== -1) return headers[idx];
    }
    return null;
  }

  const BOM_SIGNATURES = [
    { bytes: [0xEF, 0xBB, 0xBF], encoding: 'utf-8', length: 3 },
    { bytes: [0xFF, 0xFE], encoding: 'utf-16le', length: 2 },
    { bytes: [0xFE, 0xFF], encoding: 'utf-16be', length: 2 },
  ];

  function detectBom(bytes) {
    for (const sig of BOM_SIGNATURES) {
      if (bytes.length >= sig.bytes.length && sig.bytes.every((b, i) => bytes[i] === b)) {
        return sig;
      }
    }
    return null;
  }

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Failed to read file.'));
      reader.readAsArrayBuffer(file);
    });
  }

  function decodeCsvBytes(bytes, manualEncoding) {
    const bom = detectBom(bytes);
    const encoding = bom ? bom.encoding : manualEncoding;
    const offset = bom ? bom.length : 0;
    let text;
    try {
      text = new TextDecoder(encoding, { fatal: false }).decode(bytes.subarray(offset));
    } catch (e) {
      text = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(offset));
    }
    text = text.replace(/^﻿/, '');
    return { text, detectedEncoding: bom ? bom.encoding : null };
  }

  function fileExt(file) {
    const parts = file.name.toLowerCase().split('.');
    return parts.length > 1 ? parts.pop() : '';
  }

  async function handleFileSelected(file) {
    csvError.hidden = true;
    csvEncodingNote.textContent = '';
    const ext = fileExt(file);
    try {
      if (ext === 'xlsx' || ext === 'xls') {
        await loadXlsxFile(file);
      } else {
        state.workbook = null;
        sheetSelectField.hidden = true;
        csvEncodingField.hidden = false;
        const buffer = await readFileAsArrayBuffer(file);
        state.rawBytes = new Uint8Array(buffer);
        decodeAndParseText();
      }
    } catch (err) {
      showCsvError(err.message || 'Failed to read file.');
    }
  }

  function decodeAndParseText() {
    if (!state.rawBytes) return;
    csvError.hidden = true;
    const { text, detectedEncoding } = decodeCsvBytes(state.rawBytes, csvEncoding.value);
    if (detectedEncoding) {
      csvEncoding.value = detectedEncoding;
      csvEncodingNote.textContent = `Detected a ${detectedEncoding.toUpperCase()} byte-order mark — using it automatically.`;
    } else {
      csvEncodingNote.textContent = '';
    }
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      delimitersToGuess: [',', '\t', ';', '|'],
      complete: (results) => {
        try {
          handleParsedCsv(results.data, results.meta.fields || []);
        } catch (err) {
          showCsvError(err.message);
        }
      },
      error: (err) => showCsvError(err.message || 'Failed to parse file.'),
    });
  }

  async function loadXlsxFile(file) {
    state.rawBytes = null;
    csvEncodingField.hidden = true;
    const buffer = await readFileAsArrayBuffer(file);
    const workbook = XLSX.read(buffer, { type: 'array' });
    if (!workbook.SheetNames.length) {
      throw new Error('Workbook has no sheets.');
    }
    state.workbook = workbook;

    sheetSelect.innerHTML = '';
    for (const name of workbook.SheetNames) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sheetSelect.appendChild(opt);
    }
    sheetSelectField.hidden = workbook.SheetNames.length < 2;

    parseWorkbookSheet(workbook.SheetNames[0]);
  }

  function parseWorkbookSheet(sheetName) {
    if (!state.workbook || !state.workbook.Sheets[sheetName]) return;
    csvError.hidden = true;
    sheetSelect.value = sheetName;
    const sheet = state.workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
    const headerRow = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true })[0] || [];
    const headers = headerRow.map((h) => String(h));
    try {
      handleParsedCsv(rows, headers);
    } catch (err) {
      showCsvError(err.message);
    }
  }

  function showCsvError(msg) {
    csvError.textContent = msg;
    csvError.hidden = false;
  }

  function handleParsedCsv(rows, headers) {
    const dieXCol = matchColumn(headers, HEADER_ALIASES.dieX);
    const dieYCol = matchColumn(headers, HEADER_ALIASES.dieY);
    const gdsXCol = matchColumn(headers, HEADER_ALIASES.gdsX);
    const gdsYCol = matchColumn(headers, HEADER_ALIASES.gdsY);

    const missing = [];
    if (!dieXCol) missing.push('die_X / X coordinate');
    if (!dieYCol) missing.push('die_Y / Y coordinate');
    if (!gdsXCol) missing.push('GDS-X');
    if (!gdsYCol) missing.push('GDS-Y');
    if (missing.length) {
      throw new Error(`CSV is missing required column(s): ${missing.join(', ')}`);
    }

    const knownCols = new Set([dieXCol, dieYCol, gdsXCol, gdsYCol]);
    const extraCols = headers.filter((h) => !knownCols.has(h));

    const records = [];
    for (const row of rows) {
      const dieX = Number(row[dieXCol]);
      const dieY = Number(row[dieYCol]);
      const gdsXUm = Number(row[gdsXCol]);
      const gdsYUm = Number(row[gdsYCol]);
      if (!Number.isFinite(dieX) || !Number.isFinite(dieY) || !Number.isFinite(gdsXUm) || !Number.isFinite(gdsYUm)) {
        continue; // skip malformed rows
      }
      const raw = {};
      for (const col of extraCols) raw[col] = row[col];
      // GDS-X/GDS-Y are given in micrometers; convert to mm (matches die size units) for plotting.
      records.push({ dieX, dieY, gdsXUm, gdsYUm, gdsX: gdsXUm / 1000, gdsY: gdsYUm / 1000, raw });
    }

    if (!records.length) {
      throw new Error('No valid defect rows found in CSV.');
    }

    state.records = records;
    state.defectsByDie = new Map();
    for (const rec of records) {
      const key = `${rec.dieX},${rec.dieY}`;
      if (!state.defectsByDie.has(key)) state.defectsByDie.set(key, []);
      state.defectsByDie.get(key).push(rec);
    }
    // Auto-select the die with the most defects so both maps are populated immediately.
    let busiestKey = null;
    let busiestCount = -1;
    for (const [key, defects] of state.defectsByDie) {
      if (defects.length > busiestCount) { busiestCount = defects.length; busiestKey = key; }
    }
    state.selectedDie = null;
    render();
    if (busiestKey) {
      const [bx, by] = busiestKey.split(',').map(Number);
      selectDie(bx, by);
    }
  }

  csvInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    csvFileName.textContent = file.name;
    dropzoneLabel.textContent = 'Replace file';
    handleFileSelected(file);
  });

  ['dragenter', 'dragover'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); });
  });
  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    csvInput.files = e.dataTransfer.files;
    csvFileName.textContent = file.name;
    dropzoneLabel.textContent = 'Replace file';
    handleFileSelected(file);
  });

  csvEncoding.addEventListener('change', () => decodeAndParseText());
  sheetSelect.addEventListener('change', () => parseWorkbookSheet(sheetSelect.value));

  /* ===================== Inputs ===================== */
  function readInputs() {
    state.waferInch = Number(waferSizeSel.value);
    state.dieSizeX = Math.max(0.1, Number(dieSizeXInput.value) || 5);
    state.dieSizeY = Math.max(0.1, Number(dieSizeYInput.value) || 5);
    state.notch = notchSel.value;
  }
  [waferSizeSel, dieSizeXInput, dieSizeYInput, notchSel].forEach((input) => {
    input.addEventListener('change', () => { readInputs(); render(); });
  });

  /* ===================== Wafer geometry ===================== */
  function computeDieGrid() {
    const diameterMm = WAFER_DIAMETER_MM[state.waferInch];
    const radiusMm = diameterMm / 2;
    const { dieSizeX, dieSizeY } = state;
    const maxI = Math.ceil(radiusMm / dieSizeX) + 1;
    const maxJ = Math.ceil(radiusMm / dieSizeY) + 1;
    const dies = [];

    // die_X/die_Y in the CSV are non-negative (first-quadrant indexing), with the
    // wafer center falling at index (maxI, maxJ) — i.e. index 0 is the corner of
    // the theoretical grid's bounding square, not the wafer center itself.
    for (let i = -maxI; i <= maxI; i++) {
      for (let j = -maxJ; j <= maxJ; j++) {
        const cx = i * dieSizeX;
        const cy = j * dieSizeY;
        const halfX = dieSizeX / 2;
        const halfY = dieSizeY / 2;
        // closest point on die rect to wafer center (0,0)
        const closestX = Math.max(cx - halfX, Math.min(0, cx + halfX));
        const closestY = Math.max(cy - halfY, Math.min(0, cy + halfY));
        const dist = Math.hypot(closestX, closestY);
        if (dist <= radiusMm) {
          dies.push({ i: i + maxI, j: j + maxJ, cx, cy });
        }
      }
    }
    return { dies, radiusMm, diameterMm };
  }

  function defectBucketColor(count) {
    if (count <= 0) return null;
    if (count <= 2) return 'var(--warning)';
    if (count <= 5) return 'var(--accent-2)';
    return 'var(--danger)';
  }

  function renderLegend() {
    legend.innerHTML = '';
    const items = [
      { label: 'No defect', color: 'var(--die-empty-fill)' },
      { label: '1–2 defects', color: 'var(--warning)' },
      { label: '3–5 defects', color: 'var(--accent-2)' },
      { label: '6+ defects', color: 'var(--danger)' },
    ];
    for (const item of items) {
      const wrap = document.createElement('span');
      wrap.className = 'legend-item';
      wrap.innerHTML = `<span class="legend-swatch" style="background:${item.color}"></span>${item.label}`;
      legend.appendChild(wrap);
    }
  }

  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  function renderWafer() {
    readInputs();
    waferSvg.innerHTML = '';

    const { dies, radiusMm, diameterMm } = computeDieGrid();
    const usableRadiusPx = (WAFER_VIEWBOX / 2) - WAFER_MARGIN;
    const mmToPx = usableRadiusPx / radiusMm;
    const centerPx = WAFER_VIEWBOX / 2;

    const group = svgEl('g', {
      transform: `rotate(${NOTCH_ANGLE_DEG[state.notch]} ${centerPx} ${centerPx})`,
    });

    // wafer circle
    group.appendChild(svgEl('circle', {
      class: 'wafer-circle', cx: centerPx, cy: centerPx, r: usableRadiusPx,
    }));

    // notch mark (bottom, before rotation)
    const notchSize = 10;
    const ny = centerPx + usableRadiusPx;
    group.appendChild(svgEl('path', {
      class: 'notch-mark',
      d: `M ${centerPx - notchSize} ${ny} L ${centerPx} ${ny - notchSize} L ${centerPx + notchSize} ${ny} Z`,
    }));

    let defectDieCount = 0;
    let totalDefects = 0;

    for (const die of dies) {
      const key = `${die.i},${die.j}`;
      const defects = state.defectsByDie.get(key);
      const count = defects ? defects.length : 0;
      if (count > 0) { defectDieCount++; totalDefects += count; }

      const w = state.dieSizeX * mmToPx;
      const h = state.dieSizeY * mmToPx;
      const x = centerPx + die.cx * mmToPx - w / 2;
      const y = centerPx - die.cy * mmToPx - h / 2;

      const fill = defectBucketColor(count) || 'var(--die-empty-fill)';
      const rect = svgEl('rect', {
        class: 'die-rect', x, y, width: Math.max(w - 0.6, 0.5), height: Math.max(h - 0.6, 0.5),
        fill, stroke: 'var(--die-empty-stroke)',
        'data-die-x': die.i, 'data-die-y': die.j, 'data-count': count,
      });
      rect.addEventListener('mouseenter', (e) => {
        showTooltip(e.clientX, e.clientY, `Die (${die.i}, ${die.j})\nDefects: ${count}`);
      });
      rect.addEventListener('mousemove', (e) => {
        showTooltip(e.clientX, e.clientY, `Die (${die.i}, ${die.j})\nDefects: ${count}`);
      });
      rect.addEventListener('mouseleave', hideTooltip);
      rect.addEventListener('click', () => selectDie(die.i, die.j));
      group.appendChild(rect);
    }

    waferSvg.appendChild(group);
    waferEmptyState.hidden = state.records.length > 0;

    statsPanel.hidden = state.records.length === 0;
    statTotalDies.textContent = dies.length.toLocaleString();
    statDefectDies.textContent = defectDieCount.toLocaleString();
    statTotalDefects.textContent = totalDefects.toLocaleString();
    renderLegend();

    // reflect current selection highlight, if any
    if (state.selectedDie) {
      const sel = waferSvg.querySelector(
        `.die-rect[data-die-x="${state.selectedDie.x}"][data-die-y="${state.selectedDie.y}"]`
      );
      if (sel) sel.classList.add('selected');
    }
  }

  /* ===================== Die inspector ===================== */
  function selectDie(x, y) {
    const key = `${x},${y}`;
    const defects = state.defectsByDie.get(key) || [];
    state.selectedDie = { x, y };
    dieEmptyState.hidden = true;
    dieCardTitle.textContent = `Die (${x}, ${y}) — ${defects.length} defect${defects.length === 1 ? '' : 's'}`;
    renderDieDetail(defects);
    renderWafer(); // refresh selection outline
    dieCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderDieDetail(defects) {
    dieSvg.innerHTML = '';
    dieDefectList.innerHTML = '';

    const usableHalf = (DIE_VIEWBOX / 2) - DIE_MARGIN;
    const halfMmX = state.dieSizeX / 2;
    const halfMmY = state.dieSizeY / 2;
    const mmToPx = usableHalf / Math.max(halfMmX, halfMmY);
    const centerPx = DIE_VIEWBOX / 2;

    const dieW = state.dieSizeX * mmToPx;
    const dieH = state.dieSizeY * mmToPx;

    dieSvg.appendChild(svgEl('rect', {
      class: 'die-outline',
      x: centerPx - dieW / 2, y: centerPx - dieH / 2, width: dieW, height: dieH,
    }));
    dieSvg.appendChild(svgEl('line', {
      class: 'axis-line', x1: centerPx - dieW / 2, y1: centerPx, x2: centerPx + dieW / 2, y2: centerPx,
    }));
    dieSvg.appendChild(svgEl('line', {
      class: 'axis-line', x1: centerPx, y1: centerPx - dieH / 2, x2: centerPx, y2: centerPx + dieH / 2,
    }));
    dieSvg.appendChild(svgEl('text', {
      class: 'axis-label', x: centerPx + dieW / 2 - 4, y: centerPx - 6, 'text-anchor': 'end',
    })).textContent = `+X`;
    dieSvg.appendChild(svgEl('text', {
      class: 'axis-label', x: centerPx + 6, y: centerPx - dieH / 2 + 10,
    })).textContent = `+Y`;

    defects.forEach((rec, idx) => {
      const px = centerPx + rec.gdsX * mmToPx;
      const py = centerPx - rec.gdsY * mmToPx;
      const dot = svgEl('circle', { class: 'defect-dot', cx: px, cy: py, r: 5, 'data-idx': idx });
      const tipLines = [`Defect #${idx + 1}`, `GDS-X: ${rec.gdsXUm} µm`, `GDS-Y: ${rec.gdsYUm} µm`];
      for (const [k, v] of Object.entries(rec.raw)) tipLines.push(`${k}: ${v}`);
      const tipText = tipLines.join('\n');
      dot.addEventListener('mouseenter', (e) => showTooltip(e.clientX, e.clientY, tipText));
      dot.addEventListener('mousemove', (e) => showTooltip(e.clientX, e.clientY, tipText));
      dot.addEventListener('mouseleave', hideTooltip);
      dieSvg.appendChild(dot);

      const row = document.createElement('div');
      row.className = 'defect-row';
      let rowHtml = `<div><span class="k">GDS-X</span><span>${rec.gdsXUm} µm</span></div><div><span class="k">GDS-Y</span><span>${rec.gdsYUm} µm</span></div>`;
      for (const [k, v] of Object.entries(rec.raw)) {
        rowHtml += `<div><span class="k">${escapeHtml(k)}</span><span>${escapeHtml(String(v))}</span></div>`;
      }
      row.innerHTML = rowHtml;
      dieDefectList.appendChild(row);
    });

    if (!defects.length) {
      const empty = document.createElement('p');
      empty.className = 'muted small';
      empty.textContent = 'No defects recorded for this die.';
      dieDefectList.appendChild(empty);
    }
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  closeDieCard.addEventListener('click', () => {
    state.selectedDie = null;
    dieCardTitle.textContent = '–';
    dieSvg.innerHTML = '';
    dieDefectList.innerHTML = '';
    dieEmptyState.hidden = false;
    renderWafer();
  });

  /* ===================== Render orchestration ===================== */
  function render() {
    renderWafer();
  }

  /* ===================== Init ===================== */
  initTheme();
  render();
})();
