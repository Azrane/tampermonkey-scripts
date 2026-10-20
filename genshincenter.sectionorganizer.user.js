// ==UserScript==
// @name         Genshin Center - Section Organizer
// @namespace    https://genshin-center.com/
// @version      1.9.0
// @description  Organize characters and weapons into collapsible sections on the Ascension Planner. Group items visually, collapse to hide, and pause/resume a whole section at once.
// @author       You
// @match        https://genshin-center.com/planner*
// @match        https://genshin-center.com/*/planner*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const SECTION_DATA_ATTR = 'data-gc-section';
  const ITEM_KEY_ATTR = 'data-gc-key';

  const DEFAULT_COLORS = [
    '#e57373', '#f06292', '#ba68c8', '#9575cd',
    '#7986cb', '#64b5f6', '#4dd0e1', '#4db6ac',
    '#81c784', '#aed581', '#ffd54f', '#ffb74d',
    '#ff8a65', '#a1887f', '#90a4ae'
  ];

  const STORAGE_KEY = 'gc-section-organizer-v2';

  // ---- User config ----
  // Scroll-wheel adjusts inventory quantity boxes.
  //   false = only when the box is focused (clicked into)
  //   true  = also when merely hovering the box (lets you scroll-edit
  //           without clicking, but you can't scroll the page past a box)
  const SCROLL_ADJUST_ON_HOVER = false;
  const LEGACY_STORAGE_KEY = 'gc-section-organizer-v1';
  const DEFAULT_PROFILE = '__default';

  // ---------- State (per-profile) ----------
  // v2 storage shape: { profiles: { "<profileName>": { sections, assignments } } }
  function defaultState() {
    return { sections: [], assignments: {} };
  }
  const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
  function sanitizeSection(s) {
    if (!s || typeof s !== 'object') return null;
    if (typeof s.id !== 'string' || !s.id) return null;
    return {
      id: s.id,
      name: (typeof s.name === 'string' && s.name.trim()) ? s.name.trim() : 'Unnamed',
      color: (typeof s.color === 'string' && HEX_COLOR_RE.test(s.color)) ? s.color : DEFAULT_COLORS[0],
      collapsed: !!s.collapsed
    };
  }
  function sanitizeProfileState(p) {
    const sections = (Array.isArray(p && p.sections) ? p.sections : [])
      .map(sanitizeSection)
      .filter(Boolean);
    const assignments = {};
    const validIds = new Set(sections.map(s => s.id));
    const rawAssign = (p && p.assignments && typeof p.assignments === 'object') ? p.assignments : {};
    for (const k of Object.keys(rawAssign)) {
      // Drop assignments pointing at sections that don't exist
      if (typeof rawAssign[k] === 'string' && validIds.has(rawAssign[k])) {
        assignments[k] = rawAssign[k];
      }
    }
    return { sections, assignments };
  }
  function sanitizeUi(u) {
    const panelCollapsed = {};
    const raw = (u && u.panelCollapsed && typeof u.panelCollapsed === 'object') ? u.panelCollapsed : {};
    for (const k of Object.keys(raw)) {
      if (raw[k] === true) panelCollapsed[k] = true;
    }
    return { panelCollapsed };
  }

  function loadAllProfiles() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const profiles = {};
        if (parsed.profiles && typeof parsed.profiles === 'object') {
          for (const k of Object.keys(parsed.profiles)) {
            profiles[k] = sanitizeProfileState(parsed.profiles[k]);
          }
        }
        return { profiles, ui: sanitizeUi(parsed.ui) };
      }
      // Migrate legacy v1 (flat, profile-unaware) data into the default bucket.
      const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacyRaw) {
        const legacy = sanitizeProfileState(JSON.parse(legacyRaw));
        console.log('[gc-sections] migrated v1 data to per-profile storage');
        return { profiles: { [DEFAULT_PROFILE]: legacy }, ui: sanitizeUi(null) };
      }
    } catch (e) {
      console.error('[gc-sections] load failed, starting fresh', e);
    }
    return { profiles: {}, ui: sanitizeUi(null) };
  }

  let allProfiles = loadAllProfiles();
  let currentProfileKey = DEFAULT_PROFILE;
  let state = null; // set by switchToProfile below

  function saveState() {
    try {
      allProfiles.profiles[currentProfileKey] = state;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(allProfiles));
    } catch (e) { console.error('[gc-sections] save failed', e); }
  }

  // The site shows the active profile name in the header account button.
  function detectProfileKey() {
    const el = document.querySelector('[class*="Header_accBtn"] [class*="Header_number"]');
    const name = el ? el.textContent.trim() : '';
    return name || DEFAULT_PROFILE;
  }

  function isEmptyState(s) {
    return !s || (s.sections.length === 0 && Object.keys(s.assignments).length === 0);
  }

  function switchToProfile(key) {
    if (state && key === currentProfileKey) return;
    if (state) saveState(); // persist outgoing profile first
    const previousKey = currentProfileKey;
    currentProfileKey = key;

    if (!allProfiles.profiles[key]) {
      allProfiles.profiles[key] = defaultState();
    }

    // Migration/race cleanup: data can land in the __default bucket when the
    // header hasn't hydrated yet (or from a v1 upgrade). When we move from
    // __default to a named profile, reconcile:
    //  - default has data, destination empty  -> adopt data into destination
    //  - default empty                        -> prune the cruft bucket
    //  - both have data                       -> keep both, warn (no data loss)
    if (previousKey === DEFAULT_PROFILE && key !== DEFAULT_PROFILE) {
      const def = allProfiles.profiles[DEFAULT_PROFILE];
      const dest = allProfiles.profiles[key];
      if (!isEmptyState(def) && isEmptyState(dest)) {
        allProfiles.profiles[key] = def;
        delete allProfiles.profiles[DEFAULT_PROFILE];
        console.log(`[gc-sections] adopted default-bucket data into profile "${key}"`);
      } else if (isEmptyState(def)) {
        delete allProfiles.profiles[DEFAULT_PROFILE];
      } else {
        console.warn(`[gc-sections] both default bucket and profile "${key}" contain data; keeping both. Use __gcSections.profiles() to inspect.`);
      }
    }

    state = allProfiles.profiles[key];
    saveState();
    console.log(`[gc-sections] active profile: "${key}"`);
  }
  switchToProfile(detectProfileKey());

  // Poll for profile switches (the header updates when the user changes
  // profile in account settings — no reliable event to hook).
  setInterval(() => {
    const key = detectProfileKey();
    if (key !== currentProfileKey) {
      switchToProfile(key);
      scheduleRender(true);
    }
  }, 2000);

  function genId() {
    return 'sec-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  }
  function pickColor() {
    const used = new Set(state.sections.map(s => s.color));
    for (const c of DEFAULT_COLORS) if (!used.has(c)) return c;
    return DEFAULT_COLORS[state.sections.length % DEFAULT_COLORS.length];
  }
  function getSectionById(id) {
    return state.sections.find(s => s.id === id);
  }

  // ---------- Styles ----------
  const css = `
    .gc-section-header {
      width: 100%;
      box-sizing: border-box;
      /* Span the full row regardless of whether the parent is grid or flex */
      grid-column: 1 / -1;
      flex-basis: 100%;
      background: linear-gradient(160deg, rgba(40, 55, 90, 0.88) 0%, rgba(22, 32, 58, 0.92) 100%);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-left: 5px solid var(--sec-color, #888);
      border-radius: 6px;
      padding: 8px 12px;
      margin: 12px 0 8px 0;
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: 'Montserrat', sans-serif;
      font-weight: 700;
      color: #ece5d8;
      font-size: 13px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.25);
    }
    .gc-section-header[data-collapsed="true"] {
      opacity: 0.65;
    }
    .gc-section-toggle {
      cursor: pointer;
      user-select: none;
      width: 22px;
      text-align: center;
      font-size: 14px;
      color: #ece5d8;
    }
    .gc-section-name {
      flex: 1;
      cursor: pointer;
      letter-spacing: 0.5px;
      color: #ece5d8;
    }
    .gc-section-name:hover { text-decoration: underline; }
    .gc-section-count {
      font-size: 11px;
      font-weight: 400;
      color: rgba(236, 229, 216, 0.65);
      margin-right: 4px;
    }
    .gc-btn {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 4px;
      padding: 3px 8px;
      font-size: 11px;
      cursor: pointer;
      font-family: 'Montserrat', sans-serif;
      color: #ece5d8;
      font-weight: 600;
      transition: background 0.15s, border-color 0.15s;
    }
    .gc-btn:hover { background: rgba(255, 255, 255, 0.18); border-color: rgba(255, 255, 255, 0.35); }
    .gc-btn:disabled {
      opacity: 0.3;
      cursor: default;
    }
    .gc-btn:disabled:hover { background: rgba(255, 255, 255, 0.08); border-color: rgba(255, 255, 255, 0.18); }
    .gc-btn-danger:hover {
      background: rgba(220, 80, 80, 0.35);
      border-color: rgba(255, 120, 120, 0.6);
      color: #ffd5d5;
    }
    .gc-section-controls { display: flex; gap: 4px; }
    .gc-color-swatch {
      width: 16px; height: 16px;
      border-radius: 3px;
      border: 1px solid rgba(255,255,255,0.35);
      cursor: pointer;
      flex-shrink: 0;
      box-shadow: 0 0 0 1px rgba(0,0,0,0.3);
    }
    .gc-unassigned-header {
      background: rgba(40, 50, 75, 0.55);
      border: 1px dashed rgba(255, 255, 255, 0.2);
      border-left: 5px dashed rgba(255, 255, 255, 0.2);
      color: rgba(236, 229, 216, 0.7);
      box-shadow: none;
    }
    /* Per-item section badge: inserted as a strip directly below the nameBar */
    .gc-item-section-badge {
      display: block;
      width: 100%;
      box-sizing: border-box;
      font-family: 'Montserrat', sans-serif;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.6px;
      text-align: center;
      padding: 3px 8px;
      margin: 0;
      background: rgba(22, 32, 58, 0.85);
      color: #ece5d8;
      border: none;
      border-top: 1px solid rgba(0, 0, 0, 0.25);
      border-bottom: 3px solid var(--badge-sec-color, rgba(255,255,255,0.15));
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: filter 0.15s, opacity 0.2s;
      position: relative;
      z-index: 2;
    }
    .gc-item-section-badge:hover { filter: brightness(1.25); }
    .gc-item-section-badge.unassigned {
      background: rgba(22, 32, 58, 0.4);
      color: rgba(236, 229, 216, 0.55);
      font-style: italic;
      font-weight: 500;
      border-bottom-style: dashed;
      border-bottom-color: rgba(255,255,255,0.2);
    }
    .gc-item-section-badge.unassigned:hover {
      background: rgba(22, 32, 58, 0.7);
      color: #ece5d8;
    }
    .gc-item-section-badge.paused {
      filter: grayscale(85%);
      opacity: 0.45;
    }
    .gc-menu {
      position: absolute;
      background: rgba(22, 32, 58, 0.97);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 6px;
      box-shadow: 0 6px 18px rgba(0,0,0,0.5);
      z-index: 10000;
      min-width: 180px;
      max-height: 320px;
      overflow-y: auto;
      overflow-x: hidden;
      font-family: 'Montserrat', sans-serif;
      font-size: 13px;
      padding: 4px 0;
      color: #ece5d8;
    }
    .gc-menu button {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      box-sizing: border-box;
      text-align: left;
      padding: 8px 12px;
      background: none;
      border: none;
      cursor: pointer;
      font: inherit;
      color: #ece5d8;
    }
    .gc-menu button:hover { background: rgba(255, 255, 255, 0.1); }
    .gc-menu button:disabled { cursor: default; color: rgba(236, 229, 216, 0.45); font-style: italic; }
    .gc-menu button:disabled:hover { background: none; }
    .gc-menu-sep {
      height: 1px;
      background: rgba(255, 255, 255, 0.15);
      margin: 4px 0;
    }
    .gc-color-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 6px;
      padding: 8px;
    }
    .gc-color-grid .gc-color-swatch { width: 26px; height: 26px; }
    /* --- Panel collapse (Summary / Schedule) --- */
    .gc-cat-toggle { cursor: pointer; user-select: none; }
    .gc-cat-toggle:hover { text-decoration: underline dotted; text-underline-offset: 3px; }
    .gc-cat-toggle.gc-cat-dim { opacity: 0.55; }
    .gc-cat-arrow {
      display: inline-block;
      margin-left: 6px;
      font-size: 0.75em;
      transition: transform 0.2s;
      transform-origin: 50% 50%;
    }
    .gc-cat-arrow.gc-cat-closed { transform: rotate(-90deg); }
    .gc-panel-hidden { display: none !important; }
    .gc-fade-in { animation: gcFadeIn 0.18s ease; }
    @keyframes gcFadeIn { from { opacity: 0; } to { opacity: 1; } }
    /* --- Modal (export/import) --- */
    .gc-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      z-index: 20000;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .gc-modal {
      background: rgba(22, 32, 58, 0.98);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 8px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.6);
      padding: 16px;
      width: min(560px, 92vw);
      font-family: 'Montserrat', sans-serif;
      color: #ece5d8;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .gc-modal h3 { margin: 0; font-size: 15px; }
    .gc-modal p { margin: 0; font-size: 12px; color: rgba(236,229,216,0.7); }
    .gc-modal textarea {
      width: 100%;
      box-sizing: border-box;
      height: 160px;
      resize: vertical;
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 4px;
      color: #ece5d8;
      font-family: monospace;
      font-size: 11px;
      padding: 8px;
    }
    .gc-modal-buttons {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .gc-modal-buttons .gc-btn { font-size: 12px; padding: 6px 14px; }
  `;
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ---------- DOM helpers ----------
  function getItemList() {
    return document.querySelector('[class*="Farm_itemList"]');
  }

  function identifyItems() {
    const list = getItemList();
    if (!list) return [];
    const wrappers = Array.from(list.querySelectorAll('[class*="ItemPanel_itemWrapper"]'));
    const counts = {};
    const results = [];
    for (const w of wrappers) {
      const nameEl = w.querySelector('[class*="ItemPanel_itemName"] p');
      if (!nameEl) continue;
      const name = nameEl.textContent.trim();
      const img = w.querySelector('[class*="ItemPanel_itemImage"] [class*="containedImage"]');
      let type = 'item';
      if (img) {
        const bg = img.style.backgroundImage || '';
        if (bg.includes('/char/')) type = 'char';
        else if (bg.includes('/weapons/')) type = 'weapon';
      }
      const baseKey = `${type}:${name}`;
      counts[baseKey] = (counts[baseKey] || 0) + 1;
      const key = counts[baseKey] === 1 ? baseKey : `${baseKey}#${counts[baseKey]}`;
      w.setAttribute(ITEM_KEY_ATTR, key);
      results.push({ wrapper: w, slot: w.parentElement, key, name, type });
    }
    return results;
  }

  // ---------- Section header element ----------
  function moveSection(secId, dir) {
    const idx = state.sections.findIndex(s => s.id === secId);
    if (idx === -1) return;
    const target = idx + dir;
    if (target < 0 || target >= state.sections.length) return;
    const [sec] = state.sections.splice(idx, 1);
    state.sections.splice(target, 0, sec);
    saveState();
    scheduleRender(true);
  }

  function createSectionHeader(sec, itemCount) {
    const h = document.createElement('div');
    h.className = 'gc-section-header';
    h.setAttribute('data-gc-section-header', sec.id);
    h.setAttribute('data-collapsed', sec.collapsed ? 'true' : 'false');
    h.style.setProperty('--sec-color', sec.color);

    const toggleCollapse = () => {
      sec.collapsed = !sec.collapsed;
      saveState();
      scheduleRender(true);
    };

    const toggle = document.createElement('span');
    toggle.className = 'gc-section-toggle';
    toggle.textContent = sec.collapsed ? '▶' : '▼';
    toggle.title = sec.collapsed ? 'Expand' : 'Collapse';
    toggle.addEventListener('click', toggleCollapse);
    h.appendChild(toggle);

    const swatch = document.createElement('div');
    swatch.className = 'gc-color-swatch';
    swatch.style.background = sec.color;
    swatch.title = 'Change color';
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      showColorMenu(e, sec);
    });
    h.appendChild(swatch);

    const name = document.createElement('div');
    name.className = 'gc-section-name';
    name.textContent = sec.name;
    name.title = sec.collapsed ? 'Click to expand' : 'Click to collapse';
    name.addEventListener('click', toggleCollapse);
    h.appendChild(name);

    const count = document.createElement('span');
    count.className = 'gc-section-count';
    count.textContent = `${itemCount} item${itemCount === 1 ? '' : 's'}`;
    h.appendChild(count);

    const controls = document.createElement('div');
    controls.className = 'gc-section-controls';

    const idx = state.sections.findIndex(s => s.id === sec.id);

    const upBtn = document.createElement('button');
    upBtn.className = 'gc-btn';
    upBtn.textContent = '▲';
    upBtn.title = 'Move section up';
    upBtn.disabled = idx <= 0;
    upBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      moveSection(sec.id, -1);
    });
    controls.appendChild(upBtn);

    const downBtn = document.createElement('button');
    downBtn.className = 'gc-btn';
    downBtn.textContent = '▼';
    downBtn.title = 'Move section down';
    downBtn.disabled = idx >= state.sections.length - 1;
    downBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      moveSection(sec.id, 1);
    });
    controls.appendChild(downBtn);

    const pauseBtn = document.createElement('button');
    pauseBtn.className = 'gc-btn';
    pauseBtn.textContent = '⏸ Pause all';
    pauseBtn.title = 'Pause all active items in this section';
    pauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSectionPause(sec.id, true);
    });
    controls.appendChild(pauseBtn);

    const resumeBtn = document.createElement('button');
    resumeBtn.className = 'gc-btn';
    resumeBtn.textContent = '▶ Resume all';
    resumeBtn.title = 'Resume all paused items in this section';
    resumeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSectionPause(sec.id, false);
    });
    controls.appendChild(resumeBtn);

    const renameBtn = document.createElement('button');
    renameBtn.className = 'gc-btn';
    renameBtn.textContent = '✎';
    renameBtn.title = 'Rename section';
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const newName = prompt('Rename section:', sec.name);
      if (newName && newName.trim()) {
        sec.name = newName.trim();
        saveState();
        scheduleRender(true);
      }
    });
    controls.appendChild(renameBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'gc-btn gc-btn-danger';
    delBtn.textContent = '✕';
    delBtn.title = 'Delete section (items become unassigned)';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm(`Delete section "${sec.name}"? Items will become unassigned.`)) return;
      state.sections = state.sections.filter(s => s.id !== sec.id);
      for (const k in state.assignments) {
        if (state.assignments[k] === sec.id) delete state.assignments[k];
      }
      saveState();
      scheduleRender(true);
    });
    controls.appendChild(delBtn);

    h.appendChild(controls);
    return h;
  }

  function createUnassignedHeader(itemCount) {
    const h = document.createElement('div');
    h.className = 'gc-section-header gc-unassigned-header';
    h.setAttribute('data-gc-unassigned-header', 'true');

    const name = document.createElement('div');
    name.className = 'gc-section-name';
    name.textContent = 'Unassigned';
    name.style.cursor = 'default';
    h.appendChild(name);

    const count = document.createElement('span');
    count.className = 'gc-section-count';
    count.textContent = `${itemCount} item${itemCount === 1 ? '' : 's'}`;
    h.appendChild(count);

    return h;
  }

  function handleAddSection() {
    const name = prompt('Section name:', `Section ${state.sections.length + 1}`);
    if (!name || !name.trim()) return;
    state.sections.push({
      id: genId(),
      name: name.trim(),
      color: pickColor(),
      collapsed: false
    });
    saveState();
    scheduleRender(true);
  }

  // ---------- Tools: export / import / collapse / expand ----------
  function setAllCollapsed(collapsed) {
    for (const sec of state.sections) sec.collapsed = collapsed;
    saveState();
    scheduleRender(true);
  }

  // Modal with a textarea — used by export/import because prompt() caps
  // input around ~2000 chars and silently truncates larger pastes.
  function showTextModal(opts) {
    // opts: { title, note, value, readonly, confirmLabel, onConfirm(text), extraButton: {label, handler(textarea)} }
    const overlay = document.createElement('div');
    overlay.className = 'gc-modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'gc-modal';

    const title = document.createElement('h3');
    title.textContent = opts.title;
    modal.appendChild(title);

    if (opts.note) {
      const note = document.createElement('p');
      note.textContent = opts.note;
      modal.appendChild(note);
    }

    const ta = document.createElement('textarea');
    ta.value = opts.value || '';
    ta.readOnly = !!opts.readonly;
    ta.spellcheck = false;
    modal.appendChild(ta);

    const buttons = document.createElement('div');
    buttons.className = 'gc-modal-buttons';

    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    if (opts.extraButton) {
      const extra = document.createElement('button');
      extra.className = 'gc-btn';
      extra.textContent = opts.extraButton.label;
      extra.addEventListener('click', () => opts.extraButton.handler(ta, extra));
      buttons.appendChild(extra);
    }

    const cancel = document.createElement('button');
    cancel.className = 'gc-btn';
    cancel.textContent = opts.onConfirm ? 'Cancel' : 'Close';
    cancel.addEventListener('click', close);
    buttons.appendChild(cancel);

    if (opts.onConfirm) {
      const ok = document.createElement('button');
      ok.className = 'gc-btn';
      ok.textContent = opts.confirmLabel || 'OK';
      ok.addEventListener('click', () => {
        // onConfirm returns true to close, false/undefined-with-error to stay open
        if (opts.onConfirm(ta.value) !== false) close();
      });
      buttons.appendChild(ok);
    }

    modal.appendChild(buttons);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    if (opts.readonly) ta.select();
    else ta.focus();
  }

  function exportState() {
    const payload = JSON.stringify({
      gcSectionsExport: 2,
      profile: currentProfileKey,
      exportedAt: new Date().toISOString(),
      data: { sections: state.sections, assignments: state.assignments }
    });
    showTextModal({
      title: `Export — profile "${currentProfileKey === DEFAULT_PROFILE ? '(default)' : currentProfileKey}"`,
      note: 'Copy this and keep it somewhere safe (notes file, etc).',
      value: payload,
      readonly: true,
      extraButton: {
        label: 'Copy to clipboard',
        handler: (ta, btn) => {
          const done = () => { btn.textContent = 'Copied ✓'; setTimeout(() => btn.textContent = 'Copy to clipboard', 1500); };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(ta.value).then(done, () => { ta.select(); document.execCommand('copy'); done(); });
          } else {
            ta.select();
            document.execCommand('copy');
            done();
          }
        }
      }
    });
  }

  function importState() {
    showTextModal({
      title: 'Import section data',
      note: `Paste exported data below. This REPLACES sections and assignments for profile "${currentProfileKey === DEFAULT_PROFILE ? '(default)' : currentProfileKey}".`,
      value: '',
      readonly: false,
      confirmLabel: 'Import',
      onConfirm: (raw) => {
        if (!raw || !raw.trim()) return false;
        let parsed;
        try {
          parsed = JSON.parse(raw.trim());
        } catch (e) {
          alert('Import failed: that isn\'t valid JSON.\n(If you pasted from a source that wraps lines, make sure nothing got cut off.)');
          return false;
        }
        if (!parsed || parsed.gcSectionsExport !== 2 || !parsed.data) {
          alert('Import failed: unrecognized format. Use data from this script\'s Export.');
          return false;
        }
        const incoming = sanitizeProfileState(parsed.data);
        const summary = `${incoming.sections.length} section(s), ${Object.keys(incoming.assignments).length} assignment(s)`;
        if (!confirm(`Import ${summary}?\nThis replaces this profile's current sections and assignments.`)) return false;
        state.sections = incoming.sections;
        state.assignments = incoming.assignments;
        saveState();
        scheduleRender(true);
        console.log(`[gc-sections] imported ${summary} (from export dated ${parsed.exportedAt || 'unknown'})`);
        return true;
      }
    });
  }

  // ---------- Planner order sync ----------
  // Writes to the site's own roster order. Safety rules, all enforced below:
  //  * Reorder by PERMUTING INDICES only — entries are never rebuilt from a
  //    key lookup, so membership cannot change. (An earlier id-keyed rebuild
  //    silently collapsed entries that shared a blank id.)
  //  * Verify the index list is a true permutation of 0..n-1 before writing.
  //  * Assert array length is identical before and after.
  //  * Store the applied permutation so undo survives a page refresh.
  const ORDER_BACKUP_KEY = 'gc-section-order-backup';

  function getFiber(el) {
    for (const k in el) {
      if (k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')) return el[k];
    }
    return null;
  }
  function findSelectionHub() {
    const card = document.querySelector('[class*="ItemPanel_itemWrapper"]');
    if (!card) return null;
    let n = getFiber(card), d = 0;
    while (n && d < 30) {
      const p = n.memoizedProps;
      if (p && typeof p === 'object' && Array.isArray(p.selection) && typeof p.setSelection === 'function') return p;
      n = n.return; d++;
    }
    return null;
  }
  // Each card's component props carry `index` — its slot in the selection
  // array. This is the mapping; no name or id matching is involved.
  function cardSelectionIndex(wrapper) {
    let n = getFiber(wrapper), d = 0;
    while (n && d < 30) {
      const p = n.memoizedProps;
      if (p && typeof p === 'object' && typeof p.index === 'number' && p.item && p.current) return p.index;
      n = n.return; d++;
    }
    return null;
  }

  function isPermutation(order, n) {
    if (!Array.isArray(order) || order.length !== n) return false;
    const seen = new Uint8Array(n);
    for (const i of order) {
      if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= n) return false;
      if (seen[i]) return false;
      seen[i] = 1;
    }
    return true;
  }

  async function syncOrderToPlanner() {
    const hub = findSelectionHub();
    if (!hub) {
      alert('Could not reach the planner\u2019s roster state.\nThe site may have changed; order sync is unavailable.');
      return;
    }
    if (state.sections.length === 0) {
      alert('No sections to sync. Create a section and assign some items first.');
      return;
    }

    // Every entry must be visible, or we can't map hidden ones to a slot.
    let restoreMode = null;
    if (getInactivePanelMode() === 'Hide') {
      if (!setInactivePanelMode('End')) {
        alert('Could not temporarily change "Inactive Panel Options".\nSet it to Priority or End and try again.');
        return;
      }
      restoreMode = 'Hide';
      await new Promise(r => setTimeout(r, 300));
    }

    const finish = () => { if (restoreMode) setInactivePanelMode(restoreMode); };

    const n = hub.selection.length;
    const items = identifyItems();

    if (items.length !== n) {
      finish();
      alert(`Aborted — safety check failed.\n\nThe planner holds ${n} entries but only ${items.length} are on screen. ` +
            'Nothing was changed.');
      return;
    }

    // Map each visible card to its slot in the selection array.
    const entries = [];
    for (const it of items) {
      const idx = cardSelectionIndex(it.wrapper);
      if (idx === null) {
        finish();
        alert('Aborted — could not read a card\u2019s planner position. Nothing was changed.');
        return;
      }
      entries.push({ key: it.key, idx });
    }

    // Group slots by section, keeping each group's existing relative order.
    const bySection = new Map(state.sections.map(s => [s.id, []]));
    const unassigned = [];
    for (const e of entries) {
      const sid = state.assignments[e.key];
      if (sid && bySection.has(sid)) bySection.get(sid).push(e.idx);
      else unassigned.push(e.idx);
    }
    const newOrder = [];
    for (const s of state.sections) newOrder.push(...bySection.get(s.id));
    newOrder.push(...unassigned);

    if (!isPermutation(newOrder, n)) {
      finish();
      alert('Aborted — the computed order failed its integrity check. Nothing was changed.');
      return;
    }

    const summary = state.sections
      .map(s => `  ${s.name}: ${bySection.get(s.id).length}`)
      .join('\n') + `\n  (unassigned): ${unassigned.length}`;
    if (!confirm(`Reorder all ${n} planner entries to match your sections?\n\n${summary}\n\n` +
                 'This changes the site\u2019s own order (what Manage Priority controls).\n' +
                 'You can revert with "Undo order sync".')) {
      finish();
      return;
    }

    const next = newOrder.map(i => hub.selection[i]);
    if (next.length !== n || next.some(e => e === undefined)) {
      finish();
      alert('Aborted — the reordered list did not match the original length. Nothing was changed.');
      return;
    }

    try {
      localStorage.setItem(ORDER_BACKUP_KEY, JSON.stringify({
        at: new Date().toISOString(), profile: currentProfileKey, order: newOrder
      }));
    } catch (e) { console.warn('[gc-sections] could not save undo data', e); }

    hub.setSelection(next);
    finish();
    console.log(`[gc-sections] order sync applied to ${n} entries`);
    setTimeout(() => scheduleRender(true), 250);
  }

  function undoOrderSync() {
    const hub = findSelectionHub();
    if (!hub) { alert('Could not reach the planner\u2019s roster state.'); return; }
    let saved;
    try { saved = JSON.parse(localStorage.getItem(ORDER_BACKUP_KEY) || 'null'); }
    catch (e) { saved = null; }
    if (!saved || !Array.isArray(saved.order)) { alert('No order sync to undo.'); return; }

    const n = hub.selection.length;
    if (saved.order.length !== n) {
      alert(`Cannot undo — the planner now holds ${n} entries but the saved order covers ${saved.order.length}. ` +
            'Entries were added or removed since the sync, so reverting could misplace them.');
      return;
    }
    if (!isPermutation(saved.order, n)) { alert('Cannot undo — saved order failed its integrity check.'); return; }

    // current[j] === previous[order[j]], so previous[i] === current[inverse[i]]
    const inverse = new Array(n);
    for (let j = 0; j < n; j++) inverse[saved.order[j]] = j;
    if (!isPermutation(inverse, n)) { alert('Cannot undo — inverse order failed its integrity check.'); return; }

    const restored = inverse.map(j => hub.selection[j]);
    if (restored.length !== n || restored.some(e => e === undefined)) {
      alert('Cannot undo — restored list length mismatch. Nothing was changed.');
      return;
    }
    if (!confirm(`Revert all ${n} planner entries to the order from before the last sync?`)) return;

    hub.setSelection(restored);
    localStorage.removeItem(ORDER_BACKUP_KEY);
    console.log(`[gc-sections] order sync undone for ${n} entries`);
    setTimeout(() => scheduleRender(true), 250);
  }

  function hasOrderBackup() {
    try { return !!JSON.parse(localStorage.getItem(ORDER_BACKUP_KEY) || 'null'); }
    catch (e) { return false; }
  }

  function showToolsMenu(e) {
    closeMenu();
    const menu = document.createElement('div');
    menu.className = 'gc-menu';

    const addItem = (label, handler, disabled) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.disabled = !!disabled;
      btn.addEventListener('click', () => { closeMenu(); handler(); });
      menu.appendChild(btn);
    };
    const addSep = () => {
      const sep = document.createElement('div');
      sep.className = 'gc-menu-sep';
      menu.appendChild(sep);
    };

    const noSections = state.sections.length === 0;

    addItem('＋ Add Section', handleAddSection);
    addSep();
    addItem('⏸ Pause All items', () => toggleAllPause(true));
    addItem('▶ Resume All items', () => toggleAllPause(false));
    addSep();
    addItem('⊟ Collapse all sections', () => setAllCollapsed(true), noSections);
    addItem('⊞ Expand all sections', () => setAllCollapsed(false), noSections);
    addSep();
    addItem('⇅ Sync order to planner', syncOrderToPlanner, noSections);
    if (hasOrderBackup()) addItem('↶ Undo order sync', undoOrderSync);
    addSep();
    addItem('⇪ Export section data', exportState);
    addItem('⇩ Import section data', importState);
    addSep();

    const info = document.createElement('button');
    info.textContent = `Profile: ${currentProfileKey === DEFAULT_PROFILE ? '(default)' : currentProfileKey}`;
    info.disabled = true;
    menu.appendChild(info);

    openMenu(menu, e);
  }

  // Clones one of the site's existing buttons so our "+ Add Section" button
  // matches the visual style of "Add Character" / "Add Weapon" / etc.
  function cloneButtonFrom(existing, partPrefixes, labelText) {
    const btn = document.createElement('button');
    btn.className = existing.className;
    for (const prefix of partPrefixes) {
      const src = existing.querySelector(`[class*="${prefix}"]`);
      if (!src) continue;
      const clone = document.createElement('div');
      clone.className = src.className;
      if (labelText && prefix.endsWith('label')) {
        clone.textContent = labelText;
      }
      btn.appendChild(clone);
    }
    return btn;
  }

  function ensureAddSectionButton() {
    const row = document.querySelector('[class*="Farm_centeredRectButtons"]');
    if (!row) return;
    const existing = row.querySelector('[class*="RectButton_button"]');
    if (!existing) return;

    const ensure = (attr, label, handler) => {
      if (row.querySelector(`[${attr}]`)) return;
      const btn = cloneButtonFrom(
        existing,
        ['RectButton_inner', 'RectButton_border', 'RectButton_label'],
        label
      );
      btn.setAttribute(attr, 'true');
      btn.addEventListener('click', handler);
      row.appendChild(btn);
    };

    ensure('data-gc-tools-btn', '⚙ Sections', (e) => showToolsMenu(e));
  }

  function ensureMobileAddSectionButton() {
    const row = document.querySelector('[class*="Farm_centeredButtons"]');
    if (!row) return;
    const existing = row.querySelector('[class*="BigIconButton_button"]');
    if (!existing) return;

    const ensure = (attr, glyph, title, handler) => {
      if (row.querySelector(`[${attr}]`)) return;
      const btn = cloneButtonFrom(
        existing,
        ['BigIconButton_inner', 'BigIconButton_image', 'BigIconButton_border'],
        null
      );
      btn.setAttribute(attr, 'true');
      btn.title = title;
      const imgDiv = btn.querySelector('[class*="BigIconButton_image"]');
      if (imgDiv) {
        imgDiv.style.display = 'flex';
        imgDiv.style.alignItems = 'center';
        imgDiv.style.justifyContent = 'center';
        imgDiv.style.fontSize = '28px';
        imgDiv.style.lineHeight = '1';
        imgDiv.textContent = glyph;
      }
      btn.addEventListener('click', handler);
      row.appendChild(btn);
    };

    ensure('data-gc-tools-icon-btn', '⚙', 'Section tools', (e) => showToolsMenu(e));
  }

  // ---------- Per-item badge ----------
  function ensureItemBadge(itemInfo) {
    const { wrapper, key } = itemInfo;
    // Insert into the inner ItemPanel_item container, right after the nameBar.
    const inner = wrapper.querySelector('[class*="ItemPanel_item"]:not([class*="ItemPanel_itemWrapper"]):not([class*="ItemPanel_itemName"]):not([class*="ItemPanel_itemContent"]):not([class*="ItemPanel_itemImage"]):not([class*="ItemPanel_itemList"])')
      || wrapper.querySelector('[class*="ItemPanel_nameBar"]')?.parentElement
      || wrapper;
    const nameBar = inner.querySelector(':scope > [class*="ItemPanel_nameBar"]');

    let badge = inner.querySelector(':scope > .gc-item-section-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'gc-item-section-badge';
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        // Read the key at click time — keys on a wrapper can be reassigned
        // by identifyItems() (e.g. duplicate renumbering after a deletion),
        // so a key captured at badge-creation time may be stale.
        const w = e.currentTarget.closest('[class*="ItemPanel_itemWrapper"]');
        const liveKey = w && w.getAttribute(ITEM_KEY_ATTR);
        if (!liveKey) {
          console.warn('[gc-sections] badge click: no live key on wrapper');
          return;
        }
        showSectionPickerMenu(e, liveKey);
      });
      if (nameBar && nameBar.nextSibling) {
        inner.insertBefore(badge, nameBar.nextSibling);
      } else if (nameBar) {
        inner.appendChild(badge);
      } else {
        // Fallback: prepend to wrapper
        wrapper.insertBefore(badge, wrapper.firstChild);
      }
    }

    const secId = state.assignments[key];
    const sec = secId ? getSectionById(secId) : null;
    if (sec) {
      badge.textContent = sec.name;
      badge.classList.remove('unassigned');
      badge.style.setProperty('--badge-sec-color', sec.color);
      wrapper.setAttribute(SECTION_DATA_ATTR, sec.id);
    } else {
      badge.textContent = '+ Add to Section';
      badge.classList.add('unassigned');
      badge.style.removeProperty('--badge-sec-color');
      wrapper.removeAttribute(SECTION_DATA_ATTR);
    }

    // Reflect current pause state immediately
    badge.classList.toggle('paused', isItemPaused(wrapper));
  }

  // Lightweight background poll: updates the .paused class on badges
  // without touching DOM order. Catches state changes from the user
  // clicking individual pause buttons, since the MutationObserver
  // intentionally ignores opacity/style changes.
  function updateBadgePausedStates() {
    const wrappers = document.querySelectorAll('[class*="ItemPanel_itemWrapper"]');
    for (const w of wrappers) {
      const badge = w.querySelector(':scope [class*="ItemPanel_item"] > .gc-item-section-badge')
        || w.querySelector(':scope > .gc-item-section-badge');
      if (!badge) continue;
      const paused = isItemPaused(w);
      if (badge.classList.contains('paused') !== paused) {
        badge.classList.toggle('paused', paused);
      }
    }
  }
  setInterval(updateBadgePausedStates, 600);

  // ---------- Panel collapse (Summary / Schedule) ----------
  // Global (profile-independent) UI preference. React re-renders these
  // panels freely, so this is applied idempotently from a poll: click
  // handlers and classes are re-attached whenever React replaces nodes.
  function isPanelCollapsed(key) {
    return allProfiles.ui.panelCollapsed[key] === true;
  }
  function setPanelCollapsed(key, collapsed) {
    if (collapsed) allProfiles.ui.panelCollapsed[key] = true;
    else delete allProfiles.ui.panelCollapsed[key];
    saveState();
  }

  // Make a header toggle `key`. Idempotent: dataset marker prevents
  // duplicate listeners; if React recreated the node the marker is gone
  // and everything is re-attached.
  function setupPanelToggle(header, key, withArrow) {
    if (!header) return;
    if (header.getAttribute('data-gc-panel-key') !== key) {
      header.setAttribute('data-gc-panel-key', key);
      header.classList.add('gc-cat-toggle');
      header.addEventListener('click', (e) => {
        e.stopPropagation();
        const k = header.getAttribute('data-gc-panel-key');
        setPanelCollapsed(k, !isPanelCollapsed(k));
        applyPanelCollapses();
      });
    }
    if (withArrow && !header.querySelector(':scope > .gc-cat-arrow')) {
      const arrow = document.createElement('span');
      arrow.className = 'gc-cat-arrow';
      arrow.textContent = '▼';
      header.appendChild(arrow);
    }
    const collapsed = isPanelCollapsed(key);
    const arrow = header.querySelector(':scope > .gc-cat-arrow');
    if (arrow) arrow.classList.toggle('gc-cat-closed', collapsed);
    header.classList.toggle('gc-cat-dim', collapsed);
    return collapsed;
  }

  // Show/hide a content element, fading in on expand.
  function setPanelContentVisible(el, visible) {
    if (!el) return;
    const hidden = el.classList.contains('gc-panel-hidden');
    if (visible && hidden) {
      el.classList.remove('gc-panel-hidden');
      el.classList.add('gc-fade-in');
      setTimeout(() => el.classList.remove('gc-fade-in'), 250);
    } else if (!visible && !hidden) {
      el.classList.add('gc-panel-hidden');
    }
  }

  function elementSiblingsAfter(node) {
    const out = [];
    let n = node ? node.nextElementSibling : null;
    while (n) { out.push(n); n = n.nextElementSibling; }
    return out;
  }

  function applyPanelCollapses() {
    // Summary top-level categories (Misc / Common / Gems / Domains / ...)
    for (const cat of document.querySelectorAll('[class*="Summary_category"]')) {
      const h3 = cat.querySelector(':scope > h3');
      if (!h3) continue;
      const label = (h3.childNodes[0] && h3.childNodes[0].textContent || h3.textContent).trim();
      if (!label) continue;
      const collapsed = setupPanelToggle(h3, 'sum:' + label, true);
      for (const sib of elementSiblingsAfter(h3)) setPanelContentVisible(sib, !collapsed);
    }
    // Day groups inside the Domains category
    for (const day of document.querySelectorAll('[class*="Summary_domainCategory"]')) {
      const h3 = day.querySelector(':scope > h3');
      if (!h3) continue;
      const label = (h3.childNodes[0] && h3.childNodes[0].textContent || h3.textContent).trim();
      if (!label) continue;
      const collapsed = setupPanelToggle(h3, 'dom:' + label, true);
      for (const sib of elementSiblingsAfter(h3)) setPanelContentVisible(sib, !collapsed);
    }
    // Schedule: "Today" panel — fixed key (the header text changes as you
    // page through days). No arrow: header row is horizontally busy.
    const dayToggleH3 = document.querySelector('[class*="Schedule_dayToggle"] h3');
    if (dayToggleH3) {
      const collapsed = setupPanelToggle(dayToggleH3, 'sched:today', false);
      const topBar = dayToggleH3.closest('[class*="Schedule_topBar"]');
      const panel = topBar && topBar.parentElement;
      const content = panel && panel.querySelector('[class*="Schedule_content"]');
      setPanelContentVisible(content, !collapsed);
    }
    // Schedule: Tasks panel — fixed key, no arrow.
    const tasksTopBar = document.querySelector('[class*="Schedule_taskTopBar"]');
    if (tasksTopBar) {
      const h3 = tasksTopBar.querySelector(':scope > h3');
      if (h3) {
        const collapsed = setupPanelToggle(h3, 'sched:tasks', false);
        for (const sib of elementSiblingsAfter(tasksTopBar)) setPanelContentVisible(sib, !collapsed);
      }
    }
  }
  setInterval(applyPanelCollapses, 700);
  setTimeout(applyPanelCollapses, 800);

  // ---------- Scroll-to-adjust inventory quantity boxes ----------
  // React ignores direct .value assignment; set via the native setter and
  // dispatch an input event so the site's state updates.
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  ).set;

  function setReactInputValue(input, value) {
    nativeInputValueSetter.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Is this element a quantity box in the inventory UI (and not some other
  // number field on the page)? The inventory modal/screen is the only place
  // the site exposes editable material counts.
  function isInventoryQtyInput(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (type !== 'number' && type !== 'text') return false;
    // Must sit within an inventory container. Matches the site's Inventory_*
    // component classes; falls back to a Material_* ancestor which is how
    // inventory count fields are grouped.
    return !!el.closest('[class*="Inventory_"], [class*="ManageInventory"], [class*="inventory"]');
  }

  function handleInventoryWheel(e) {
    const el = e.target;
    if (!isInventoryQtyInput(el)) return;

    // Focus gate: unless hover mode is on, only act on the focused field.
    if (!SCROLL_ADJUST_ON_HOVER && document.activeElement !== el) return;

    e.preventDefault(); // stop the page/panel from scrolling instead

    const step = e.shiftKey ? 10 : 1;
    const dir = e.deltaY < 0 ? 1 : -1; // wheel up = increase
    const current = parseFloat(el.value);
    let next = (isNaN(current) ? 0 : current) + dir * step;

    // Respect min/max if the input declares them; otherwise floor at 0
    // (negative material counts are meaningless).
    const min = el.hasAttribute('min') ? parseFloat(el.getAttribute('min')) : 0;
    const max = el.hasAttribute('max') ? parseFloat(el.getAttribute('max')) : Infinity;
    if (!isNaN(min)) next = Math.max(min, next);
    if (!isNaN(max)) next = Math.min(max, next);

    setReactInputValue(el, next);
  }

  // Passive:false so preventDefault works; capture so we see it before the
  // site's own handlers.
  document.addEventListener('wheel', handleInventoryWheel, { passive: false, capture: true });

  // ---------- Reorder + render ----------
  function reorderAndRender() {
    const list = getItemList();
    if (!list) return;
    const items = identifyItems();

    // Remove our previously injected elements (we re-create fresh each render)
    list.querySelectorAll(
      ':scope > [data-gc-section-header], :scope > [data-gc-unassigned-header], :scope > [data-gc-add-bar]'
    ).forEach(el => el.remove());

    // Ensure each item has its badge
    for (const it of items) ensureItemBadge(it);

    // Group items by section, preserving the original DOM order within each group
    const groups = new Map();
    for (const sec of state.sections) groups.set(sec.id, []);
    const unassigned = [];
    for (const it of items) {
      const secId = state.assignments[it.key];
      if (secId && groups.has(secId)) groups.get(secId).push(it);
      else unassigned.push(it);
    }

    // Inject "+ Add Section" into the site's existing button row(s)
    ensureAddSectionButton();
    ensureMobileAddSectionButton();

    // Build new ordering
    const fragment = document.createDocumentFragment();

    for (const sec of state.sections) {
      const groupItems = groups.get(sec.id) || [];
      fragment.appendChild(createSectionHeader(sec, groupItems.length));
      for (const it of groupItems) {
        it.slot.style.display = sec.collapsed ? 'none' : '';
        fragment.appendChild(it.slot);
      }
    }

    if (unassigned.length > 0 && state.sections.length > 0) {
      fragment.appendChild(createUnassignedHeader(unassigned.length));
    }
    for (const it of unassigned) {
      it.slot.style.display = '';
      fragment.appendChild(it.slot);
    }

    list.appendChild(fragment);
  }

  // ---------- Pause / Resume ----------
  function getPauseButton(wrapper) {
    return wrapper.querySelector('[class*="ItemPanel_pauseButton"] button');
  }

  // Read the live opacity via getComputedStyle — the site's animation library
  // may not reflect the current value in inline `style` attributes.
  function isItemPaused(wrapper) {
    const offImg = wrapper.querySelector('[class*="PowerButton_off"]');
    if (!offImg) return false;
    const opacity = parseFloat(window.getComputedStyle(offImg).opacity || '0');
    return opacity >= 0.5;
  }

  // Build a key -> live wrapper map in one pass. Much cheaper than
  // re-scanning the whole list for every lookup.
  function buildKeyWrapperMap() {
    identifyItems(); // tags any freshly-rendered nodes
    const map = new Map();
    const wrappers = document.querySelectorAll('[class*="ItemPanel_itemWrapper"]');
    for (const w of wrappers) {
      const k = w.getAttribute(ITEM_KEY_ATTR);
      if (k) map.set(k, w);
    }
    return map;
  }

  // ---- Site's "Inactive Panel Options" radio (Priority / End / Hide) ----
  function findInactivePanelRadio() {
    const radios = document.querySelectorAll('[class*="Radio_radio"]');
    for (const r of radios) {
      const label = r.querySelector('[class*="Radio_radioLabel"]');
      if (label && label.textContent.trim() === 'Inactive Panel Options') return r;
    }
    return null;
  }
  function getInactivePanelMode() {
    const radio = findInactivePanelRadio();
    if (!radio) return null;
    const options = radio.querySelectorAll('[class*="Radio_option"]');
    // Primary: look for the visible Radio_selected indicator
    for (const opt of options) {
      const sel = opt.querySelector('[class*="Radio_selected"]');
      if (sel && window.getComputedStyle(sel).visibility !== 'hidden') {
        return opt.textContent.trim();
      }
    }
    // Fallback: text color (selected is black, others are grey)
    for (const opt of options) {
      const color = (opt.style.color || '').replace(/\s+/g, '');
      if (color === 'rgb(0,0,0)') return opt.textContent.trim();
    }
    return null;
  }
  function setInactivePanelMode(mode) {
    const radio = findInactivePanelRadio();
    if (!radio) return false;
    const options = radio.querySelectorAll('[class*="Radio_option"]');
    for (const opt of options) {
      if (opt.textContent.trim() === mode) {
        opt.click();
        return true;
      }
    }
    return false;
  }

  // Core pause/resume driver.
  // `selectKeys` is called with the list of identified items AFTER any
  // Hide-mode workaround has run — this ordering matters: in Hide mode,
  // paused items aren't in the DOM at all, so gathering keys before
  // revealing them would silently exclude exactly the items a resume
  // needs to reach.
  async function togglePauseDriver(selectKeys, targetPaused, label) {
    // When resuming, paused items may be invisible (Hide mode). Temporarily
    // expose them so we can see and click them, then restore the user's
    // original preference afterwards.
    let restoreMode = null;
    if (!targetPaused) {
      const currentMode = getInactivePanelMode();
      if (currentMode === 'Hide') {
        if (setInactivePanelMode('End')) {
          restoreMode = 'Hide';
          // Give the site time to re-render with the now-visible items
          await new Promise(r => setTimeout(r, 250));
        } else {
          console.warn('[gc-sections] could not switch Inactive Panel mode; paused items may not be reachable');
        }
      }
    }

    // NOW gather keys — hidden items (if any) are visible at this point.
    let keyMap = buildKeyWrapperMap();
    const allTargetKeys = selectKeys(Array.from(keyMap.keys()));

    if (allTargetKeys.length === 0) {
      if (restoreMode) setInactivePanelMode(restoreMode);
      alert('No matching items found.\nClick the "+ Add to Section" badge on a character or weapon to assign it to a section.');
      return;
    }

    // Snapshot which items actually need toggling. Pre-filtering means items
    // already in the target state aren't touched (avoids toggling them the
    // wrong way).
    const keysToClick = [];
    for (const key of allTargetKeys) {
      const wrapper = keyMap.get(key);
      if (!wrapper) continue; // assigned but not in DOM (deleted on site?)
      if (isItemPaused(wrapper) !== targetPaused) keysToClick.push(key);
    }

    console.log(`[gc-sections] ${label}: ${targetPaused ? 'pausing' : 'resuming'} ${keysToClick.length} of ${allTargetKeys.length} item(s)`);

    let clicked = 0;
    for (const key of keysToClick) {
      // Prefer the cached wrapper; if React replaced the node since we
      // built the map (isConnected === false), rebuild once and retry.
      let wrapper = keyMap.get(key);
      if (!wrapper || !wrapper.isConnected) {
        keyMap = buildKeyWrapperMap();
        wrapper = keyMap.get(key);
      }
      if (!wrapper) {
        console.warn(`[gc-sections] could not find live wrapper for ${key}`);
        continue;
      }
      const btn = getPauseButton(wrapper);
      if (!btn) {
        console.warn(`[gc-sections] no pause button found for ${key}`);
        continue;
      }
      btn.click();
      clicked++;
      // Yield so React can process the state update before the next click
      await new Promise(r => setTimeout(r, 40));
    }

    // Restore the user's "Hide" setting if we changed it
    if (restoreMode) {
      await new Promise(r => setTimeout(r, 100));
      setInactivePanelMode(restoreMode);
    }

    console.log(`[gc-sections] ${label}: done. Clicked ${clicked}/${keysToClick.length}.`);
  }

  async function toggleSectionPause(secId, targetPaused) {
    await togglePauseDriver(
      (allKeys) => allKeys.filter(k => state.assignments[k] === secId),
      targetPaused,
      'section'
    );
  }

  async function toggleAllPause(targetPaused) {
    await togglePauseDriver(
      (allKeys) => allKeys,
      targetPaused,
      'master'
    );
  }

  // ---------- Popup menus ----------
  let activeMenu = null;
  function closeMenu() {
    if (!activeMenu) return;
    activeMenu.remove();
    activeMenu = null;
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('keydown', onMenuKey, true);
  }
  function onDocClick(e) {
    if (activeMenu && !activeMenu.contains(e.target)) closeMenu();
  }
  function onMenuKey(e) {
    if (e.key === 'Escape') closeMenu();
  }
  function positionMenu(menu, anchorEvent) {
    const rect = anchorEvent.currentTarget.getBoundingClientRect();
    menu.style.left = (rect.left + window.scrollX) + 'px';
    menu.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    // If menu goes off the right edge, nudge left
    requestAnimationFrame(() => {
      const mr = menu.getBoundingClientRect();
      if (mr.right > window.innerWidth - 8) {
        menu.style.left = (window.innerWidth - mr.width - 8 + window.scrollX) + 'px';
      }
    });
  }
  function openMenu(menu, anchorEvent) {
    document.body.appendChild(menu);
    positionMenu(menu, anchorEvent);
    activeMenu = menu;
    setTimeout(() => {
      document.addEventListener('click', onDocClick, true);
      document.addEventListener('keydown', onMenuKey, true);
    }, 0);
  }

  function showSectionPickerMenu(e, itemKey) {
    closeMenu();
    const menu = document.createElement('div');
    menu.className = 'gc-menu';

    const noneBtn = document.createElement('button');
    noneBtn.textContent = '(No section)';
    noneBtn.addEventListener('click', () => {
      closeMenu();
      delete state.assignments[itemKey];
      saveState();
      scheduleRender(true);
    });
    menu.appendChild(noneBtn);

    if (state.sections.length > 0) {
      const sep = document.createElement('div');
      sep.className = 'gc-menu-sep';
      menu.appendChild(sep);
      for (const sec of state.sections) {
        const btn = document.createElement('button');
        const sw = document.createElement('span');
        sw.className = 'gc-color-swatch';
        sw.style.background = sec.color;
        sw.style.width = '12px';
        sw.style.height = '12px';
        btn.appendChild(sw);
        btn.appendChild(document.createTextNode(sec.name));
        btn.addEventListener('click', () => {
          closeMenu();
          state.assignments[itemKey] = sec.id;
          saveState();
          scheduleRender(true);
        });
        menu.appendChild(btn);
      }
    } else {
      const sep = document.createElement('div');
      sep.className = 'gc-menu-sep';
      menu.appendChild(sep);
      const note = document.createElement('button');
      note.textContent = 'No sections yet — create one first';
      note.disabled = true;
      menu.appendChild(note);
    }

    openMenu(menu, e);
  }

  function showColorMenu(e, sec) {
    closeMenu();
    const menu = document.createElement('div');
    menu.className = 'gc-menu';
    const grid = document.createElement('div');
    grid.className = 'gc-color-grid';
    for (const color of DEFAULT_COLORS) {
      const sw = document.createElement('div');
      sw.className = 'gc-color-swatch';
      sw.style.background = color;
      if (color === sec.color) sw.style.boxShadow = '0 0 0 2px #333';
      sw.addEventListener('click', () => {
        closeMenu();
        sec.color = color;
        saveState();
        scheduleRender(true);
      });
      grid.appendChild(sw);
    }
    menu.appendChild(grid);
    openMenu(menu, e);
  }

  // ---------- Render scheduling ----------
  let renderPending = false;
  let suppressUntil = 0;
  function scheduleRender(immediate) {
    if (renderPending) return;
    renderPending = true;
    setTimeout(() => {
      renderPending = false;
      try {
        reorderAndRender();
        suppressUntil = Date.now() + 250;
      } catch (e) {
        console.error('[gc-sections] render error', e);
      }
    }, immediate ? 0 : 120);
  }

  // ---------- MutationObserver ----------
  function shouldReact(mutations) {
    if (Date.now() < suppressUntil) return false;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches && (
          node.matches('[data-gc-section-header]') ||
          node.matches('[data-gc-unassigned-header]') ||
          node.matches('[data-gc-add-bar]') ||
          node.matches('[data-gc-add-section-btn]') ||
          node.matches('[data-gc-add-section-icon-btn]') ||
          node.matches('[data-gc-master-pause-btn]') ||
          node.matches('[data-gc-master-resume-btn]') ||
          node.matches('[data-gc-master-pause-icon-btn]') ||
          node.matches('[data-gc-master-resume-icon-btn]') ||
          node.matches('[data-gc-tools-btn]') ||
          node.matches('[data-gc-tools-icon-btn]') ||
          node.matches('.gc-item-section-badge') ||
          node.matches('.gc-menu')
        )) continue;
        if (node.matches && node.matches('[class*="Farm_itemList"]')) return true;
        if (node.matches && node.matches('[class*="ItemPanel_itemWrapper"]')) return true;
        if (node.querySelector && node.querySelector('[class*="ItemPanel_itemWrapper"]')) return true;
      }
      for (const node of m.removedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches && (
          node.matches('[data-gc-section-header]') ||
          node.matches('[data-gc-unassigned-header]') ||
          node.matches('[data-gc-add-bar]')
        )) continue;
        if (node.matches && node.matches('[class*="ItemPanel_itemWrapper"]')) return true;
      }
    }
    return false;
  }
  const observer = new MutationObserver(mutations => {
    if (shouldReact(mutations)) scheduleRender(false);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Initial passes (page may still be hydrating)
  scheduleRender(false);
  setTimeout(() => scheduleRender(false), 500);
  setTimeout(() => scheduleRender(false), 1500);
  setTimeout(() => scheduleRender(false), 3000);

  // SPA navigation detection
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(() => scheduleRender(false), 300);
      setTimeout(() => scheduleRender(false), 1200);
    }
  }, 1000);

  // Expose a tiny debug handle
  window.__gcSections = {
    state: () => state,
    profiles: () => allProfiles,
    profile: () => currentProfileKey,
    reset: () => {
      state = defaultState();
      allProfiles.profiles[currentProfileKey] = state;
      saveState();
      scheduleRender(true);
    },
    rerender: () => scheduleRender(true)
  };
})();