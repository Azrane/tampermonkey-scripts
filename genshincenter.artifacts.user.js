// ==UserScript==
// @name         Genshin Center - Artifact Goals
// @namespace    https://genshin-center.com/
// @version      0.1.1
// @description  Track artifact goals per character on the Ascension Planner: 5 slots with a "done" checkbox, main stat, and 2 substats each, plus a set target. STEP 1 of an incremental build — data model, storage, and a read-only panel under each character card. Editing arrives in a later version.
// @author       You
// @match        https://genshin-center.com/planner*
// @match        https://genshin-center.com/*/planner*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ============================================================
  // Reference data
  // ============================================================
  const SLOTS = [
    { key: 'flower',  label: 'Flower',  fixedMain: 'HP' },
    { key: 'plume',   label: 'Plume',   fixedMain: 'ATK' },
    { key: 'sands',   label: 'Sands',   mains: ['HP%', 'ATK%', 'DEF%', 'Elemental Mastery', 'Energy Recharge'] },
    { key: 'goblet',  label: 'Goblet',  mains: ['HP%', 'ATK%', 'DEF%', 'Elemental Mastery', 'Physical DMG', 'Pyro DMG', 'Hydro DMG', 'Electro DMG', 'Cryo DMG', 'Anemo DMG', 'Geo DMG', 'Dendro DMG'] },
    { key: 'circlet', label: 'Circlet', mains: ['HP%', 'ATK%', 'DEF%', 'Elemental Mastery', 'CRIT Rate', 'CRIT DMG', 'Healing Bonus'] }
  ];

  // Substat pool (shared by all slots; main stat of a slot is excluded at edit time later)
  const SUBSTATS = [
    'HP', 'ATK', 'DEF', 'HP%', 'ATK%', 'DEF%',
    'Elemental Mastery', 'Energy Recharge', 'CRIT Rate', 'CRIT DMG'
  ];

  // Artifact set names — YOU maintain this list. New sets launch ~twice a year.
  // Sorted alphabetically; add new ones anywhere, it's sorted at load.
  const ARTIFACT_SETS = [
    'Archaic Petra',
    'Blizzard Strayer',
    'Bloodstained Chivalry',
    'Crimson Witch of Flames',
    'Deepwood Memories',
    'Desert Pavilion Chronicle',
    "Emblem of Severed Fate",
    'Flower of Paradise Lost',
    "Fragment of Harmonic Whimsy",
    "Gilded Dreams",
    "Gladiator's Finale",
    'Golden Troupe',
    'Heart of Depth',
    'Husk of Opulence',
    "Instructor",
    "Lavawalker",
    "Maiden Beloved",
    'Marechaussee Hunter',
    "Multiple / mixed (2+2)",
    'Noblesse Oblige',
    'Nymph\'s Dream',
    'Obsidian Codex',
    'Ocean-Hued Clam',
    "Pale Flame",
    'Retracing Bolide',
    "Scroll of the Hero of Cinder City",
    'Shimenawa\'s Reminiscence',
    'Song of Days Past',
    'Tenacity of the Millelith',
    "The Exile",
    'Thundering Fury',
    'Unfinished Reverie',
    'Vermillion Hereafter',
    'Viridescent Venerer',
    "Wanderer's Troupe"
  ].sort((a, b) => a.localeCompare(b));

  // ============================================================
  // Storage (own key, independent of the sections script)
  // ============================================================
  const STORAGE_KEY = 'gc-artifacts-v1';
  const DEFAULT_PROFILE = '__default';

  function defaultProfileState() {
    return { characters: {} }; // characters[charKey] = { set, slots: {slotKey: {done, main, subs:[a,b]}}, notes }
  }

  function sanitizeSlot(s) {
    const subs = Array.isArray(s && s.subs) ? s.subs.slice(0, 2) : [];
    while (subs.length < 2) subs.push('');
    return {
      done: !!(s && s.done),
      main: (s && typeof s.main === 'string') ? s.main : '',
      subs: subs.map(x => (typeof x === 'string' ? x : ''))
    };
  }
  function sanitizeCharacter(c) {
    const slots = {};
    const rawSlots = (c && c.slots && typeof c.slots === 'object') ? c.slots : {};
    for (const def of SLOTS) slots[def.key] = sanitizeSlot(rawSlots[def.key]);
    return {
      set: (c && typeof c.set === 'string') ? c.set : '',
      slots,
      notes: (c && typeof c.notes === 'string') ? c.notes : ''
    };
  }
  function isEmptyCharacter(c) {
    if (c.set || c.notes) return false;
    return SLOTS.every(def => {
      const s = c.slots[def.key];
      return !s.done && !s.main && !s.subs[0] && !s.subs[1];
    });
  }
  function sanitizeProfileState(p) {
    const characters = {};
    const raw = (p && p.characters && typeof p.characters === 'object') ? p.characters : {};
    for (const k of Object.keys(raw)) {
      const c = sanitizeCharacter(raw[k]);
      if (!isEmptyCharacter(c)) characters[k] = c; // v0.1.0 saved blanks for every card
    }
    return { characters };
  }

  function loadAll() {
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
        return { profiles };
      }
    } catch (e) {
      console.error('[gc-artifacts] load failed, starting fresh', e);
    }
    return { profiles: {} };
  }

  let allData = loadAll();
  let currentProfileKey = DEFAULT_PROFILE;
  let state = null;

  function saveState() {
    try {
      allData.profiles[currentProfileKey] = state;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(allData));
    } catch (e) { console.error('[gc-artifacts] save failed', e); }
  }

  function detectProfileKey() {
    const el = document.querySelector('[class*="Header_accBtn"] [class*="Header_number"]');
    const name = el ? el.textContent.trim() : '';
    return name || DEFAULT_PROFILE;
  }
  function switchToProfile(key) {
    if (state && key === currentProfileKey) return;
    if (state) saveState();
    currentProfileKey = key;
    if (!allData.profiles[key]) allData.profiles[key] = defaultProfileState();
    state = allData.profiles[key];
    saveState();
    console.log(`[gc-artifacts] active profile: "${key}"`);
  }
  switchToProfile(detectProfileKey());
  setInterval(() => {
    const key = detectProfileKey();
    if (key !== currentProfileKey) { switchToProfile(key); scheduleApply(); }
  }, 2000);

  function getCharacter(charKey) {
    if (!state.characters[charKey]) state.characters[charKey] = sanitizeCharacter(null);
    return state.characters[charKey];
  }
  // Read without creating: rendering must not write empty entries into
  // saved state for every character on the page.
  const EMPTY_CHARACTER = Object.freeze(sanitizeCharacter(null));
  function peekCharacter(charKey) {
    return state.characters[charKey] || EMPTY_CHARACTER;
  }
  function doneCount(charKey) {
    const c = state.characters[charKey];
    if (!c) return 0;
    return SLOTS.reduce((n, def) => n + (c.slots[def.key] && c.slots[def.key].done ? 1 : 0), 0);
  }

  // ============================================================
  // Styles
  // ============================================================
  const css = `
    .gc-art-summary {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      box-sizing: border-box;
      font-family: 'Montserrat', sans-serif;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.4px;
      padding: 3px 8px;
      background: rgba(22, 32, 58, 0.85);
      color: #ece5d8;
      border-top: 1px solid rgba(0,0,0,0.25);
      border-bottom: 3px solid rgba(255,255,255,0.15);
      cursor: pointer;
      user-select: none;
    }
    .gc-art-summary:hover { filter: brightness(1.2); }
    .gc-art-summary .gc-art-arrow {
      display: inline-block;
      transition: transform 0.2s;
      font-size: 0.8em;
    }
    .gc-art-summary.collapsed .gc-art-arrow { transform: rotate(-90deg); }
    .gc-art-summary .gc-art-count { margin-left: auto; font-weight: 400; opacity: 0.8; }
    .gc-art-body {
      width: 100%;
      box-sizing: border-box;
      background: rgba(16, 24, 44, 0.9);
      color: #ece5d8;
      font-family: 'Montserrat', sans-serif;
      font-size: 11px;
      padding: 6px 8px 8px;
      border-bottom: 1px solid rgba(0,0,0,0.25);
    }
    .gc-art-body.gc-art-hidden { display: none; }
    .gc-art-set {
      font-weight: 700;
      margin-bottom: 4px;
      color: #ffd7a0;
    }
    .gc-art-slot {
      display: flex;
      align-items: baseline;
      gap: 6px;
      padding: 2px 0;
      border-top: 1px solid rgba(255,255,255,0.06);
    }
    .gc-art-slot-check { width: 14px; text-align: center; flex-shrink: 0; }
    .gc-art-slot-check.done { color: #7ddc7d; }
    .gc-art-slot-check.notdone { color: rgba(255,255,255,0.3); }
    .gc-art-slot-label { width: 48px; flex-shrink: 0; font-weight: 700; opacity: 0.85; }
    .gc-art-slot-stats { flex: 1; opacity: 0.9; }
    .gc-art-slot-main { color: #cfe4ff; }
    .gc-art-slot-subs { opacity: 0.7; }
    .gc-art-empty { opacity: 0.5; font-style: italic; }
    .gc-art-notes { margin-top: 4px; opacity: 0.7; font-style: italic; }
    .gc-art-hint {
      margin-top: 6px;
      font-size: 10px;
      opacity: 0.55;
      font-style: italic;
    }
  `;
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ============================================================
  // Character identification (mirrors the sections script's approach)
  // ============================================================
  const CHAR_KEY_ATTR = 'data-gc-art-key';

  function identifyCharacters() {
    const list = document.querySelector('[class*="Farm_itemList"]');
    if (!list) return [];
    const wrappers = Array.from(list.querySelectorAll('[class*="ItemPanel_itemWrapper"]'));
    const counts = {};
    const results = [];
    for (const w of wrappers) {
      const img = w.querySelector('[class*="ItemPanel_itemImage"] [class*="containedImage"]');
      let type = 'item';
      if (img) {
        const bg = img.style.backgroundImage || '';
        if (bg.includes('/char/')) type = 'char';
        else if (bg.includes('/weapons/')) type = 'weapon';
      }
      if (type !== 'char') continue; // artifacts are a character-only concept
      const nameEl = w.querySelector('[class*="ItemPanel_itemName"] p');
      if (!nameEl) continue;
      const name = nameEl.textContent.trim();
      const base = `char:${name}`;
      counts[base] = (counts[base] || 0) + 1;
      const key = counts[base] === 1 ? base : `${base}#${counts[base]}`;
      w.setAttribute(CHAR_KEY_ATTR, key);
      results.push({ wrapper: w, key, name });
    }
    return results;
  }

  // ============================================================
  // Read-only panel rendering
  // ============================================================
  // Expand/collapse is local UI (not persisted in step 1); kept in a Set.
  const expanded = new Set();

  function statText(slotState, slotDef) {
    const main = slotDef.fixedMain || slotState.main || '';
    const subs = (slotState.subs || []).filter(Boolean);
    if (!main && subs.length === 0) return '<span class="gc-art-empty">— not set —</span>';
    let out = '';
    if (main) out += `<span class="gc-art-slot-main">${escapeHtml(main)}</span>`;
    if (subs.length) out += ` <span class="gc-art-slot-subs">· ${subs.map(escapeHtml).join(', ')}</span>`;
    return out;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function buildPanel(charKey) {
    const c = peekCharacter(charKey);
    const isOpen = expanded.has(charKey);

    const container = document.createElement('div');
    container.setAttribute('data-gc-art-panel', charKey);

    // Summary row
    const summary = document.createElement('div');
    summary.className = 'gc-art-summary' + (isOpen ? '' : ' collapsed');
    const arrow = document.createElement('span');
    arrow.className = 'gc-art-arrow';
    arrow.textContent = '▾';
    summary.appendChild(arrow);
    const title = document.createElement('span');
    title.textContent = 'Artifacts';
    summary.appendChild(title);
    const count = document.createElement('span');
    count.className = 'gc-art-count';
    count.textContent = `${doneCount(charKey)}/5`;
    summary.appendChild(count);
    summary.addEventListener('click', (e) => {
      e.stopPropagation();
      if (expanded.has(charKey)) expanded.delete(charKey);
      else expanded.add(charKey);
      scheduleApply();
    });
    container.appendChild(summary);

    // Body
    const body = document.createElement('div');
    body.className = 'gc-art-body' + (isOpen ? '' : ' gc-art-hidden');

    const setLine = document.createElement('div');
    setLine.className = 'gc-art-set';
    setLine.innerHTML = c.set
      ? `Set: ${escapeHtml(c.set)}`
      : '<span class="gc-art-empty">Set: — not set —</span>';
    body.appendChild(setLine);

    for (const def of SLOTS) {
      const s = c.slots[def.key];
      const row = document.createElement('div');
      row.className = 'gc-art-slot';
      row.innerHTML =
        `<span class="gc-art-slot-check ${s.done ? 'done' : 'notdone'}">${s.done ? '✔' : '○'}</span>` +
        `<span class="gc-art-slot-label">${def.label}</span>` +
        `<span class="gc-art-slot-stats">${statText(s, def)}</span>`;
      body.appendChild(row);
    }

    if (c.notes) {
      const notes = document.createElement('div');
      notes.className = 'gc-art-notes';
      notes.textContent = c.notes;
      body.appendChild(notes);
    }

    const hint = document.createElement('div');
    hint.className = 'gc-art-hint';
    hint.textContent = 'Read-only preview. Editing comes in the next version.';
    body.appendChild(hint);

    container.appendChild(body);
    return container;
  }

  function findInsertPoint(wrapper) {
    // Same anchor the sections script uses: the inner item container, after
    // the name bar. We place our panel at the end of that inner container.
    const inner = wrapper.querySelector('[class*="ItemPanel_nameBar"]')?.parentElement || wrapper;
    return inner;
  }

  function applyPanels() {
    const chars = identifyCharacters();
    for (const ch of chars) {
      const inner = findInsertPoint(ch.wrapper);
      let panel = inner.querySelector(':scope > [data-gc-art-panel]');
      const fresh = buildPanel(ch.key);
      if (panel) {
        // Only replace if content actually changed, to avoid clobbering on
        // every React tick. Cheap signature check.
        if (panel.getAttribute('data-sig') !== signature(ch.key)) {
          fresh.setAttribute('data-sig', signature(ch.key));
          panel.replaceWith(fresh);
        }
      } else {
        fresh.setAttribute('data-sig', signature(ch.key));
        inner.appendChild(fresh);
      }
    }
  }

  function signature(charKey) {
    const c = state.characters[charKey];
    const open = expanded.has(charKey) ? '1' : '0';
    if (!c) return open + '|empty';
    return open + '|' + JSON.stringify(c);
  }

  // ============================================================
  // Apply scheduling + observer
  // ============================================================
  let applyPending = false;
  let suppressUntil = 0;
  function scheduleApply() {
    if (applyPending) return;
    applyPending = true;
    setTimeout(() => {
      applyPending = false;
      try { applyPanels(); suppressUntil = Date.now() + 200; }
      catch (e) { console.error('[gc-artifacts] apply error', e); }
    }, 100);
  }

  const observer = new MutationObserver((mutations) => {
    if (Date.now() < suppressUntil) return;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches && node.matches('[data-gc-art-panel]')) continue;
        if (node.closest && node.closest('[data-gc-art-panel]')) continue;
        if (node.matches && (node.matches('[class*="ItemPanel_itemWrapper"]') || node.matches('[class*="Farm_itemList"]'))) {
          scheduleApply(); return;
        }
        if (node.querySelector && node.querySelector('[class*="ItemPanel_itemWrapper"]')) {
          scheduleApply(); return;
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  scheduleApply();
  setTimeout(scheduleApply, 600);
  setTimeout(scheduleApply, 1500);
  setTimeout(scheduleApply, 3000);

  // SPA nav
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(scheduleApply, 400);
      setTimeout(scheduleApply, 1200);
    }
  }, 1000);

  // ============================================================
  // Debug handle + a temporary seeding helper (step 1 has no editor yet)
  // ============================================================
  window.__gcArtifacts = {
    state: () => state,
    profiles: () => allData,
    sets: () => ARTIFACT_SETS,
    // Seed sample data so you can see the read-only panel populated.
    // Usage: __gcArtifacts.seed('char:Hu Tao')
    seed: (charKey) => {
      const c = getCharacter(charKey);
      c.set = 'Crimson Witch of Flames';
      c.slots.flower = { done: true, main: 'HP', subs: ['CRIT Rate', 'CRIT DMG'] };
      c.slots.plume = { done: true, main: 'ATK', subs: ['CRIT DMG', 'ATK%'] };
      c.slots.sands = { done: false, main: 'HP%', subs: ['CRIT DMG', 'Elemental Mastery'] };
      c.slots.goblet = { done: false, main: 'Pyro DMG', subs: ['CRIT Rate', 'CRIT DMG'] };
      c.slots.circlet = { done: false, main: 'CRIT Rate', subs: ['CRIT DMG', 'HP%'] };
      c.notes = 'Farm goblet + circlet first.';
      saveState();
      scheduleApply();
      return c;
    },
    clear: (charKey) => {
      delete state.characters[charKey];
      saveState();
      scheduleApply();
    },
    reapply: () => scheduleApply()
  };

  console.log('[gc-artifacts] v0.1.1 loaded (read-only preview). Try __gcArtifacts.seed("char:<Name>") in console.');
})();