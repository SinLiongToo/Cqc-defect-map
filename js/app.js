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
    gridLineColor: null,    // hex string once user picks one, else CSS default
    notch: 'down',
    records: [],            // [{dieX, dieY, gdsX, gdsY, raw:{...}}]
    defectsByDie: new Map(),// key "x,y" -> records[]
    selectedDies: new Set(),// Set of "x,y" keys -- supports multi-select (ctrl/shift-click)
    rawBytes: null,         // Uint8Array of the last-loaded text file, kept for re-decoding on encoding change
    workbook: null,         // SheetJS workbook, kept for re-parsing on sheet change (xlsx/xls only)
  };

  function dieKey(x, y) { return `${x},${y}`; }

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
  const dieCard = el('dieCard');
  const dieCardTitle = el('dieCardTitle');
  const dieSvg = el('dieSvg');
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
  const fullViewBtn = el('fullViewBtn');
  const fullViewModal = el('fullViewModal');
  const fullViewBody = el('fullViewBody');
  const closeFullView = el('closeFullView');

  /* ===================== Modals ===================== */
  function openModal(modal) { modal.hidden = false; }
  function closeModal(modal) { modal.hidden = true; }

  helpBtn.addEventListener('click', () => openModal(helpModal));
  closeHelpModal.addEventListener('click', () => closeModal(helpModal));
  helpModal.addEventListener('click', (e) => { if (e.target === helpModal) closeModal(helpModal); });

  fullViewBtn.addEventListener('click', () => {
    fullViewBody.appendChild(dieStage);
    openModal(fullViewModal);
  });
  function exitFullView() {
    dieCard.appendChild(dieStage);
    closeModal(fullViewModal);
  }
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
    state.selectedDies = new Set();
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

    // reflect current selection highlight(s), if any
    for (const key of state.selectedDies) {
      const [sx, sy] = key.split(',');
      const sel = waferSvg.querySelector(`.die-rect[data-die-x="${sx}"][data-die-y="${sy}"]`);
      if (sel) sel.classList.add('selected');
    }
  }

  /* ===================== Die inspector ===================== */
  function updateDieCardTitle() {
    const keys = [...state.selectedDies];
    if (keys.length === 0) {
      dieCardTitle.textContent = 'All dies';
    } else if (keys.length === 1) {
      const [x, y] = keys[0].split(',');
      const defects = state.defectsByDie.get(keys[0]) || [];
      dieCardTitle.textContent = `Die (${x}, ${y}) — ${defects.length} defect${defects.length === 1 ? '' : 's'}`;
    } else {
      let total = 0;
      for (const k of keys) total += (state.defectsByDie.get(k) || []).length;
      dieCardTitle.textContent = `${keys.length} dies selected — ${total} defect${total === 1 ? '' : 's'}`;
    }
  }

  // Plain click: select just this die (replace any existing selection).
  function selectDie(x, y) {
    state.selectedDies = new Set([dieKey(x, y)]);
    updateDieCardTitle();
    renderDieDetail();
    renderWafer(); // refresh selection outline
    // Don't scroll the (now mostly empty) card into view while its contents
    // are reparented into the full-view modal.
    if (fullViewModal.hidden) dieCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Ctrl/Cmd/Shift-click: add or remove this die from the current selection,
  // for inspecting several dies' defects together.
  function toggleDieSelection(x, y) {
    const key = dieKey(x, y);
    if (state.selectedDies.has(key)) state.selectedDies.delete(key);
    else state.selectedDies.add(key);
    updateDieCardTitle();
    renderDieDetail();
    renderWafer();
  }

  function clearSelection() {
    if (state.selectedDies.size === 0) return;
    state.selectedDies = new Set();
    updateDieCardTitle();
    renderDieDetail();
    renderWafer();
  }

  // Rubber-band multi-select on the wafer map: hold Ctrl/Cmd/Shift and drag to
  // draw a box, adding every die it touches to the selection (on top of
  // individual Ctrl/Shift-click). A plain click on empty background, with no
  // drag, clears the selection instead. Dies tile the wafer edge-to-edge with
  // almost no gap between them, so the drag has to be allowed to start ON a
  // die-rect too -- it's only treated as a real drag once the mouse actually
  // moves; a same-spot mousedown+mouseup still lets the die's own click
  // handler run untouched (native click semantics: it won't fire at all if
  // the mouse moved off the original element by mouseup).
  let waferDrag = null;

  waferStage.addEventListener('mousedown', (e) => {
    waferDrag = {
      modifier: e.ctrlKey || e.metaKey || e.shiftKey,
      startX: e.clientX, startY: e.clientY, moved: false,
      startedOnDie: !!e.target.closest('.die-rect'),
    };
  });

  document.addEventListener('mousemove', (e) => {
    if (!waferDrag) return;
    if (Math.abs(e.clientX - waferDrag.startX) > 3 || Math.abs(e.clientY - waferDrag.startY) > 3) {
      waferDrag.moved = true;
    }
    if (waferDrag.modifier && waferDrag.moved) {
      const left = Math.min(waferDrag.startX, e.clientX);
      const top = Math.min(waferDrag.startY, e.clientY);
      waferSelectionBox.style.left = `${left}px`;
      waferSelectionBox.style.top = `${top}px`;
      waferSelectionBox.style.width = `${Math.abs(e.clientX - waferDrag.startX)}px`;
      waferSelectionBox.style.height = `${Math.abs(e.clientY - waferDrag.startY)}px`;
      waferSelectionBox.hidden = false;
    }
  });

  document.addEventListener('mouseup', (e) => {
    if (!waferDrag) return;
    const drag = waferDrag;
    waferDrag = null;
    waferSelectionBox.hidden = true;

    if (drag.modifier && drag.moved) {
      const left = Math.min(drag.startX, e.clientX);
      const right = Math.max(drag.startX, e.clientX);
      const top = Math.min(drag.startY, e.clientY);
      const bottom = Math.max(drag.startY, e.clientY);
      let changed = false;
      document.querySelectorAll('.die-rect').forEach((el) => {
        const r = el.getBoundingClientRect();
        const intersects = r.left < right && r.right > left && r.top < bottom && r.bottom > top;
        if (intersects) {
          const key = dieKey(Number(el.getAttribute('data-die-x')), Number(el.getAttribute('data-die-y')));
          if (!state.selectedDies.has(key)) { state.selectedDies.add(key); changed = true; }
        }
      });
      if (changed) { updateDieCardTitle(); renderDieDetail(); renderWafer(); }
    } else if (!drag.modifier && !drag.moved && !drag.startedOnDie) {
      // Background click with no drag and no modifier -- clear the selection.
      // (A same-spot click that started on a die is left entirely to that
      // die's own click handler, whether or not a modifier was held.)
      clearSelection();
    }
  });

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
    const mmToPx = usableHalf / Math.max(halfMmX, halfMmY);
    const centerPx = DIE_VIEWBOX / 2;

    const dieW = state.dieSizeX * mmToPx;
    const dieH = state.dieSizeY * mmToPx;

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

    group.appendChild(svgEl('rect', {
      class: 'die-outline',
      x: centerPx - dieW / 2, y: centerPx - dieH / 2, width: dieW, height: dieH,
    }));

    // Ruler: grid lines + tick marks + um labels along both axes, spaced at a
    // "nice" round interval. The assumed center (where GDS-X/Y = dieSize/2
    // normally lands) can be nudged by the GDS Origin Offset calibration, to
    // correct a systematic measurement bias. Once auto-calibrated, the
    // absolute center (data-derived, independent of Die Size) takes priority
    // over the offset so it stays correct across Die Size changes; the
    // offset fields are kept in sync purely for display.
    const halfWidthUm = halfMmX * 1000;
    const halfHeightUm = halfMmY * 1000;
    const isCalibratedX = state.gdsCalibratedCenterXUm !== null;
    const isCalibratedY = state.gdsCalibratedCenterYUm !== null;
    const assumedCenterXUm = isCalibratedX ? state.gdsCalibratedCenterXUm : halfWidthUm + state.gdsOffsetXUm;
    const assumedCenterYUm = isCalibratedY ? state.gdsCalibratedCenterYUm : halfHeightUm + state.gdsOffsetYUm;
    if (isCalibratedX) {
      state.gdsOffsetXUm = Math.round(assumedCenterXUm - halfWidthUm);
      gdsOffsetXInput.value = state.gdsOffsetXUm;
    }
    if (isCalibratedY) {
      state.gdsOffsetYUm = Math.round(assumedCenterYUm - halfHeightUm);
      gdsOffsetYInput.value = state.gdsOffsetYUm;
    }
    const pxPerUm = mmToPx / 1000;
    const TARGET_TICKS = 4;
    const stepUm = niceStep(Math.max(halfWidthUm, halfHeightUm) / TARGET_TICKS);
    const TICK_LEN = 5;

    for (let vUm = stepUm; vUm <= halfWidthUm + 1e-6; vUm += stepUm) {
      for (const sign of [1, -1]) {
        const tx = centerPx + sign * vUm * pxPerUm;
        group.appendChild(gridLine({ x1: tx, y1: centerPx - dieH / 2, x2: tx, y2: centerPx + dieH / 2 }));
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
        group.appendChild(gridLine({ x1: centerPx - dieW / 2, y1: ty, x2: centerPx + dieW / 2, y2: ty }));
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
      class: 'axis-line', x1: centerPx - dieW / 2, y1: centerPx, x2: centerPx + dieW / 2, y2: centerPx,
    }));
    group.appendChild(svgEl('line', {
      class: 'axis-line', x1: centerPx, y1: centerPx - dieH / 2, x2: centerPx, y2: centerPx + dieH / 2,
    }));
    group.appendChild(textEl({
      class: 'axis-label', x: centerPx + dieW / 2 - 4, y: centerPx - 6, 'text-anchor': 'end',
    })).textContent = `+X`;
    group.appendChild(textEl({
      class: 'axis-label', x: centerPx + 6, y: centerPx - dieH / 2 + 10,
    })).textContent = `+Y`;
    group.appendChild(textEl({
      class: 'axis-label tick-label', x: centerPx - dieW / 2 + 4, y: centerPx - dieH / 2 + 12,
    })).textContent = 'µm';

    // Plot every plottable defect from every die. When one or more dies are
    // selected, their own points are drawn on top, larger and in the accent
    // color, while everything else is dimmed for pattern context. With no
    // selection, every dot is drawn the same (no dimming) since nothing is
    // being emphasized.
    const hasSelection = state.selectedDies.size > 0;
    const isSelectedRec = (rec) => hasSelection && state.selectedDies.has(dieKey(rec.dieX, rec.dieY));
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
        if (e.ctrlKey || e.metaKey || e.shiftKey) toggleDieSelection(rec.dieX, rec.dieY);
        else selectDie(rec.dieX, rec.dieY);
      });
      group.appendChild(dot);
    }

    dieSvg.appendChild(group);

    // Defect list stays scoped to the selected die(s) only, combined across
    // all of them when more than one is selected.
    if (!hasSelection) {
      const p = document.createElement('p');
      p.className = 'muted small';
      p.textContent = 'Click a die on the wafer map to see its defect list.';
      dieDefectList.appendChild(p);
      return;
    }
    const combinedDefects = state.records.filter(isSelectedRec);
    const multiSelect = state.selectedDies.size > 1;
    if (!combinedDefects.length) {
      const p = document.createElement('p');
      p.className = 'muted small';
      p.textContent = multiSelect
        ? 'The selected dies have no recorded defects.'
        : 'This die has no recorded defects.';
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
    state.selectedDies = new Set();
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

  /* ===================== Render orchestration ===================== */
  function render() {
    renderWafer();
    updateDieSizeHint();
    if (state.records.length) renderDieDetail();
  }

  /* ===================== Init ===================== */
  initTheme();
  render();
})();
