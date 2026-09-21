(() => {
  'use strict';

  /* ===================== Constants ===================== */
  // Bumped by hand on each ship (see the "ship" skill) -- there's no build
  // step to derive this from automatically, so it's the one thing that has
  // to be remembered and edited alongside a release rather than computed.
  const APP_VERSION = 'v1.1.0';
  const APP_UPDATED = '2026-09-22 02:22 (UTC+8)';
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
    ecid: ['ecid', 'cqcnumber', 'cqcno', 'cqcid', 'cqc'],
  };

  /* ===================== State ===================== */
  const state = {
    waferInch: 12,
    dieSizeX: 5,
    dieSizeY: 5,
    scribeLaneUm: 80,
    edgeExclusionMm: 3,
    centerOffsetX: 0,
    centerOffsetY: 0,
    gdsOffsetXUm: 0,
    gdsOffsetYUm: 0,
    // Set by auto-calibrate: the absolute GDS-X/Y center derived purely from
    // loaded data (min+max midpoint), independent of Die Size. When set, this
    // takes priority over gdsOffsetXUm/YUm so the calibration stays correct
    // even if Die Size changes afterward. Cleared the moment the user edits
    // the offset fields manually.
    gdsCalibratedCenterXUm: null,
    gdsCalibratedCenterYUm: null,
    dieRotationDeg: 0,
    gridLineColor: '#ff3b3b', // defaults to red; user can repick via the Grid Color input
    showCoordNumbers: true,   // toggles the die defect map's ruler tick-value labels
    notch: 'down',
    records: [],             // [{recId, dieX, dieY, gdsX, gdsY, raw:{...}}]
    recordsById: new Map(),  // recId -> record, for O(1) lookup
    defectsByDie: new Map(), // key "x,y" -> records[]
    // Selection is tracked per individual defect (recId), not per die, so the
    // die defect map's composite plot can highlight exactly the dots picked
    // (e.g. via drag-select) without lighting up a die's other, unrelated
    // defects elsewhere on the plot. Clicking a die on the wafer map (which
    // has no way to target one specific defect) still selects that whole
    // die's defects as a block, by adding all of their recIds at once.
    selectedDefects: new Set(), // Set of recId numbers
    rawBytes: null,         // Uint8Array of the last-loaded text file, kept for re-decoding on encoding change
    workbook: null,         // SheetJS workbook, kept for re-parsing on sheet change (xlsx/xls only)
    // Maps the fixed record fields back to the original CSV/XLSX header they
    // came from, so the Pareto column picker (and getColumnValue) can offer
    // and read ANY loaded column -- not just the free-form "extra" ones --
    // using the same header names the file actually had.
    columnMap: { dieX: null, dieY: null, gdsX: null, gdsY: null, ecid: null },
    extraColumns: [],  // headers not recognized as dieX/dieY/gdsX/gdsY/ecid
    paretoColumns: [], // all headers, in file order, offered by the Pareto column select
    paretoColumn: null, // currently selected header for the Pareto chart
    paretoGroupColumn: '', // currently selected header to stack/split each Pareto bar by; '' = no grouping
    trendColumns: [],   // headers whose name contains "date" (case-insensitive), offered by the Trend chart
    trendColumn: null,  // currently selected header for the Trend chart
  };

  function dieKey(x, y) { return `${x},${y}`; }

  // Distinct dies represented among the currently selected defects. The
  // wafer map only has die-level granularity, so this is what it outlines.
  function getSelectedDieKeys() {
    const keys = new Set();
    for (const recId of state.selectedDefects) {
      const rec = state.recordsById.get(recId);
      if (rec) keys.add(dieKey(rec.dieX, rec.dieY));
    }
    return keys;
  }

  /* ===================== DOM refs ===================== */
  const el = (id) => document.getElementById(id);
  const waferSizeSel = el('waferSize');
  const dieSizeXInput = el('dieSizeX');
  const dieSizeYInput = el('dieSizeY');
  const scribeLaneInput = el('scribeLane');
  const edgeExclusionInput = el('edgeExclusion');
  const centerOffsetXInput = el('centerOffsetX');
  const centerOffsetYInput = el('centerOffsetY');
  const autoCenterBtn = el('autoCenterBtn');
  const dieSizeHint = el('dieSizeHint');
  const dieSizeHintText = el('dieSizeHintText');
  const applyDieSizeSuggestion = el('applyDieSizeSuggestion');
  const autoCalibrateDieSizeBtn = el('autoCalibrateDieSizeBtn');
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
  const csvSkippedNote = el('csvSkippedNote');
  const statsPanel = el('statsPanel');
  const statTotalDies = el('statTotalDies');
  const statUsableDies = el('statUsableDies');
  const statExcludedDies = el('statExcludedDies');
  const statDefectDies = el('statDefectDies');
  const statTotalDefects = el('statTotalDefects');
  const legend = el('legend');
  const waferSvg = el('waferSvg');
  const waferEmptyState = el('waferEmptyState');
  const waferStage = el('waferStage');
  const waferSelectionBox = el('waferSelectionBox');
  const waferCard = el('waferCard');
  const waferFullViewBtn = el('waferFullViewBtn');
  const dieCard = el('dieCard');
  const dieCardTitle = el('dieCardTitle');
  const dieSvg = el('dieSvg');
  const dieSvgWrap = el('dieSvgWrap');
  const dieSelectionBox = el('dieSelectionBox');
  const dieEmptyState = el('dieEmptyState');
  const DIE_EMPTY_DEFAULT_TEXT = dieEmptyState.textContent;
  const dieDefectList = el('dieDefectList');
  const closeDieCard = el('closeDieCard');
  const gdsOffsetXInput = el('gdsOffsetX');
  const gdsOffsetYInput = el('gdsOffsetY');
  const autoCalibrateGdsBtn = el('autoCalibrateGdsBtn');
  const dieRotationSel = el('dieRotation');
  const gridLineColorInput = el('gridLineColor');
  const tooltip = el('tooltip');
  const themeToggle = el('themeToggle');
  const themeIconMoon = el('themeIconMoon');
  const themeIconSun = el('themeIconSun');
  const sidebarToggle = el('sidebarToggle');
  const sidebar = el('sidebar');
  const sidebarBackdrop = el('sidebarBackdrop');
  const helpBtn = el('helpBtn');
  const helpModal = el('helpModal');
  const closeHelpModal = el('closeHelpModal');
  const dieStage = el('dieStage');
  const dieToolbar = el('dieToolbar');
  const toggleCoordNumbersBtn = el('toggleCoordNumbersBtn');
  const fullViewBtn = el('fullViewBtn');
  const fullViewModal = el('fullViewModal');
  const fullViewBody = el('fullViewBody');
  const fullViewTitle = el('fullViewTitle');
  const closeFullView = el('closeFullView');
  const paretoCard = el('paretoCard');
  const paretoColumnSelect = el('paretoColumnSelect');
  const paretoGroupSelect = el('paretoGroupSelect');
  const paretoSvg = el('paretoSvg');
  const paretoEmptyState = el('paretoEmptyState');
  const paretoList = el('paretoList');
  const paretoLegend = el('paretoLegend');
  const paretoStage = el('paretoStage');
  const paretoFullViewBtn = el('paretoFullViewBtn');
  const trendCard = el('trendCard');
  const trendColumnSelect = el('trendColumnSelect');
  const trendSvg = el('trendSvg');
  const trendEmptyState = el('trendEmptyState');
  const trendExcludedNote = el('trendExcludedNote');
  const trendSvgWrap = el('trendSvgWrap');
  const trendFullViewBtn = el('trendFullViewBtn');
  const appVersionInfo = el('appVersionInfo');

  /* ===================== Modals ===================== */
  function openModal(modal) { modal.hidden = false; }
  function closeModal(modal) { modal.hidden = true; }

  helpBtn.addEventListener('click', () => openModal(helpModal));
  closeHelpModal.addEventListener('click', () => closeModal(helpModal));
  helpModal.addEventListener('click', (e) => { if (e.target === helpModal) closeModal(helpModal); });

  // One shared modal serves every plot's "full view" (only one can be open
  // at a time anyway) -- fullViewReturn remembers where to put the borrowed
  // elements back when it closes, since they're moved (not cloned), so the
  // originals keep their live SVG/state and event listeners either way.
  let fullViewReturn = null;
  function openFullView(cardEl, elements, title) {
    fullViewReturn = { parent: cardEl, elements };
    fullViewTitle.textContent = title;
    for (const node of elements) fullViewBody.appendChild(node);
    openModal(fullViewModal);
  }
  function exitFullView() {
    if (fullViewReturn) {
      for (const node of fullViewReturn.elements) fullViewReturn.parent.appendChild(node);
      fullViewReturn = null;
    }
    closeModal(fullViewModal);
  }
  waferFullViewBtn.addEventListener('click', () => openFullView(waferCard, [waferStage], 'Wafer Map — Full View'));
  fullViewBtn.addEventListener('click', () => openFullView(dieCard, [dieToolbar, dieStage], 'Die Defect Map — Full View'));
  paretoFullViewBtn.addEventListener('click', () => openFullView(paretoCard, [paretoStage], 'Pareto Chart — Full View'));
  trendFullViewBtn.addEventListener('click', () => openFullView(trendCard, [trendSvgWrap, trendExcludedNote], 'Trend Chart — Full View'));
  closeFullView.addEventListener('click', exitFullView);
  fullViewModal.addEventListener('click', (e) => { if (e.target === fullViewModal) exitFullView(); });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!fullViewModal.hidden) exitFullView();
    else if (!helpModal.hidden) closeModal(helpModal);
  });

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

  // Number('') and Number('  ') both evaluate to 0, not NaN -- so a blank cell
  // in a required numeric column would otherwise be silently treated as a real
  // 0 value instead of being skipped as missing data.
  function parseNumericCell(value) {
    if (value === null || value === undefined) return NaN;
    const trimmed = String(value).trim();
    if (trimmed === '') return NaN;
    return Number(trimmed);
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
    csvSkippedNote.hidden = true;
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
    const ecidCol = matchColumn(headers, HEADER_ALIASES.ecid); // optional

    const missing = [];
    if (!dieXCol) missing.push('die_X / X coordinate');
    if (!dieYCol) missing.push('die_Y / Y coordinate');
    if (!gdsXCol) missing.push('GDS-X');
    if (!gdsYCol) missing.push('GDS-Y');
    if (missing.length) {
      throw new Error(`CSV is missing required column(s): ${missing.join(', ')}`);
    }

    const knownCols = new Set([dieXCol, dieYCol, gdsXCol, gdsYCol, ecidCol].filter(Boolean));
    const extraCols = headers.filter((h) => !knownCols.has(h));

    state.columnMap = { dieX: dieXCol, dieY: dieYCol, gdsX: gdsXCol, gdsY: gdsYCol, ecid: ecidCol };
    state.extraColumns = extraCols;
    state.paretoColumns = [dieXCol, dieYCol, gdsXCol, gdsYCol, ...(ecidCol ? [ecidCol] : []), ...extraCols];

    const records = [];
    let skippedCount = 0;   // blank/invalid die_X or die_Y -- unusable anywhere, dropped entirely
    let noGdsCount = 0;     // valid die_X/die_Y but blank/invalid GDS-X or GDS-Y
    for (const row of rows) {
      const dieX = parseNumericCell(row[dieXCol]);
      const dieY = parseNumericCell(row[dieYCol]);
      if (!Number.isFinite(dieX) || !Number.isFinite(dieY)) {
        skippedCount++; // no die to attribute this row to -- can't count it anywhere
        continue;
      }
      const gdsXUmRaw = parseNumericCell(row[gdsXCol]);
      const gdsYUmRaw = parseNumericCell(row[gdsYCol]);
      const hasGds = Number.isFinite(gdsXUmRaw) && Number.isFinite(gdsYUmRaw);
      if (!hasGds) noGdsCount++;
      const raw = {};
      for (const col of extraCols) raw[col] = row[col];
      const ecid = ecidCol ? row[ecidCol] : null;
      // GDS-X/GDS-Y are absolute die-local coordinates in micrometers, origin at
      // the die's own corner (die center sits at dieSize/2) -- not an offset from
      // the die center. Kept raw here; converted to a centered mm offset for
      // plotting wherever the die size is known (it can change after parsing).
      // A row with a valid die but blank/invalid GDS still counts toward the
      // wafer map's per-die defect count -- it just can't be plotted as a dot
      // in the die defect map (gdsXUm/gdsYUm are null when missing).
      records.push({
        recId: records.length,
        dieX, dieY,
        gdsXUm: hasGds ? gdsXUmRaw : null,
        gdsYUm: hasGds ? gdsYUmRaw : null,
        ecid, raw,
      });
    }

    if (!records.length) {
      throw new Error('No valid defect rows found in CSV.');
    }

    const noteParts = [];
    if (skippedCount > 0) {
      noteParts.push(`${skippedCount} row${skippedCount === 1 ? '' : 's'} skipped (blank/non-numeric die_X or die_Y).`);
    }
    if (noGdsCount > 0) {
      noteParts.push(
        `${noGdsCount} defect${noGdsCount === 1 ? '' : 's'} missing GDS-X/GDS-Y — ` +
        `still counted on the wafer map, but not plotted in the die defect map.`
      );
    }
    if (noteParts.length) {
      csvSkippedNote.textContent = noteParts.join(' ');
      csvSkippedNote.hidden = false;
    } else {
      csvSkippedNote.hidden = true;
    }

    state.records = records;
    state.recordsById = new Map();
    state.defectsByDie = new Map();
    for (const rec of records) {
      state.recordsById.set(rec.recId, rec);
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
    state.selectedDefects = new Set();
    populateParetoColumnSelect();
    populateParetoGroupSelect();
    populateTrendColumnSelect();
    render();
    if (busiestKey) {
      const [bx, by] = busiestKey.split(',').map(Number);
      selectDie(bx, by);
    }
  }

  // Rebuilds the Pareto column dropdown from the just-parsed file's headers.
  // Keeps the previous column selected across a reload if it still exists
  // (e.g. re-uploading a corrected version of the same file); otherwise
  // falls back to the first "extra" column, since that's most likely to hold
  // a categorical defect classification -- die index / GDS coordinates /
  // ECID are technically selectable too, but rarely what someone actually
  // wants a Pareto breakdown of.
  function populateParetoColumnSelect() {
    const prev = state.paretoColumn;
    paretoColumnSelect.innerHTML = '';
    for (const col of state.paretoColumns) {
      const opt = document.createElement('option');
      opt.value = col;
      opt.textContent = col;
      paretoColumnSelect.appendChild(opt);
    }
    paretoColumnSelect.disabled = false;
    const fallback = state.extraColumns[0] || state.columnMap.ecid || state.columnMap.dieX;
    state.paretoColumn = state.paretoColumns.includes(prev) ? prev : fallback;
    paretoColumnSelect.value = state.paretoColumn;
  }

  // Rebuilds the "Group by" dropdown the same way, but defaults to off
  // ('' = no grouping) rather than auto-picking a column -- unlike the main
  // Pareto column, stacking is an opt-in refinement, not something that
  // should suddenly appear (and repaint every bar) just because a new file
  // happened to load.
  function populateParetoGroupSelect() {
    const prev = state.paretoGroupColumn;
    paretoGroupSelect.innerHTML = '';
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '(None)';
    paretoGroupSelect.appendChild(noneOpt);
    for (const col of state.paretoColumns) {
      const opt = document.createElement('option');
      opt.value = col;
      opt.textContent = col;
      paretoGroupSelect.appendChild(opt);
    }
    paretoGroupSelect.disabled = false;
    state.paretoGroupColumn = prev === '' || state.paretoColumns.includes(prev) ? prev : '';
    paretoGroupSelect.value = state.paretoGroupColumn;
  }

  // Reads a record's value for any loaded column, whether it's one of the
  // fixed fields (die_X, die_Y, GDS-X, GDS-Y, ECID) or a free-form "extra"
  // column -- the Pareto chart lets the user pick any of them.
  function getColumnValue(rec, colKey) {
    const map = state.columnMap;
    if (colKey === map.dieX) return rec.dieX;
    if (colKey === map.dieY) return rec.dieY;
    if (colKey === map.gdsX) return rec.gdsXUm;
    if (colKey === map.gdsY) return rec.gdsYUm;
    if (colKey === map.ecid) return rec.ecid;
    return rec.raw[colKey];
  }

  paretoColumnSelect.addEventListener('change', () => {
    state.paretoColumn = paretoColumnSelect.value;
    renderPareto();
  });

  paretoGroupSelect.addEventListener('change', () => {
    state.paretoGroupColumn = paretoGroupSelect.value;
    renderPareto();
  });

  // Rebuilds the Trend chart's date-column dropdown, scoped to only the
  // headers whose name contains "date" (case-insensitive) -- unlike the
  // Pareto column, this one can't offer every column, since a trend chart
  // is meaningless without something date-like on its x-axis.
  function populateTrendColumnSelect() {
    const prev = state.trendColumn;
    state.trendColumns = state.paretoColumns.filter((col) => col.toLowerCase().includes('date'));
    trendColumnSelect.innerHTML = '';
    for (const col of state.trendColumns) {
      const opt = document.createElement('option');
      opt.value = col;
      opt.textContent = col;
      trendColumnSelect.appendChild(opt);
    }
    trendColumnSelect.disabled = state.trendColumns.length === 0;
    state.trendColumn = state.trendColumns.includes(prev) ? prev : (state.trendColumns[0] || null);
    if (state.trendColumn) trendColumnSelect.value = state.trendColumn;
  }

  trendColumnSelect.addEventListener('change', () => {
    state.trendColumn = trendColumnSelect.value;
    renderTrend();
  });

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
    state.scribeLaneUm = Math.max(0, Number(scribeLaneInput.value) || 0);
    state.edgeExclusionMm = Math.max(0, Number(edgeExclusionInput.value) || 0);
    state.centerOffsetX = Math.round(Number(centerOffsetXInput.value) || 0);
    state.centerOffsetY = Math.round(Number(centerOffsetYInput.value) || 0);
    state.gdsOffsetXUm = Math.round(Number(gdsOffsetXInput.value) || 0);
    state.gdsOffsetYUm = Math.round(Number(gdsOffsetYInput.value) || 0);
    state.dieRotationDeg = Number(dieRotationSel.value) || 0;
    state.notch = notchSel.value;
  }
  [
    waferSizeSel, dieSizeXInput, dieSizeYInput, scribeLaneInput, edgeExclusionInput,
    centerOffsetXInput, centerOffsetYInput, gdsOffsetXInput, gdsOffsetYInput, dieRotationSel, notchSel,
  ].forEach((input) => {
    input.addEventListener('change', () => { readInputs(); render(); });
  });

  // Manually editing the offset fields overrides (and drops) any prior
  // auto-calibration lock, so the typed value actually takes effect instead
  // of being recomputed from the locked calibrated center on next render.
  gdsOffsetXInput.addEventListener('input', () => { state.gdsCalibratedCenterXUm = null; });
  gdsOffsetYInput.addEventListener('input', () => { state.gdsCalibratedCenterYUm = null; });

  // 'input' (not 'change') for live preview while dragging the color picker.
  gridLineColorInput.addEventListener('input', () => {
    state.gridLineColor = gridLineColorInput.value;
    if (state.records.length) renderDieDetail();
  });

  toggleCoordNumbersBtn.addEventListener('click', () => {
    state.showCoordNumbers = !state.showCoordNumbers;
    toggleCoordNumbersBtn.setAttribute('aria-pressed', String(state.showCoordNumbers));
    if (state.records.length) renderDieDetail();
  });

  autoCenterBtn.addEventListener('click', () => {
    if (!state.records.length) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const rec of state.records) {
      minX = Math.min(minX, rec.dieX);
      maxX = Math.max(maxX, rec.dieX);
      minY = Math.min(minY, rec.dieY);
      maxY = Math.max(maxY, rec.dieY);
    }
    readInputs();
    const { maxI, maxJ } = computeDieGrid(); // geometric center, independent of any existing offset
    state.centerOffsetX = Math.round((minX + maxX) / 2) - maxI;
    state.centerOffsetY = Math.round((minY + maxY) / 2) - maxJ;
    centerOffsetXInput.value = state.centerOffsetX;
    centerOffsetYInput.value = state.centerOffsetY;
    render();
  });

  // GDS Origin Offset: like the wafer map's auto-center, but for the die
  // defect map -- nudges the assumed die center (normally dieSize/2) so that
  // the midpoint of all loaded defects' GDS-X/GDS-Y lines up with it, correcting
  // a systematic calibration bias in the inspection tool's coordinate output.
  // The calibrated center is derived purely from the data (its min/max
  // midpoint) with no reference to Die Size, so it stays correct even if Die
  // Size is changed afterward -- see gdsCalibratedCenterXUm/YUm.
  autoCalibrateGdsBtn.addEventListener('click', () => {
    if (!state.records.length) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const rec of state.records) {
      if (rec.gdsXUm === null || rec.gdsYUm === null) continue; // no GDS location
      minX = Math.min(minX, rec.gdsXUm);
      maxX = Math.max(maxX, rec.gdsXUm);
      minY = Math.min(minY, rec.gdsYUm);
      maxY = Math.max(maxY, rec.gdsYUm);
    }
    if (!Number.isFinite(minX)) return; // no defect had a GDS location to calibrate from
    state.gdsCalibratedCenterXUm = (minX + maxX) / 2;
    state.gdsCalibratedCenterYUm = (minY + maxY) / 2;
    render(); // updates the offset fields' displayed value too, see renderDieDetail
  });

  /* ===================== Wafer geometry ===================== */
  function computeDieGrid() {
    const diameterMm = WAFER_DIAMETER_MM[state.waferInch];
    const radiusMm = diameterMm / 2;
    const { dieSizeX, dieSizeY, scribeLaneUm, edgeExclusionMm } = state;
    // Die pitch (center-to-center spacing) includes the scribe lane (saw street)
    // between dies -- dies are drawn at their actual size, but spaced by pitch.
    const scribeLaneMm = scribeLaneUm / 1000;
    const pitchX = dieSizeX + scribeLaneMm;
    const pitchY = dieSizeY + scribeLaneMm;
    const usableRadiusMm = Math.max(radiusMm - edgeExclusionMm, 0);
    const maxI = Math.ceil(radiusMm / pitchX) + 1;
    const maxJ = Math.ceil(radiusMm / pitchY) + 1;
    const dies = [];

    // die_X/die_Y in the CSV are non-negative (first-quadrant indexing), with the
    // wafer center falling at index (maxI + centerOffsetX, maxJ + centerOffsetY) —
    // i.e. index 0 is the corner of the theoretical grid's bounding square, not
    // the wafer center itself. The offset lets the index labeling be nudged to
    // match a fab's actual numbering without moving any die's physical position.
    const offsetX = state.centerOffsetX || 0;
    const offsetY = state.centerOffsetY || 0;
    for (let i = -maxI; i <= maxI; i++) {
      for (let j = -maxJ; j <= maxJ; j++) {
        const cx = i * pitchX;
        const cy = j * pitchY;
        const halfX = dieSizeX / 2;
        const halfY = dieSizeY / 2;
        // closest point on die rect to wafer center (0,0) -- decides whether the
        // die physically fits on the wafer at all.
        const closestX = Math.max(cx - halfX, Math.min(0, cx + halfX));
        const closestY = Math.max(cy - halfY, Math.min(0, cy + halfY));
        const dist = Math.hypot(closestX, closestY);
        if (dist <= radiusMm) {
          // farthest point on die rect from wafer center -- a die only counts as
          // usable if it sits entirely clear of the edge exclusion ring.
          const farthestDist = Math.hypot(Math.abs(cx) + halfX, Math.abs(cy) + halfY);
          const usable = farthestDist <= usableRadiusMm;
          dies.push({ i: i + maxI + offsetX, j: j + maxJ + offsetY, cx, cy, usable });
        }
      }
    }
    return { dies, radiusMm, diameterMm, usableRadiusMm, maxI, maxJ };
  }

  function defectBucketColor(count) {
    if (count <= 0) return null;
    if (count <= 2) return 'var(--sev-low)';
    if (count <= 5) return 'var(--sev-mid)';
    return 'var(--sev-high)';
  }

  function formatEcidList(defects) {
    if (!defects || !defects.length) return null;
    const seen = [];
    for (const rec of defects) {
      const val = rec.ecid;
      if (val !== null && val !== undefined && val !== '' && !seen.includes(val)) seen.push(val);
    }
    if (!seen.length) return null;
    const MAX_SHOWN = 4;
    const shown = seen.slice(0, MAX_SHOWN).join(', ');
    return seen.length > MAX_SHOWN ? `${shown}, +${seen.length - MAX_SHOWN} more` : shown;
  }

  function dieHoverText(x, y, defects, usable) {
    const count = defects ? defects.length : 0;
    const lines = [`Die (${x}, ${y})`, `Defects: ${count}`];
    const ecidList = formatEcidList(defects);
    if (ecidList) lines.push(`ECID: ${ecidList}`);
    if (usable === false) lines.push('Edge exclusion (unusable)');
    return lines.join('\n');
  }

  function renderLegend() {
    legend.innerHTML = '';
    const items = [
      { label: 'No defect', color: 'var(--die-empty-fill)' },
      { label: '1–2 defects', color: 'var(--sev-low)' },
      { label: '3–5 defects', color: 'var(--sev-mid)' },
      { label: '6+ defects', color: 'var(--sev-high)' },
    ];
    for (const item of items) {
      const wrap = document.createElement('span');
      wrap.className = 'legend-item';
      wrap.innerHTML = `<span class="legend-swatch" style="background:${item.color}"></span>${item.label}`;
      legend.appendChild(wrap);
    }
    const excludedWrap = document.createElement('span');
    excludedWrap.className = 'legend-item';
    excludedWrap.innerHTML = '<span class="legend-swatch excluded-swatch"></span>Edge exclusion';
    legend.appendChild(excludedWrap);
  }

  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  function renderWafer() {
    readInputs();
    waferSvg.innerHTML = '';

    const { dies, radiusMm, diameterMm, usableRadiusMm } = computeDieGrid();
    const waferRadiusPx = (WAFER_VIEWBOX / 2) - WAFER_MARGIN;
    const mmToPx = waferRadiusPx / radiusMm;
    const centerPx = WAFER_VIEWBOX / 2;

    const group = svgEl('g', {
      transform: `rotate(${NOTCH_ANGLE_DEG[state.notch]} ${centerPx} ${centerPx})`,
    });

    // wafer circle
    group.appendChild(svgEl('circle', {
      class: 'wafer-circle', cx: centerPx, cy: centerPx, r: waferRadiusPx,
    }));

    // edge exclusion boundary (dashed ring) -- dies outside this ring are unusable
    if (state.edgeExclusionMm > 0 && usableRadiusMm > 0) {
      group.appendChild(svgEl('circle', {
        class: 'exclusion-ring', cx: centerPx, cy: centerPx, r: usableRadiusMm * mmToPx,
      }));
    }

    // notch mark (bottom, before rotation)
    const notchSize = 10;
    const ny = centerPx + waferRadiusPx;
    group.appendChild(svgEl('path', {
      class: 'notch-mark',
      d: `M ${centerPx - notchSize} ${ny} L ${centerPx} ${ny - notchSize} L ${centerPx + notchSize} ${ny} Z`,
    }));

    let defectDieCount = 0;
    let totalDefects = 0;
    let usableDieCount = 0;

    for (const die of dies) {
      const key = `${die.i},${die.j}`;
      const defects = state.defectsByDie.get(key);
      const count = defects ? defects.length : 0;
      if (count > 0) { defectDieCount++; totalDefects += count; }
      if (die.usable) usableDieCount++;

      const w = state.dieSizeX * mmToPx;
      const h = state.dieSizeY * mmToPx;
      const x = centerPx + die.cx * mmToPx - w / 2;
      const y = centerPx - die.cy * mmToPx - h / 2;

      const fill = defectBucketColor(count) || 'var(--die-empty-fill)';
      const rectClass = die.usable ? 'die-rect' : 'die-rect excluded';
      const rect = svgEl('rect', {
        class: rectClass, x, y, width: Math.max(w - 0.6, 0.5), height: Math.max(h - 0.6, 0.5),
        fill, stroke: 'var(--die-empty-stroke)',
        'data-die-x': die.i, 'data-die-y': die.j, 'data-count': count,
      });
      const dieTip = dieHoverText(die.i, die.j, defects, die.usable);
      rect.addEventListener('mouseenter', (e) => showTooltip(e.clientX, e.clientY, dieTip));
      rect.addEventListener('mousemove', (e) => showTooltip(e.clientX, e.clientY, dieTip));
      rect.addEventListener('mouseleave', hideTooltip);
      rect.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey) toggleDieSelection(die.i, die.j);
        else selectDie(die.i, die.j);
      });
      group.appendChild(rect);
    }

    waferSvg.appendChild(group);
    waferEmptyState.hidden = state.records.length > 0;

    statsPanel.hidden = state.records.length === 0;
    statTotalDies.textContent = dies.length.toLocaleString();
    statUsableDies.textContent = usableDieCount.toLocaleString();
    statExcludedDies.textContent = (dies.length - usableDieCount).toLocaleString();
    statDefectDies.textContent = defectDieCount.toLocaleString();
    statTotalDefects.textContent = totalDefects.toLocaleString();
    renderLegend();

    // reflect current selection highlight(s), if any -- a die is outlined if
    // any one of its defects is selected (the wafer map can't show partial
    // per-defect selection at this zoom level).
    for (const key of getSelectedDieKeys()) {
      const [sx, sy] = key.split(',');
      const sel = waferSvg.querySelector(`.die-rect[data-die-x="${sx}"][data-die-y="${sy}"]`);
      if (sel) sel.classList.add('selected');
    }
  }

  /* ===================== Die inspector ===================== */
  function updateDieCardTitle() {
    const selectedCount = state.selectedDefects.size;
    if (selectedCount === 0) {
      dieCardTitle.textContent = 'All dies';
      return;
    }
    const dieKeys = [...getSelectedDieKeys()];
    if (dieKeys.length === 1) {
      const [x, y] = dieKeys[0].split(',');
      const total = (state.defectsByDie.get(dieKeys[0]) || []).length;
      dieCardTitle.textContent = selectedCount === total
        ? `Die (${x}, ${y}) — ${total} defect${total === 1 ? '' : 's'}`
        : `Die (${x}, ${y}) — ${selectedCount} of ${total} defect${total === 1 ? '' : 's'} selected`;
    } else {
      dieCardTitle.textContent =
        `${selectedCount} defect${selectedCount === 1 ? '' : 's'} selected across ${dieKeys.length} dies`;
    }
  }

  // Wafer map plain click: select this die's entire set of defects (replacing
  // any existing selection) -- the wafer map has no way to target one
  // specific defect, only a die as a whole.
  function selectDie(x, y) {
    const defects = state.defectsByDie.get(dieKey(x, y)) || [];
    state.selectedDefects = new Set(defects.map((r) => r.recId));
    updateDieCardTitle();
    renderDieDetail();
    renderWafer(); // refresh selection outline
    // Don't scroll the (now mostly empty) card into view while its contents
    // are reparented into the full-view modal.
    if (fullViewModal.hidden) dieCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Wafer map Ctrl/Cmd/Shift-click: add or remove this die's whole set of
  // defects from the current selection, for inspecting several dies together.
  function toggleDieSelection(x, y) {
    const defects = state.defectsByDie.get(dieKey(x, y)) || [];
    const allSelected = defects.length > 0 && defects.every((r) => state.selectedDefects.has(r.recId));
    for (const rec of defects) {
      if (allSelected) state.selectedDefects.delete(rec.recId);
      else state.selectedDefects.add(rec.recId);
    }
    updateDieCardTitle();
    renderDieDetail();
    renderWafer();
  }

  // Die defect map plain click on a dot: select just that ONE defect
  // (replacing any existing selection) -- unlike the wafer map, individual
  // dots ARE precise enough to target a single defect.
  function selectDefect(recId) {
    state.selectedDefects = new Set([recId]);
    updateDieCardTitle();
    renderDieDetail();
    renderWafer();
  }

  // Die defect map Ctrl/Cmd/Shift-click on a dot: add or remove just that one
  // defect from the current selection.
  function toggleDefectSelection(recId) {
    if (state.selectedDefects.has(recId)) state.selectedDefects.delete(recId);
    else state.selectedDefects.add(recId);
    updateDieCardTitle();
    renderDieDetail();
    renderWafer();
  }

  function clearSelection() {
    if (state.selectedDefects.size === 0) return;
    state.selectedDefects = new Set();
    updateDieCardTitle();
    renderDieDetail();
    renderWafer();
  }

  // Rubber-band multi-select, usable on both the wafer map (over .die-rect,
  // selecting a whole die's defects per rect touched) and the die defect
  // map's composite plot (over .defect-dot, selecting only the exact defects
  // touched -- getRecIds decides which). Hold Ctrl/Cmd/Shift and drag to draw
  // a box, adding every matching element's recId(s) to the selection (on top
  // of individual Ctrl/Shift-click). A plain click on empty background, with
  // no drag, clears the selection instead. Both surfaces tile almost
  // edge-to-edge (dies) or can be densely packed (dots), so the drag has to
  // be allowed to start ON an item too -- it's only treated as a real drag
  // once the mouse actually moves; a same-spot mousedown+mouseup still lets
  // that item's own click handler run untouched (native click semantics:
  // click won't fire at all if the mouse moved off the original element by
  // mouseup).
  function setupDragSelect(container, selectionBoxEl, itemSelector, getRecIds) {
    let drag = null;

    container.addEventListener('mousedown', (e) => {
      drag = {
        modifier: e.ctrlKey || e.metaKey || e.shiftKey,
        startX: e.clientX, startY: e.clientY, moved: false,
        startedOnItem: !!e.target.closest(itemSelector),
      };
    });

    document.addEventListener('mousemove', (e) => {
      if (!drag) return;
      if (Math.abs(e.clientX - drag.startX) > 3 || Math.abs(e.clientY - drag.startY) > 3) drag.moved = true;
      if (drag.modifier && drag.moved) {
        const left = Math.min(drag.startX, e.clientX);
        const top = Math.min(drag.startY, e.clientY);
        selectionBoxEl.style.left = `${left}px`;
        selectionBoxEl.style.top = `${top}px`;
        selectionBoxEl.style.width = `${Math.abs(e.clientX - drag.startX)}px`;
        selectionBoxEl.style.height = `${Math.abs(e.clientY - drag.startY)}px`;
        selectionBoxEl.hidden = false;
      }
    });

    document.addEventListener('mouseup', (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      selectionBoxEl.hidden = true;

      if (d.modifier && d.moved) {
        const left = Math.min(d.startX, e.clientX);
        const right = Math.max(d.startX, e.clientX);
        const top = Math.min(d.startY, e.clientY);
        const bottom = Math.max(d.startY, e.clientY);
        let changed = false;
        document.querySelectorAll(itemSelector).forEach((el) => {
          const r = el.getBoundingClientRect();
          const intersects = r.left < right && r.right > left && r.top < bottom && r.bottom > top;
          if (intersects) {
            for (const recId of getRecIds(el)) {
              if (!state.selectedDefects.has(recId)) { state.selectedDefects.add(recId); changed = true; }
            }
          }
        });
        if (changed) { updateDieCardTitle(); renderDieDetail(); renderWafer(); }
      } else if (!d.modifier && !d.moved && !d.startedOnItem) {
        // Background click with no drag and no modifier -- clear the selection.
        // (A same-spot click that started on an item is left entirely to that
        // item's own click handler, whether or not a modifier was held.)
        clearSelection();
      }
    });
  }

  setupDragSelect(waferStage, waferSelectionBox, '.die-rect', (el) => {
    const key = dieKey(Number(el.getAttribute('data-die-x')), Number(el.getAttribute('data-die-y')));
    return (state.defectsByDie.get(key) || []).map((r) => r.recId);
  });
  setupDragSelect(dieSvgWrap, dieSelectionBox, '.defect-dot', (el) => [Number(el.getAttribute('data-rec-id'))]);

  function niceStep(rough) {
    if (!(rough > 0)) return 1;
    const exp = Math.floor(Math.log10(rough));
    const base = Math.pow(10, exp);
    const fraction = rough / base;
    let niceFraction;
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
    return niceFraction * base;
  }

  function renderDieDetail() {
    dieSvg.innerHTML = '';
    dieDefectList.innerHTML = '';
    dieSvg.classList.toggle('hide-coord-numbers', !state.showCoordNumbers);

    // Composite view: every defect from every die is plotted (all dies share
    // the same Die Size, so they all fit the same box); only the selected
    // die's (or dies', if multiple are selected) own points are drawn
    // highlighted. Hidden only if nothing anywhere has a plottable location.
    const anyPlottable = state.records.some((r) => r.gdsXUm !== null && r.gdsYUm !== null);
    if (!anyPlottable) {
      dieEmptyState.textContent = 'No defects have a GDS-X/GDS-Y location to plot.';
      dieEmptyState.hidden = false;
      return;
    }
    dieEmptyState.hidden = true;

    const usableHalf = (DIE_VIEWBOX / 2) - DIE_MARGIN;
    const halfMmX = state.dieSizeX / 2;
    const halfMmY = state.dieSizeY / 2;
    const centerPx = DIE_VIEWBOX / 2;

    // The whole plot (outline, grid, ticks, dots) rotates as one rigid group so
    // the composite view can be reoriented to match a die's actual physical
    // placement. Text labels counter-rotate individually (around their own
    // position) so they stay upright and readable at any rotation.
    const rotationDeg = state.dieRotationDeg || 0;
    const group = svgEl('g', rotationDeg ? { transform: `rotate(${rotationDeg} ${centerPx} ${centerPx})` } : {});
    function textEl(attrs) {
      const node = svgEl('text', attrs);
      if (rotationDeg) node.setAttribute('transform', `rotate(${-rotationDeg} ${attrs.x} ${attrs.y})`);
      return node;
    }
    // A presentation attribute like fill/stroke has the LOWEST possible CSS
    // priority and would be overridden by the .grid-line class rule -- use an
    // inline style instead, which behaves like a normal high-priority author
    // style and actually wins.
    function gridLine(attrs) {
      const node = svgEl('line', { class: 'grid-line', ...attrs });
      if (state.gridLineColor) node.style.stroke = state.gridLineColor;
      return node;
    }

    // The assumed center (where GDS-X/Y = dieSize/2 normally lands) can be
    // nudged by the GDS Origin Offset calibration, to correct a systematic
    // measurement bias. Once auto-calibrated, the absolute center
    // (data-derived, independent of Die Size) takes priority over the offset
    // so it stays correct across Die Size changes; the offset fields are kept
    // in sync purely for display.
    const dieHalfWidthUm = halfMmX * 1000;
    const dieHalfHeightUm = halfMmY * 1000;
    const isCalibratedX = state.gdsCalibratedCenterXUm !== null;
    const isCalibratedY = state.gdsCalibratedCenterYUm !== null;
    const assumedCenterXUm = isCalibratedX ? state.gdsCalibratedCenterXUm : dieHalfWidthUm + state.gdsOffsetXUm;
    const assumedCenterYUm = isCalibratedY ? state.gdsCalibratedCenterYUm : dieHalfHeightUm + state.gdsOffsetYUm;
    if (isCalibratedX) {
      state.gdsOffsetXUm = Math.round(assumedCenterXUm - dieHalfWidthUm);
      gdsOffsetXInput.value = state.gdsOffsetXUm;
    }
    if (isCalibratedY) {
      state.gdsOffsetYUm = Math.round(assumedCenterYUm - dieHalfHeightUm);
      gdsOffsetYInput.value = state.gdsOffsetYUm;
    }

    // The plot's scale is based on whichever is bigger: the configured Die
    // Size, or the actual spread of the loaded data around the assumed
    // center. Using Die Size alone would silently clip real defects outside
    // it -- an SVG's root element clips content past its viewBox by default,
    // so a defect further out than Die Size wouldn't just render outside the
    // drawn die-outline rectangle (as intended), it could vanish entirely.
    let halfWidthUm = dieHalfWidthUm;
    let halfHeightUm = dieHalfHeightUm;
    for (const rec of state.records) {
      if (rec.gdsXUm === null || rec.gdsYUm === null) continue;
      halfWidthUm = Math.max(halfWidthUm, Math.abs(rec.gdsXUm - assumedCenterXUm));
      halfHeightUm = Math.max(halfHeightUm, Math.abs(rec.gdsYUm - assumedCenterYUm));
    }
    const mmToPx = usableHalf / Math.max(halfWidthUm, halfHeightUm) * 1000;

    // Die outline is drawn at its true (possibly smaller) size in this scale,
    // so it's visually obvious when real defects fall outside the die.
    const dieW = state.dieSizeX * mmToPx;
    const dieH = state.dieSizeY * mmToPx;
    group.appendChild(svgEl('rect', {
      class: 'die-outline',
      x: centerPx - dieW / 2, y: centerPx - dieH / 2, width: dieW, height: dieH,
    }));

    // Ruler: grid lines + tick marks + um labels along both axes, spaced at a
    // "nice" round interval, covering the full plotted extent (not just the
    // die outline).
    const pxPerUm = mmToPx / 1000;
    const TARGET_TICKS = 8;
    const stepUm = niceStep(Math.max(halfWidthUm, halfHeightUm) / TARGET_TICKS);
    const TICK_LEN = 5;
    // Grid lines, crosshair, and axis labels span the full plotted extent
    // (which may be larger than the die outline itself, see above) so every
    // defect has a ruler/grid reference, not just ones inside the die box.
    const plotHalfWidthPx = halfWidthUm * pxPerUm;
    const plotHalfHeightPx = halfHeightUm * pxPerUm;

    for (let vUm = stepUm; vUm <= halfWidthUm + 1e-6; vUm += stepUm) {
      for (const sign of [1, -1]) {
        const tx = centerPx + sign * vUm * pxPerUm;
        group.appendChild(gridLine({ x1: tx, y1: centerPx - plotHalfHeightPx, x2: tx, y2: centerPx + plotHalfHeightPx }));
        group.appendChild(svgEl('line', {
          class: 'tick-mark', x1: tx, y1: centerPx - TICK_LEN, x2: tx, y2: centerPx + TICK_LEN,
        }));
        group.appendChild(textEl({
          class: 'axis-label tick-label', x: tx, y: centerPx + TICK_LEN + 11, 'text-anchor': 'middle',
        // Label with the absolute GDS-X value (origin at the die's corner,
        // adjusted by any calibration offset), matching the raw tooltip value.
        })).textContent = `${Math.round(assumedCenterXUm + sign * vUm)}`;
      }
    }
    for (let vUm = stepUm; vUm <= halfHeightUm + 1e-6; vUm += stepUm) {
      for (const sign of [1, -1]) {
        const ty = centerPx - sign * vUm * pxPerUm;
        group.appendChild(gridLine({ x1: centerPx - plotHalfWidthPx, y1: ty, x2: centerPx + plotHalfWidthPx, y2: ty }));
        group.appendChild(svgEl('line', {
          class: 'tick-mark', x1: centerPx - TICK_LEN, y1: ty, x2: centerPx + TICK_LEN, y2: ty,
        }));
        group.appendChild(textEl({
          class: 'axis-label tick-label', x: centerPx - TICK_LEN - 4, y: ty + 3, 'text-anchor': 'end',
        })).textContent = `${Math.round(assumedCenterYUm + sign * vUm)}`;
      }
    }

    // Center crosshair (the die's own axes), drawn over the grid lines.
    group.appendChild(svgEl('line', {
      class: 'axis-line', x1: centerPx - plotHalfWidthPx, y1: centerPx, x2: centerPx + plotHalfWidthPx, y2: centerPx,
    }));
    group.appendChild(svgEl('line', {
      class: 'axis-line', x1: centerPx, y1: centerPx - plotHalfHeightPx, x2: centerPx, y2: centerPx + plotHalfHeightPx,
    }));
    group.appendChild(textEl({
      class: 'axis-label', x: centerPx + plotHalfWidthPx - 4, y: centerPx - 6, 'text-anchor': 'end',
    })).textContent = `+X`;
    group.appendChild(textEl({
      class: 'axis-label', x: centerPx + 6, y: centerPx - plotHalfHeightPx + 10,
    })).textContent = `+Y`;
    group.appendChild(textEl({
      class: 'axis-label tick-label', x: centerPx - plotHalfWidthPx + 4, y: centerPx - plotHalfHeightPx + 12,
    })).textContent = 'µm';

    // Plot every plottable defect from every die. When one or more individual
    // defects are selected, exactly those points are drawn on top, larger and
    // in the accent color, while everything else (including other defects
    // from the SAME die) is dimmed for pattern context -- selection is
    // per-defect, not per-die, so picking one corner of a die doesn't light
    // up that die's unrelated defects elsewhere on the plot. With no
    // selection, every dot is drawn the same (no dimming) since nothing is
    // being emphasized.
    const hasSelection = state.selectedDefects.size > 0;
    const isSelectedRec = (rec) => hasSelection && state.selectedDefects.has(rec.recId);
    const plotOrder = state.records
      .filter((rec) => rec.gdsXUm !== null && rec.gdsYUm !== null)
      .sort((a, b) => Number(isSelectedRec(a)) - Number(isSelectedRec(b))); // selected drawn last (on top)

    for (const rec of plotOrder) {
      const selected = isSelectedRec(rec);
      // GDS-X/GDS-Y are absolute, corner-origin coordinates (die center =
      // dieSize/2, nudged by the GDS Origin Offset calibration); convert to a
      // centered mm offset for plotting against the centered die box.
      const gdsXCenteredMm = (rec.gdsXUm - assumedCenterXUm) / 1000;
      const gdsYCenteredMm = (rec.gdsYUm - assumedCenterYUm) / 1000;
      const px = centerPx + gdsXCenteredMm * mmToPx;
      const py = centerPx - gdsYCenteredMm * mmToPx;
      const dotClass = !hasSelection ? 'defect-dot' : (selected ? 'defect-dot highlighted' : 'defect-dot dimmed');
      const dot = svgEl('circle', {
        class: dotClass, cx: px, cy: py, r: !hasSelection ? 4 : (selected ? 5 : 3),
        'data-die-x': rec.dieX, 'data-die-y': rec.dieY, 'data-rec-id': rec.recId,
      });
      const tipLines = [`Die (${rec.dieX}, ${rec.dieY})`];
      if (rec.ecid !== null && rec.ecid !== undefined && rec.ecid !== '') tipLines.push(`ECID: ${rec.ecid}`);
      tipLines.push(`GDS-X: ${rec.gdsXUm} µm`, `GDS-Y: ${rec.gdsYUm} µm`);
      for (const [k, v] of Object.entries(rec.raw)) tipLines.push(`${k}: ${v}`);
      const tipText = tipLines.join('\n');
      dot.addEventListener('mouseenter', (e) => showTooltip(e.clientX, e.clientY, tipText));
      dot.addEventListener('mousemove', (e) => showTooltip(e.clientX, e.clientY, tipText));
      dot.addEventListener('mouseleave', hideTooltip);
      dot.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey) toggleDefectSelection(rec.recId);
        else selectDefect(rec.recId);
      });
      group.appendChild(dot);
    }

    dieSvg.appendChild(group);

    // Defect list stays scoped to exactly the selected defect(s), regardless
    // of how many different dies they belong to.
    if (!hasSelection) {
      const p = document.createElement('p');
      p.className = 'muted small';
      p.textContent = 'Click a die on the wafer map, or a defect dot below, to see it here.';
      dieDefectList.appendChild(p);
      return;
    }
    const combinedDefects = state.records.filter(isSelectedRec);
    const multiSelect = getSelectedDieKeys().size > 1;
    if (!combinedDefects.length) {
      const p = document.createElement('p');
      p.className = 'muted small';
      p.textContent = 'This die has no recorded defects.';
      dieDefectList.appendChild(p);
      return;
    }

    combinedDefects.forEach((rec) => {
      const hasGds = rec.gdsXUm !== null && rec.gdsYUm !== null;
      const gdsXText = hasGds ? `${rec.gdsXUm} µm` : 'N/A';
      const gdsYText = hasGds ? `${rec.gdsYUm} µm` : 'N/A';

      const row = document.createElement('div');
      row.className = 'defect-row';
      let rowHtml = '';
      if (multiSelect) {
        rowHtml += `<div><span class="k">Die</span><span>(${rec.dieX}, ${rec.dieY})</span></div>`;
      }
      if (rec.ecid !== null && rec.ecid !== undefined && rec.ecid !== '') {
        rowHtml += `<div><span class="k">ECID</span><span>${escapeHtml(String(rec.ecid))}</span></div>`;
      }
      rowHtml += `<div><span class="k">GDS-X</span><span>${gdsXText}</span></div><div><span class="k">GDS-Y</span><span>${gdsYText}</span></div>`;
      if (!hasGds) {
        rowHtml += `<div><span class="k">Note</span><span>not plotted (missing GDS)</span></div>`;
      }
      for (const [k, v] of Object.entries(rec.raw)) {
        rowHtml += `<div><span class="k">${escapeHtml(k)}</span><span>${escapeHtml(String(v))}</span></div>`;
      }
      row.innerHTML = rowHtml;
      dieDefectList.appendChild(row);
    });
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  closeDieCard.addEventListener('click', () => {
    state.selectedDefects = new Set();
    dieCardTitle.textContent = 'All dies';
    if (state.records.length) {
      renderDieDetail();
    } else {
      dieSvg.innerHTML = '';
      dieDefectList.innerHTML = '';
      dieEmptyState.textContent = DIE_EMPTY_DEFAULT_TEXT;
      dieEmptyState.hidden = false;
    }
    renderWafer();
  });

  /* ===================== Data-driven die size suggestion ===================== */
  // Wafer size and scribe lane have no signal in this data model (die_X/die_Y are
  // unitless grid indices), but die size can be validated: GDS-X/GDS-Y are
  // absolute, corner-origin coordinates within the die, so a defect's GDS value
  // can never exceed the true die size -- a value larger than the current Die
  // Size setting proves that setting is too small.
  function computeMinDieSizeFromData() {
    if (!state.records.length) return null;
    let maxX = 0;
    let maxY = 0;
    let sawGds = false;
    for (const rec of state.records) {
      if (rec.gdsXUm === null || rec.gdsYUm === null) continue; // no GDS location to measure
      sawGds = true;
      maxX = Math.max(maxX, Math.abs(rec.gdsXUm) / 1000);
      maxY = Math.max(maxY, Math.abs(rec.gdsYUm) / 1000);
    }
    if (!sawGds) return null;
    const roundUpToHalf = (v) => Math.max(Math.ceil(v / 0.5) * 0.5, 0.5);
    return { minX: roundUpToHalf(maxX), minY: roundUpToHalf(maxY) };
  }

  function updateDieSizeHint() {
    const minSize = computeMinDieSizeFromData();
    if (!minSize) { dieSizeHint.hidden = true; return; }
    const needsX = minSize.minX > state.dieSizeX + 1e-9;
    const needsY = minSize.minY > state.dieSizeY + 1e-9;
    if (!needsX && !needsY) { dieSizeHint.hidden = true; return; }
    dieSizeHintText.textContent =
      `Defects reach up to ${minSize.minX}×${minSize.minY} mm from the die's origin corner — ` +
      `larger than the current Die Size (${state.dieSizeX}×${state.dieSizeY} mm).`;
    dieSizeHint.dataset.suggestX = minSize.minX;
    dieSizeHint.dataset.suggestY = minSize.minY;
    dieSizeHint.hidden = false;
  }

  applyDieSizeSuggestion.addEventListener('click', () => {
    dieSizeXInput.value = dieSizeHint.dataset.suggestX;
    dieSizeYInput.value = dieSizeHint.dataset.suggestY;
    readInputs();
    render();
  });

  // Like the wafer map's auto-center icon, this lets Die Size be recalculated
  // from the loaded data on demand, not just via the reactive too-small hint.
  autoCalibrateDieSizeBtn.addEventListener('click', () => {
    const minSize = computeMinDieSizeFromData();
    if (!minSize) return;
    dieSizeXInput.value = minSize.minX;
    dieSizeYInput.value = minSize.minY;
    readInputs();
    render();
  });

  /* ===================== Pareto chart ===================== */
  // Beyond this many distinct values, the tail is collapsed into a single
  // "Others" bucket -- a column like a raw coordinate can have hundreds of
  // near-unique values, and a bar per value would make the chart unreadable
  // (and its labels illegible) without actually adding insight.
  const PARETO_MAX_CATEGORIES = 15;
  const PARETO_VIEWBOX_W = 640;
  const PARETO_VIEWBOX_H = 380;
  const PARETO_MARGIN = { top: 20, right: 54, bottom: 100, left: 50 };
  // A validated 8-color categorical palette (css/style.css --series-1..8) is
  // the hard cap on distinct colored segments in a stacked bar -- past that,
  // a 9th color is never manufactured, it folds into a shared "Other"
  // segment (dataviz skill: "color follows the entity, never its rank").
  const PARETO_GROUP_MAX_SERIES = 8;

  // Ranks the "Group by" column's values by their OVERALL frequency across
  // every loaded record (not per-bar), and assigns the top
  // PARETO_GROUP_MAX_SERIES a fixed color-slot index. Computed once and
  // reused for every bar's segments so a given group value always gets the
  // same color everywhere on the chart -- color identity must not depend on
  // which bar happens to be showing it.
  function computeGroupColorRanks() {
    const ranks = new Map(); // groupLabel -> 0-based rank
    if (!state.paretoGroupColumn) return ranks;
    const totals = new Map();
    for (const rec of state.records) {
      const raw = getColumnValue(rec, state.paretoGroupColumn);
      const label = (raw === null || raw === undefined || String(raw).trim() === '') ? '(blank)' : String(raw);
      totals.set(label, (totals.get(label) || 0) + 1);
    }
    [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, PARETO_GROUP_MAX_SERIES)
      .forEach(([label], i) => ranks.set(label, i));
    return ranks;
  }
  function seriesColorVar(rank) { return `var(--series-${rank + 1})`; }

  // Counts how often each value of the selected column occurs, sorted most-
  // to-least common, with a running cumulative percentage -- the two things
  // a Pareto chart needs. Independent of any die/defect selection on the two
  // maps: it always summarizes every loaded record, since narrowing it to
  // "just what's currently selected" would make it answer a different
  // question (this selection's makeup) than a Pareto chart is for (what
  // dominates across the whole dataset).
  //
  // When a "Group by" column is set, each entry also gets a `segments` array
  // (label/count/color, ordered by the fixed global color rank, "Other"
  // last) so the bar can be drawn stacked instead of solid. The returned
  // `legend` lists every color actually used, in the same fixed order.
  function computeParetoData() {
    const hasGroup = !!state.paretoGroupColumn;
    const groupRanks = hasGroup ? computeGroupColorRanks() : null;
    const counts = new Map();
    const groupBreakdown = new Map(); // mainLabel -> Map(groupLabel -> count)
    for (const rec of state.records) {
      const raw = getColumnValue(rec, state.paretoColumn);
      const label = (raw === null || raw === undefined || String(raw).trim() === '') ? '(blank)' : String(raw);
      counts.set(label, (counts.get(label) || 0) + 1);
      if (hasGroup) {
        const graw = getColumnValue(rec, state.paretoGroupColumn);
        const glabel = (graw === null || graw === undefined || String(graw).trim() === '') ? '(blank)' : String(graw);
        if (!groupBreakdown.has(label)) groupBreakdown.set(label, new Map());
        const gm = groupBreakdown.get(label);
        gm.set(glabel, (gm.get(glabel) || 0) + 1);
      }
    }
    let entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (entries.length > PARETO_MAX_CATEGORIES) {
      const top = entries.slice(0, PARETO_MAX_CATEGORIES - 1);
      const rest = entries.slice(PARETO_MAX_CATEGORIES - 1);
      const othersCount = rest.reduce((sum, [, c]) => sum + c, 0);
      const othersLabel = `Others (${rest.length} values)`;
      top.push([othersLabel, othersCount]);
      if (hasGroup) {
        // The collapsed categories' own group breakdowns merge into one, so
        // the "Others" bar can still be split by group like any other bar.
        const merged = new Map();
        for (const [mainLabel] of rest) {
          const gm = groupBreakdown.get(mainLabel);
          if (!gm) continue;
          for (const [g, c] of gm) merged.set(g, (merged.get(g) || 0) + c);
        }
        groupBreakdown.set(othersLabel, merged);
      }
      entries = top;
    }
    const total = state.records.length;
    let running = 0;
    const legendUsed = new Map(); // label -> color, insertion order
    let othersUsedInLegend = false;
    const data = entries.map(([label, count]) => {
      running += count;
      const result = { label, count, pct: (count / total) * 100, cumPct: (running / total) * 100 };
      if (hasGroup) {
        const gm = groupBreakdown.get(label) || new Map();
        const named = [];
        let otherCount = 0;
        for (const [g, c] of gm) {
          if (groupRanks.has(g)) named.push([g, c, groupRanks.get(g)]);
          else otherCount += c;
        }
        named.sort((a, b) => a[2] - b[2]);
        const segments = named.map(([g, c, rank]) => ({ label: g, count: c, color: seriesColorVar(rank) }));
        if (otherCount > 0) { segments.push({ label: 'Other', count: otherCount, color: 'var(--text-muted)' }); othersUsedInLegend = true; }
        for (const seg of segments) if (!legendUsed.has(seg.label)) legendUsed.set(seg.label, seg.color);
        result.segments = segments;
      }
      return result;
    });
    // Legend order follows the fixed color rank (not first-appearance), plus
    // "Other" last if it was ever used -- matches the stacking order within
    // each bar so the legend reads as a key to what's on screen.
    let legend = [];
    if (hasGroup) {
      legend = [...groupRanks.entries()]
        .sort((a, b) => a[1] - b[1])
        .filter(([label]) => legendUsed.has(label))
        .map(([label, rank]) => ({ label, color: seriesColorVar(rank) }));
      if (othersUsedInLegend) legend.push({ label: 'Other', color: 'var(--text-muted)' });
    }
    return { data, legend };
  }

  function renderPareto() {
    paretoSvg.innerHTML = '';
    if (!state.records.length || !state.paretoColumn) {
      paretoEmptyState.hidden = false;
      paretoList.innerHTML = '';
      paretoLegend.hidden = true;
      paretoLegend.innerHTML = '';
      return;
    }
    paretoEmptyState.hidden = true;

    const { data, legend } = computeParetoData();
    const x0 = PARETO_MARGIN.left;
    const x1 = PARETO_VIEWBOX_W - PARETO_MARGIN.right;
    const y0 = PARETO_MARGIN.top;
    const y1 = PARETO_VIEWBOX_H - PARETO_MARGIN.bottom;
    const plotW = x1 - x0;
    const plotH = y1 - y0;
    const n = data.length;
    const bandW = plotW / n;
    const barW = Math.min(bandW * 0.55, 48);

    const rawMax = data.reduce((m, e) => Math.max(m, e.count), 0) || 1;
    const step = niceStep(rawMax / 5);
    const yMax = Math.ceil(rawMax / step) * step;

    // First bar whose cumulative % reaches the classic Pareto 80% cutoff --
    // marks the "vital few" categories that account for most of the count.
    const cutoffIndex = data.findIndex((e) => e.cumPct >= 80);

    const frag = document.createDocumentFragment();

    // Left axis: absolute count, gridlines + ticks at a "nice" interval.
    for (let v = 0; v <= yMax + 1e-9; v += step) {
      const y = y1 - (v / yMax) * plotH;
      frag.appendChild(svgEl('line', { class: 'grid-line', x1: x0, y1: y, x2: x1, y2: y }));
      frag.appendChild(svgEl('line', { class: 'tick-mark', x1: x0 - 5, y1: y, x2: x0, y2: y }));
      const label = svgEl('text', { class: 'axis-label tick-label', x: x0 - 8, y: y + 3, 'text-anchor': 'end' });
      label.textContent = String(Math.round(v));
      frag.appendChild(label);
    }

    // Right axis: cumulative percentage, fixed 0-100% in steps of 20. The 80%
    // tick is skipped here and drawn separately below, in the cutoff-line's
    // own warning color, so the two don't render as an overlapping duplicate
    // "80%" label at the same y position.
    for (let p = 0; p <= 100; p += 20) {
      if (p === 80) continue;
      const y = y1 - (p / 100) * plotH;
      frag.appendChild(svgEl('line', { class: 'tick-mark', x1: x1, y1: y, x2: x1 + 5, y2: y }));
      const label = svgEl('text', { class: 'axis-label tick-label', x: x1 + 8, y: y + 3, 'text-anchor': 'start' });
      label.textContent = `${p}%`;
      frag.appendChild(label);
    }

    // 80% reference line, so the "vital few" cutoff is visible at a glance,
    // not just implied by the bar coloring.
    const y80 = y1 - (80 / 100) * plotH;
    frag.appendChild(svgEl('line', { class: 'axis-line pareto-cutoff-line', x1: x0, y1: y80, x2: x1, y2: y80 }));
    frag.appendChild(svgEl('line', { class: 'tick-mark pareto-cutoff-line', x1: x1, y1: y80, x2: x1 + 5, y2: y80 }));
    const cutoffLabel = svgEl('text', {
      class: 'axis-label tick-label pareto-cutoff-label', x: x1 + 8, y: y80 + 3, 'text-anchor': 'start',
    });
    cutoffLabel.textContent = '80%';
    frag.appendChild(cutoffLabel);

    frag.appendChild(svgEl('line', { class: 'tick-mark', x1: x0, y1: y0, x2: x0, y2: y1 }));
    frag.appendChild(svgEl('line', { class: 'tick-mark', x1: x0, y1: y1, x2: x1, y2: y1 }));

    const linePoints = [];

    // 2px-ish gap between stacked segments (and it doubles as breathing room
    // above/below a solid bar) -- separates touching marks with surface-
    // color air instead of a border, per the dataviz skill's stacked-bar
    // mark spec.
    const SEGMENT_GAP = 1.5;

    data.forEach((entry, i) => {
      const cx = x0 + bandW * (i + 0.5);
      // "Vital few" bars (up through the 80% cumulative cutoff) are drawn at
      // full opacity; the "trivial many" tail is dimmed, same visual
      // language as the die defect map's selected-vs-dimmed dots. This
      // opacity layer applies whether or not the bar is also split into
      // group-colored segments -- it says "how much this bar matters
      // overall," which is orthogonal to what a grouped bar's colors say
      // ("what this bar is made of").
      const vital = i <= cutoffIndex;
      const opacity = vital ? 0.9 : 0.45;
      const wholeBarTip = `${entry.label}\nCount: ${entry.count} (${entry.pct.toFixed(1)}%)\nCumulative: ${entry.cumPct.toFixed(1)}%`;

      if (entry.segments) {
        let cumCount = 0;
        for (const seg of entry.segments) {
          const segTopCount = cumCount + seg.count;
          const segTopY = y1 - (segTopCount / yMax) * plotH;
          const segBottomY = y1 - (cumCount / yMax) * plotH;
          const rawH = segBottomY - segTopY;
          const insetH = Math.max(rawH - SEGMENT_GAP, 0.5);
          const segY = segTopY + (rawH - insetH) / 2;
          const rect = svgEl('rect', {
            class: 'pareto-bar', x: cx - barW / 2, y: segY, width: barW, height: insetH,
            fill: seg.color, opacity,
          });
          const segPct = entry.count > 0 ? (seg.count / entry.count) * 100 : 0;
          const segTip = `${entry.label} — ${seg.label}\nCount: ${seg.count} (${segPct.toFixed(1)}% of this bar)\nBar total: ${entry.count}`;
          rect.addEventListener('mouseenter', (e) => showTooltip(e.clientX, e.clientY, segTip));
          rect.addEventListener('mousemove', (e) => showTooltip(e.clientX, e.clientY, segTip));
          rect.addEventListener('mouseleave', hideTooltip);
          frag.appendChild(rect);
          cumCount = segTopCount;
        }
      } else {
        const barH = (entry.count / yMax) * plotH;
        const by = y1 - barH;
        const bar = svgEl('rect', {
          class: 'pareto-bar', x: cx - barW / 2, y: by, width: barW, height: Math.max(barH, 0.5),
          fill: vital ? 'var(--accent-2)' : 'var(--text-muted)', opacity,
        });
        bar.addEventListener('mouseenter', (e) => showTooltip(e.clientX, e.clientY, wholeBarTip));
        bar.addEventListener('mousemove', (e) => showTooltip(e.clientX, e.clientY, wholeBarTip));
        bar.addEventListener('mouseleave', hideTooltip);
        frag.appendChild(bar);
      }

      const labelText = entry.label.length > 16 ? `${entry.label.slice(0, 14)}…` : entry.label;
      const xLabel = svgEl('text', {
        class: 'axis-label tick-label', x: cx, y: y1 + 14, 'text-anchor': 'end',
        transform: `rotate(-40 ${cx} ${y1 + 14})`,
      });
      xLabel.textContent = labelText;
      xLabel.addEventListener('mouseenter', (e) => showTooltip(e.clientX, e.clientY, wholeBarTip));
      xLabel.addEventListener('mousemove', (e) => showTooltip(e.clientX, e.clientY, wholeBarTip));
      xLabel.addEventListener('mouseleave', hideTooltip);
      frag.appendChild(xLabel);

      linePoints.push([cx, y1 - (entry.cumPct / 100) * plotH, wholeBarTip]);
    });

    // Cumulative-% line, drawn over the bars.
    const polyline = svgEl('polyline', {
      class: 'pareto-line', points: linePoints.map(([px, py]) => `${px},${py}`).join(' '),
    });
    polyline.style.stroke = 'var(--accent)';
    frag.appendChild(polyline);

    linePoints.forEach(([px, py, tip]) => {
      const dot = svgEl('circle', { class: 'pareto-point', cx: px, cy: py, r: 3, fill: 'var(--accent)' });
      dot.addEventListener('mouseenter', (e) => showTooltip(e.clientX, e.clientY, tip));
      dot.addEventListener('mousemove', (e) => showTooltip(e.clientX, e.clientY, tip));
      dot.addEventListener('mouseleave', hideTooltip);
      frag.appendChild(dot);
    });

    paretoSvg.appendChild(frag);

    // Legend: the dependable identity channel for >=2 series, per the
    // dataviz skill -- readers shouldn't have to color-match segments to
    // values unaided. A single (or zero) series needs no legend box.
    paretoLegend.innerHTML = '';
    if (legend.length >= 2) {
      for (const item of legend) {
        const el = document.createElement('span');
        el.className = 'pareto-legend-item';
        el.innerHTML = `<span class="pareto-legend-swatch" style="background:${item.color}"></span>${escapeHtml(item.label)}`;
        paretoLegend.appendChild(el);
      }
      paretoLegend.hidden = false;
    } else {
      paretoLegend.hidden = true;
    }

    paretoList.innerHTML = '';
    data.forEach((entry, i) => {
      const row = document.createElement('div');
      row.className = 'pareto-row' + (i <= cutoffIndex ? ' vital' : '');
      let html = `
        <div class="pareto-row-head"><span>#${i + 1} ${escapeHtml(entry.label)}</span><span>${entry.count}</span></div>
        <div class="pareto-row-sub"><span>${entry.pct.toFixed(1)}% of total</span><span>Cum ${entry.cumPct.toFixed(1)}%</span></div>
      `;
      if (entry.segments && entry.segments.length) {
        html += '<div class="pareto-row-groups">' + entry.segments.map((seg) =>
          `<span class="pareto-row-group"><span class="pareto-legend-swatch" style="background:${seg.color}"></span>${escapeHtml(seg.label)}: ${seg.count}</span>`
        ).join('') + '</div>';
      }
      row.innerHTML = html;
      paretoList.appendChild(row);
    });
  }

  /* ===================== Trend chart ===================== */
  const TREND_VIEWBOX_W = 640;
  const TREND_VIEWBOX_H = 380;
  const TREND_MARGIN = { top: 20, right: 20, bottom: 70, left: 50 };
  // Beyond this many plotted dates, most x-axis text labels are skipped (the
  // points themselves are still all drawn) so long date ranges don't turn
  // the axis into an illegible smear of overlapping text -- hovering a point
  // still shows its exact date and count.
  const TREND_MAX_LABELS = 12;

  // A bare 4-digit value in a "date" column is a fab work-week code (YYWW:
  // 2-digit year + 2-digit ISO week, e.g. "2405" = 2024, week 5) -- not a
  // literal calendar year. JS's Date constructor would otherwise happily
  // (and silently wrongly) parse "2405" as literally the year 2405, so this
  // format is matched and handled before anything falls through to
  // new Date().
  const YYWW_RE = /^(\d{2})(\d{2})$/;

  // Monday of the given ISO-8601 week (week 1 is defined as the week
  // containing the year's first Thursday, equivalently the week containing
  // Jan 4th) -- gives a real, correctly-orderable date for a YYWW code,
  // reusing the same "collapse to one representative calendar date per
  // bucket" approach already used for timestamped columns below.
  function isoWeekMonday(year, week) {
    const jan4 = new Date(year, 0, 4);
    const jan4WeekdayMon0 = (jan4.getDay() + 6) % 7; // Monday=0 ... Sunday=6
    const week1Monday = new Date(year, 0, 4 - jan4WeekdayMon0);
    return new Date(week1Monday.getFullYear(), week1Monday.getMonth(), week1Monday.getDate() + (week - 1) * 7);
  }

  // Parses one raw cell value into a { sortKey, label } pair, or null if it
  // isn't a recognizable date/work-week. sortKey is a real timestamp (so
  // sorting is correct even if a column mixes formats); label is what's
  // actually shown on the chart and used as the grouping bucket.
  function parseTrendValue(raw) {
    const trimmed = String(raw).trim();
    const yyww = YYWW_RE.exec(trimmed);
    if (yyww) {
      const week = Number(yyww[2]);
      if (week < 1 || week > 53) return null; // not a valid ISO week number
      const year = 2000 + Number(yyww[1]);
      const monday = isoWeekMonday(year, week);
      return { sortKey: monday.getTime(), label: `${year}-W${yyww[2]}` };
    }
    const d = new Date(trimmed);
    if (Number.isNaN(d.getTime())) return null;
    // Collapsed to calendar date (year-month-day, local time) -- a column
    // with a time-of-day component would otherwise produce a near-unique
    // bucket per row instead of a usable daily trend.
    const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const label = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
    return { sortKey: local.getTime(), label };
  }

  // Groups records by the selected date-like column's parsed value and
  // counts rows per bucket. Rows whose value is blank or unparseable are
  // excluded (a trend line has no sensible place to put them), and buckets
  // are sorted chronologically by their real timestamp, not by label text.
  function computeTrendData() {
    const groups = new Map(); // label -> { count, sortKey }
    let excluded = 0;
    for (const rec of state.records) {
      const raw = getColumnValue(rec, state.trendColumn);
      if (raw === null || raw === undefined || String(raw).trim() === '') { excluded++; continue; }
      const parsed = parseTrendValue(raw);
      if (!parsed) { excluded++; continue; }
      const g = groups.get(parsed.label);
      if (g) g.count++;
      else groups.set(parsed.label, { count: 1, sortKey: parsed.sortKey });
    }
    const data = [...groups.entries()]
      .sort((a, b) => a[1].sortKey - b[1].sortKey)
      .map(([date, g]) => ({ date, count: g.count }));
    return { data, excluded };
  }

  function renderTrend() {
    trendSvg.innerHTML = '';
    trendExcludedNote.hidden = true;
    if (!state.records.length || !state.trendColumn) {
      trendEmptyState.textContent = state.records.length && !state.trendColumns.length
        ? 'No column with "date" in its name was found in this file.'
        : 'Upload a CSV with a date-like column to see a defect-count trend.';
      trendEmptyState.hidden = false;
      return;
    }

    const { data, excluded } = computeTrendData();
    if (!data.length) {
      trendEmptyState.textContent = `No valid dates found in column "${state.trendColumn}".`;
      trendEmptyState.hidden = false;
      return;
    }
    trendEmptyState.hidden = true;

    const x0 = TREND_MARGIN.left;
    const x1 = TREND_VIEWBOX_W - TREND_MARGIN.right;
    const y0 = TREND_MARGIN.top;
    const y1 = TREND_VIEWBOX_H - TREND_MARGIN.bottom;
    const plotW = x1 - x0;
    const plotH = y1 - y0;
    const n = data.length;
    const bandW = n > 1 ? plotW / (n - 1) : 0;

    const rawMax = data.reduce((m, e) => Math.max(m, e.count), 0) || 1;
    const step = niceStep(rawMax / 5);
    const yMax = Math.ceil(rawMax / step) * step;

    const frag = document.createDocumentFragment();

    for (let v = 0; v <= yMax + 1e-9; v += step) {
      const y = y1 - (v / yMax) * plotH;
      frag.appendChild(svgEl('line', { class: 'grid-line', x1: x0, y1: y, x2: x1, y2: y }));
      frag.appendChild(svgEl('line', { class: 'tick-mark', x1: x0 - 5, y1: y, x2: x0, y2: y }));
      const label = svgEl('text', { class: 'axis-label tick-label', x: x0 - 8, y: y + 3, 'text-anchor': 'end' });
      label.textContent = String(Math.round(v));
      frag.appendChild(label);
    }
    frag.appendChild(svgEl('line', { class: 'tick-mark', x1: x0, y1: y0, x2: x0, y2: y1 }));
    frag.appendChild(svgEl('line', { class: 'tick-mark', x1: x0, y1: y1, x2: x1, y2: y1 }));

    // Only label every Nth point when there are many, to keep the axis
    // readable -- but every point is still plotted and hoverable.
    const labelStride = Math.max(1, Math.ceil(n / TREND_MAX_LABELS));

    const points = data.map((entry, i) => {
      const cx = n > 1 ? x0 + bandW * i : (x0 + x1) / 2;
      const cy = y1 - (entry.count / yMax) * plotH;
      return { ...entry, cx, cy };
    });

    const polyline = svgEl('polyline', {
      class: 'trend-line', points: points.map((p) => `${p.cx},${p.cy}`).join(' '),
    });
    polyline.style.stroke = 'var(--accent)';
    frag.appendChild(polyline);

    points.forEach((p, i) => {
      const tip = `${p.date}\nCount: ${p.count}`;
      const dot = svgEl('circle', { class: 'trend-point', cx: p.cx, cy: p.cy, r: 3, fill: 'var(--accent)' });
      dot.addEventListener('mouseenter', (e) => showTooltip(e.clientX, e.clientY, tip));
      dot.addEventListener('mousemove', (e) => showTooltip(e.clientX, e.clientY, tip));
      dot.addEventListener('mouseleave', hideTooltip);
      frag.appendChild(dot);

      if (i % labelStride === 0 || i === n - 1) {
        const xLabel = svgEl('text', {
          class: 'axis-label tick-label', x: p.cx, y: y1 + 14, 'text-anchor': 'end',
          transform: `rotate(-40 ${p.cx} ${y1 + 14})`,
        });
        xLabel.textContent = p.date;
        xLabel.addEventListener('mouseenter', (e) => showTooltip(e.clientX, e.clientY, tip));
        xLabel.addEventListener('mousemove', (e) => showTooltip(e.clientX, e.clientY, tip));
        xLabel.addEventListener('mouseleave', hideTooltip);
        frag.appendChild(xLabel);
      }
    });

    trendSvg.appendChild(frag);

    if (excluded > 0) {
      trendExcludedNote.textContent =
        `${excluded} record${excluded === 1 ? '' : 's'} missing/unparseable "${state.trendColumn}" excluded from the trend.`;
      trendExcludedNote.hidden = false;
    }
  }

  /* ===================== Render orchestration ===================== */
  function render() {
    renderWafer();
    updateDieSizeHint();
    if (state.records.length) renderDieDetail();
    renderPareto();
    renderTrend();
  }

  /* ===================== Init ===================== */
  appVersionInfo.textContent = `Version ${APP_VERSION} · Updated ${APP_UPDATED}`;
  initTheme();
  render();
})();
