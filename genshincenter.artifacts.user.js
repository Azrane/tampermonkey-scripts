// ==UserScript==
// @name         Genshin Center - Artifact Goals
// @namespace    https://genshin-center.com/
// @version      0.2.0
// @description  Track artifact goals per character on the Ascension Planner. Each character can have several named builds (e.g. "Main DPS", "Off-field"), each with a 4pc or 2+2 set target, ranked main stats for sands/goblet/circlet, a ranked substat list, per-piece "done" checkboxes and notes. Edited in a pop-up styled like the site's own Edit dialog.
// @author       You
// @match        https://genshin-center.com/planner*
// @match        https://genshin-center.com/*/planner*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Azrane/tampermonkey-scripts/main/genshincenter.artifacts.user.js
// @downloadURL  https://raw.githubusercontent.com/Azrane/tampermonkey-scripts/main/genshincenter.artifacts.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ============================================================
  // Reference data
  // ============================================================
  const SLOTS = [
    { key: 'flower',  label: 'Flower',  fixed: 'HP' },
    { key: 'plume',   label: 'Plume',   fixed: 'ATK' },
    { key: 'sands',   label: 'Sands',   mains: ['ATK%', 'HP%', 'DEF%', 'Elemental Mastery', 'Energy Recharge'] },
    { key: 'goblet',  label: 'Goblet',  mains: ['Pyro DMG', 'Hydro DMG', 'Electro DMG', 'Cryo DMG', 'Anemo DMG', 'Geo DMG', 'Dendro DMG', 'Physical DMG', 'ATK%', 'HP%', 'DEF%', 'Elemental Mastery'] },
    { key: 'circlet', label: 'Circlet', mains: ['CRIT Rate', 'CRIT DMG', 'ATK%', 'HP%', 'DEF%', 'Elemental Mastery', 'Healing Bonus'] }
  ];
  const MAIN_SLOTS = SLOTS.filter(s => !s.fixed);

  const SUBSTATS = [
    'CRIT Rate', 'CRIT DMG', 'ATK%', 'HP%', 'DEF%',
    'Elemental Mastery', 'Energy Recharge', 'ATK', 'HP', 'DEF'
  ];

  // 4★ and 5★ sets. The site has no artifact data to read, so this list is
  // maintained by hand. The set picker also accepts any typed name, so a
  // brand-new set works before this list is updated.
  const ARTIFACT_SETS = [
    'A Day Carved From Rising Winds', 'Archaic Petra', 'Aubade of Morningstar and Moon',
    'Berserker', 'Blizzard Strayer', 'Bloodstained Chivalry', 'Brave Heart',
    'Celestial Gift', 'Crimson Witch of Flames', 'Deepwood Memories', "Defender's Will",
    'Desert Pavilion Chronicle', 'Disenchantment in Deep Shadow', 'Echoes of an Offering',
    'Emblem of Severed Fate', 'Finale of the Deep Galleries', 'Flower of Paradise Lost',
    'Fragment of Harmonic Whimsy', 'Gambler', 'Gilded Dreams', "Gladiator's Finale",
    'Golden Troupe', 'Heart of Depth', 'Heart of the Furnace', 'Husk of Opulent Dreams',
    'Instructor', 'Lavawalker', "Long Night's Oath", 'Maiden Beloved', 'Marechaussee Hunter',
    'Martial Artist', "Night of the Sky's Unveiling", 'Nighttime Whispers in the Echoing Woods',
    'Noblesse Oblige', "Nymph's Dream", 'Obsidian Codex', 'Ocean-Hued Clam', 'Pale Flame',
    'Prayers for Destiny', 'Prayers for Illumination', 'Prayers for Wisdom', 'Prayers to Springtime',
    'Resolution of Sojourner', 'Retracing Bolide', 'Scarlet Proof', 'Scholar',
    'Scroll of the Hero of Cinder City', "Shimenawa's Reminiscence", "Silken Moon's Serenade",
    'Song of Days Past', 'Tenacity of the Millelith', 'The Exile', 'Thundering Fury',
    'Thundersoother', 'Tiny Miracle', 'Unfinished Reverie', 'Vermillion Hereafter',
    'Viridescent Venerer', "Vourukasha's Glow", "Wanderer's Troupe"
  ].sort((a, b) => a.localeCompare(b));

  // ============================================================
  // Data model
  //   characters[charKey] = { activeBuild: id, builds: [Build] }
  //   Build = { id, name, sets:{mode:'4pc'|'2+2', a, b},
  //             mains:{sands:[],goblet:[],circlet:[]}  (ranked, best first)
  //             subs:[] (ranked), done:{flower..circlet}, notes }
  // ============================================================
  const STORAGE_KEY = 'gc-artifacts-v2';
  const LEGACY_KEY = 'gc-artifacts-v1';   // 0.1.x; read once for migration, never written
  const DEFAULT_PROFILE = '__default';

  function newId() {
    return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function uniqStrings(x, allowed) {
    const out = [];
    if (!Array.isArray(x)) return out;
    for (const v of x) {
      if (typeof v !== 'string' || !v || out.includes(v)) continue;
      if (allowed && !allowed.includes(v)) continue;
      out.push(v);
    }
    return out;
  }
  function blankBuild(name) {
    const done = {};
    for (const s of SLOTS) done[s.key] = false;
    const mains = {};
    for (const s of MAIN_SLOTS) mains[s.key] = [];
    return { id: newId(), name: name || 'Build 1', sets: { mode: '4pc', a: '', b: '' }, mains, subs: [], done, notes: '' };
  }
  function sanitizeBuild(b) {
    const out = blankBuild();
    if (!b || typeof b !== 'object') return out;
    if (typeof b.id === 'string' && b.id) out.id = b.id;
    if (typeof b.name === 'string') out.name = b.name.slice(0, 60);
    const s = b.sets || {};
    out.sets.mode = s.mode === '2+2' ? '2+2' : '4pc';
    out.sets.a = typeof s.a === 'string' ? s.a : '';
    out.sets.b = typeof s.b === 'string' ? s.b : '';
    for (const def of MAIN_SLOTS) out.mains[def.key] = uniqStrings(b.mains && b.mains[def.key], def.mains);
    out.subs = uniqStrings(b.subs, SUBSTATS);
    for (const def of SLOTS) out.done[def.key] = !!(b.done && b.done[def.key]);
    out.notes = typeof b.notes === 'string' ? b.notes : '';
    return out;
  }
  function sanitizeCharacter(c) {
    if (!c || typeof c !== 'object' || !Array.isArray(c.builds)) return null;
    const builds = [];
    const ids = new Set();
    for (const raw of c.builds) {
      const b = sanitizeBuild(raw);
      while (ids.has(b.id)) b.id = newId();
      ids.add(b.id);
      builds.push(b);
    }
    if (!builds.length) return null;
    const activeBuild = ids.has(c.activeBuild) ? c.activeBuild : builds[0].id;
    return { activeBuild, builds };
  }
  function sanitizeProfileState(p) {
    const characters = {};
    const raw = (p && p.characters && typeof p.characters === 'object') ? p.characters : {};
    for (const k of Object.keys(raw)) {
      const c = sanitizeCharacter(raw[k]);
      if (c) characters[k] = c;
    }
    return { characters };
  }

  // 0.1.x stored one flat goal per character. Turn each non-empty one into a
  // single build named "Build 1".
  function migrateLegacyCharacter(c) {
    if (!c || typeof c !== 'object') return null;
    const slots = c.slots || {};
    const b = blankBuild('Build 1');
    let any = false;
    const set = typeof c.set === 'string' ? c.set : '';
    if (set === 'Multiple / mixed (2+2)') { b.sets.mode = '2+2'; any = true; }
    else if (set) { b.sets.a = set; any = true; }
    const subs = [];
    for (const def of SLOTS) {
      const s = slots[def.key] || {};
      if (s.done) { b.done[def.key] = true; any = true; }
      if (def.mains && typeof s.main === 'string' && def.mains.includes(s.main)) { b.mains[def.key] = [s.main]; any = true; }
      for (const x of (Array.isArray(s.subs) ? s.subs : [])) {
        if (SUBSTATS.includes(x) && !subs.includes(x)) { subs.push(x); any = true; }
      }
    }
    b.subs = subs;
    if (typeof c.notes === 'string' && c.notes) { b.notes = c.notes; any = true; }
    return any ? { activeBuild: b.id, builds: [b] } : null;
  }

  function loadAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const profiles = {};
        if (parsed && parsed.profiles && typeof parsed.profiles === 'object') {
          for (const k of Object.keys(parsed.profiles)) profiles[k] = sanitizeProfileState(parsed.profiles[k]);
        }
        return { version: 2, profiles };
      }
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        const profiles = {};
        let n = 0;
        for (const pk of Object.keys((parsed && parsed.profiles) || {})) {
          const chars = (parsed.profiles[pk] && parsed.profiles[pk].characters) || {};
          profiles[pk] = { characters: {} };
          for (const ck of Object.keys(chars)) {
            const m = migrateLegacyCharacter(chars[ck]);
            if (m) { profiles[pk].characters[ck] = m; n++; }
          }
        }
        console.log(`[gc-artifacts] migrated ${n} character(s) from 0.1.x data (old data left in place under "${LEGACY_KEY}")`);
        const data = { version: 2, profiles };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        return data;
      }
    } catch (e) {
      console.error('[gc-artifacts] load failed, starting fresh', e);
    }
    return { version: 2, profiles: {} };
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
    if (editor) closeEditor();
    currentProfileKey = key;
    if (!allData.profiles[key]) allData.profiles[key] = { characters: {} };
    state = allData.profiles[key];
    console.log(`[gc-artifacts] active profile: "${key}"`);
  }

  function activeBuildOf(c) {
    if (!c) return null;
    return c.builds.find(b => b.id === c.activeBuild) || c.builds[0] || null;
  }
  function doneCount(build) {
    return build ? SLOTS.reduce((n, d) => n + (build.done[d.key] ? 1 : 0), 0) : 0;
  }
  function setsText(build) {
    const s = build.sets;
    if (s.mode === '2+2') {
      if (!s.a && !s.b) return '';
      return `2pc ${s.a || '?'} + 2pc ${s.b || '?'}`;
    }
    return s.a ? `4pc ${s.a}` : '';
  }

  // ============================================================
  // Native look: resolve the site's hashed CSS-module class names at runtime
  // (e.g. "Window_modal" -> "Window_modal__2s0yi") so the pop-up uses the
  // site's own styles. Our .gca-* rules carry the same values as a fallback
  // and override only where we need something different.
  // ============================================================
  let NATIVE = null;
  function nc(base) {
    if (!NATIVE || !Object.keys(NATIVE).length) {
      NATIVE = {};
      const re = /\.([A-Za-z0-9]+_[A-Za-z0-9]+)__([A-Za-z0-9_-]+)/g;
      const visit = (rules) => {
        for (const r of rules) {
          if (r.cssRules && !r.selectorText) { visit(r.cssRules); continue; }
          if (!r.selectorText) continue;
          let m;
          re.lastIndex = 0;
          while ((m = re.exec(r.selectorText))) {
            if (!NATIVE[m[1]]) NATIVE[m[1]] = `${m[1]}__${m[2]}`;
          }
        }
      };
      for (const ss of document.styleSheets) {
        try { visit(ss.cssRules); } catch (e) { /* cross-origin sheet */ }
      }
    }
    return NATIVE[base] || '';
  }
  function cls(own, ...natives) {
    return [own, ...natives.map(nc)].filter(Boolean).join(' ');
  }

  // ============================================================
  // Styles
  // ============================================================
  const css = `
    /* ---- card panel ---- */
    /* The card has a positioned layer over its lower part; without this the
       panel is painted underneath it and real clicks land on the card. */
    [data-gc-art-panel] { position: relative; z-index: 1; }
    .gc-art-summary {
      display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box;
      font-family: 'Montserrat', sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.4px;
      padding: 3px 4px 3px 8px; background: rgba(22, 32, 58, 0.85); color: #ece5d8;
      border-top: 1px solid rgba(0,0,0,0.25); border-bottom: 3px solid rgba(255,255,255,0.15);
      cursor: pointer; user-select: none;
    }
    .gc-art-summary:hover { filter: brightness(1.2); }
    .gc-art-summary .gc-art-arrow { display: inline-block; transition: transform 0.2s; font-size: 0.8em; }
    .gc-art-summary.collapsed .gc-art-arrow { transform: rotate(-90deg); }
    .gc-art-summary .gc-art-build { font-weight: 400; color: #ffd7a0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .gc-art-summary .gc-art-count { margin-left: auto; font-weight: 400; opacity: 0.8; white-space: nowrap; }
    .gc-art-summary .gc-art-edit {
      background: rgba(219,207,184,0.25); color: #ece5d8; border: none; border-radius: 10px;
      font: 700 11px 'Montserrat', sans-serif; padding: 1px 8px; cursor: pointer; white-space: nowrap;
    }
    .gc-art-summary .gc-art-edit:hover { background: rgba(219,207,184,0.45); }
    .gc-art-body {
      width: 100%; box-sizing: border-box; background: rgba(16, 24, 44, 0.9); color: #ece5d8;
      font-family: 'Montserrat', sans-serif; font-size: 11px; padding: 6px 8px 8px;
      border-bottom: 1px solid rgba(0,0,0,0.25);
    }
    .gc-art-body.gc-art-hidden { display: none; }
    .gc-art-set { font-weight: 700; margin-bottom: 4px; color: #ffd7a0; }
    .gc-art-slot { display: flex; align-items: baseline; gap: 6px; padding: 2px 0; border-top: 1px solid rgba(255,255,255,0.06); }
    .gc-art-check { width: 16px; text-align: center; flex-shrink: 0; cursor: pointer; background: none; border: none; padding: 0; font-size: 12px; }
    .gc-art-check.done { color: #7ddc7d; }
    .gc-art-check.notdone { color: rgba(255,255,255,0.35); }
    .gc-art-check:hover { filter: brightness(1.4); }
    .gc-art-slot-label { width: 48px; flex-shrink: 0; font-weight: 700; opacity: 0.85; }
    .gc-art-slot-main { flex: 1; color: #cfe4ff; }
    .gc-art-subs { margin-top: 4px; opacity: 0.8; }
    .gc-art-subs b { font-weight: 700; opacity: 0.85; }
    .gc-art-empty { opacity: 0.5; font-style: italic; }
    .gc-art-notes { margin-top: 4px; opacity: 0.7; font-style: italic; white-space: pre-wrap; }

    /* ---- pop-up (fallback values mirror the site's Window/Edit/Select styles) ---- */
    .gca-root { position: fixed; inset: 0; z-index: 10000; font-family: Montserrat, Helvetica, Arial, sans-serif; color: #ccc; font-size: 16px; }
    .gca-root * { box-sizing: border-box; }
    .gca-root p, .gca-root h3 { margin: 0; }
    .gca-win { display: flex; position: fixed; inset: 0; justify-content: center; background-color: rgba(10,10,20,0.96); }
    .gca-modal {
      position: fixed; top: 50%; transform: translateY(-50%); display: grid; grid-template-rows: auto 1fr auto;
      max-height: 95%; max-width: 96vw; width: 400px; background-color: #1e2231; border-radius: 5px; overflow: hidden;
    }
    .gca-title { font-size: 22px; color: #ccc; text-align: center; padding: 10px; font-weight: 800; border-radius: 5px 5px 0 0; }
    .gca-content {
      display: flex; flex-direction: column; align-items: center; padding: 2px 14px; overflow-y: auto; max-width: none;
      box-shadow: inset 0 89px 11px -90px rgba(0,0,0,0.75), inset 0 -89px 11px -90px rgba(0,0,0,0.75);
    }
    .gca-section { position: relative; display: flex; flex-direction: column; align-items: center; padding-bottom: 12px; width: 100%; flex-shrink: 0; }
    .gca-section + .gca-section { border-top: 1px solid rgba(255,255,255,0.2); }
    .gca-sname { padding: 10px 10px 6px; }
    .gca-sname p { text-align: center; font-weight: 600; font-size: 18px; color: #ffd780; }
    .gca-btns { display: flex; width: 100%; justify-content: space-evenly; padding: 10px 0; }
    .gca-row { display: flex; gap: 6px; width: 100%; align-items: center; justify-content: center; flex-wrap: wrap; margin-top: 8px; }
    .gca-hint { font-size: 12px; opacity: 0.6; text-align: center; margin-top: 4px; }

    .gca-select {
      position: relative; background-color: #ece5d8; box-shadow: 0 0 4px rgba(0,0,0,0.8); border-radius: 40px;
      padding: 5px 34px 5px 14px; font-size: 16px; color: #000; font-weight: 600; width: 100%; cursor: pointer;
      text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-height: 31px; line-height: 21px;
    }
    .gca-select::after {
      content: ""; position: absolute; top: 50%; right: 12px; transform: translateY(-25%);
      border: 7px solid transparent; border-top-color: #000; pointer-events: none;
    }
    .gca-select.gca-placeholder { color: rgba(0,0,0,0.5); }
    .gca-select-wrap { position: relative; width: 100%; }
    .gca-bg { position: fixed; inset: 0; z-index: 10001; }
    .gca-options {
      position: fixed; z-index: 10002; background-color: #282d41; border-radius: 5px; box-shadow: 0 0 4px rgba(0,0,0,0.8);
      overflow: hidden; display: flex; flex-direction: column; top: auto;
    }
    .gca-options-list { overflow-y: auto; }
    .gca-option { position: relative; font-size: 16px; font-weight: 600; padding: 10px 44px 10px 15px; cursor: pointer; line-height: 19px; color: #ccc; }
    .gca-option:not(:last-child) { border-bottom: 1px solid rgba(255,255,255,0.2); }
    .gca-option.gca-hl { background-color: #4c98ff; color: #000; }
    .gca-search { margin: 8px; padding: 6px 10px; border-radius: 3px; border: none; background: #ece5d8; color: #1e1e28; font: 600 15px Montserrat, sans-serif; outline: none; }
    .gca-search:focus { box-shadow: 0 0 7px #aaa; }

    .gca-pill {
      background: rgba(219,207,184,0.6); color: #1e1e28; border: none; border-radius: 40px; padding: 5px 14px;
      font: 700 13px Montserrat, sans-serif; cursor: pointer; box-shadow: 0 0 4px rgba(0,0,0,0.6);
    }
    .gca-pill:hover { filter: brightness(1.15); }
    .gca-pill.gca-on { background: #ece5d8; box-shadow: 0 0 7px rgba(236,230,217,0.7); }
    .gca-pill.gca-danger { background: rgba(252,68,69,0.85); color: #fff; }

    .gca-input, .gca-textarea {
      width: 100%; background: #ece5d8; color: #1e1e28; border: none; border-radius: 3px; outline: none;
      font-family: Montserrat, sans-serif;
    }
    .gca-input { padding: 6px 10px; font-size: 16px; font-weight: 800; text-align: center; }
    .gca-textarea { padding: 8px 10px; font-size: 14px; font-weight: 600; min-height: 64px; resize: vertical; }
    .gca-input:focus, .gca-textarea:focus { box-shadow: 0 0 7px #aaa; }

    .gca-slot { width: 100%; margin: 4px 0 6px; }
    .gca-slot > h3 { font-size: 15px; font-weight: 600; margin-bottom: 3px; }
    .gca-slot > h3 span { font-weight: 400; opacity: 0.6; font-size: 13px; }
    .gca-rank {
      display: flex; align-items: center; gap: 4px; width: 100%; background: rgba(0,0,0,0.28); border-radius: 4px;
      padding: 3px 4px 3px 8px; margin: 3px 0; font-weight: 600; font-size: 14px;
    }
    .gca-rank .gca-n { color: #ffd780; width: 18px; flex-shrink: 0; }
    .gca-rank .gca-l { flex: 1; min-width: 0; }
    .gca-ib { background: none; border: none; color: #ccc; cursor: pointer; font-size: 12px; padding: 3px 6px; border-radius: 3px; line-height: 1; }
    .gca-ib:hover:not([disabled]) { background: rgba(255,255,255,0.14); }
    .gca-ib[disabled] { opacity: 0.25; cursor: default; }

    .gca-cb { display: flex; align-items: center; width: 100%; cursor: pointer; }
    .gca-cb button {
      width: 25px; height: 25px; flex-shrink: 0; background-color: rgba(0,0,0,0.4); margin-right: 10px; padding: 0;
      border: 1px solid rgba(56,166,194,0.4); border-radius: 3px; box-shadow: inset 0 0 4px rgba(0,0,0,0.8); cursor: pointer;
    }
    .gca-cb button svg { width: 25px; height: 25px; display: block; }
    .gca-cb button path { stroke: #38a6c2; stroke-width: 6; fill: none; transform: scale(1.3); transform-origin: 50% 50%; }
    .gca-cb h3 { font-weight: 600; font-size: 15px; }
    .gca-done { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; width: 100%; }

    .gca-cbtn { position: relative; display: flex; align-items: center; justify-content: center; height: 44px; width: 44px; border-radius: 100%; background-color: rgba(219,207,184,0.6); border: none; padding: 0; cursor: pointer; }
    .gca-cbtn .gca-cimg { width: 30px; height: 30px; z-index: 1; pointer-events: none; }
  `;
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ============================================================
  // Small DOM helpers
  // ============================================================
  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ============================================================
  // Character identification
  // ============================================================
  const CHAR_KEY_ATTR = 'data-gc-art-key';

  function identifyCharacters() {
    const list = document.querySelector('[class*="Farm_itemList"]');
    if (!list) return [];
    const counts = {};
    const results = [];
    for (const w of list.querySelectorAll('[class*="ItemPanel_itemWrapper"]')) {
      const img = w.querySelector('[class*="ItemPanel_itemImage"] [class*="containedImage"]');
      const bg = img ? (img.style.backgroundImage || '') : '';
      if (!bg.includes('/char/')) continue; // artifacts are a character-only concept
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
  // Card panel
  // ============================================================
  const expanded = new Set();

  function toggleDoneFromCard(charKey, slotKey) {
    const b = activeBuildOf(state.characters[charKey]);
    if (!b) return;
    b.done[slotKey] = !b.done[slotKey];
    saveState();
    refreshPanel(charKey);
  }

  function buildPanel(charKey) {
    const c = state.characters[charKey] || null;
    const b = activeBuildOf(c);
    const isOpen = !!b && expanded.has(charKey);

    const container = el('div');
    container.setAttribute('data-gc-art-panel', charKey);

    const summary = el('div', 'gc-art-summary' + (isOpen ? '' : ' collapsed'));
    summary.appendChild(el('span', 'gc-art-arrow', '▾'));
    summary.appendChild(el('span', '', 'Artifacts'));
    if (b) {
      const extra = c.builds.length > 1 ? `  (${c.builds.length} builds)` : '';
      summary.appendChild(el('span', 'gc-art-build', b.name + extra));
    }
    summary.appendChild(el('span', 'gc-art-count', b ? `${doneCount(b)}/5` : 'no builds'));
    const edit = el('button', 'gc-art-edit', b ? '✎ Edit' : '+ Add');
    edit.setAttribute('data-gc-art-edit', '1');
    edit.addEventListener('click', (e) => { e.stopPropagation(); openEditor(charKey); });
    summary.appendChild(edit);
    summary.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!b) { openEditor(charKey); return; }
      if (expanded.has(charKey)) expanded.delete(charKey); else expanded.add(charKey);
      refreshPanel(charKey);
    });
    container.appendChild(summary);

    if (!b) return container;

    const body = el('div', 'gc-art-body' + (isOpen ? '' : ' gc-art-hidden'));
    const st = setsText(b);
    const setLine = el('div', 'gc-art-set');
    setLine.innerHTML = st ? escapeHtml(st) : '<span class="gc-art-empty">Set: — not set —</span>';
    body.appendChild(setLine);

    for (const def of SLOTS) {
      const row = el('div', 'gc-art-slot');
      const chk = el('button', 'gc-art-check ' + (b.done[def.key] ? 'done' : 'notdone'), b.done[def.key] ? '✔' : '○');
      chk.title = b.done[def.key] ? 'Done — click to unmark' : 'Click to mark done';
      chk.setAttribute('data-gc-art-check', def.key);
      chk.addEventListener('click', (e) => { e.stopPropagation(); toggleDoneFromCard(charKey, def.key); });
      row.appendChild(chk);
      row.appendChild(el('span', 'gc-art-slot-label', def.label));
      const mains = def.fixed ? [def.fixed] : b.mains[def.key];
      const m = el('span', 'gc-art-slot-main');
      if (mains.length) m.textContent = mains.join(' › ');
      else m.innerHTML = '<span class="gc-art-empty">— not set —</span>';
      row.appendChild(m);
      body.appendChild(row);
    }
    const subs = el('div', 'gc-art-subs');
    subs.innerHTML = '<b>Subs:</b> ' + (b.subs.length ? escapeHtml(b.subs.join(' › ')) : '<span class="gc-art-empty">— not set —</span>');
    body.appendChild(subs);
    if (b.notes) body.appendChild(el('div', 'gc-art-notes', b.notes));

    container.appendChild(body);
    return container;
  }

  function findInsertPoint(wrapper) {
    const bar = wrapper.querySelector('[class*="ItemPanel_nameBar"]');
    return (bar && bar.parentElement) || wrapper;
  }

  function signature(charKey) {
    const c = state.characters[charKey];
    return (expanded.has(charKey) ? '1' : '0') + '|' + (c ? JSON.stringify(c) : 'none');
  }

  function placePanel(wrapper, key) {
    const inner = findInsertPoint(wrapper);
    const panel = inner.querySelector(':scope > [data-gc-art-panel]');
    const sig = signature(key);
    if (panel && panel.getAttribute('data-sig') === sig && panel.getAttribute('data-gc-art-panel') === key) return;
    const fresh = buildPanel(key);
    fresh.setAttribute('data-sig', sig);
    if (panel) panel.replaceWith(fresh); else inner.appendChild(fresh);
  }

  function applyPanels() {
    for (const ch of identifyCharacters()) placePanel(ch.wrapper, ch.key);
  }

  // Redraw one card's panel wherever its wrapper currently is — including
  // while the roster's panel view has borrowed it out of the planner list.
  function refreshPanel(charKey) {
    const w = document.querySelector(`[${CHAR_KEY_ATTR}="${CSS.escape(charKey)}"]`);
    if (w) placePanel(w, charKey);
    scheduleApply();
  }

  // ============================================================
  // Custom select (styled like the site's Select)
  // ============================================================
  let openPanel = null; // { close, panel }

  function closeOpenPanel() {
    if (openPanel) { const p = openPanel; openPanel = null; p.close(); }
  }

  // opts: { value, options:[{value,label}], placeholder, onChange, searchable, allowCustom, testId }
  function makeSelect(opts) {
    const wrap = el('div', cls('gca-select-wrap', 'Select_selectWrapper'));
    const pillEl = el('div', cls('gca-select', 'Select_select'));
    const cur = opts.options.find(o => o.value === opts.value);
    const label = cur ? cur.label : (opts.value && opts.allowCustom ? opts.value : '');
    pillEl.textContent = label || opts.placeholder || 'Select…';
    if (!label) pillEl.classList.add('gca-placeholder');
    if (opts.testId) pillEl.setAttribute('data-gca-select', opts.testId);
    pillEl.tabIndex = 0;
    wrap.appendChild(pillEl);

    const open = () => {
      closeOpenPanel();
      const root = editor && editor.root;
      if (!root) return;
      const bg = el('div', cls('gca-bg', 'Select_background'));
      const panel = el('div', cls('gca-options', 'Select_options'));
      const r = pillEl.getBoundingClientRect();
      const width = Math.min(Math.max(r.width, 220), window.innerWidth - 16);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const maxH = Math.max(160, Math.min(340, Math.max(below, above)));
      panel.style.left = left + 'px';
      panel.style.width = width + 'px';
      panel.style.maxHeight = maxH + 'px';
      if (below >= Math.min(220, maxH) || below >= above) panel.style.top = (r.bottom + 4) + 'px';
      else panel.style.bottom = (window.innerHeight - r.top + 4) + 'px';

      let search = null;
      if (opts.searchable) {
        search = el('input', 'gca-search');
        search.type = 'text';
        search.placeholder = opts.allowCustom ? 'Search or type a name…' : 'Search…';
        search.setAttribute('data-gca-search', '1');
        panel.appendChild(search);
      }
      const list = el('div', 'gca-options-list');
      panel.appendChild(list);

      let items = [];
      let hl = -1;
      const hlClass = nc('Select_highlighted');
      const setHl = (i) => {
        hl = i;
        items.forEach((it, j) => {
          it.node.classList.toggle('gca-hl', j === hl);
          if (hlClass) it.node.classList.toggle(hlClass, j === hl);
        });
        if (items[hl]) items[hl].node.scrollIntoView({ block: 'nearest' });
      };
      const close = () => {
        bg.remove(); panel.remove();
        if (openPanel && openPanel.panel === panel) openPanel = null;
      };
      const choose = (v) => { close(); opts.onChange(v); };
      const fill = () => {
        list.innerHTML = '';
        items = [];
        const typed = search ? search.value.trim() : '';
        const q = typed.toLowerCase();
        const shown = opts.options.filter(o => !q || o.label.toLowerCase().includes(q));
        if (opts.allowCustom && q && !opts.options.some(o => o.label.toLowerCase() === q)) {
          shown.push({ value: typed, label: `Use "${typed}"` });
        }
        const selClass = nc('Select_selected');
        for (const o of shown) {
          const node = el('div', cls('gca-option', 'Select_option'));
          if (o.value === opts.value && selClass) node.classList.add(selClass);
          node.appendChild(el('p', '', o.label));
          node.setAttribute('data-gca-option', o.value);
          const idx = items.length;
          node.addEventListener('mouseenter', () => setHl(idx));
          node.addEventListener('mousedown', (e) => { e.preventDefault(); choose(o.value); });
          list.appendChild(node);
          items.push({ node, value: o.value });
        }
        if (!shown.length) list.appendChild(el('div', 'gca-option', 'No matches'));
        const sel = items.findIndex(it => it.value === opts.value);
        setHl(sel >= 0 && !q ? sel : (items.length ? 0 : -1));
      };
      const onKey = (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setHl(Math.min(items.length - 1, hl + 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setHl(Math.max(0, hl - 1)); }
        else if (e.key === 'Enter') { e.preventDefault(); if (items[hl]) choose(items[hl].value); }
      };
      if (search) { search.addEventListener('input', fill); search.addEventListener('keydown', onKey); }
      else panel.addEventListener('keydown', onKey);
      bg.addEventListener('mousedown', (e) => { e.preventDefault(); closeOpenPanel(); });

      root.appendChild(bg);
      root.appendChild(panel);
      openPanel = { close, panel };
      fill();
      if (search) search.focus(); else { panel.tabIndex = -1; panel.focus(); }
    };
    pillEl.addEventListener('click', open);
    pillEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); open(); }
    });
    return wrap;
  }

  // ============================================================
  // Pop-up editor
  // ============================================================
  let editor = null; // { root, content, draft, selId, charKey, deleteArmed, deleteTimer }

  function nativeSection(title) {
    const sec = el('div', cls('gca-section', 'Edit_section'));
    const name = el('div', cls('gca-sname', 'Edit_sectionName'));
    name.appendChild(el('p', '', title));
    sec.appendChild(name);
    return sec;
  }
  function nativeCheckbox(label, checked, onToggle, testId) {
    const box = el('div', cls('gca-cb', 'Checkbox_checkbox'));
    const bw = el('div', nc('Checkbox_buttonWrapper'));
    const btn = el('button');
    btn.type = 'button';
    if (testId) btn.setAttribute('data-gca-check', testId);
    btn.setAttribute('aria-pressed', checked ? 'true' : 'false');
    if (checked) {
      btn.innerHTML = '<svg viewBox="0 0 52 52" xmlns="http://www.w3.org/2000/svg"><path d="m14 27 7 7 16-16"></path></svg>';
      const svg = btn.firstChild;
      const m = nc('Checkbox_checkmark'), mc = nc('Checkbox_checkmarkCheck');
      if (m) svg.setAttribute('class', m);
      if (mc) svg.firstChild.setAttribute('class', mc);
    }
    bw.appendChild(btn);
    box.appendChild(bw);
    box.appendChild(el('h3', '', label));
    box.addEventListener('click', (e) => { e.preventDefault(); onToggle(); });
    return box;
  }
  function colorButton(color, img, onClick, testId) {
    const b = el('button', cls('gca-cbtn', 'ColorButton_button'));
    b.type = 'button';
    if (testId) b.setAttribute('data-gca-btn', testId);
    b.appendChild(el('div', nc('ColorButton_glow')));
    b.appendChild(el('div', nc('ColorButton_innerborder')));
    const inner = el('div', nc('ColorButton_inner'));
    inner.style.backgroundColor = color;
    b.appendChild(inner);
    const imgWrap = el('div', cls('gca-cimg', 'ColorButton_img'));
    const ci = el('div', 'containedImage');
    ci.style.cssText = `width:100%;height:100%;background-image:url("${img}");background-size:contain;background-repeat:no-repeat;background-position:center;`;
    imgWrap.appendChild(ci);
    b.appendChild(imgWrap);
    b.addEventListener('click', onClick);
    return b;
  }
  function pill(text, onClick, extra, testId) {
    const b = el('button', 'gca-pill' + (extra ? ' ' + extra : ''), text);
    b.type = 'button';
    if (testId) b.setAttribute('data-gca-btn', testId);
    b.addEventListener('click', onClick);
    return b;
  }

  // Ranked list: rows with ▲ ▼ ✕, plus an "add" select for what's left.
  function rankedList(list, allOptions, onChange, testId, addLabel) {
    const box = el('div');
    box.style.width = '100%';
    list.forEach((v, i) => {
      const row = el('div', 'gca-rank');
      row.setAttribute('data-gca-rank', `${testId}:${v}`);
      row.appendChild(el('span', 'gca-n', String(i + 1)));
      row.appendChild(el('span', 'gca-l', v));
      const up = el('button', 'gca-ib', '▲'); up.title = 'Move up'; up.disabled = i === 0;
      const dn = el('button', 'gca-ib', '▼'); dn.title = 'Move down'; dn.disabled = i === list.length - 1;
      const rm = el('button', 'gca-ib', '✕'); rm.title = 'Remove';
      up.setAttribute('data-gca-act', 'up'); dn.setAttribute('data-gca-act', 'down'); rm.setAttribute('data-gca-act', 'remove');
      up.addEventListener('click', () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; onChange(); });
      dn.addEventListener('click', () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; onChange(); });
      rm.addEventListener('click', () => { list.splice(i, 1); onChange(); });
      row.appendChild(up); row.appendChild(dn); row.appendChild(rm);
      box.appendChild(row);
    });
    const left = allOptions.filter(o => !list.includes(o));
    if (left.length) {
      const add = makeSelect({
        value: '', placeholder: addLabel || '+ Add', testId: testId + ':add',
        options: left.map(o => ({ value: o, label: o })),
        onChange: (v) => { list.push(v); onChange(); }
      });
      add.style.marginTop = '4px';
      box.appendChild(add);
    }
    return box;
  }

  function uniqueBuildName(builds, base) {
    const names = new Set(builds.map(b => b.name));
    if (!names.has(base)) return base;
    for (let n = 2; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
  }

  function renderEditor() {
    if (!editor) return;
    closeOpenPanel();
    const { content, draft } = editor;
    const scroll = content.scrollTop;
    content.innerHTML = '';
    const rerender = () => renderEditor();
    const b = draft.builds.find(x => x.id === editor.selId) || null;

    // ---- Build ----
    const secB = nativeSection('Build');
    if (b) {
      secB.appendChild(makeSelect({
        value: editor.selId, testId: 'build',
        options: draft.builds.map(x => ({ value: x.id, label: (x.name || 'Untitled') + (x.id === draft.activeBuild ? '  ★' : '') })),
        onChange: (v) => { editor.selId = v; editor.deleteArmed = false; rerender(); }
      }));
      const name = el('input', 'gca-input');
      name.type = 'text';
      name.maxLength = 60;
      name.value = b.name;
      name.placeholder = 'Build name, e.g. Main DPS';
      name.style.marginTop = '8px';
      name.setAttribute('data-gca-input', 'name');
      name.addEventListener('input', () => { b.name = name.value; });
      name.addEventListener('change', rerender);
      secB.appendChild(name);
    } else {
      secB.appendChild(el('div', 'gca-hint', 'No builds. Confirm now to remove artifact goals for this character, or add a build.'));
    }
    const actions = el('div', 'gca-row');
    actions.appendChild(pill('+ New build', () => {
      const nb = blankBuild(uniqueBuildName(draft.builds, 'Build ' + (draft.builds.length + 1)));
      draft.builds.push(nb);
      if (!draft.activeBuild) draft.activeBuild = nb.id;
      editor.selId = nb.id; editor.deleteArmed = false; rerender();
    }, '', 'new'));
    if (b) {
      actions.appendChild(pill('Duplicate', () => {
        const copy = JSON.parse(JSON.stringify(b));
        copy.id = newId();
        // A copied loadout is a new set of pieces to farm: start it unmarked.
        for (const def of SLOTS) copy.done[def.key] = false;
        copy.name = uniqueBuildName(draft.builds, (b.name || 'Build') + ' (copy)');
        draft.builds.splice(draft.builds.indexOf(b) + 1, 0, copy);
        editor.selId = copy.id; editor.deleteArmed = false; rerender();
      }, '', 'duplicate'));
      actions.appendChild(pill(editor.deleteArmed ? 'Really delete?' : 'Delete', () => {
        if (!editor.deleteArmed) {
          editor.deleteArmed = true;
          clearTimeout(editor.deleteTimer);
          editor.deleteTimer = setTimeout(() => {
            if (editor && editor.deleteArmed) { editor.deleteArmed = false; renderEditor(); }
          }, 3000);
          rerender();
          return;
        }
        const i = draft.builds.indexOf(b);
        draft.builds.splice(i, 1);
        if (draft.activeBuild === b.id) draft.activeBuild = draft.builds[0] ? draft.builds[0].id : null;
        const next = draft.builds[Math.min(i, draft.builds.length - 1)];
        editor.selId = next ? next.id : null;
        editor.deleteArmed = false;
        rerender();
      }, editor.deleteArmed ? 'gca-danger' : '', 'delete'));
    }
    secB.appendChild(actions);
    if (b) {
      const cbWrap = el('div');
      cbWrap.style.cssText = 'width:100%;margin-top:10px;';
      cbWrap.appendChild(nativeCheckbox('Show this build on the card', draft.activeBuild === b.id, () => {
        draft.activeBuild = b.id; rerender();
      }, 'active'));
      secB.appendChild(cbWrap);
    }
    content.appendChild(secB);
    if (!b) { content.scrollTop = scroll; return; }

    // ---- Sets ----
    const secS = nativeSection('Artifact set');
    const modes = el('div', 'gca-row');
    modes.style.marginTop = '0';
    modes.appendChild(pill('4-piece', () => { b.sets.mode = '4pc'; rerender(); }, b.sets.mode === '4pc' ? 'gca-on' : '', 'mode-4pc'));
    modes.appendChild(pill('2 + 2', () => { b.sets.mode = '2+2'; rerender(); }, b.sets.mode === '2+2' ? 'gca-on' : '', 'mode-22'));
    secS.appendChild(modes);
    const setOpts = ARTIFACT_SETS.map(s => ({ value: s, label: s }));
    const setPicker = (key, ph) => {
      const w = el('div');
      w.style.cssText = 'width:100%;margin-top:8px;display:flex;gap:6px;align-items:center;';
      w.appendChild(makeSelect({
        value: b.sets[key], placeholder: ph, testId: 'set-' + key, searchable: true, allowCustom: true,
        options: setOpts, onChange: (v) => { b.sets[key] = v; rerender(); }
      }));
      if (b.sets[key]) {
        const clr = el('button', 'gca-ib', '✕');
        clr.title = 'Clear';
        clr.addEventListener('click', () => { b.sets[key] = ''; rerender(); });
        w.appendChild(clr);
      }
      return w;
    };
    if (b.sets.mode === '4pc') secS.appendChild(setPicker('a', '4pc set…'));
    else { secS.appendChild(setPicker('a', 'First 2pc set…')); secS.appendChild(setPicker('b', 'Second 2pc set…')); }
    content.appendChild(secS);

    // ---- Main stats ----
    const secM = nativeSection('Main stats');
    for (const def of SLOTS) {
      const slot = el('div', 'gca-slot');
      const h = el('h3', '', def.label);
      if (def.fixed) {
        h.appendChild(el('span', '', `  ${def.fixed} (always)`));
        slot.appendChild(h);
      } else {
        if (b.mains[def.key].length > 1) h.appendChild(el('span', '', '  best first, any counts'));
        slot.appendChild(h);
        slot.appendChild(rankedList(b.mains[def.key], def.mains, rerender, 'main-' + def.key,
          b.mains[def.key].length ? '+ Add alternate' : '+ Add main stat'));
      }
      secM.appendChild(slot);
    }
    content.appendChild(secM);

    // ---- Substats ----
    const secU = nativeSection('Substat priority');
    secU.appendChild(rankedList(b.subs, SUBSTATS, rerender, 'subs', '+ Add substat'));
    content.appendChild(secU);

    // ---- Done ----
    const secD = nativeSection('Pieces done');
    const grid = el('div', 'gca-done');
    for (const def of SLOTS) {
      grid.appendChild(nativeCheckbox(def.label, b.done[def.key], () => {
        b.done[def.key] = !b.done[def.key]; rerender();
      }, 'done-' + def.key));
    }
    secD.appendChild(grid);
    content.appendChild(secD);

    // ---- Notes ----
    const secN = nativeSection('Notes');
    const ta = el('textarea', 'gca-textarea');
    ta.value = b.notes;
    ta.placeholder = 'e.g. Farm goblet first';
    ta.setAttribute('data-gca-input', 'notes');
    ta.addEventListener('input', () => { b.notes = ta.value; });
    secN.appendChild(ta);
    content.appendChild(secN);

    content.scrollTop = scroll;
  }

  // The site's ad bars are fixed to the bottom at z-index 99999 and would
  // cover the Cancel/Confirm buttons. Measure them and keep the dialog above.
  function bottomReserve() {
    let reserve = 0;
    for (const e of document.querySelectorAll('[id$="-adhesive"], [class*="adhesive"]')) {
      const cs = window.getComputedStyle(e);
      if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = e.getBoundingClientRect();
      if (r.height < 10 || r.width < 100) continue;
      if (r.bottom >= window.innerHeight - 2 && r.top > window.innerHeight / 2) {
        reserve = Math.max(reserve, Math.ceil(window.innerHeight - r.top));
      }
    }
    return reserve;
  }
  function fitModal() {
    if (!editor) return;
    const reserve = bottomReserve();
    editor.modal.style.top = `calc(50% - ${reserve / 2}px)`;
    editor.modal.style.maxHeight = `calc(100% - ${reserve + 16}px)`;
  }

  function onEditorKey(e) {
    if (!editor || e.key !== 'Escape') return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (openPanel) closeOpenPanel(); else closeEditor();
  }

  function openEditor(charKey) {
    if (editor) closeEditor();
    const wrapper = document.querySelector(`[${CHAR_KEY_ATTR}="${CSS.escape(charKey)}"]`);
    const nameEl = wrapper && wrapper.querySelector('[class*="ItemPanel_itemName"] p');
    const title = nameEl ? nameEl.textContent.trim() : charKey.replace(/^char:/, '').replace(/#\d+$/, '');
    const bar = wrapper && wrapper.querySelector('[class*="ItemPanel_nameBar"]');

    const existing = state.characters[charKey];
    const draft = existing ? JSON.parse(JSON.stringify(existing)) : { activeBuild: null, builds: [] };
    if (!draft.builds.length) {
      const nb = blankBuild('Build 1');
      draft.builds.push(nb);
      draft.activeBuild = nb.id;
    }

    const root = el('div', 'gca-root');
    root.setAttribute('data-gca-root', charKey);
    const win = el('div', cls('gca-win', 'Window_window'));
    const modal = el('div', cls('gca-modal', 'Window_modal'));
    const head = el('div', cls('gca-title', 'Edit_itemName'), title);
    if (bar && bar.style.background) head.style.background = bar.style.background;
    const content = el('div', cls('gca-content', 'Edit_content'));
    const btns = el('div', cls('gca-btns', 'Edit_buttonWrapper'));
    btns.appendChild(colorButton('rgb(252, 68, 69)', '/images/general/cross.png', () => closeEditor(), 'cancel'));
    btns.appendChild(colorButton('rgb(20, 167, 108)', '/images/general/confirm.png', () => confirmEditor(), 'confirm'));
    modal.appendChild(head);
    modal.appendChild(content);
    modal.appendChild(btns);
    win.appendChild(modal);
    root.appendChild(win);
    document.body.appendChild(root);
    content.addEventListener('scroll', closeOpenPanel);
    window.addEventListener('keydown', onEditorKey, true);

    editor = { root, modal, content, draft, selId: draft.activeBuild, charKey, deleteArmed: false, deleteTimer: null };
    fitModal();
    window.addEventListener('resize', fitModal);
    editor.fitTimer = setInterval(fitModal, 1500); // ad bars can appear or close while open
    renderEditor();
  }

  function closeEditor() {
    if (!editor) return;
    closeOpenPanel();
    clearTimeout(editor.deleteTimer);
    clearInterval(editor.fitTimer);
    editor.root.remove();
    editor = null;
    window.removeEventListener('keydown', onEditorKey, true);
    window.removeEventListener('resize', fitModal);
  }

  function confirmEditor() {
    if (!editor) return;
    const { draft, charKey } = editor;
    draft.builds.forEach((b, i) => { b.name = (b.name || '').trim() || `Build ${i + 1}`; });
    const clean = sanitizeCharacter(draft);
    if (clean) state.characters[charKey] = clean;
    else delete state.characters[charKey];
    saveState();
    closeEditor();
    refreshPanel(charKey);
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

  switchToProfile(detectProfileKey());
  setInterval(() => {
    const key = detectProfileKey();
    if (key !== currentProfileKey) { switchToProfile(key); scheduleApply(); }
  }, 2000);

  const observer = new MutationObserver((mutations) => {
    if (Date.now() < suppressUntil) return;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches && (node.matches('[data-gc-art-panel]') || node.matches('.gca-root'))) continue;
        if (node.closest && (node.closest('[data-gc-art-panel]') || node.closest('.gca-root'))) continue;
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
  // Debug / integration handle
  // ============================================================
  window.__gcArtifacts = {
    version: '0.2.0',
    state: () => state,
    profiles: () => allData,
    profileKey: () => currentProfileKey,
    sets: () => ARTIFACT_SETS,
    open: (charKey) => openEditor(charKey),
    close: () => closeEditor(),
    activeBuild: (charKey) => activeBuildOf(state.characters[charKey]),
    reapply: () => scheduleApply()
  };

  console.log('[gc-artifacts] v0.2.0 loaded');
})();
