// ==UserScript==
// @name         Genshin Center - Toolkit
// @namespace    https://genshin-center.com/
// @version      1.1.0
// @description  All Genshin Center planner add-ons in one script, each switchable in "Script Options" (under "More Options" in the planner sidebar): Section Organizer (sections, second button row, scroll-wheel inventory, collapsible panels, order sync), Roster tables, Artifact Goals, Goal Presets, and an Adventure Rank 60 leyline-mora option. Replaces the four separate scripts; keeps all their saved data.
// @author       You
// @match        https://genshin-center.com/planner*
// @match        https://genshin-center.com/*/planner*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Azrane/tampermonkey-scripts/main/genshincenter.toolkit.user.js
// @downloadURL  https://raw.githubusercontent.com/Azrane/tampermonkey-scripts/main/genshincenter.toolkit.user.js
// ==/UserScript==

/*
 * Layout of this file
 *   1. Settings (what's on/off), stored in localStorage "gc-toolkit-settings-v1"
 *   2. Shared helpers
 *   3. Script Options panel + its link under "More Options"
 *   4. Small features that live in the core (AR 60 leyline mora)
 *   5. Old-script detection
 *   6. Modules (each was a separate script; same storage keys, so data carries over)
 *        moduleGoals, moduleRoster, moduleArtifacts, moduleSections
 *   7. Start-up: run each module whose switch is on
 *
 * Changes in the options panel apply after a reload (the Save button reloads).
 */

(function () {
  'use strict';

  const VERSION = '1.1.0';

  // ============================================================
  // 1. Settings
  // ============================================================
  const SETTINGS_KEY = 'gc-toolkit-settings-v1';

  // Every switch. `parent` greys an option out while its parent is off.
  // `choices` = [[value, label], ...]; plain on/off when omitted.
  const GROUPS = [
    { title: 'Section Organizer', options: [
      { key: 'sections', label: 'Sections', def: true,
        info: 'Group cards into named, colored, collapsible sections. Adds a section badge under each card name.' },
      { key: 'orderSync', label: 'Order sync tools', def: true, parent: 'sections',
        info: '"Sync order to planner" / "Undo order sync" in the ⚙ More menu: rewrites the site’s own card order to match your sections.' }
    ]},
    { title: 'Second button row', options: [
      { key: 'row', label: 'Second button row', def: true,
        info: 'An extra row of buttons under Add Character / Add Weapon / Manage Inventory / Manage Priority.' },
      { key: 'rowAddSection', label: '＋ Section button', def: true, parent: ['row', 'sections'] },
      { key: 'rowPauseAll', label: '⏸ Pause All / ▶ Resume All', def: true, parent: 'row' },
      { key: 'rowCollapse', label: '⊟ Collapse / ⊞ Expand', def: true, parent: ['row', 'sections'] },
      { key: 'rowRoster', label: '▤ Roster button', def: true, parent: 'roster',
        info: 'On the second row, or on the site’s own row when the second row is off.' }
    ]},
    { title: 'Inventory & panels', options: [
      { key: 'wheel', label: 'Scroll-wheel quantity editing', def: true,
        info: 'Mouse wheel over an inventory quantity box adds/subtracts 1 (Shift: 10).' },
      { key: 'wheelHover', label: 'Scroll-wheel works on', def: 'focus', parent: 'wheel',
        choices: [['focus', 'Clicked box'], ['hover', 'Hovered box']],
        info: '"Hovered box" edits without clicking first, but the page won’t scroll while the pointer is over a box.' },
      { key: 'panelCollapse', label: 'Collapsible Summary / Schedule', def: true,
        info: 'Click a Summary or Schedule heading to fold it away. Remembered between visits.' },
      { key: 'ar60', label: 'Adventure Rank 60', def: false,
        info: 'At AR 60, a ley line’s 100 Adventure EXP becomes 1,000 Mora. "Add mora leyline amount" then adds 61,000 instead of 60,000.' }
    ]},
    { title: 'Roster tables', options: [
      { key: 'roster', label: 'Roster tables', def: true,
        info: 'Sortable, filterable tables of every character and weapon on the planner.' },
      { key: 'rosterHotkey', label: 'Alt+R opens the roster', def: true, parent: 'roster' },
      { key: 'rosterDefaultTab', label: 'Opens on', def: 'characters', parent: 'roster',
        choices: [['characters', 'Characters'], ['weapons', 'Weapons']] },
      { key: 'rosterActiveOnly', label: 'Show by default', def: 'active', parent: 'roster',
        choices: [['active', 'Active only'], ['all', 'All']] },
      { key: 'rosterRowActions', label: '✎ Edit / ⇧ Ascend / ⏸ buttons in rows', def: true, parent: 'roster' },
      { key: 'rosterMatFilter', label: 'Material filter', def: true, parent: 'roster' },
      { key: 'rosterPanelView', label: '▦ Open as panels', def: true, parent: 'roster',
        info: 'Shows the filtered rows as real planner cards in a pop-up.' },
      { key: 'rosterWeekly', label: 'Weekly bosses tab', def: true, parent: 'roster' },
      { key: 'rosterWeeklyTips', label: 'Material tooltips on Weekly tab', def: true, parent: ['roster', 'rosterWeekly'] }
    ]},
    { title: 'Artifact Goals', options: [
      { key: 'artifacts', label: 'Artifact Goals', def: true,
        info: 'Named artifact builds per character (sets, main stats, substats), shown under each character card.' },
      { key: 'artCardChecks', label: 'Tick pieces done on the card', def: true, parent: 'artifacts' }
    ]},
    { title: 'Goal Presets', options: [
      { key: 'goalsMax', label: '⤒ Max Goals button', def: true,
        info: 'Active characters/weapons: Lv 90, talents 9/9/9. Button is on the second row.' },
      { key: 'goalsNext', label: '⇡ Next Goals button', def: true,
        info: 'Active characters/weapons: next ascension star, talents +1 (max 9). Button is on the second row.' }
    ]}
  ];
  const ALL_OPTIONS = GROUPS.flatMap(g => g.options);

  function loadSettings() {
    let raw = {};
    try { raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch (e) { raw = {}; }
    const s = {};
    for (const o of ALL_OPTIONS) {
      let v = raw[o.key];
      if (o.stored) { try { const x = localStorage.getItem(o.stored); if (x) v = x; } catch (e) { /* ignore */ } }
      if (o.choices) s[o.key] = o.choices.some(c => c[0] === v) ? v : o.def;
      else s[o.key] = typeof v === 'boolean' ? v : o.def;
    }
    return s;
  }
  function saveSettings(s) {
    const out = {};
    for (const o of ALL_OPTIONS) {
      if (o.stored) { try { localStorage.setItem(o.stored, s[o.key]); } catch (e) { /* ignore */ } continue; }
      out[o.key] = s[o.key];
    }
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(out)); } catch (e) { console.error('[gc-toolkit] save failed', e); }
  }
  function parentsOn(s, o) {
    const ps = o.parent ? (Array.isArray(o.parent) ? o.parent : [o.parent]) : [];
    return ps.every(p => s[p] === true || (typeof s[p] === 'string' && s[p] !== 'off'));
  }
  // Effective value: an option whose parent is off counts as off.
  function effective(s) {
    const e = {};
    for (const o of ALL_OPTIONS) e[o.key] = parentsOn(s, o) ? s[o.key] : (o.choices ? s[o.key] : false);
    return e;
  }

  const SETTINGS = loadSettings();
  const ON = effective(SETTINGS); // what this page load actually runs with

  // ============================================================
  // 2. Shared helpers
  // ============================================================
  // Resolve the site's hashed CSS-module class names at runtime
  // ("Radio_option" -> "Radio_option__6A9gc") so our UI uses its styles.
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
          while ((m = re.exec(r.selectorText))) if (!NATIVE[m[1]]) NATIVE[m[1]] = `${m[1]}__${m[2]}`;
        }
      };
      for (const ss of document.styleSheets) { try { visit(ss.cssRules); } catch (e) { /* cross-origin */ } }
    }
    return NATIVE[base] || '';
  }
  function cls(own, ...natives) { return [own, ...natives.map(nc)].filter(Boolean).join(' '); }

  // ============================================================
  // 3. Script Options panel
  // ============================================================
  const coreCss = `
    .gcm-root { position: fixed; inset: 0; z-index: 10000; font-family: Montserrat, Helvetica, Arial, sans-serif; color: #ccc; }
    .gcm-root * { box-sizing: border-box; }
    .gcm-root h3, .gcm-root h4, .gcm-root p { margin: 0; }
    .gcm-win { display: flex; position: fixed; inset: 0; justify-content: center; background-color: rgba(10,10,20,0.96); }
    .gcm-modal { position: fixed; top: 50%; transform: translateY(-50%); display: grid; grid-template-rows: auto 1fr auto;
      max-height: 95%; max-width: 96vw; background-color: #1e2231; border-radius: 5px; overflow: hidden; }
    .gcm-title { font-size: 30px; color: #ccc; text-align: center; padding: 10px; font-weight: 800; }
    .gcm-content { display: flex; flex-wrap: wrap; justify-content: center; align-content: flex-start; padding: 10px;
      width: min(1176px, 96vw); max-width: 1176px; overflow: auto; /* +20px: room for the scrollbar beside 3 cards */
      box-shadow: inset 0 89px 11px -90px rgba(0,0,0,0.75), inset 0 -89px 11px -90px rgba(0,0,0,0.75); }
    .gcm-group { width: 100%; text-align: center; color: #ffd780; font-size: 18px; font-weight: 600; margin: 12px 0 2px; }
    .gcm-group:first-child { margin-top: 0; }
    .gcm-section { display: flex; justify-content: center; background-color: #1e1e28; box-shadow: 0 0 4px rgba(0,0,0,0.8);
      border-radius: 5px; padding: 10px; width: 360px; max-width: 100%; margin: 8px; }
    .gcm-radio { display: flex; flex-direction: column; align-items: center; justify-content: space-between; width: 100%; min-width: 100px; height: 100%; transition: opacity 0.2s; }
    .gcm-radio.gcm-off { opacity: 0.4; }
    .gcm-label { font-weight: 600; text-align: center; margin-bottom: 5px; display: flex; align-items: center; justify-content: center; gap: 8px; }
    .gcm-info { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 100%;
      background: rgba(255,255,255,0.2); color: #1e2231; font-size: 11px; font-weight: 800; cursor: help; flex-shrink: 0; }
    .gcm-options { display: flex; isolation: isolate; width: 100%; background-color: rgba(0,0,0,0.4); border-radius: 5px; padding: 2px; border: 1px solid rgba(56,166,194,0.4); }
    .gcm-option { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; margin: auto;
      padding: 3px; cursor: pointer; font-weight: 600; font-size: 18px; text-align: center; background: none; border: none; font-family: inherit; }
    .gcm-selected { position: absolute; background-color: #38a6c2; top: 0; width: 100%; height: 100%; border-radius: 4px; z-index: -1; }
    .gcm-foot { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 10px; }
    .gcm-note { font-size: 13px; opacity: 0.7; text-align: center; }
    .gcm-note.gcm-changed { color: #ffd780; opacity: 1; }
    .gcm-save { position: relative; height: 44px; width: 200px; border: none; background: none; padding: 0; cursor: pointer; font-family: inherit; }
    .gcm-save-fallback { background: #ece5d8; color: #1e1e28; border-radius: 40px; font-weight: 700; font-size: 16px; }
    .gcm-warn { position: fixed; left: 50%; top: 8px; transform: translateX(-50%); z-index: 10001; max-width: min(640px, 94vw);
      background: #3a1e22; color: #ffd5d5; border: 1px solid rgba(255,120,120,0.6); border-radius: 6px; padding: 10px 36px 10px 14px;
      font: 600 13px Montserrat, sans-serif; box-shadow: 0 6px 18px rgba(0,0,0,0.5); }
    .gcm-warn button { position: absolute; right: 8px; top: 6px; background: none; border: none; color: #ffd5d5; font-size: 16px; cursor: pointer; }
    h4[data-gcm-link] { margin-top: 6px !important; }
  `;
  const coreStyle = document.createElement('style');
  coreStyle.textContent = coreCss;
  document.head.appendChild(coreStyle);

  let panel = null; // { root, draft }

  function radioWidget(o, draft, onPick) {
    const choices = o.choices || [[false, 'Off'], [true, 'On']];
    const wrap = document.createElement('div');
    wrap.className = cls('gcm-radio', 'Radio_radio') + (parentsOn(draft, o) ? '' : ' gcm-off');
    wrap.setAttribute('data-gcm-opt', o.key);
    const label = document.createElement('div');
    label.className = cls('gcm-label', 'Radio_radioLabel');
    label.appendChild(document.createTextNode(o.label));
    if (o.info) {
      const i = document.createElement('span');
      i.className = 'gcm-info';
      i.textContent = 'i';
      i.title = o.info;
      label.appendChild(i);
    }
    wrap.appendChild(label);
    const opts = document.createElement('div');
    opts.className = cls('gcm-options', 'Radio_options');
    for (const [val, text] of choices) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls('gcm-option', 'Radio_option');
      b.style.width = `${100 / choices.length}%`;
      const on = draft[o.key] === val;
      b.style.color = on ? 'rgb(0, 0, 0)' : 'rgb(204, 204, 204)';
      b.setAttribute('data-gcm-val', String(val));
      if (on) {
        const sel = document.createElement('div');
        sel.className = cls('gcm-selected', 'Radio_selected');
        b.appendChild(sel);
      }
      b.appendChild(document.createTextNode(text));
      b.addEventListener('click', () => onPick(val));
      opts.appendChild(b);
    }
    wrap.appendChild(opts);
    return wrap;
  }

  function renderPanel() {
    if (!panel) return;
    const { content, draft, note } = panel;
    const scroll = content.scrollTop;
    content.innerHTML = '';
    for (const g of GROUPS) {
      const h = document.createElement('h3');
      h.className = 'gcm-group';
      h.textContent = g.title;
      content.appendChild(h);
      for (const o of g.options) {
        const sec = document.createElement('div');
        sec.className = cls('gcm-section', 'PlannerOptions_section');
        sec.appendChild(radioWidget(o, draft, (v) => { draft[o.key] = v; renderPanel(); }));
        content.appendChild(sec);
      }
    }
    content.scrollTop = scroll;
    const changed = ALL_OPTIONS.some(o => draft[o.key] !== SETTINGS[o.key]);
    note.textContent = changed ? 'Unsaved changes — Save reloads the page to apply them.'
      : `Toolkit v${VERSION} · changes apply after the page reloads`;
    note.classList.toggle('gcm-changed', changed);
  }

  function makeSaveButton(onClick) {
    // Copy the site's own RectButton (the one under "Save" in More Options).
    const proto = document.querySelector('[class*="Farm_centeredRectButtons"] [class*="RectButton_button"]');
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('data-gcm-save', '1');
    if (proto) {
      b.className = proto.className;
      for (const part of ['RectButton_inner', 'RectButton_border', 'RectButton_label']) {
        const src = proto.querySelector(`[class*="${part}"]`);
        if (!src) continue;
        const d = document.createElement('div');
        d.className = src.className;
        if (part === 'RectButton_label') d.textContent = 'Save';
        b.appendChild(d);
      }
    } else {
      b.className = 'gcm-save gcm-save-fallback';
      b.textContent = 'Save';
    }
    b.addEventListener('click', onClick);
    return b;
  }

  // The site's ad bars are fixed to the bottom at z-index 99999 and would
  // cover the Save button; keep the window above them.
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
  function fitPanel() {
    if (!panel) return;
    // Ad bars animate in and change height; keep the largest seen while open
    // so the Save button never ends up underneath.
    const reserve = panel.reserve = Math.max(panel.reserve || 0, bottomReserve());
    panel.modal.style.top = `calc(50% - ${reserve / 2}px)`;
    panel.modal.style.maxHeight = `calc(100% - ${reserve + 16}px)`;
  }

  function onPanelKey(e) {
    if (panel && e.key === 'Escape') { e.stopImmediatePropagation(); closePanel(); }
  }

  function openPanel() {
    if (panel) return;
    const root = document.createElement('div');
    root.className = 'gcm-root';
    root.setAttribute('data-gcm-panel', '1');
    const win = document.createElement('div');
    win.className = cls('gcm-win', 'Window_window');
    const modal = document.createElement('div');
    modal.className = cls('gcm-modal', 'Window_modal');
    const title = document.createElement('h3');
    title.className = cls('gcm-title', 'PlannerOptions_windowTitle');
    title.textContent = 'Script Options';
    const content = document.createElement('div');
    content.className = cls('gcm-content', 'PlannerOptions_content');
    const foot = document.createElement('div');
    foot.className = cls('gcm-foot', 'PlannerOptions_buttonWrapper');
    foot.style.flexDirection = 'column';
    foot.style.alignItems = 'center';
    const note = document.createElement('p');
    note.className = 'gcm-note';
    foot.appendChild(note);
    foot.appendChild(makeSaveButton(() => {
      const changed = ALL_OPTIONS.some(o => panel.draft[o.key] !== SETTINGS[o.key]);
      saveSettings(panel.draft);
      closePanel();
      if (changed) location.reload();
    }));
    modal.appendChild(title);
    modal.appendChild(content);
    modal.appendChild(foot);
    win.appendChild(modal);
    root.appendChild(win);
    // Clicking the dark backdrop closes without saving, like the site's dialogs.
    win.addEventListener('mousedown', (e) => { if (e.target === win) closePanel(); });
    document.body.appendChild(root);
    window.addEventListener('keydown', onPanelKey, true);
    panel = { root, modal, content, note, draft: Object.assign({}, SETTINGS) };
    fitPanel();
    window.addEventListener('resize', fitPanel);
    panel.fitTimer = setInterval(fitPanel, 500); // ad bars can appear or grow while open
    renderPanel();
  }
  function closePanel() {
    if (!panel) return;
    clearInterval(panel.fitTimer);
    panel.root.remove();
    panel = null;
    window.removeEventListener('keydown', onPanelKey, true);
    window.removeEventListener('resize', fitPanel);
  }

  // "Script Options" link right under the site's "More Options" link.
  function ensureOptionsLink() {
    for (const h of document.querySelectorAll('h4')) {
      if (h.hasAttribute('data-gcm-link')) continue;
      const parent = h.parentElement;
      if (!parent || !String(parent.className).includes('PlannerOptions_optionContent')) continue;
      if (parent.querySelector(':scope > h4[data-gcm-link]')) continue;
      const link = document.createElement('h4');
      link.setAttribute('data-gcm-link', '1');
      link.textContent = 'Script Options';
      link.addEventListener('click', (e) => { e.stopPropagation(); openPanel(); });
      h.insertAdjacentElement('afterend', link);
    }
  }
  setInterval(ensureOptionsLink, 1000);
  setTimeout(ensureOptionsLink, 300);

  // ============================================================
  // 4. AR 60 leyline mora
  // ============================================================
  // The site's "Add mora leyline amount" button (in the Mora dialog) sets the
  // Mora box to box + leyline amount. At AR 60 a ley line's 100 Adventure EXP
  // is paid out as 1,000 Mora instead, so add 1,000 more - but only after
  // confirming the site's own click did add its amount (so a changed site
  // can't make us add 1,000 to the wrong thing).
  const AR60_BONUS = 1000;
  const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  function moraInput(dialog) { return dialog && dialog.querySelector('input[name="10000"]'); }
  function readNum(input) { const n = parseInt(String(input.value).replace(/[^\d-]/g, ''), 10); return isNaN(n) ? 0 : n; }
  if (ON.ar60) {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('button');
      const dialog = btn && btn.closest('#dynamicinventory');
      if (!dialog || !String(btn.className).includes('AltRectButton')) return;
      const input = moraInput(dialog);
      if (!input) return;
      const before = readNum(input);
      setTimeout(() => {
        const now = moraInput(dialog);
        if (!now) return;
        const after = readNum(now);
        if (after - before < 10000) return; // site didn't add a leyline amount
        setInputValue.call(now, String(after + AR60_BONUS));
        now.dispatchEvent(new Event('input', { bubbles: true }));
      }, 0);
    }, true);
  }

  // ============================================================
  // 5. Old-script detection
  // ============================================================
  // The four separate scripts each expose a window.__gc* handle. Ours carry
  // __fromToolkit; anything else means an old script is still running.
  const HANDLES = { __gcSections: 'Section Organizer', __gcRoster: 'Roster Tables',
    __gcArtifacts: 'Artifact Goals', __gcGoals: 'Goal Presets' };
  const preexisting = Object.keys(HANDLES).filter(k => window[k]);
  function checkOldScripts() {
    const old = Object.keys(HANDLES).filter(k => preexisting.includes(k) || (window[k] && !window[k].__fromToolkit));
    if (!old.length || document.querySelector('.gcm-warn')) return;
    const box = document.createElement('div');
    box.className = 'gcm-warn';
    box.textContent = `The separate ${old.map(k => HANDLES[k]).join(', ')} script${old.length > 1 ? 's are' : ' is'} still enabled in Tampermonkey. ` +
      'Toolkit already includes ' + (old.length > 1 ? 'them' : 'it') + ' — disable the old one' + (old.length > 1 ? 's' : '') +
      ' (your data is shared, nothing is lost) and reload.';
    const x = document.createElement('button');
    x.textContent = '✕';
    x.title = 'Dismiss';
    x.addEventListener('click', () => box.remove());
    box.appendChild(x);
    document.body.appendChild(box);
    console.warn('[gc-toolkit] old scripts still running:', old.map(k => HANDLES[k]).join(', '));
  }
  setTimeout(checkOldScripts, 4000);
  setTimeout(checkOldScripts, 12000);

  function tag(obj) { if (obj) Object.defineProperty(obj, '__fromToolkit', { value: true }); return obj; }

  // ============================================================
  // 6. Module: Goal Presets
  //    (was genshincenter.goalpresets.user.js 1.0.0; same storage keys)
  // ============================================================
  function moduleGoals(S) {

  // Level caps per ascension phase: phase A ends at CAPS[A] (A = 0..6).
  const CAPS = [20, 40, 50, 60, 70, 80, 90];
  const TALENT_GOAL = 9;           // 1-indexed; never set a talent goal above this
  const UNDO_KEY = 'gc-goal-presets-undo-v1';

  // ============================================================
  // Reaching the planner's state
  // ============================================================
  // Walk the COMMITTED fiber tree from the root container: a DOM node's own
  // fiber link can point at the stale double-buffer copy.
  function findHub() {
    const cands = [document.getElementById('__next'), ...Array.from(document.body.children)];
    for (const c of cands) {
      if (!c) continue;
      for (const k in c) {
        if (!k.startsWith('__reactContainer$')) continue;
        const f0 = c[k];
        const root = (f0 && f0.stateNode && f0.stateNode.current) || f0;
        const stack = [root];
        let steps = 0;
        while (stack.length && steps < 400000) {
          const f = stack.pop(); steps++;
          const p = f.memoizedProps;
          if (p && typeof p === 'object' && Array.isArray(p.selection) &&
              typeof p.setSelection === 'function' && p.itemList) return p;
          if (f.sibling) stack.push(f.sibling);
          if (f.child) stack.push(f.child);
        }
      }
    }
    return null;
  }

  function namespaces() {
    try {
      const pp = window.__NEXT_DATA__ ? window.__NEXT_DATA__.props.pageProps
        : JSON.parse(document.getElementById('__NEXT_DATA__').textContent).props.pageProps;
      return (pp && pp.__namespaces) || {};
    } catch (e) { return {}; }
  }

  // Everything we need about one selection entry, or null if it can't be read
  // (then it's left alone).
  function describe(hub, entry, ns) {
    if (!entry || typeof entry !== 'object' || !entry.data) return null;
    const isWeapon = entry.type === 1;
    if (entry.type !== 0 && entry.type !== 1) return null;
    let cur, stars, name;
    if (entry.custom) {
      cur = entry.current && entry.current.data;
      stars = entry.item && entry.item.stars;
      name = (entry.item && entry.item.name) || 'Custom';
    } else {
      cur = hub.itemList && hub.itemList[entry.id] && hub.itemList[entry.id].data;
      const db = isWeapon ? hub.weapons : hub.characters;
      const it = db && db[entry.itemId];
      stars = it && it.stars;
      const dict = (isWeapon ? ns.weapons : ns.characters) || {};
      name = (it && dict[it.name]) || (it && it.img) || `#${entry.itemId}`;
    }
    if (!cur || typeof cur.level !== 'number' || typeof cur.ascension !== 'number') return null;
    // 1★/2★ weapons stop at 70 (ascension 4). None are on the site today, but
    // an impossible goal would make the planner ask for materials that don't exist.
    const maxAsc = isWeapon && typeof stars === 'number' && stars <= 2 ? 4 : 6;
    return { entry, isWeapon, cur, name, stars, maxAsc, paused: !!entry.data.paused };
  }

  // ============================================================
  // The two presets (all values 0-indexed like the planner)
  // ============================================================
  function maxGoal(d) {
    const g = { level: CAPS[d.maxAsc] - 1, ascension: d.maxAsc };
    g.level = Math.max(g.level, d.cur.level);              // never below current
    g.ascension = Math.max(g.ascension, d.cur.ascension);
    if (!d.isWeapon) {
      const ct = Array.isArray(d.cur.talents) ? d.cur.talents : [0, 0, 0];
      g.talents = [0, 1, 2].map(i => Math.max(TALENT_GOAL - 1, ct[i] || 0));
    }
    return g;
  }

  // One ascension star past where the entry is now: phase A ends at CAPS[A],
  // so the goal is "level CAPS[A], ascended" = ascension A+1. Already fully
  // ascended -> the max level. Talents: one level up, but a talent at 9 or 10
  // stays where it is (never a goal of 10, never a goal below current).
  function nextGoal(d) {
    const A = Math.max(0, Math.min(d.cur.ascension, d.maxAsc));
    const g = A >= d.maxAsc
      ? { level: CAPS[d.maxAsc] - 1, ascension: d.maxAsc }
      : { level: CAPS[A] - 1, ascension: A + 1 };
    g.level = Math.max(g.level, d.cur.level);
    g.ascension = Math.max(g.ascension, d.cur.ascension);
    if (!d.isWeapon) {
      const ct = Array.isArray(d.cur.talents) ? d.cur.talents : [0, 0, 0];
      g.talents = [0, 1, 2].map(i => {
        const t = ct[i] || 0;
        return t >= TALENT_GOAL - 1 ? t : t + 1;
      });
    }
    return g;
  }

  // ============================================================
  // Display helpers
  // ============================================================
  const ASC_AT = { 20: 1, 40: 2, 50: 3, 60: 4, 70: 5, 80: 6 };
  function fmtLevel(level0, asc) {
    const lv = level0 + 1;
    return `${lv}${typeof ASC_AT[lv] === 'number' && asc >= ASC_AT[lv] ? '★' : ''}`;
  }
  function fmtGoal(data, isWeapon) {
    let s = `Lv ${fmtLevel(data.level, data.ascension)}`;
    if (!isWeapon && Array.isArray(data.talents)) s += ` · ${data.talents.map(t => t + 1).join('/')}`;
    return s;
  }
  function sameGoal(data, g) {
    if (data.level !== g.level || data.ascension !== g.ascension) return false;
    if (!g.talents) return true;
    return Array.isArray(data.talents) && g.talents.every((t, i) => data.talents[i] === t);
  }

  // Identity of an entry that survives reordering (for Undo).
  function identity(entry, seen) {
    const base = entry.custom ? `c:${entry.item && entry.item.name}` : `t${entry.type}:${entry.id}`;
    seen[base] = (seen[base] || 0) + 1;
    return seen[base] === 1 ? base : `${base}#${seen[base]}`;
  }

  // ============================================================
  // Plan, confirm, apply
  // ============================================================
  function plan(kind) {
    const hub = findHub();
    if (!hub) return { error: 'Could not reach the planner’s data. The site may have changed; nothing was done.' };
    const ns = namespaces();
    const changes = [];
    let paused = 0, unreadable = 0, unchanged = 0;
    const seen = {};
    hub.selection.forEach((entry, i) => {
      const id = identity(entry, seen);
      const d = describe(hub, entry, ns);
      if (!d) { unreadable++; return; }
      if (d.paused) { paused++; return; }
      const g = kind === 'max' ? maxGoal(d) : nextGoal(d);
      if (sameGoal(entry.data, g)) { unchanged++; return; }
      changes.push({ index: i, id, name: d.name, isWeapon: d.isWeapon, before: {
        level: entry.data.level, ascension: entry.data.ascension,
        talents: Array.isArray(entry.data.talents) ? entry.data.talents.slice() : undefined
      }, after: g });
    });
    return { hub, changes, paused, unreadable, unchanged, total: hub.selection.length };
  }

  function summary(p, title) {
    const lines = p.changes.slice(0, 14).map(c =>
      `${c.name}: ${fmtGoal(c.before, c.isWeapon)}  →  ${fmtGoal(c.after, c.isWeapon)}`);
    if (p.changes.length > 14) lines.push(`…and ${p.changes.length - 14} more`);
    const notes = [];
    if (p.unchanged) notes.push(`${p.unchanged} already set`);
    if (p.paused) notes.push(`${p.paused} paused (skipped)`);
    if (p.unreadable) notes.push(`${p.unreadable} unreadable (skipped)`);
    return `${title}\nChange goals on ${p.changes.length} active entr${p.changes.length === 1 ? 'y' : 'ies'}?\n\n` +
      lines.join('\n') + (notes.length ? `\n\n${notes.join(' · ')}` : '') +
      '\n\nYou can undo this from ⚙ More → Undo goal change.';
  }

  function deepCopy(x) { return JSON.parse(JSON.stringify(x)); }

  // Apply goal fields by index, then verify the result differs from the
  // original ONLY in those fields before saving.
  function commit(hub, edits) {
    const before = hub.selection;
    const next = deepCopy(before);
    if (next.length !== before.length) return 'copy length mismatch';
    for (const e of edits) {
      const t = next[e.index];
      if (!t || !t.data) return 'entry missing';
      t.data.level = e.goal.level;
      t.data.ascension = e.goal.ascension;
      if (e.goal.talents) t.data.talents = e.goal.talents.slice();
    }
    // Integrity check: strip the goal fields and the rest must be identical.
    const strip = (arr) => JSON.stringify(arr.map(en => {
      const c = deepCopy(en);
      if (c.data) { delete c.data.level; delete c.data.ascension; delete c.data.talents; }
      return c;
    }));
    if (strip(next) !== strip(before)) return 'integrity check failed';
    hub.setSelection(next);
    return null;
  }

  function run(kind) {
    const title = kind === 'max' ? '⤒ Max Goals (Lv 90, talents 9/9/9)' : '⇡ Next Goals (next ascension star, talents +1)';
    const p = plan(kind);
    if (p.error) { alert(p.error); return; }
    if (!p.changes.length) {
      alert(`${title}\n\nNothing to change: every active entry already has these goals.` +
        (p.paused ? `\n(${p.paused} paused entr${p.paused === 1 ? 'y' : 'ies'} skipped.)` : ''));
      return;
    }
    if (!confirm(summary(p, title))) return;

    // Re-read right before writing, in case the planner changed while the
    // dialog was open, and only proceed if the plan is still the same.
    const again = plan(kind);
    if (again.error || again.total !== p.total || again.changes.length !== p.changes.length ||
        again.changes.some((c, i) => c.id !== p.changes[i].id)) {
      alert('The planner changed while the dialog was open. Nothing was done; please try again.');
      return;
    }
    const undo = { kind, at: Date.now(), total: again.total,
      entries: again.changes.map(c => ({ id: c.id, before: c.before, after: c.after })) };
    const err = commit(again.hub, again.changes.map(c => ({ index: c.index, goal: c.after })));
    if (err) { alert(`Aborted — ${err}. Nothing was changed.`); return; }
    try { localStorage.setItem(UNDO_KEY, JSON.stringify(undo)); } catch (e) { /* storage blocked */ }
    console.log(`[gc-goals] ${kind}: changed ${again.changes.length} entr${again.changes.length === 1 ? 'y' : 'ies'}`);
  }

  function savedUndo() {
    try {
      const u = JSON.parse(localStorage.getItem(UNDO_KEY) || 'null');
      return u && Array.isArray(u.entries) && u.entries.length ? u : null;
    } catch (e) { return null; }
  }

  // Undo matches entries by identity, not position, so reordering since the
  // change (e.g. Sync order) doesn't matter. An entry whose goal was edited
  // since is left alone rather than overwritten.
  function undo() {
    const u = savedUndo();
    if (!u) { alert('No goal change to undo.'); return; }
    const hub = findHub();
    if (!hub) { alert('Could not reach the planner’s data. Nothing was done.'); return; }
    const seen = {};
    const byId = new Map();
    hub.selection.forEach((entry, i) => byId.set(identity(entry, seen), i));
    const edits = [];
    let missing = 0, edited = 0;
    for (const e of u.entries) {
      const i = byId.get(e.id);
      if (i === undefined) { missing++; continue; }
      const data = hub.selection[i].data;
      if (!sameGoal(data, e.after)) { edited++; continue; }
      const goal = { level: e.before.level, ascension: e.before.ascension };
      if (Array.isArray(e.before.talents)) goal.talents = e.before.talents;
      edits.push({ index: i, goal });
    }
    if (!edits.length) {
      alert('Nothing to undo: those entries were removed or their goals were edited since.');
      return;
    }
    const label = u.kind === 'max' ? 'Max Goals' : 'Next Goals';
    const skipped = [];
    if (edited) skipped.push(`${edited} edited since (left as is)`);
    if (missing) skipped.push(`${missing} no longer on the planner`);
    if (!confirm(`Undo the last ${label} change?\nRestores the previous goals on ${edits.length} entr${edits.length === 1 ? 'y' : 'ies'}.` +
      (skipped.length ? `\n\n${skipped.join(' · ')}` : ''))) return;
    const err = commit(hub, edits);
    if (err) { alert(`Aborted — ${err}. Nothing was changed.`); return; }
    try { localStorage.removeItem(UNDO_KEY); } catch (e) { /* storage blocked */ }
  }

  // ============================================================
  // Integration: Section Organizer puts these on its second row and
  // its ⚙ More menu when it finds this object.
  // ============================================================
  window.__gcGoals = tag({
    version: '1.0.0',
    showMax: !!S.goalsMax,
    showNext: !!S.goalsNext,
    max: () => run('max'),
    next: () => run('next'),
    undo,
    canUndo: () => !!savedUndo(),
    preview: (kind) => {           // for debugging in the console
      const p = plan(kind === 'max' ? 'max' : 'next');
      return p.error ? p.error : p.changes.map(c =>
        `${c.name}: ${fmtGoal(c.before, c.isWeapon)} -> ${fmtGoal(c.after, c.isWeapon)}`);
    }
  });

  console.log('[gc-goals] module ready');
  }

  // ============================================================
  // 6. Module: Roster tables
  //    (was genshincenter.roster.user.js 2.8.0; same storage keys)
  // ============================================================
  function moduleRoster(S) {

  // ============================================================
  // User config
  // ============================================================
  // Keyboard shortcut to open/close (set HOTKEY to null to disable).
  const HOTKEY = S.rosterHotkey ? { key: 'r', alt: true, ctrl: false, shift: false } : null;

  // Tab shown when the popup opens: 'characters' or 'weapons'
  const DEFAULT_TAB = S.rosterDefaultTab === 'weapons' ? 'weapons' : 'characters';

  // Hide paused entries by default.
  const DEFAULT_ACTIVE_ONLY = S.rosterActiveOnly !== 'all';

  // ============================================================
  // Constants
  // ============================================================
  const ELEMENTS = ['pyro', 'hydro', 'electro', 'cryo', 'anemo', 'geo', 'dendro'];
  const WEAPON_TYPES = ['sword', 'claymore', 'polearm', 'bow', 'catalyst'];
  // Rarity chips are derived from the live roster per tab (see render), not a
  // fixed list — characters are 4-5★, weapons 1-5★.
  const STATUSES = ['active', 'paused'];
  const OWNERSHIP = ['owned', 'planned'];

  const ELEMENT_COLORS = {
    pyro: '#ef7a35', hydro: '#4cc2f1', electro: '#b08fdb', cryo: '#8fd8e8',
    anemo: '#74c2a8', geo: '#f5b64c', dendro: '#a5c83b', none: '#9aa0a6'
  };
  const RARITY_COLORS = { 5: '#e0a44a', 4: '#a97fd0', 3: '#5b93c4', 2: '#5ca87a', 1: '#8c8c8c' };
  const STATUS_COLORS = { active: '#7ddc7d', paused: '#b9b3a6' };
  const OWNERSHIP_COLORS = { owned: '#7ddc7d', planned: '#8fb4e8' };

  // Site day numbering: 0 = Sunday ... 6 = Saturday (Sunday = all domains)
  const DAY_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const FILTER_DAYS = [1, 2, 3, 4, 5, 6]; // Mon..Sat (Sunday matches everything)

  function titleCase(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

  // ============================================================
  // Static character/weapon database from the page payload (fallback only)
  // ============================================================
  let STATIC_DB = null;
  function buildStaticDb() {
    if (STATIC_DB) return STATIC_DB;
    let payload = null;
    try {
      if (window.__NEXT_DATA__) payload = window.__NEXT_DATA__;
      else {
        const tag = document.getElementById('__NEXT_DATA__');
        if (tag) payload = JSON.parse(tag.textContent);
      }
    } catch (e) { /* fall through */ }
    const chars = {}, weapons = {};
    try {
      const pp = payload && payload.props && payload.props.pageProps;
      if (pp && pp.characters) {
        for (const id of Object.keys(pp.characters)) {
          const c = pp.characters[id];
          if (c && c.img) chars[c.img] = {
            element: c.element || '', weapon: c.weapon || '', stars: c.stars || 0,
            mats: Array.isArray(c.mats) ? c.mats : []
          };
        }
      }
      if (pp && pp.weapons) {
        for (const id of Object.keys(pp.weapons)) {
          const w = pp.weapons[id];
          if (w && w.img) weapons[w.img] = {
            type: w.type || '', stars: w.stars || 0,
            mats: Array.isArray(w.mats) ? w.mats : []
          };
        }
      }
    } catch (e) { /* fall through */ }
    STATIC_DB = { chars, weapons };
    return STATIC_DB;
  }

  // ============================================================
  // Material family index — powers the searchable material filter
  // ============================================================
  // Every material carries `family` (e.g. 13109 = the "Light" talent-book
  // family, spanning Teachings/Guide/Philosophies) and a `subcategory` that
  // is already the family label. So tiered materials (talent books, weapon
  // ascension mats, gems, common drops) collapse by `family` with no name
  // parsing. Local specialties and boss/weekly mats all share unhelpful
  // family ids, so those stay individual, keyed by their own id + name.
  //
  // Each "group" is one pickable entity. A character/weapon matches a group
  // if any id in its `mats` array belongs to that group.
  const GROUPED_CATEGORIES = new Set(['domains', 'world', 'gem']);
  let MAT_INDEX = null; // { idToGroup: Map(matId->key), groups: Map(key->{key,label,category,memberIds:Set}) }

  function pagePropsBag() {
    try {
      if (window.__NEXT_DATA__) return window.__NEXT_DATA__.props.pageProps;
      const tag = document.getElementById('__NEXT_DATA__');
      if (tag) return JSON.parse(tag.textContent).props.pageProps;
    } catch (e) { /* ignore */ }
    return null;
  }
  function materialNamesTable() {
    const pp = pagePropsBag();
    return (pp && pp.__namespaces && pp.__namespaces.materials) || {};
  }

  function buildMaterialIndex() {
    if (MAT_INDEX) return MAT_INDEX;
    const idToGroup = new Map();
    const groups = new Map();
    const pp = pagePropsBag();
    const mats = (pp && pp.materials) || {};
    const names = materialNamesTable();
    for (const idStr of Object.keys(mats)) {
      const m = mats[idStr];
      if (!m || m.category === 'misc') continue; // skip Mora / EXP books
      let key, label;
      if (GROUPED_CATEGORIES.has(m.category)) {
        key = 'fam:' + m.family;
        // subcategory is the family label ("Light", "Decarabian", "Pyro Gems")
        // for grouped categories; guard against the numeric-hash form.
        label = (typeof m.subcategory === 'string' && m.subcategory)
          ? m.subcategory
          : (names[m.name] || m.img);
      } else {
        key = 'mat:' + m.id;
        label = names[m.name] || m.img;
      }
      idToGroup.set(m.id, key);
      let g = groups.get(key);
      if (!g) { g = { key, label, category: m.category, memberIds: new Set() }; groups.set(key, g); }
      g.memberIds.add(m.id);
    }
    MAT_INDEX = { idToGroup, groups };
    return MAT_INDEX;
  }

  // The set of group keys a row's mats belong to.
  function matGroupsOf(matIds) {
    const idx = buildMaterialIndex();
    const out = new Set();
    if (Array.isArray(matIds)) {
      for (const id of matIds) {
        const k = idx.idToGroup.get(id);
        if (k) out.add(k);
      }
    }
    return out;
  }

  // ============================================================
  // React fiber access — the planner's own item state
  // ============================================================
  // Each card is rendered by a component whose props look like:
  //   { type, item:{img,element,weapon,type,stars},
  //     current:{level,talents[],ascension,constellation,obtained,...},
  //     desired:{level,talents[],ascension,paused,...},
  //     paused, materials[], acquiredMaterials[], domainDays[] }
  // NOTE: level and talents are stored 0-indexed (level 79 renders as "80"),
  // so displayed = stored + 1. Constellation is NOT offset (C0 === 0).
  // Refinement is probed at runtime — see readRefinement().
  let fiberOk = null;
  let refineFieldReport = null;

  function getFiber(el) {
    for (const k in el) {
      if (k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')) return el[k];
    }
    return null;
  }

  // ---- Reading the LIVE copy of a card's props ----
  // React keeps two copies of every component (current + alternate) and swaps
  // them on each update. The `__reactFiber$` link on a DOM node is set when
  // the node is created and is NOT always moved to the live copy afterwards,
  // so walking up from a card can land in the outdated tree. Confirmed on the
  // live site: after editing a card in the panel view, the card showed Lv 6
  // while the node's link still read Lv 5 / C1 (the other copy had Lv 6 / C2).
  //
  // The root is reliable: the container's HostRoot fiber has stateNode =
  // FiberRoot, and FiberRoot.current is always the live tree. So we walk DOWN
  // the live tree once and map each card's wrapper element to its props.
  function isItemProps(p) {
    return !!(p && typeof p === 'object' && p.item && p.current &&
              typeof p.current === 'object' && typeof p.current.level === 'number');
  }

  function liveRootFiber() {
    const c = reactRootContainer();
    for (const k in c) {
      if (k.startsWith('__reactContainer$')) {
        const f = c[k];
        return (f && f.stateNode && f.stateNode.current) || f || null;
      }
    }
    return null;
  }

  let LIVE_PROPS = { map: null, at: 0 };
  // Rebuild the wrapper -> props map. Entry points (scrapeAll etc.) call this
  // so one walk serves every card they read; findItemProps reuses it.
  function refreshLiveProps() {
    const map = new Map();
    const root = liveRootFiber();
    if (root) {
      const stack = [[root, null]];
      let steps = 0;
      while (stack.length && steps < 400000) {
        const [f, inherited] = stack.pop();
        steps++;
        const own = isItemProps(f.memoizedProps) ? f.memoizedProps : inherited;
        const node = f.stateNode;
        if (own && typeof f.type === 'string' && node && node.nodeType === 1 &&
            String(node.className).includes('ItemPanel_itemWrapper')) {
          map.set(node, own);
        }
        if (f.sibling) stack.push([f.sibling, inherited]);
        if (f.child) stack.push([f.child, own]);
      }
    }
    LIVE_PROPS = { map, at: Date.now() };
    return map;
  }

  // Previous method: walk up from the node's own link. Kept only as a fallback
  // (e.g. if the root can't be found), and it now prefers whichever of the two
  // copies belongs to the live tree.
  function findItemPropsByWalk(el) {
    const start = getFiber(el);
    if (!start) return null;
    const walk = (node) => {
      let depth = 0;
      while (node && depth < 30) {
        if (isItemProps(node.memoizedProps)) return node.memoizedProps;
        node = node.return;
        depth++;
      }
      return null;
    };
    let top = start;
    while (top.return) top = top.return;
    const live = !!(top.stateNode && top.stateNode.current === top);
    return walk(live || !start.alternate ? start : start.alternate) || walk(start);
  }

  function findItemProps(el) {
    if (!LIVE_PROPS.map || Date.now() - LIVE_PROPS.at > 1000) refreshLiveProps();
    return LIVE_PROPS.map.get(el) || findItemPropsByWalk(el);
  }

  // Refinement field name is unconfirmed for weapons; probe likely keys and
  // report once so it can be pinned down if the guess is wrong.
  const REFINE_KEYS = ['refinement', 'refine', 'refinementLevel', 'refinements', 'rank'];
  function readRefinement(props) {
    const buckets = [props.current, props.desired, props];
    for (const bucket of buckets) {
      if (!bucket || typeof bucket !== 'object') continue;
      for (const k of REFINE_KEYS) {
        if (typeof bucket[k] === 'number') {
          if (!refineFieldReport) {
            refineFieldReport = k;
            console.log(`[gc-roster] weapon refinement read from "${k}" (raw value ${bucket[k]})`);
          }
          // Genshin refinements are R1-R5. If stored 0-indexed we'd see 0..4.
          // Display raw+1 when the value looks 0-indexed, else raw.
          return bucket[k] >= 1 && bucket[k] <= 5 ? bucket[k] : bucket[k] + 1;
        }
      }
    }
    if (refineFieldReport === null) {
      refineFieldReport = false;
      console.log('[gc-roster] no refinement field found on weapon props; Refine column will show —.' +
        ' Run __gcRoster.dumpWeaponProps() and share the output to add it.');
    }
    return null;
  }

  // React 17+ attaches ONE delegated listener to the root container, not to
  // individual elements. Anything we mount outside that container never
  // routes events through it, so borrowed cards would appear dead. Mount
  // inside it and normal bubbling reaches React again.
  function reactRootContainer() {
    const byId = document.getElementById('__next');
    const candidates = [byId, ...Array.from(document.body.children)];
    for (const el of candidates) {
      if (!el) continue;
      for (const k in el) if (k.startsWith('__reactContainer$')) return el;
    }
    return byId || document.body;
  }

  // Stable identity for a card: its slot in the planner's selection array.
  // Name-based keys renumber when duplicates get hidden, which silently
  // broke repeat pause/resume from the table.
  function findWrapperBySelIndex(idx) {
    if (typeof idx !== 'number') return null;
    const list = document.querySelector('[class*="Farm_itemList"]');
    if (!list) return null;
    refreshLiveProps();
    for (const w of list.querySelectorAll('[class*="ItemPanel_itemWrapper"]')) {
      const p = findItemProps(w);
      if (p && p.index === idx) return w;
    }
    return null;
  }

  const ASC_AT_LEVEL = { 20: 1, 40: 2, 50: 3, 60: 4, 70: 5, 80: 6 };
  function isAscendedAt(level, ascension) {
    const need = ASC_AT_LEVEL[level];
    return typeof need === 'number' && typeof ascension === 'number' && ascension >= need;
  }

  function pairFromFiber(curr, des, currAsc) {
    const c = typeof curr === 'number' ? curr + 1 : null;
    const d = typeof des === 'number' ? des + 1 : null;
    return { current: c, target: d, ascended: isAscendedAt(c, currAsc) };
  }

  // Material completion across the entry's requirement list.
  // acquiredMaterials[i] = [owned, craftable]; materials[i].amount = needed.
  function matProgress(props) {
    const mats = props.materials, acq = props.acquiredMaterials;
    if (!Array.isArray(mats) || mats.length === 0) return null;
    let need = 0, have = 0, done = 0, counted = 0;
    for (let i = 0; i < mats.length; i++) {
      const amount = mats[i] && mats[i].amount;
      if (typeof amount !== 'number' || amount <= 0) continue;
      const cell = Array.isArray(acq) ? acq[i] : null;
      const got = Array.isArray(cell) ? (cell[0] || 0) + (cell[1] || 0) : 0;
      need += amount;
      have += Math.min(got, amount);
      if (got >= amount) done++;
      counted++;
    }
    if (!need || !counted) return null;
    return { pct: Math.round((have / need) * 100), done, total: counted };
  }

  // ============================================================
  // DOM fallback readers (used only when fiber access fails)
  // ============================================================
  function readPair(pairEl) {
    const out = { current: null, target: null, ascended: false };
    if (!pairEl) return out;
    const labels = pairEl.querySelectorAll('[class*="ItemPanel_summaryLabel"]');
    if (!labels.length) return out;
    const first = labels[0], last = labels[labels.length - 1];
    const fp = first.querySelector('p'), lp = last.querySelector('p');
    const cur = fp ? parseInt(fp.textContent.trim(), 10) : NaN;
    const tgt = lp ? parseInt(lp.textContent.trim(), 10) : NaN;
    out.current = isNaN(cur) ? null : cur;
    out.target = isNaN(tgt) ? null : tgt;
    out.ascended = !!first.querySelector('[class*="ItemPanel_star"]');
    return out;
  }
  function findLevelPair(wrapper) {
    const titles = wrapper.querySelectorAll('[class*="ItemPanel_summaryTitle"]');
    for (const t of titles) {
      const txt = t.textContent.trim().toLowerCase();
      if (txt.startsWith('level') || txt.startsWith('lv')) {
        const pair = t.parentElement && t.parentElement.querySelector('[class*="ItemPanel_summaryPair"]');
        if (pair) return pair;
      }
    }
    const pairs = wrapper.querySelectorAll('[class*="ItemPanel_summaryPair"]');
    for (const p of pairs) {
      const sib = p.parentElement && p.parentElement.querySelector('[class*="ItemPanel_talentLabel"]');
      if (!sib) return p;
    }
    return null;
  }
  function readTalentsDom(wrapper) {
    const result = { attack: null, skill: null, burst: null };
    const labels = wrapper.querySelectorAll('[class*="ItemPanel_talentLabel"]');
    const order = ['attack', 'skill', 'burst'];
    let idx = 0;
    for (const label of labels) {
      const text = label.textContent.trim().toLowerCase();
      const val = readPair(label.previousElementSibling);
      let key = null;
      if (text.startsWith('attack') || text.startsWith('normal')) key = 'attack';
      else if (text.startsWith('skill')) key = 'skill';
      else if (text.startsWith('burst')) key = 'burst';
      else key = order[idx] || null;
      if (key && result[key] === null) result[key] = val;
      idx++;
    }
    return result;
  }
  function readDomainDaysDom(wrapper) {
    const box = wrapper.querySelector('[class*="ItemPanel_days"]');
    if (!box) return [];
    const out = [];
    for (const p of box.querySelectorAll('p')) {
      const idx = DAY_LONG.indexOf(p.textContent.trim());
      if (idx >= 0) out.push(idx);
    }
    return out;
  }
  function readTravelerElement(wrapper) {
    const btn = wrapper.querySelector('[class*="ItemPanel_travelerToggle"] button');
    if (!btn) return '';
    const m = (btn.style.backgroundImage || '').match(/elements\/([a-z]+)\.png/i);
    return m ? m[1].toLowerCase() : '';
  }
  // Pause state must come from the DOM, not fiber props. React double-buffers
  // fibers (each has an `alternate`), so props reached from a DOM node can be
  // one commit stale — which made the table lag a toggle behind. The pause
  // button's `title` is set on commit and doesn't animate, so it's the
  // reliable read. Strings come from the site's own localization so this
  // still works if the UI language is changed.
  function generalStrings() {
    const pp = pagePropsBag();
    return (pp && pp.__namespaces && pp.__namespaces.general) || {};
  }
  function isPausedDom(wrapper) {
    if (!wrapper) return false;
    const holder = wrapper.querySelector('[class*="ItemPanel_pauseButton"]');
    if (holder) {
      const title = (holder.getAttribute('title') || '').trim();
      if (title) {
        const L = generalStrings();
        if (L.Paused && title === L.Paused) return true;
        if (L.Active && title === L.Active) return false;
        // Locale strings unavailable — fall back to English
        if (title === 'Paused') return true;
        if (title === 'Active') return false;
      }
    }
    const off = wrapper.querySelector('[class*="PowerButton_off"]');
    if (!off) return false;
    return parseFloat(window.getComputedStyle(off).opacity || '0') >= 0.5;
  }

  // ============================================================
  // Planner state: inventory + aggregated requirements
  // ============================================================
  // Confirmed on the live site:
  //   <fiber>.memoizedProps.inventory                      -> { matId: ownedCount }
  //   <fiber>...props.materials[.weekly|.gem|.boss|.local] -> { matId: {material, required} }
  // `required` is the total across planned entries. The site's own summary
  // hides rows once inventory covers them, which is exactly the visibility
  // problem the Weekly tab exists to solve.
  function scanPlannerState() {
    const out = { inventory: null, required: {} };
    // Start from the live tree. The container's own link can point at the
    // outdated copy of the root, which would make inventory counts lag behind.
    const root = liveRootFiber();
    if (!root) return out;

    const isInventory = (o) => {
      if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
      const ks = Object.keys(o);
      if (ks.length < 20) return false;
      let idish = 0, numeric = 0;
      for (const k of ks.slice(0, 40)) {
        if (/^\d{5}$/.test(k)) { idish++; if (typeof o[k] === 'number') numeric++; }
      }
      return idish >= 15 && numeric >= 15;
    };
    const harvestRequirements = (o) => {
      for (const k of Object.keys(o)) {
        if (!/^\d{5}$/.test(k)) continue;
        const v = o[k];
        if (v && typeof v === 'object' && v.material && typeof v.required === 'number') {
          if (!(k in out.required)) out.required[k] = v;
        }
      }
    };

    const seen = new WeakSet();
    const queue = [root];
    let steps = 0;
    // Only the inventory is consumed; stop as soon as it's found (it sits
    // near the top of the tree, ahead of every card).
    while (queue.length && steps < 200000 && !out.inventory) {
      const node = queue.shift(); steps++;
      if (!node) continue;
      for (const bag of ['memoizedProps', 'memoizedState']) {
        const stack = [[node[bag], 0]];
        while (stack.length) {
          const [cur, depth] = stack.pop();
          if (!cur || typeof cur !== 'object' || depth > 5 || seen.has(cur)) continue;
          seen.add(cur);
          if (!out.inventory && isInventory(cur)) { out.inventory = cur; continue; }
          harvestRequirements(cur);
          if (Array.isArray(cur)) continue;
          // keep descending: category maps (.weekly/.gem/...) nest one level down
          for (const k of Object.keys(cur)) stack.push([cur[k], depth + 1]);
        }
      }
      if (node.child) queue.push(node.child);
      if (node.sibling) queue.push(node.sibling);
    }
    return out;
  }

  function fullMaterialDb() {
    const pp = pagePropsBag();
    return (pp && pp.materials) || {};
  }
  // materialNames() is an alias kept for the weekly-boss code below.
  function materialNames() { return materialNamesTable(); }
  function matLabel(mat, names) {
    if (!mat) return '?';
    return names[mat.name] || mat.img || String(mat.id || '?');
  }
  // "Lv. 70+ Wolf of the North Challenge Reward" -> "Wolf of the North"
  function bossLabel(sourceHash, names) {
    let s = names[sourceHash] || '';
    s = s.replace(/^Lv\.?\s*\d+\+\s*/i, '').replace(/\s*Challenge Reward\s*$/i, '').trim();
    return s || `Boss ${sourceHash}`;
  }

  // Sum each entry's OWN requirement across every panel to get the gross
  // total. The site's summary map exposes only what REMAINS after inventory,
  // which would double-count against the inventory figure below.
  function gatherGrossNeeds() {
    const totals = {};
    const list = document.querySelector('[class*="Farm_itemList"]');
    if (!list) return totals;
    refreshLiveProps();
    let panels = 0, withProps = 0;
    for (const w of list.querySelectorAll('[class*="ItemPanel_itemWrapper"]')) {
      panels++;
      const p = findItemProps(w);
      if (!p) continue;
      withProps++;
      if (p.paused) continue; // paused entries aren't being planned for
      if (!Array.isArray(p.materials)) continue;
      for (const m of p.materials) {
        const id = m && m.material && m.material.id;
        const amt = m && m.amount;
        if (typeof id !== 'number' || typeof amt !== 'number') continue;
        totals[id] = (totals[id] || 0) + amt;
      }
    }
    totals.__meta = { panels, withProps };
    return totals;
  }

  function gatherWeekly() {
    const scan = scanPlannerState();
    if (!scan.inventory) return { error: 'Could not find the planner inventory in page state.' };

    const gross = gatherGrossNeeds();
    const meta = gross.__meta || { panels: 0, withProps: 0 };
    delete gross.__meta;
    if (!meta.withProps) {
      return { error: 'Could not read per-entry requirements from the planner (React props unavailable).' };
    }

    const db = fullMaterialDb();
    const names = materialNames();

    // Bosses in play = any weekly material some active entry requires.
    const bossSources = new Set();
    for (const id of Object.keys(gross)) {
      const mat = db[id];
      if (mat && mat.category === 'weekly' && Array.isArray(mat.source) && mat.source.length) {
        bossSources.add(String(mat.source[0]));
      }
    }
    if (!bossSources.size) return { groups: [], hiddenNote: meta };

    // Expand each group to every weekly material from that boss, so spare
    // copies of a material nobody currently needs still show as convertible.
    const groups = [];
    for (const src of bossSources) {
      const rows = [];
      for (const id of Object.keys(db)) {
        const mat = db[id];
        if (!mat || mat.category !== 'weekly') continue;
        if (!Array.isArray(mat.source) || String(mat.source[0]) !== src) continue;
        const have = scan.inventory[id] || 0;
        const need = gross[id] || 0;
        rows.push({ id: +id, name: matLabel(mat, names), img: mat.img, have, need, net: have - need });
      }
      if (!rows.length) continue;
      rows.sort((a, b) => a.net - b.net);
      const total = rows.reduce((a, r) => { a.have += r.have; a.need += r.need; return a; }, { have: 0, need: 0 });
      total.net = total.have - total.need;
      groups.push({ src, label: bossLabel(src, names), rows, total });
    }
    groups.sort((a, b) => a.total.net - b.total.net);
    return { groups };
  }

  // ============================================================
  // Scraping
  // ============================================================
  function scrapeAll() {
    const db = buildStaticDb();
    const list = document.querySelector('[class*="Farm_itemList"]');
    if (!list) return { characters: [], weapons: [] };
    refreshLiveProps(); // one walk of the live tree serves every card below
    const wrappers = Array.from(list.querySelectorAll('[class*="ItemPanel_itemWrapper"]'));
    const seen = {};
    const characters = [], weapons = [];

    for (const w of wrappers) {
      const imgEl = w.querySelector('[class*="ItemPanel_itemImage"] [class*="containedImage"]');
      const bg = imgEl ? (imgEl.style.backgroundImage || '') : '';
      const charM = bg.match(/\/images\/char\/small\/([^.'")]+)\.png/i);
      const weapM = bg.match(/\/images\/weapons\/[^/]+\/([^.'")]+)\.png/i);
      if (!charM && !weapM) continue;

      const kind = charM ? 'char' : 'weapon';
      const imgKey = (charM || weapM)[1];
      const nameEl = w.querySelector('[class*="ItemPanel_itemName"] p');
      const name = nameEl ? nameEl.textContent.trim() : imgKey;

      const props = findItemProps(w);
      if (fiberOk === null) {
        fiberOk = !!props;
        console.log(props
          ? '[gc-roster] reading planner state via React props (full data available)'
          : '[gc-roster] React props unavailable — DOM fallback (constellation/refinement/progress will show —)');
      }

      const base = `${kind}:${name}`;
      seen[base] = (seen[base] || 0) + 1;
      const key = seen[base] === 1 ? base : `${base}#${seen[base]}`;

      if (kind === 'char') {
        let row;
        if (props) {
          const item = props.item || {};
          const curT = Array.isArray(props.current.talents) ? props.current.talents : [];
          const desT = (props.desired && Array.isArray(props.desired.talents)) ? props.desired.talents : [];
          row = {
            kind, key, name, imgKey,
            selIndex: (props && typeof props.index === 'number') ? props.index : null,
            element: item.element || '',
            weapon: item.weapon || '',
            rarity: item.stars || 0,
            constellation: typeof props.current.constellation === 'number' ? props.current.constellation : null,
            obtained: props.current.obtained !== false,
            level: pairFromFiber(props.current.level, props.desired && props.desired.level, props.current.ascension),
            talents: {
              attack: pairFromFiber(curT[0], desT[0]),
              skill: pairFromFiber(curT[1], desT[1]),
              burst: pairFromFiber(curT[2], desT[2])
            },
            days: Array.isArray(props.domainDays) ? props.domainDays.slice() : [],
            mats: matProgress(props),
            matGroups: matGroupsOf((props.item || {}).mats),
            paused: isPausedDom(w), // DOM, not props: fiber props can be a commit stale
            wrapper: w
          };
        } else {
          const meta = db.chars[imgKey] || {};
          row = {
            kind, key, name, imgKey,
            selIndex: (props && typeof props.index === 'number') ? props.index : null,
            element: meta.element || '',
            weapon: meta.weapon || '',
            rarity: meta.stars || 0,
            constellation: null,
            obtained: true,
            level: readPair(findLevelPair(w)),
            talents: readTalentsDom(w),
            days: readDomainDaysDom(w),
            mats: null,
            matGroups: matGroupsOf((db.chars[imgKey] || {}).mats),
            paused: isPausedDom(w),
            wrapper: w
          };
        }
        if (!row.element || row.element === 'none') {
          const t = readTravelerElement(w);
          if (t) row.element = t;
        }
        characters.push(row);
      } else {
        let row;
        if (props) {
          const item = props.item || {};
          row = {
            kind, key, name, imgKey,
            selIndex: (props && typeof props.index === 'number') ? props.index : null,
            wtype: item.type || item.weapon || '',
            rarity: item.stars || 0,
            refine: readRefinement(props),
            level: pairFromFiber(props.current.level, props.desired && props.desired.level, props.current.ascension),
            days: Array.isArray(props.domainDays) ? props.domainDays.slice() : [],
            mats: matProgress(props),
            matGroups: matGroupsOf((props.item || {}).mats),
            paused: isPausedDom(w), // DOM, not props: fiber props can be a commit stale
            wrapper: w
          };
        } else {
          const meta = db.weapons[imgKey] || {};
          row = {
            kind, key, name, imgKey,
            selIndex: (props && typeof props.index === 'number') ? props.index : null,
            wtype: meta.type || '',
            rarity: meta.stars || 0,
            refine: null,
            level: readPair(findLevelPair(w)),
            days: readDomainDaysDom(w),
            mats: null,
            matGroups: matGroupsOf((db.weapons[imgKey] || {}).mats),
            paused: isPausedDom(w),
            wrapper: w
          };
        }
        weapons.push(row);
      }
    }
    return { characters, weapons };
  }

  // ---- Inactive Panel Options radio ----
  function findInactivePanelRadio() {
    for (const r of document.querySelectorAll('[class*="Radio_radio"]')) {
      const label = r.querySelector('[class*="Radio_radioLabel"]');
      if (label && label.textContent.trim() === 'Inactive Panel Options') return r;
    }
    return null;
  }
  function getInactivePanelMode() {
    const radio = findInactivePanelRadio();
    if (!radio) return null;
    const options = radio.querySelectorAll('[class*="Radio_option"]');
    for (const opt of options) {
      const sel = opt.querySelector('[class*="Radio_selected"]');
      if (sel && window.getComputedStyle(sel).visibility !== 'hidden') return opt.textContent.trim();
    }
    for (const opt of options) {
      if ((opt.style.color || '').replace(/\s+/g, '') === 'rgb(0,0,0)') return opt.textContent.trim();
    }
    return null;
  }
  function setInactivePanelMode(mode) {
    const radio = findInactivePanelRadio();
    if (!radio) return false;
    for (const opt of radio.querySelectorAll('[class*="Radio_option"]')) {
      if (opt.textContent.trim() === mode) { opt.click(); return true; }
    }
    return false;
  }

  // ============================================================
  // Styles
  // ============================================================
  const css = `
    .gcr-overlay {
      position: fixed; inset: 0;
      box-sizing: border-box;
      /* The site mounts its dialogs in #editor (a direct child of body) at
         z-index 10000. Stay below that so Edit/Ascend always land on top,
         while still clearing normal page chrome. */
      z-index: 9000;
      background: rgba(0,0,0,0.55);
      display: flex; align-items: center; justify-content: center;
      font-family: 'Montserrat', sans-serif;
    }
    .gcr-modal {
      background: rgba(20, 29, 52, 0.98);
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 10px;
      box-shadow: 0 10px 34px rgba(0,0,0,0.6);
      color: #ece5d8;
      width: min(1080px, 96vw);
      max-height: var(--gcr-maxh, 88vh);
      display: flex; flex-direction: column; overflow: hidden;
    }
    .gcr-head {
      display: flex; align-items: center; gap: 4px;
      padding: 8px 12px 0;
      flex-shrink: 0;
    }
    .gcr-tab {
      background: transparent; border: 1px solid transparent;
      border-bottom: none; color: rgba(236,229,216,0.6);
      font: inherit; font-size: 13px; font-weight: 700;
      padding: 6px 14px; cursor: pointer;
      border-radius: 6px 6px 0 0; letter-spacing: 0.4px;
    }
    .gcr-tab:hover { color: #ece5d8; background: rgba(255,255,255,0.06); }
    .gcr-tab.on {
      background: rgba(255,255,255,0.1);
      border-color: rgba(255,255,255,0.18);
      color: #ffd7a0;
    }
    .gcr-tab .gcr-tabn { opacity: 0.65; font-weight: 400; margin-left: 4px; }
    .gcr-x {
      margin-left: auto; background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.18); color: #ece5d8;
      border-radius: 4px; cursor: pointer; font: inherit; font-size: 12px; font-weight: 600; padding: 4px 10px;
    }
    .gcr-x:hover { background: rgba(255,255,255,0.18); }
    .gcr-filters {
      padding: 8px 12px;
      border-top: 1px solid rgba(255,255,255,0.18);
      border-bottom: 1px solid rgba(255,255,255,0.12);
      flex-shrink: 0;
      /* overflow visible so the material dropdown isn't clipped; the filter
         rows are few, and the table's own scroll area absorbs the height. */
      overflow: visible;
    }
    .gcr-frow { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin: 3px 0; }
    .gcr-flabel {
      font-size: 11px; opacity: 0.55; width: 70px; flex-shrink: 0;
      letter-spacing: 0.6px; font-weight: 700;
    }
    .gcr-chip {
      font-size: 12px; padding: 3px 10px; border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.2);
      background: transparent; color: rgba(236,229,216,0.6);
      cursor: pointer; font-family: inherit; font-weight: 600;
    }
    .gcr-chip:hover { background: rgba(255,255,255,0.1); color: #ece5d8; }
    .gcr-chip.on { background: var(--chip, rgba(255,255,255,0.25)); border-color: transparent; color: #141d34; }
    .gcr-chip.today { box-shadow: 0 0 0 1px rgba(255,215,160,0.8); }
    .gcr-matrow { align-items: flex-start; position: relative; }
    .gcr-matchip { background: rgba(255,215,160,0.85); }
    .gcr-matmode {
      background: rgba(120,170,255,0.85); border-color: transparent; color: #101828;
      font-size: 11px; letter-spacing: 0.4px;
    }
    .gcr-matsearch-wrap { position: relative; display: inline-block; }
    .gcr-matsearch {
      background: rgba(0,0,0,0.3);
      border: 1px solid rgba(255,255,255,0.25);
      color: #ece5d8; border-radius: 10px;
      font-family: inherit; font-size: 12px; padding: 3px 9px; width: 160px;
    }
    .gcr-matsearch::placeholder { color: rgba(236,229,216,0.4); }
    .gcr-matsearch:focus { outline: none; border-color: rgba(255,215,160,0.7); }
    .gcr-matresults {
      position: absolute; top: 100%; left: 0; margin-top: 3px;
      z-index: 5; min-width: 210px; max-height: 240px; overflow-y: auto;
      background: rgba(16,24,44,0.99);
      border: 1px solid rgba(255,255,255,0.22); border-radius: 6px;
      box-shadow: 0 6px 18px rgba(0,0,0,0.5); padding: 3px;
    }
    .gcr-matopt {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      width: 100%; box-sizing: border-box; text-align: left;
      background: none; border: none; color: #ece5d8;
      font-family: inherit; font-size: 13px; padding: 6px 9px;
      border-radius: 4px; cursor: pointer;
    }
    .gcr-matopt:hover { background: rgba(255,255,255,0.12); }
    .gcr-matcount { font-size: 11px; opacity: 0.55; flex-shrink: 0; }
    .gcr-matnone { padding: 6px 8px; font-size: 12px; opacity: 0.5; }
    .gcr-clear {
      font-size: 11px; margin-left: auto; background: none; border: none;
      color: rgba(236,229,216,0.5); cursor: pointer; font-family: inherit; text-decoration: underline;
    }
    .gcr-clear:hover { color: #ece5d8; }
    .gcr-scroll { overflow: auto; flex: 1; }
    .gcr-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    .gcr-table th {
      position: sticky; top: 0; background: rgba(28, 40, 68, 0.99);
      text-align: left; font-weight: 700; font-size: 11.5px; letter-spacing: 0.4px;
      padding: 7px 7px; border-bottom: 1px solid rgba(255,255,255,0.15);
      cursor: pointer; user-select: none; white-space: nowrap;
    }
    .gcr-table th:hover { background: rgba(40, 56, 92, 0.99); }
    .gcr-table th.num, .gcr-table td.num { text-align: right; }
    .gcr-table th.sorted { color: #ffd7a0; }
    .gcr-arrow { font-size: 10px; opacity: 0.9; }
    .gcr-table td { padding: 6px 7px; border-bottom: 1px solid rgba(255,255,255,0.06); white-space: nowrap; }
    .gcr-row { cursor: pointer; }
    .gcr-row:hover td { background: rgba(255,255,255,0.07); }
    .gcr-row.paused td { opacity: 0.45; }
    .gcr-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
    .gcr-star { color: #ffd7a0; font-size: 11px; }
    .gcr-arrowto { opacity: 0.45; margin: 0 2px; }
    .gcr-rar { font-weight: 700; font-size: 12px; }
    .gcr-cons, .gcr-ref {
      display: inline-block; min-width: 22px; padding: 1px 5px; border-radius: 3px;
      background: rgba(255,255,255,0.09); font-size: 11.5px; font-weight: 700; letter-spacing: 0.3px;
    }
    .gcr-cons.max, .gcr-ref.max { background: rgba(255,215,160,0.22); color: #ffd7a0; }
    .gcr-days { font-size: 11.5px; opacity: 0.8; letter-spacing: 0.3px; }
    .gcr-days .on { color: #ffd7a0; font-weight: 700; opacity: 1; }
    .gcr-bar {
      display: inline-block; width: 42px; height: 5px; border-radius: 3px;
      background: rgba(255,255,255,0.14); overflow: hidden; vertical-align: middle; margin-right: 5px;
    }
    .gcr-bar > i { display: block; height: 100%; background: #7ddc7d; }
    .gcr-bar.part > i { background: #e0c060; }
    .gcr-acts { white-space: nowrap; }
    .gcr-acts .gcr-pw + .gcr-pw { margin-left: 3px; }
    .gcr-pw {
      background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
      color: #ece5d8; border-radius: 4px; cursor: pointer; font: inherit;
      font-size: 12px; padding: 1px 8px; line-height: 18px; min-width: 26px;
    }
    .gcr-pw:hover { background: rgba(255,255,255,0.22); }
    .gcr-foot {
      padding: 8px 12px; border-top: 1px solid rgba(255,255,255,0.12);
      display: flex; align-items: center; gap: 10px; flex-shrink: 0; font-size: 12px; opacity: 0.85;
    }
    .gcr-btn {
      background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
      color: #ece5d8; border-radius: 4px; cursor: pointer; font: inherit;
      font-size: 12px; font-weight: 600; padding: 5px 12px;
    }
    .gcr-btn:hover { background: rgba(255,255,255,0.22); }
    .gcr-empty { padding: 24px 14px; text-align: center; opacity: 0.6; font-size: 13px; }
    /* --- Weekly boss table (single table so columns align across bosses) --- */
    .gcr-wt {
      width: 100%; border-collapse: collapse; font-size: 12.5px; table-layout: fixed;
    }
    .gcr-wt col.c-mat { width: auto; }
    .gcr-wt col.c-num { width: 92px; }
    .gcr-wt th {
      position: sticky; top: 0; z-index: 1;
      background: rgba(28, 40, 68, 0.99);
      font-size: 11px; letter-spacing: 0.5px; opacity: 0.75; font-weight: 700;
      text-align: right; padding: 7px 10px;
      border-bottom: 1px solid rgba(255,255,255,0.15);
    }
    .gcr-wt th:first-child { text-align: left; }
    .gcr-wt td {
      padding: 4px 10px; text-align: right;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .gcr-wt td:first-child { text-align: left; }
    .gcr-wt tr.bosshead td {
      padding-top: 14px; padding-bottom: 4px;
      border-bottom: 1px solid rgba(255,255,255,0.12);
    }
    .gcr-wt tr.bosshead .gcr-boss-name {
      font-size: 13.5px; font-weight: 700; letter-spacing: 0.4px; color: #ffd7a0;
    }
    .gcr-wt tr.matrow.zero td { opacity: 0.4; }
    .gcr-wt tr.total td {
      border-top: 1px solid rgba(255,255,255,0.18);
      border-bottom: 1px solid rgba(255,255,255,0.06);
      padding-top: 5px; padding-bottom: 7px; font-weight: 700;
    }
    .gcr-wt tr.covered td { opacity: 0.5; }
    .gcr-wt tr.covered.bosshead .gcr-boss-name { color: rgba(236,229,216,0.8); }
    .gcr-pos { color: #7ddc7d; }
    .gcr-matlink {
      cursor: pointer;
      text-decoration: underline dotted;
      text-underline-offset: 3px;
      text-decoration-color: rgba(255,255,255,0.35);
    }
    .gcr-matlink:hover { color: #ffd7a0; text-decoration-color: #ffd7a0; }
    .gcr-matplain { opacity: 0.75; }
    .gcr-neg { color: #ef8a8a; }
    .gcr-zero { opacity: 0.5; }
    .gcr-net-big { font-size: 14px; }
    @keyframes gcrFlash {
      0%, 100% { box-shadow: 0 0 0 0 rgba(255,215,160,0); }
      25%, 75% { box-shadow: 0 0 0 4px rgba(255,215,160,0.85); }
    }
    .gcr-flash { animation: gcrFlash 1.4s ease; border-radius: 8px; }
    /* --- Panel view (borrows the real cards into a modal) --- */
    .gcr-pv-modal { width: min(1600px, 98vw); max-height: var(--gcr-maxh, 92vh); }
    .gcr-pv-host {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 10px 12px 16px;
      display: grid;
      gap: 10px;
      align-content: start;
    }
    /* min-width:0 stops grid children from forcing the track wider than 1fr,
       which is what produced the horizontal scrollbar. */
    .gcr-pv-host > * { min-width: 0; max-width: 100%; }
    /* Beats the sections script's inline display toggling */
    .gcr-borrowed-slot { display: none !important; }
    /* Membership-changing controls are disabled while cards are borrowed:
       React would try to add/remove them from a container they've left. */
    .gcr-pv-host [class*="ItemPanel_pauseButton"],
    .gcr-pv-host [class*="ItemPanel_trashButton"] { display: none !important; }
    .gcr-pv-host .gc-item-section-badge { pointer-events: none; }
    .gcr-pv-note { font-size: 12px; opacity: 0.6; }
    .gcr-sel {
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.2);
      color: #ece5d8; border-radius: 4px;
      font: inherit; font-size: 12px; padding: 2px 4px; margin-left: 4px;
    }
    .gcr-sel option { background: #141d34; color: #ece5d8; }

    /* ============================================================
       Native theme: mirrors the site's own dialogs (Window/Edit/Select
       styles). Applied by adding .gcr-native to an overlay; Classic is
       the rules above, untouched.
       ============================================================ */
    .gcr-native.gcr-overlay { background: rgba(10,10,20,0.96); }
    .gcr-native .gcr-modal {
      background: #1e2231; border: none; border-radius: 5px; box-shadow: none; color: #ccc;
    }
    .gcr-native .gcr-head {
      padding: 8px 10px; gap: 6px;
      background: linear-gradient(160deg, rgba(105,84,83,0.565) 0%, rgba(161,112,78,0.565) 39%, rgba(228,171,82,0.565) 100%);
      border-radius: 5px 5px 0 0;
    }
    .gcr-native .gcr-tab {
      border: none; border-radius: 40px; padding: 5px 14px; font-size: 13px; font-weight: 700;
      background: rgba(219,207,184,0.35); color: #1e1e28; box-shadow: 0 0 4px rgba(0,0,0,0.5);
    }
    .gcr-native .gcr-tab:hover { background: rgba(219,207,184,0.6); color: #1e1e28; }
    .gcr-native .gcr-tab.on { background: #ece5d8; color: #000; box-shadow: 0 0 7px rgba(236,230,217,0.7); }
    .gcr-native .gcr-tab .gcr-tabn { opacity: 0.6; }
    .gcr-native .gcr-title { font-size: 18px; font-weight: 800; color: #ccc; }
    .gcr-native .gcr-pv-note { color: #ccc; opacity: 0.75; }
    .gcr-native .gcr-x {
      background: rgba(219,207,184,0.6); color: #1e1e28; border: none; border-radius: 40px;
      font-size: 12px; font-weight: 700; padding: 5px 12px; box-shadow: 0 0 4px rgba(0,0,0,0.5);
    }
    .gcr-native .gcr-x:hover { background: #ece5d8; }
    /* Close: the site's round red cross button */
    .gcr-native .gcr-x.gcr-close {
      width: 34px; height: 34px; padding: 0; flex-shrink: 0; font-size: 0; color: transparent;
      border-radius: 50%; border: 3px solid #fff;
      background: rgb(252,68,69) url("/images/general/cross.png") center / 22px no-repeat;
      box-shadow: 0 0 0 2px rgba(219,207,184,0.6);
    }
    .gcr-native .gcr-x.gcr-close:hover { filter: brightness(1.3); box-shadow: 0 0 7px #aaa; }
    .gcr-native .gcr-filters { border-top: none; border-bottom: 1px solid rgba(255,255,255,0.2); padding: 8px 12px; }
    .gcr-native .gcr-flabel { color: #ffd780; opacity: 1; font-size: 11px; font-weight: 600; letter-spacing: 0.3px; width: 70px; }
    .gcr-native .gcr-chip {
      border: none; border-radius: 40px; padding: 4px 11px; font-size: 12px; font-weight: 700;
      background: rgba(219,207,184,0.22); color: #ccc;
    }
    .gcr-native .gcr-chip:hover { background: rgba(219,207,184,0.4); color: #fff; }
    .gcr-native .gcr-chip.on { background: var(--chip, #ece5d8); color: #000; box-shadow: 0 0 6px rgba(236,230,217,0.45); }
    .gcr-native .gcr-chip.today { box-shadow: inset 0 0 0 2px #ffd780; }
    .gcr-native .gcr-matchip { background: #ece5d8; }
    .gcr-native .gcr-matmode { background: #4c98ff; color: #000; }
    .gcr-native .gcr-matsearch {
      background: #ece5d8; color: #1e1e28; border: none; border-radius: 3px;
      font-size: 12px; font-weight: 600; padding: 4px 9px;
    }
    .gcr-native .gcr-matsearch::placeholder { color: rgba(30,30,40,0.5); }
    .gcr-native .gcr-matsearch:focus { box-shadow: 0 0 7px #aaa; }
    .gcr-native .gcr-matresults { background: #282d41; border: none; border-radius: 5px; box-shadow: 0 0 4px rgba(0,0,0,0.8); padding: 0; }
    .gcr-native .gcr-matopt { border-radius: 0; font-size: 13px; font-weight: 600; padding: 8px 12px; color: #ccc; }
    .gcr-native .gcr-matopt:not(:last-child) { border-bottom: 1px solid rgba(255,255,255,0.2); }
    .gcr-native .gcr-matopt:hover { background: #4c98ff; color: #000; }
    .gcr-native .gcr-clear { color: #ffd780; }
    .gcr-native .gcr-table { font-size: 12.5px; }
    .gcr-native .gcr-table th, .gcr-native .gcr-wt th {
      background: #282d41; color: #ffd780; border-bottom: 1px solid rgba(255,255,255,0.2); opacity: 1;
    }
    .gcr-native .gcr-table th:hover { background: #323850; }
    .gcr-native .gcr-table th.sorted { color: #fff; }
    .gcr-native .gcr-table td { border-bottom: 1px solid rgba(255,255,255,0.08); }
    .gcr-native .gcr-row:hover td { background: rgba(76,152,255,0.16); }
    .gcr-native .gcr-cons, .gcr-native .gcr-ref { background: rgba(219,207,184,0.18); border-radius: 40px; padding: 1px 7px; }
    .gcr-native .gcr-cons.max, .gcr-native .gcr-ref.max { background: #ece5d8; color: #000; }
    .gcr-native .gcr-pw, .gcr-native .gcr-btn, .gcr-native .gcr-sel {
      background: rgba(219,207,184,0.6); color: #1e1e28; border: none; border-radius: 40px; font-weight: 700;
      box-shadow: 0 0 4px rgba(0,0,0,0.5);
    }
    .gcr-native .gcr-pw { padding: 2px 8px; min-width: 28px; font-size: 13px; line-height: 18px; color: #000; }
    .gcr-native .gcr-btn { padding: 5px 14px; font-size: 12px; }
    .gcr-native .gcr-pw:hover, .gcr-native .gcr-btn:hover { background: #ece5d8; }
    .gcr-native .gcr-btn[disabled] { opacity: 0.4; cursor: default; }
    .gcr-native .gcr-sel { padding: 2px 8px; }
    .gcr-native .gcr-sel option { background: #282d41; color: #ccc; }
    .gcr-native .gcr-foot { border-top: 1px solid rgba(255,255,255,0.2); opacity: 1; color: #ccc; }
    .gcr-native .gcr-wt tr.bosshead .gcr-boss-name { color: #ffd780; }
    .gcr-native .gcr-wt tr.bosshead td { border-bottom: 1px solid rgba(255,255,255,0.2); }
  `;
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ============================================================
  // View state
  // ============================================================
  let overlay = null;

  // ---- Look: always the site's native dialog style ----
  // (The old "Classic" look was removed in Toolkit 1.1.0. Its rules are still
  // the base layer that .gcr-native styles on top of.)
  function applyTheme(el) { if (el) el.classList.add('gcr-native'); }
  let activeTab = DEFAULT_TAB;
  let data = { characters: [], weapons: [] };
  let restoreHideMode = null;

  const view = {
    characters: {
      sortKey: 'name', sortDir: 1, matMode: 'or',
      f: { element: new Set(), weapon: new Set(), rarity: new Set(),
           days: new Set(), status: new Set(DEFAULT_ACTIVE_ONLY ? ['active'] : []),
           owned: new Set(), materials: new Set() }
    },
    weapons: {
      sortKey: 'name', sortDir: 1, matMode: 'or',
      f: { wtype: new Set(), rarity: new Set(), days: new Set(),
           status: new Set(DEFAULT_ACTIVE_ONLY ? ['active'] : []), materials: new Set() }
    }
  };
  let weeklyShortfallsOnly = false;

  const EMPTY_SET = new Set();
  function anyFilterActive(v) {
    return Object.keys(v.f).some(k => v.f[k].size > 0);
  }
  function clearFilters(v) {
    for (const k of Object.keys(v.f)) v.f[k].clear();
  }

  function rowsFor(tab) {
    const v = view[tab];
    const src = data[tab] || [];
    return src.filter(r => {
      const f = v.f;
      if (f.status.size && !f.status.has(r.paused ? 'paused' : 'active')) return false;
      if (f.rarity.size && !f.rarity.has(r.rarity)) return false;
      if (f.days.size) {
        const days = r.days || [];
        if (!days.some(d => f.days.has(d))) return false;
      }
      if (tab === 'characters') {
        if (f.element.size && !f.element.has(r.element)) return false;
        if (f.weapon.size && !f.weapon.has(r.weapon)) return false;
        if (f.owned.size && !f.owned.has(r.obtained ? 'owned' : 'planned')) return false;
      } else {
        if (f.wtype.size && !f.wtype.has(r.wtype)) return false;
      }
      if (f.materials.size) {
        const mg = r.matGroups || EMPTY_SET;
        if (v.matMode === 'and') {
          for (const k of f.materials) if (!mg.has(k)) return false;
        } else {
          let any = false;
          for (const k of f.materials) if (mg.has(k)) { any = true; break; }
          if (!any) return false;
        }
      }
      return true;
    }).sort((a, b) => {
      const va = sortValue(a, v.sortKey), vb = sortValue(b, v.sortKey);
      if (va < vb) return -1 * v.sortDir;
      if (va > vb) return 1 * v.sortDir;
      return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
    });
  }

  function sortValue(row, key) {
    switch (key) {
      case 'name': return row.name.toLowerCase();
      case 'rarity': return row.rarity || 0;
      case 'element': return row.element || 'zzz';
      case 'weapon': return row.weapon || 'zzz';
      case 'wtype': return row.wtype || 'zzz';
      case 'cons': return row.constellation === null ? -1 : row.constellation;
      case 'refine': return row.refine === null ? -1 : row.refine;
      case 'level': return row.level && row.level.current !== null ? row.level.current : -1;
      case 'attack': return row.talents && row.talents.attack && row.talents.attack.current !== null ? row.talents.attack.current : -1;
      case 'skill': return row.talents && row.talents.skill && row.talents.skill.current !== null ? row.talents.skill.current : -1;
      case 'burst': return row.talents && row.talents.burst && row.talents.burst.current !== null ? row.talents.burst.current : -1;
      case 'days': return (row.days && row.days.length) ? row.days[0] : 99;
      case 'mats': return row.mats ? row.mats.pct : -1;
      default: return 0;
    }
  }

  // ============================================================
  // Cell renderers
  // ============================================================
  function levelCell(lvl) {
    if (!lvl || lvl.current === null) return '—';
    const star = lvl.ascended ? '<span class="gcr-star">★</span>' : '';
    if (lvl.target === null || lvl.target === lvl.current) return `${lvl.current}${star}`;
    return `${lvl.current}${star}<span class="gcr-arrowto">→</span>${lvl.target}`;
  }
  function talentCell(t) {
    if (!t || t.current === null) return '—';
    if (t.target === null || t.target === t.current) return String(t.current);
    return `${t.current}<span class="gcr-arrowto">→</span>${t.target}`;
  }
  function daysCell(days) {
    if (!days || !days.length) return '<span style="opacity:.4">—</span>';
    const today = new Date().getDay();
    return '<span class="gcr-days">' + days.map(d =>
      `<span class="${d === today || today === 0 ? 'on' : ''}">${DAY_SHORT[d] || '?'}</span>`
    ).join('/') + '</span>';
  }
  function matsCell(m) {
    if (!m) return '<span style="opacity:.4">—</span>';
    const cls = m.pct >= 100 ? '' : ' part';
    return `<span class="gcr-bar${cls}" title="${m.done}/${m.total} materials complete"><i style="width:${Math.min(100, m.pct)}%"></i></span>${m.pct}%`;
  }
  function rarityCell(n) {
    if (!n) return '<span style="opacity:.4">—</span>';
    return `<span class="gcr-rar" style="color:${RARITY_COLORS[n] || '#ccc'}">${n}★</span>`;
  }

  const COLUMNS = {
    characters: [
      { label: 'Name', sort: 'name', cell: r => escapeHtml(r.name) },
      { label: '★', sort: 'rarity', num: true, cell: r => rarityCell(r.rarity) },
      { label: 'Element', sort: 'element', cell: r => r.element
          ? `<span class="gcr-dot" style="background:${ELEMENT_COLORS[r.element] || ELEMENT_COLORS.none}"></span>${titleCase(r.element)}`
          : '—' },
      { label: 'Weapon', sort: 'weapon', cell: r => r.weapon ? titleCase(r.weapon) : '—' },
      { label: 'Cons', sort: 'cons', num: true, cell: r => r.constellation === null
          ? '<span style="opacity:.4">—</span>'
          : `<span class="gcr-cons${r.constellation >= 6 ? ' max' : ''}">C${r.constellation}</span>` },
      { label: 'Lv', sort: 'level', num: true, cell: r => levelCell(r.level) },
      { label: 'Atk', sort: 'attack', num: true, cell: r => talentCell(r.talents.attack) },
      { label: 'Skill', sort: 'skill', num: true, cell: r => talentCell(r.talents.skill) },
      { label: 'Burst', sort: 'burst', num: true, cell: r => talentCell(r.talents.burst) },
      { label: 'Days', sort: 'days', cell: r => daysCell(r.days) },
      { label: 'Mats', sort: 'mats', num: true, cell: r => matsCell(r.mats) }
    ],
    weapons: [
      { label: 'Name', sort: 'name', cell: r => escapeHtml(r.name) },
      { label: '★', sort: 'rarity', num: true, cell: r => rarityCell(r.rarity) },
      { label: 'Type', sort: 'wtype', cell: r => r.wtype ? titleCase(r.wtype) : '—' },
      { label: 'Refine', sort: 'refine', num: true, cell: r => r.refine === null
          ? '<span style="opacity:.4">—</span>'
          : `<span class="gcr-ref${r.refine >= 5 ? ' max' : ''}">R${r.refine}</span>` },
      { label: 'Lv', sort: 'level', num: true, cell: r => levelCell(r.level) },
      { label: 'Days', sort: 'days', cell: r => daysCell(r.days) },
      { label: 'Mats', sort: 'mats', num: true, cell: r => matsCell(r.mats) }
    ]
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ============================================================
  // Actions
  // ============================================================
  // Resolve a row to its live wrapper: stable selection index first, then
  // the name key as a fallback for the DOM-only path.
  function liveWrapperFor(row) {
    const byIdx = findWrapperBySelIndex(row.selIndex);
    if (byIdx) return byIdx;
    const fresh = scrapeAll();
    const pool = row.kind === 'char' ? fresh.characters : fresh.weapons;
    const match = pool.find(r => r.key === row.key);
    return (match && match.wrapper) || null;
  }

  // If the sections script has this card inside a collapsed section, expand
  // it — otherwise the card is display:none and scrolling to it does nothing.
  function expandSectionFor(wrapper) {
    const secId = wrapper && wrapper.getAttribute && wrapper.getAttribute('data-gc-section');
    if (!secId) return false;
    let header = null;
    for (const h of document.querySelectorAll('[data-gc-section-header]')) {
      if (h.getAttribute('data-gc-section-header') === secId) { header = h; break; }
    }
    if (!header || header.getAttribute('data-collapsed') !== 'true') return false;
    const toggle = header.querySelector('.gc-section-toggle');
    if (!toggle) return false;
    toggle.click();
    return true;
  }

  function isHiddenCard(wrapper) {
    const slot = wrapper.parentElement;
    if (slot && window.getComputedStyle(slot).display === 'none') return true;
    return wrapper.offsetParent === null && window.getComputedStyle(wrapper).position !== 'fixed';
  }

  function jumpTo(row) {
    closeModal();
    setTimeout(() => {
      const el = liveWrapperFor(row);
      if (!el || !el.isConnected) { console.warn('[gc-roster] card no longer in DOM:', row.key); return; }
      const expanded = expandSectionFor(el);
      const go = () => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('gcr-flash');
        setTimeout(() => el.classList.remove('gcr-flash'), 1600);
        if (isHiddenCard(el)) {
          console.warn('[gc-roster] card is hidden (paused + "Hide" panel option?) — cannot scroll to it');
        }
      };
      // Give the sections script a beat to re-render the expanded section.
      if (expanded) setTimeout(go, 220); else go();
    }, 60);
  }

  // Press the card's own Edit / Ascend button so the site opens its normal
  // dialog. The click handler sits on a <button> inside the card's
  // ItemPanel_editButton / ItemPanel_ascendButton spot (verified live). The
  // dialogs render at z-index 10000, above this table (9000), so the table can
  // stay open underneath and refresh once the dialog closes.
  function openCardDialog(row, kind) {
    const el = liveWrapperFor(row);
    if (!el || !el.isConnected) {
      alert(`${row.name}'s card isn't on the page right now.\n\n` +
            'Paused entries are hidden when Inactive Panel Options is set to "Hide" — use "Load hidden" first.');
      return;
    }
    const btn = el.querySelector(`[class*="ItemPanel_${kind}Button"] button`);
    if (!btn) {
      alert(`${row.name} has no ${kind === 'edit' ? 'Edit' : 'Ascend'} button on its card.`);
      return;
    }
    btn.click();
    watchDialogThen(() => { if (overlay) { data = scrapeAll(); render(); } });
  }

  function togglePause(row) {
    const el = liveWrapperFor(row);
    if (!el) { console.warn('[gc-roster] cannot toggle, card missing:', row.key, 'selIndex', row.selIndex); return; }
    const btn = el.querySelector('[class*="ItemPanel_pauseButton"] button');
    if (!btn) { console.warn('[gc-roster] no pause button for', row.key); return; }

    const target = !isPausedDom(el);
    btn.click();

    // Optimistic: reflect it immediately so the table never looks a step behind.
    row.paused = target;
    render();

    // Then confirm against the DOM rather than guessing at a delay.
    let tries = 0;
    const verify = () => {
      const live = findWrapperBySelIndex(row.selIndex);
      if (!live || !live.isConnected) {
        // Card left the DOM (paused with "Hide" on) — the change took effect.
        data = scrapeAll(); render(); return;
      }
      if (isPausedDom(live) === target || tries >= 15) {
        if (tries >= 15) console.warn('[gc-roster] pause state did not settle for', row.key);
        data = scrapeAll(); render(); return;
      }
      tries++;
      setTimeout(verify, 60);
    };
    setTimeout(verify, 60);
  }

  async function loadHidden() {
    if (getInactivePanelMode() !== 'Hide') return;
    if (!setInactivePanelMode('End')) { alert('Could not change the Inactive Panel Options setting.'); return; }
    restoreHideMode = 'Hide';
    await new Promise(r => setTimeout(r, 280));
    // Revealed entries are all paused — don't let the status filter re-hide them.
    for (const tab of ['characters', 'weapons']) {
      if (view[tab].f.status.size) view[tab].f.status.add('paused');
    }
    data = scrapeAll();
    render();
  }

  // ============================================================
  // Panel view — borrows the real cards into a modal
  // ============================================================
  // The cards are React-managed nodes, so moving them keeps every handler
  // (edit, ascend, material clicks). We move the WRAPPER and leave its slot
  // behind, so the list's own children are untouched and React can still
  // add/remove/reorder list items normally. Pause and delete are hidden
  // inside the view because those change list membership.
  let panelView = null;
  let panelColumns = 'auto'; // 'auto' | 1 | 2 | 3 | 4
  let panelCardWidth = 420;  // measured from the site's own list on open

  // Match the planner's own card density instead of guessing a minimum.
  function measureSiteCardWidth(list) {
    const card = list && list.querySelector('[class*="ItemPanel_itemWrapper"]');
    const slot = card && card.parentElement;
    if (!slot) return null;
    const w = slot.getBoundingClientRect().width;
    if (!w || w < 200) return null;
    return Math.round(Math.min(760, Math.max(300, w)));
  }

  function applyPanelColumns(host) {
    if (!host) return;
    host.style.gridTemplateColumns = panelColumns === 'auto'
      ? `repeat(auto-fill, minmax(${panelCardWidth}px, 1fr))`
      : `repeat(${panelColumns}, minmax(0, 1fr))`;
  }

  // Fallback for site dialogs that mount in a container with a z-index BELOW
  // our overlay. The site's Edit dialog uses #editor at 10000 (above us, so
  // untouched); other dialogs may not. Lifting must target the body-level
  // container that owns the stacking context — raising an inner node does
  // nothing, since it only reorders within its own context.
  const OVERLAY_Z = 9000;
  const LIFT_Z = '10500';
  const LIFT_SKIP_IDS = new Set(['__next', 'portal-root']);
  let dialogLifter = null;

  function bodyLevelContainer(node) {
    let top = node;
    while (top && top.parentElement && top.parentElement !== document.body) top = top.parentElement;
    return (top && top.parentElement === document.body) ? top : null;
  }

  function liftElement(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.closest && node.closest('.gcr-overlay')) return; // ours
    const top = bodyLevelContainer(node);
    if (!top || top.id && LIFT_SKIP_IDS.has(top.id)) return;
    if (top.hasAttribute('data-gcr-lifted')) return;
    if (top.querySelector && top.querySelector('.gcr-overlay')) return; // contains ours
    let cs;
    try { cs = window.getComputedStyle(top); } catch (e) { return; }
    if (cs.position !== 'fixed' && cs.position !== 'absolute') return;
    const z = parseInt(cs.zIndex, 10);
    if (!isNaN(z) && z > OVERLAY_Z) return; // already above us; leave it alone
    const r = top.getBoundingClientRect();
    if (r.width < 150 || r.height < 100) return;
    top.setAttribute('data-gcr-lifted', top.style.zIndex || '');
    top.style.zIndex = LIFT_Z;
    console.log('[gc-roster] lifted buried dialog container:', top.id || top.className || top.tagName);
  }

  function scanForDialogs(node) {
    if (!node || node.nodeType !== 1) return;
    liftElement(node);
  }

  function startDialogLifter() {
    if (dialogLifter) return;
    dialogLifter = new MutationObserver((muts) => {
      if (!panelView) return;
      for (const m of muts) for (const n of m.addedNodes) scanForDialogs(n);
    });
    dialogLifter.observe(document.body, { childList: true, subtree: true });
    // Catch anything already open when the view was launched
    for (const c of document.body.children) scanForDialogs(c);
  }

  function stopDialogLifter() {
    if (dialogLifter) { dialogLifter.disconnect(); dialogLifter = null; }
    for (const el of document.querySelectorAll('[data-gcr-lifted]')) {
      const prev = el.getAttribute('data-gcr-lifted');
      el.style.zIndex = prev || '';
      el.removeAttribute('data-gcr-lifted');
    }
  }

  function closePanelView(reopenTable) {
    if (!panelView) return;
    const pv = panelView;
    panelView = null;
    for (const b of pv.borrowed) {
      const slotAlive = b.slot && b.slot.isConnected;
      if (slotAlive && b.slot.children.length === 0) {
        b.slot.appendChild(b.wrapper);
      } else if (b.wrapper.parentElement) {
        // React replaced this card while it was borrowed; ours is stale.
        b.wrapper.remove();
      }
      if (b.slot) b.slot.classList.remove('gcr-borrowed-slot');
    }
    if (pv.overlay.isConnected) pv.overlay.remove();
    stopDialogLifter();
    document.removeEventListener('keydown', onPanelViewKey, true);
    if (reopenTable) setTimeout(openModal, 40);
  }
  function onPanelViewKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); closePanelView(true); }
  }

  function openPanelView(rows, label) {
    if (panelView) closePanelView(false);
    const list = document.querySelector('[class*="Farm_itemList"]');
    if (!list) { alert('Planner list not found.'); return; }
    const usable = rows.filter(r => r.wrapper && r.wrapper.isConnected);
    if (!usable.length) { alert('Nothing to show.'); return; }

    // Measure now — once slots are hidden their width collapses to 0.
    const measured = measureSiteCardWidth(list);
    if (measured) panelCardWidth = measured;

    closeModal();

    const overlay = document.createElement('div');
    overlay.className = 'gcr-overlay';
    applyTheme(overlay);
    const modal = document.createElement('div');
    modal.className = 'gcr-modal gcr-pv-modal';

    const head = document.createElement('div');
    head.className = 'gcr-head';
    head.style.paddingBottom = '8px';
    head.style.borderBottom = '1px solid rgba(255,255,255,0.18)';
    const title = document.createElement('span');
    title.className = 'gcr-title';
    title.textContent = `${usable.length} panels`;
    head.appendChild(title);
    const sub = document.createElement('span');
    sub.className = 'gcr-pv-note';
    sub.textContent = label ? `· ${label}` : '';
    head.appendChild(sub);
    const note = document.createElement('span');
    note.className = 'gcr-pv-note';
    note.style.marginLeft = '12px';
    note.textContent = 'Edit, ascend and material clicks work. Pause and delete are hidden here.';
    head.appendChild(note);

    const back = document.createElement('button');
    back.className = 'gcr-x';
    back.style.marginLeft = 'auto';
    back.textContent = '← Table';
    back.addEventListener('click', () => closePanelView(true));
    head.appendChild(back);

    const colWrap = document.createElement('span');
    colWrap.className = 'gcr-pv-note';
    colWrap.style.marginLeft = '10px';
    colWrap.textContent = 'Columns ';
    const colSel = document.createElement('select');
    colSel.className = 'gcr-sel';
    for (const opt of ['auto', '1', '2', '3', '4']) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      if (String(panelColumns) === opt) o.selected = true;
      colSel.appendChild(o);
    }
    colSel.addEventListener('change', () => {
      panelColumns = colSel.value === 'auto' ? 'auto' : parseInt(colSel.value, 10);
      if (panelView) applyPanelColumns(panelView.host);
    });
    colWrap.appendChild(colSel);
    head.appendChild(colWrap);

    const x = document.createElement('button');
    x.className = 'gcr-x gcr-close';
    x.style.marginLeft = '6px';
    x.textContent = 'Close';
    x.title = 'Close';
    x.addEventListener('click', () => closePanelView(false));
    head.appendChild(x);
    modal.appendChild(head);

    // Own grid, not the site's — the site's column sizing overflows inside a
    // narrower modal. auto-fill + min-width:0 guarantees no horizontal scroll.
    const host = document.createElement('div');
    host.className = 'gcr-pv-host';
    applyPanelColumns(host);
    const borrowed = [];
    for (const r of usable) {
      const w = r.wrapper;
      const slot = w.parentElement;
      if (!slot) continue;
      borrowed.push({ wrapper: w, slot });
      slot.classList.add('gcr-borrowed-slot');
      host.appendChild(w);
    }
    modal.appendChild(host);
    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closePanelView(true); });
    // MUST live inside the React root container, or React's delegated event
    // listener never sees clicks on the borrowed cards.
    reactRootContainer().appendChild(overlay);
    applyOverlayOffset(overlay);
    document.addEventListener('keydown', onPanelViewKey, true);

    panelView = { overlay, borrowed, host };
    startDialogLifter();
    console.log(`[gc-roster] panel view: borrowed ${borrowed.length} cards into ${reactRootContainer().id || 'root'}`);
  }

  function filterLabel(tab) {
    const v = view[tab];
    const parts = [];
    const named = { element: 'Element', weapon: 'Weapon', wtype: 'Type', rarity: '★', days: 'Day', status: '', owned: '' };
    for (const k of Object.keys(v.f)) {
      if (!v.f[k].size) continue;
      const vals = [...v.f[k]].map(x => (k === 'days' ? DAY_SHORT[x] : titleCase(String(x))));
      parts.push((named[k] ? named[k] + ' ' : '') + vals.join('/'));
    }
    const sortLabel = (COLUMNS[tab].find(c => c.sort === v.sortKey) || {}).label || v.sortKey;
    parts.push(`sorted by ${sortLabel} ${v.sortDir === 1 ? '↑' : '↓'}`);
    return parts.join(' · ');
  }

  // ============================================================
  // Rendering
  // ============================================================
  function chip(label, value, set, colorMap, extraClass) {
    const b = document.createElement('button');
    b.className = 'gcr-chip' + (set.has(value) ? ' on' : '') + (extraClass ? ' ' + extraClass : '');
    b.textContent = label;
    if (colorMap && colorMap[value]) b.style.setProperty('--chip', colorMap[value]);
    b.addEventListener('click', () => {
      if (set.has(value)) set.delete(value); else set.add(value);
      render();
    });
    return b;
  }

  function filterRow(label, chips) {
    const row = document.createElement('div');
    row.className = 'gcr-frow';
    const l = document.createElement('span');
    l.className = 'gcr-flabel';
    l.textContent = label;
    row.appendChild(l);
    for (const c of chips) row.appendChild(c);
    return row;
  }

  // Pickable material groups actually used by this tab's roster, with a count
  // of how many rows use each. Family groups (talent books, weapon mats,
  // gems, common drops) collapse tiers; local/boss/weekly stay individual.
  function materialOptionsFor(tab) {
    const idx = buildMaterialIndex();
    const counts = new Map();
    for (const r of (data[tab] || [])) {
      const mg = r.matGroups;
      if (!mg) continue;
      for (const k of mg) counts.set(k, (counts.get(k) || 0) + 1);
    }
    const opts = [];
    for (const [key, count] of counts) {
      const g = idx.groups.get(key);
      if (!g) continue;
      opts.push({ key, label: g.label, category: g.category, count });
    }
    opts.sort((a, b) => a.label.toLowerCase() < b.label.toLowerCase() ? -1 : 1);
    return opts;
  }

  // Searchable material filter: type to match a material/family by name, click
  // to add. Multiple picks combine per the ANY/ALL toggle. Typing updates the
  // results list directly (no full re-render) so focus and caret are kept;
  // committing a pick re-renders the table.
  function buildMaterialPicker(v, tab) {
    const idx = buildMaterialIndex();
    const row = document.createElement('div');
    row.className = 'gcr-frow gcr-matrow';
    const l = document.createElement('span');
    l.className = 'gcr-flabel';
    l.textContent = 'MATERIAL';
    row.appendChild(l);

    for (const key of v.f.materials) {
      const g = idx.groups.get(key);
      const b = document.createElement('button');
      b.className = 'gcr-chip on gcr-matchip';
      b.textContent = (g ? g.label : key) + '  ✕';
      b.title = 'Remove this material filter';
      b.addEventListener('click', () => { v.f.materials.delete(key); render(); });
      row.appendChild(b);
    }

    const wrap = document.createElement('span');
    wrap.className = 'gcr-matsearch-wrap';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'gcr-matsearch';
    input.placeholder = v.f.materials.size ? '+ another…' : 'type a material…';
    const results = document.createElement('div');
    results.className = 'gcr-matresults';
    results.style.display = 'none';

    const opts = materialOptionsFor(tab);
    const populate = () => {
      const q = input.value.trim().toLowerCase();
      results.innerHTML = '';
      if (!q) { results.style.display = 'none'; return; }
      const matches = opts
        .filter(o => !v.f.materials.has(o.key) && o.label.toLowerCase().includes(q))
        .slice(0, 40);
      results.style.display = 'block';
      if (!matches.length) {
        results.innerHTML = '<div class="gcr-matnone">no matches</div>';
        return;
      }
      for (const o of matches) {
        const item = document.createElement('button');
        item.className = 'gcr-matopt';
        item.innerHTML = `<span>${escapeHtml(o.label)}</span><span class="gcr-matcount">${o.count}</span>`;
        item.addEventListener('mousedown', (e) => {
          e.preventDefault(); // keep focus off the blur race
          v.f.materials.add(o.key);
          render();
        });
        results.appendChild(item);
      }
    };
    input.addEventListener('input', populate);
    input.addEventListener('focus', populate);
    input.addEventListener('blur', () => { setTimeout(() => { results.style.display = 'none'; }, 150); });
    wrap.appendChild(input);
    wrap.appendChild(results);
    row.appendChild(wrap);

    if (v.f.materials.size >= 2) {
      const t = document.createElement('button');
      t.className = 'gcr-chip gcr-matmode';
      t.textContent = v.matMode === 'and' ? 'ALL of these' : 'ANY of these';
      t.title = 'Switch between matching rows that use ANY vs ALL of the selected materials';
      t.addEventListener('click', () => { v.matMode = v.matMode === 'and' ? 'or' : 'and'; render(); });
      row.appendChild(t);
    }
    return row;
  }

  // Clicking a material name should open the site's own inventory dialog.
  // Rather than guess at the internal handler's signature, find that
  // material's real clickable element in the page (matched on its image
  // filename) and click it — the site's handler does the rest.
  function findMaterialClickable(img) {
    if (!img) return null;
    const needle = `/mats/${img}.png`;
    for (const n of document.querySelectorAll('[class*="Material_materialImg"] [class*="containedImage"]')) {
      const bg = n.style.backgroundImage || '';
      if (!bg.includes(needle)) continue;
      // Walk up to the wrapper the site marks clickable.
      let el = n;
      for (let i = 0; i < 6 && el && el !== document.body; i++) {
        if (el.style && el.style.cursor === 'pointer') return el;
        el = el.parentElement;
      }
      return n;
    }
    return null;
  }

  // The site's dialogs each get their own body-level container, created when
  // the dialog opens and removed ~1.5s after it closes (verified live):
  //   #editor           — Edit
  //   #ascension        — Ascend
  //   #dynamicinventory — a material's inventory (clicked from a card)
  // Look them up fresh on every tick: the old version held on to #editor
  // itself, which doesn't exist until a dialog opens (so it fired ~1s after
  // the click, before anything was entered) and is a detached node after
  // closing (so it would never have seen the close).
  const SITE_DIALOG_IDS = ['editor', 'ascension', 'dynamicinventory'];
  function siteDialogOpen() {
    for (const id of SITE_DIALOG_IDS) {
      const el = document.getElementById(id);
      if (el && el.children.length > 0) return true;
    }
    return false;
  }

  // Run cb once the dialog just opened has closed. If no dialog shows up
  // within ~3s (the click didn't open one), run cb anyway.
  function watchDialogThen(cb) {
    let opened = false, ticks = 0;
    const iv = setInterval(() => {
      ticks++;
      const open = siteDialogOpen();
      if (open) opened = true;
      const neverOpened = !opened && ticks > 10;         // ~3s
      const gaveUp = ticks > 6000;                         // ~30 min left open
      if ((opened && !open) || neverOpened || gaveUp) { clearInterval(iv); cb(); }
    }, 300);
  }

  // ---- The site's own material tooltip (name, image, sources, users) ----
  // Each material on a card has a wrapper whose React onMouseEnter shows the
  // tooltip, positioned from e.currentTarget's rect. Calling that handler with
  // our table cell as currentTarget shows the real tooltip next to the cell.
  // It renders in the site's #goop layer (z-index 10000), above this modal.
  function reactPropsOf(el) {
    for (const k in el) if (k.startsWith('__reactProps$')) return el[k];
    return null;
  }
  function findMaterialTipHost(img) {
    if (!img) return null;
    const path = `/mats/${img}.png`;
    for (const n of document.querySelectorAll('[class*="Material_materialImg"] [class*="containedImage"]')) {
      if (!(n.style.backgroundImage || '').includes(path)) continue;
      let el = n;
      for (let i = 0; i < 8 && el && el !== document.body; i++) {
        const p = reactPropsOf(el);
        if (p && typeof p.onMouseEnter === 'function') return el;
        el = el.parentElement;
      }
    }
    return null;
  }
  let siteTip = null; // { host, anchor }
  function showSiteTip(anchor, img) {
    if (siteTip && siteTip.anchor === anchor) return;
    hideSiteTip();
    const host = findMaterialTipHost(img);
    const p = host && reactPropsOf(host);
    if (!p) return;
    const r = anchor.getBoundingClientRect();
    try {
      p.onMouseEnter({ currentTarget: anchor, target: anchor, type: 'mouseenter',
        clientX: r.left, clientY: r.top, preventDefault() {}, stopPropagation() {} });
      siteTip = { host, anchor };
    } catch (e) { console.warn('[gc-roster] material tooltip failed', e); }
  }
  function hideSiteTip() {
    if (!siteTip) return;
    const p = reactPropsOf(siteTip.host); // read fresh: props change on re-render
    siteTip = null;
    try { if (p && typeof p.onMouseLeave === 'function') p.onMouseLeave({ type: 'mouseleave' }); } catch (e) { /* ignore */ }
  }

  function openMaterialDialog(img, name) {
    hideSiteTip();
    const el = findMaterialClickable(img);
    if (!el) {
      alert(`"${name}" isn't shown on any card right now, so its inventory dialog can't be opened.\n\n` +
            'It appears here because spare copies are still convertible, but nothing currently requires it. ' +
            'Use Manage Inventory to adjust it.');
      return;
    }
    el.click();
    watchDialogThen(() => { if (overlay && activeTab === 'weekly') render(); });
  }

  // The site's header is pinned at the top; a vertically centred modal at
  // 90vh tucks its top edge underneath it. Measure the header and offset the
  // overlay by it, then size the modal to whatever space is actually left.
  function headerOffset() {
    let max = 0;
    for (const sel of ['[class*="Header_header"]', '[class*="Header_mobileHeader"]']) {
      for (const el of document.querySelectorAll(sel)) {
        let cs;
        try { cs = window.getComputedStyle(el); } catch (e) { continue; }
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.top <= 4 && r.height < window.innerHeight / 2) {
          max = Math.max(max, Math.ceil(r.bottom));
        }
      }
    }
    return max;
  }

  function applyOverlayOffset(ov) {
    if (!ov) return;
    const off = headerOffset();
    ov.style.paddingTop = off + 'px';
    // 24px of breathing room top and bottom
    ov.style.setProperty('--gcr-maxh', `calc(100vh - ${off + 32}px)`);
  }

  function onViewportResize() {
    if (overlay) applyOverlayOffset(overlay);
    if (panelView) applyOverlayOffset(panelView.overlay);
  }
  window.addEventListener('resize', onViewportResize);

  function fmtNet(n) {
    if (n > 0) return `<span class="gcr-pos">+${n}</span>`;
    if (n < 0) return `<span class="gcr-neg">${n}</span>`;
    return '<span class="gcr-zero">0</span>';
  }

  function renderWeekly(modal) {
    const result = gatherWeekly();
    const scroll = document.createElement('div');
    scroll.className = 'gcr-scroll';

    if (result.error) {
      const e = document.createElement('div');
      e.className = 'gcr-empty';
      e.textContent = result.error;
      scroll.appendChild(e);
      modal.appendChild(scroll);
      return;
    }

    const groups = (result.groups || []).filter(g => !weeklyShortfallsOnly || g.total.net < 0);

    if (!groups.length) {
      const e = document.createElement('div');
      e.className = 'gcr-empty';
      e.textContent = (result.groups || []).length
        ? 'No weekly bosses are short right now.'
        : 'No weekly boss materials are required by your active entries.';
      scroll.appendChild(e);
      modal.appendChild(scroll);
      return;
    }

    // One table for everything: guarantees the columns line up across bosses.
    const t = document.createElement('table');
    t.className = 'gcr-wt';
    let html =
      '<colgroup><col class="c-mat"><col class="c-num"><col class="c-num"><col class="c-num"></colgroup>' +
      '<thead><tr><th>Material</th><th>Have</th><th>Need</th><th>Net</th></tr></thead><tbody>';

    for (const g of groups) {
      const covered = g.total.net >= 0;
      html += `<tr class="bosshead${covered ? ' covered' : ''}"><td colspan="4">` +
              `<span class="gcr-boss-name">${escapeHtml(g.label)}</span></td></tr>`;
      for (const r of g.rows) {
        const dim = (r.have === 0 && r.need === 0) ? ' zero' : '';
        const clickable = !!findMaterialClickable(r.img);
        const nameCell = clickable
          ? `<span class="gcr-matlink" data-img="${escapeHtml(r.img || '')}" data-name="${escapeHtml(r.name)}">` +
            `${escapeHtml(r.name)}</span>`
          : `<span class="gcr-matplain" title="Not shown on any card right now — adjust via Manage Inventory">` +
            `${escapeHtml(r.name)}</span>`;
        html += `<tr class="matrow${covered ? ' covered' : ''}${dim}">` +
                `<td>${nameCell}</td>` +
                `<td>${r.have}</td><td>${r.need}</td><td>${fmtNet(r.net)}</td></tr>`;
      }
      html += `<tr class="total${covered ? ' covered' : ''}"><td>Total</td>` +
              `<td>${g.total.have}</td><td>${g.total.need}</td>` +
              `<td class="gcr-net-big">${fmtNet(g.total.net)}</td></tr>`;
    }
    html += '</tbody>';
    t.innerHTML = html;
    t.addEventListener('click', (e) => {
      const link = e.target.closest && e.target.closest('.gcr-matlink');
      if (!link) return;
      e.stopPropagation();
      openMaterialDialog(link.getAttribute('data-img'), link.getAttribute('data-name'));
    });
    t.addEventListener('mouseover', (e) => {
      const link = e.target.closest && e.target.closest('.gcr-matlink');
      if (link && S.rosterWeeklyTips) showSiteTip(link, link.getAttribute('data-img'));
    });
    t.addEventListener('mouseout', (e) => {
      if (!siteTip) return;
      const to = e.relatedTarget;
      if (to && siteTip.anchor.contains(to)) return;
      hideSiteTip();
    });
    scroll.addEventListener('scroll', hideSiteTip, { passive: true });
    scroll.appendChild(t);
    modal.appendChild(scroll);
  }

  function render() {
    if (!overlay) return;
    hideSiteTip();
    const modal = overlay.querySelector('.gcr-modal');
    modal.innerHTML = '';

    // ---- Head / tabs ----
    const head = document.createElement('div');
    head.className = 'gcr-head';
    const tabDefs = [
      ['characters', 'Characters'],
      ['weapons', 'Weapons'],
      ...(S.rosterWeekly ? [['weekly', 'Weekly bosses']] : [])
    ];
    for (const [tab, label] of tabDefs) {
      const b = document.createElement('button');
      b.className = 'gcr-tab' + (activeTab === tab ? ' on' : '');
      b.innerHTML = tab === 'weekly'
        ? label
        : `${label}<span class="gcr-tabn">${(data[tab] || []).length}</span>`;
      b.addEventListener('click', () => { activeTab = tab; render(); });
      head.appendChild(b);
    }
    const x = document.createElement('button');
    x.className = 'gcr-x gcr-close';
    x.style.marginLeft = 'auto';
    x.textContent = 'Close';
    x.title = 'Close (Esc)';
    x.addEventListener('click', closeModal);
    head.appendChild(x);
    modal.appendChild(head);

    if (activeTab === 'weekly') {
      const filters = document.createElement('div');
      filters.className = 'gcr-filters';
      const only = document.createElement('button');
      only.className = 'gcr-chip' + (weeklyShortfallsOnly ? ' on' : '');
      only.textContent = 'Only shortfalls';
      only.addEventListener('click', () => { weeklyShortfallsOnly = !weeklyShortfallsOnly; render(); });
      filters.appendChild(filterRow('SHOW', [only]));
      modal.appendChild(filters);

      renderWeekly(modal);

      const foot = document.createElement('div');
      foot.className = 'gcr-foot';
      const note = document.createElement('span');
      note.textContent = 'Net is per boss — Dream Solvent converts between that boss\u2019s materials.';
      foot.appendChild(note);
      const refresh = document.createElement('button');
      refresh.className = 'gcr-btn';
      refresh.style.marginLeft = 'auto';
      refresh.textContent = 'Refresh';
      refresh.addEventListener('click', render);
      foot.appendChild(refresh);
      modal.appendChild(foot);
      return;
    }

    const v = view[activeTab];
    const rows = rowsFor(activeTab);
    const all = data[activeTab] || [];

    // ---- Filters ----
    const filters = document.createElement('div');
    filters.className = 'gcr-filters';
    const today = new Date().getDay();

    if (activeTab === 'characters') {
      filters.appendChild(filterRow('ELEMENT',
        ELEMENTS.map(e => chip(titleCase(e), e, v.f.element, ELEMENT_COLORS))));
      filters.appendChild(filterRow('WEAPON',
        WEAPON_TYPES.map(w => chip(titleCase(w), w, v.f.weapon, null))));
    } else {
      filters.appendChild(filterRow('TYPE',
        WEAPON_TYPES.map(w => chip(titleCase(w), w, v.f.wtype, null))));
    }

    // Rarity chips derived from what's actually on this tab (characters are
    // only 4-5★; weapons span 1-5★) rather than a hardcoded list.
    const raritiesPresent = [...new Set((data[activeTab] || []).map(r => r.rarity).filter(Boolean))]
      .sort((a, b) => b - a);
    if (raritiesPresent.length) {
      filters.appendChild(filterRow('RARITY',
        raritiesPresent.map(n => chip(`${n}★`, n, v.f.rarity, RARITY_COLORS))));
    }

    filters.appendChild(filterRow('DOMAIN',
      FILTER_DAYS.map(d => chip(DAY_SHORT[d], d, v.f.days, null, d === today ? 'today' : ''))));

    if (S.rosterMatFilter) filters.appendChild(buildMaterialPicker(v, activeTab));

    const statusChips = STATUSES.map(s => chip(titleCase(s), s, v.f.status, STATUS_COLORS));
    if (activeTab === 'characters') {
      for (const o of OWNERSHIP) statusChips.push(chip(titleCase(o), o, v.f.owned, OWNERSHIP_COLORS));
    }
    const sRow = filterRow('SHOW', statusChips);
    if (anyFilterActive(v)) {
      const clear = document.createElement('button');
      clear.className = 'gcr-clear';
      clear.textContent = 'show all';
      clear.title = 'Remove every filter on this tab, including the default active-only filter';
      clear.addEventListener('click', () => { clearFilters(v); render(); });
      sRow.appendChild(clear);
    }
    filters.appendChild(sRow);
    modal.appendChild(filters);

    // ---- Table ----
    const scroll = document.createElement('div');
    scroll.className = 'gcr-scroll';

    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'gcr-empty';
      const pausedAll = all.length > 0 && all.every(r => r.paused);
      if (all.length === 0) {
        empty.textContent = `No ${activeTab} found on the planner.`;
      } else if (pausedAll && v.f.status.size === 1 && v.f.status.has('active')) {
        empty.textContent = `All ${all.length} ${activeTab} are paused. Turn on the "Paused" chip to see them.`;
      } else {
        empty.textContent = 'Nothing matches the current filters.';
      }
      scroll.appendChild(empty);
    } else {
      const cols = COLUMNS[activeTab];
      const table = document.createElement('table');
      table.className = 'gcr-table';

      const thead = document.createElement('thead');
      const htr = document.createElement('tr');
      for (const c of cols) {
        const th = document.createElement('th');
        if (c.num) th.className = 'num';
        if (v.sortKey === c.sort) {
          th.classList.add('sorted');
          th.innerHTML = `${c.label} <span class="gcr-arrow">${v.sortDir === 1 ? '▲' : '▼'}</span>`;
        } else {
          th.textContent = c.label;
        }
        th.addEventListener('click', () => {
          if (v.sortKey === c.sort) v.sortDir *= -1;
          else { v.sortKey = c.sort; v.sortDir = c.num ? -1 : 1; }
          render();
        });
        htr.appendChild(th);
      }
      if (S.rosterRowActions) {
        const thAct = document.createElement('th');
        thAct.className = 'num';
        thAct.style.cursor = 'default';
        htr.appendChild(thAct);
      }
      thead.appendChild(htr);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      for (const r of rows) {
        const tr = document.createElement('tr');
        tr.className = 'gcr-row' + (r.paused ? ' paused' : '');
        tr.title = 'Click to jump to this card';
        tr.addEventListener('click', () => jumpTo(r));
        for (const c of cols) {
          const td = document.createElement('td');
          if (c.num) td.className = 'num';
          td.innerHTML = c.cell(r);
          tr.appendChild(td);
        }
        if (S.rosterRowActions) {
        const tdAct = document.createElement('td');
        tdAct.className = 'num gcr-acts';
        for (const [kind, glyph, title] of [['edit', '✎', 'Edit'], ['ascend', '⇧', 'Ascend']]) {
          const b = document.createElement('button');
          b.className = 'gcr-pw';
          b.textContent = glyph;
          b.title = title;
          b.addEventListener('click', (e) => { e.stopPropagation(); openCardDialog(r, kind); });
          tdAct.appendChild(b);
        }
        const pw = document.createElement('button');
        pw.className = 'gcr-pw';
        pw.textContent = r.paused ? '▶' : '⏸';
        pw.title = r.paused ? 'Resume' : 'Pause';
        pw.addEventListener('click', (e) => { e.stopPropagation(); togglePause(r); });
        tdAct.appendChild(pw);
        tr.appendChild(tdAct);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      scroll.appendChild(table);
    }
    modal.appendChild(scroll);

    // ---- Foot ----
    const foot = document.createElement('div');
    foot.className = 'gcr-foot';
    const activeCount = all.filter(r => !r.paused).length;
    const info = document.createElement('span');
    info.textContent = `${rows.length} shown · ${activeCount} active · ${all.length} total`;
    foot.appendChild(info);

    if (getInactivePanelMode() === 'Hide') {
      const lh = document.createElement('button');
      lh.className = 'gcr-btn';
      lh.textContent = 'Load hidden';
      lh.title = 'Temporarily reveal entries hidden by your panel settings';
      lh.addEventListener('click', loadHidden);
      foot.appendChild(lh);
    } else if (restoreHideMode) {
      const note = document.createElement('span');
      note.style.opacity = '0.7';
      note.textContent = '· hidden entries loaded; "Hide" restores on close';
      foot.appendChild(note);
    }

    const openPanels = document.createElement('button');
    openPanels.className = 'gcr-btn';
    openPanels.style.marginLeft = 'auto';
    openPanels.textContent = `▦ Open ${rows.length} panel${rows.length === 1 ? '' : 's'}`;
    openPanels.title = 'Show these entries as real planner cards, in this order';
    openPanels.disabled = rows.length === 0;
    openPanels.addEventListener('click', () => openPanelView(rows, filterLabel(activeTab)));
    if (S.rosterPanelView) foot.appendChild(openPanels);

    const refresh = document.createElement('button');
    refresh.className = 'gcr-btn';
    refresh.textContent = 'Refresh';
    refresh.addEventListener('click', () => { data = scrapeAll(); render(); });
    foot.appendChild(refresh);
    modal.appendChild(foot);
  }

  function openModal() {
    if (overlay) return;
    data = scrapeAll();
    overlay = document.createElement('div');
    overlay.className = 'gcr-overlay';
    applyTheme(overlay);
    const modal = document.createElement('div');
    modal.className = 'gcr-modal';
    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    document.body.appendChild(overlay);
    applyOverlayOffset(overlay);
    document.addEventListener('keydown', onModalKey, true);
    render();
  }
  function closeModal() {
    if (!overlay) return;
    hideSiteTip();
    overlay.remove();
    overlay = null;
    document.removeEventListener('keydown', onModalKey, true);
    if (restoreHideMode) { setInactivePanelMode(restoreHideMode); restoreHideMode = null; }
  }
  function onModalKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closeModal(); } }
  function toggleModal() { if (overlay) closeModal(); else openModal(); }

  // ============================================================
  // Trigger: cooperate with the sections script when it's present
  // ============================================================
  function sectionsScriptPresent() {
    return !!document.querySelector('[data-gc-tools-btn], [data-gc-tools-icon-btn]');
  }
  function cloneButtonFrom(existing, partPrefixes, labelText) {
    const btn = document.createElement('button');
    btn.className = existing.className;
    for (const prefix of partPrefixes) {
      const src = existing.querySelector(`[class*="${prefix}"]`);
      if (!src) continue;
      const clone = document.createElement('div');
      clone.className = src.className;
      if (labelText && prefix.endsWith('label')) clone.textContent = labelText;
      btn.appendChild(clone);
    }
    return btn;
  }
  function ensureOwnButtons() {
    const row = document.querySelector('[class*="Farm_centeredRectButtons"]');
    if (row) {
      const existing = row.querySelector('[class*="RectButton_button"]');
      if (existing && !row.querySelector('[data-gcr-btn]')) {
        const btn = cloneButtonFrom(existing, ['RectButton_inner', 'RectButton_border', 'RectButton_label'], '▤ Roster');
        btn.setAttribute('data-gcr-btn', 'true');
        btn.addEventListener('click', toggleModal);
        row.appendChild(btn);
      }
    }
    const irow = document.querySelector('[class*="Farm_centeredButtons"]');
    if (irow) {
      const existing = irow.querySelector('[class*="BigIconButton_button"]');
      if (existing && !irow.querySelector('[data-gcr-icon-btn]')) {
        const btn = cloneButtonFrom(existing, ['BigIconButton_inner', 'BigIconButton_image', 'BigIconButton_border'], null);
        btn.setAttribute('data-gcr-icon-btn', 'true');
        btn.title = 'Roster tables';
        const img = btn.querySelector('[class*="BigIconButton_image"]');
        if (img) {
          img.style.display = 'flex'; img.style.alignItems = 'center'; img.style.justifyContent = 'center';
          img.style.fontSize = '26px'; img.style.lineHeight = '1'; img.textContent = '▤';
        }
        btn.addEventListener('click', toggleModal);
        irow.appendChild(btn);
      }
    }
  }
  function removeOwnButtons() {
    document.querySelectorAll('[data-gcr-btn], [data-gcr-icon-btn]').forEach(el => el.remove());
  }
  function syncTrigger() {
    // Safety net: if the panel view's overlay vanished for any reason,
    // put the borrowed cards back rather than stranding them.
    if (panelView && !panelView.overlay.isConnected) {
      console.warn('[gc-roster] panel view overlay lost — restoring borrowed cards');
      closePanelView(false);
    }
    // Toolkit: the second row carries the Roster button; with that row off,
    // put it on the site's own row instead (unless the button is switched off).
    if (S.row || !S.rowRoster) removeOwnButtons(); else ensureOwnButtons();
  }

  const menuObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (!node.classList || !node.classList.contains('gc-menu')) continue;
        if (node.querySelector('[data-gcr-menu-entry]')) continue;
        const text = node.textContent || '';
        if (!/Add Section|Export section data/i.test(text)) continue;
        const sep = document.createElement('div');
        sep.className = 'gc-menu-sep';
        node.appendChild(sep);
        const entry = document.createElement('button');
        entry.setAttribute('data-gcr-menu-entry', 'true');
        entry.textContent = '▤ Roster tables';
        entry.addEventListener('click', () => setTimeout(toggleModal, 0));
        node.appendChild(entry);
      }
    }
  });
  menuObserver.observe(document.body, { childList: true, subtree: true });

  syncTrigger();
  setInterval(syncTrigger, 1500);

  if (HOTKEY) {
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) return;
      // Match the physical key: on macOS Option+R produces e.key '®', not 'r'.
      const want = 'Key' + HOTKEY.key.toUpperCase();
      if (e.code ? e.code !== want : (!e.key || e.key.toLowerCase() !== HOTKEY.key)) return;
      if (!!HOTKEY.alt !== e.altKey) return;
      if (!!HOTKEY.ctrl !== (e.ctrlKey || e.metaKey)) return;
      if (!!HOTKEY.shift !== e.shiftKey) return;
      e.preventDefault();
      toggleModal();
    });
  }

  window.__gcRoster = tag({
    showButton: !!S.rowRoster,
    open: openModal,
    close: closeModal,
    scrape: () => scrapeAll(),
    // Dump a weapon panel's raw props so the refinement field can be pinned down
    dumpWeaponProps: () => {
      const list = document.querySelector('[class*="Farm_itemList"]');
      if (!list) return 'planner list not found';
      refreshLiveProps();
      for (const w of list.querySelectorAll('[class*="ItemPanel_itemWrapper"]')) {
        const img = w.querySelector('[class*="ItemPanel_itemImage"] [class*="containedImage"]');
        const bg = img ? (img.style.backgroundImage || '') : '';
        if (!/\/images\/weapons\//i.test(bg)) continue;
        const p = findItemProps(w);
        if (!p) return 'no React props found on weapon panels';
        return { item: p.item, current: p.current, desired: p.desired, type: p.type, paused: p.paused };
      }
      return 'no weapon panels on the planner';
    }
  });

  console.log('[gc-roster] module ready' + (HOTKEY ? ' (Alt+R)' : ''));
  }

  // ============================================================
  // 6. Module: Artifact Goals
  //    (was genshincenter.artifacts.user.js 0.2.0; same storage keys)
  // ============================================================
  function moduleArtifacts(S) {

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
      if (S.artCardChecks) {
        chk.addEventListener('click', (e) => { e.stopPropagation(); toggleDoneFromCard(charKey, def.key); });
      } else {
        chk.disabled = true; chk.style.cursor = 'default'; chk.title = b.done[def.key] ? 'Done' : 'Not done';
      }
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
    // Ad bars animate in and change height; keep the largest seen while open.
    const reserve = editor.reserve = Math.max(editor.reserve || 0, bottomReserve());
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
    editor.fitTimer = setInterval(fitModal, 500); // ad bars can appear or grow while open
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
  window.__gcArtifacts = tag({
    version: '0.2.0',
    state: () => state,
    profiles: () => allData,
    profileKey: () => currentProfileKey,
    sets: () => ARTIFACT_SETS,
    open: (charKey) => openEditor(charKey),
    close: () => closeEditor(),
    activeBuild: (charKey) => activeBuildOf(state.characters[charKey]),
    reapply: () => scheduleApply()
  });

  console.log('[gc-artifacts] v0.2.0 loaded');
  }

  // ============================================================
  // 6. Module: Section Organizer (+ second row, scroll-wheel, panel collapse)
  //    (was genshincenter.sectionorganizer.user.js 2.1.0; same storage keys)
  // ============================================================
  function moduleSections(S) {

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
  const SCROLL_ADJUST_ON_HOVER = S.wheelHover === 'hover';
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
    /* ---- Section title bar (styled after the site's card name bars) ---- */
    .gc-section-header {
      width: 100%;
      box-sizing: border-box;
      /* Span the full row regardless of whether the parent is grid or flex */
      grid-column: 1 / -1;
      flex-basis: 100%;
      /* Tint toward the section colour, like a card's rarity gradient */
      background: linear-gradient(160deg,
        rgba(40, 44, 62, 0.95) 0%,
        color-mix(in srgb, var(--sec-color, #888) 30%, rgba(40, 44, 62, 0.95)) 45%,
        color-mix(in srgb, var(--sec-color, #888) 62%, transparent) 100%);
      border-radius: 5px;
      padding: 6px 10px;
      margin: 0;
      min-height: 46px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: 'Montserrat', sans-serif;
      color: #ece5d8;
    }
    /* Collapse arrow: the site's own (same as the Options panel) */
    .gc-section-toggle {
      cursor: pointer;
      user-select: none;
      flex-shrink: 0;
      width: 26px; height: 26px;
      background: url("/images/general/wup.png") center / contain no-repeat;
      transition: transform 0.2s;
    }
    .gc-section-header[data-collapsed="true"] .gc-section-toggle { transform: rotate(180deg); }
    .gc-section-name {
      flex: 1;
      min-width: 0;
      cursor: pointer;
      text-align: center;
      font-size: 24px;
      font-weight: 800;
      letter-spacing: 0.3px;
      color: #ece5d8;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .gc-section-count {
      font-size: 13px;
      font-weight: 600;
      color: rgba(236, 229, 216, 0.75);
      white-space: nowrap;
    }
    /* Generic small button (also used by the export/import dialog) */
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
    .gc-btn:disabled { opacity: 0.3; cursor: default; }
    .gc-btn:disabled:hover { background: rgba(255, 255, 255, 0.08); border-color: rgba(255, 255, 255, 0.18); }
    .gc-btn-danger:hover { background: rgba(220, 80, 80, 0.35); border-color: rgba(255, 120, 120, 0.6); color: #ffd5d5; }
    /* Title-bar buttons: round, icon-only, like the site's icon buttons.
       Flex-centred: line-height alone leaves symbol glyphs ~8px off-centre. */
    .gc-section-controls { display: flex; gap: 6px; flex-shrink: 0; }
    .gc-section-header .gc-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; padding: 0;
      border-radius: 50%; border: none;
      background: rgba(219, 207, 184, 0.6);
      color: #000;
      font-family: "Segoe UI Symbol", "Noto Sans Symbols 2", 'Montserrat', sans-serif;
      font-size: 17px; font-weight: 700; line-height: 1;
      box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
    }
    .gc-section-header .gc-btn:hover:not(:disabled) { background: #ece5d8; box-shadow: 0 0 7px #aaa; }
    .gc-section-header .gc-btn:disabled { opacity: 0.35; }
    .gc-section-header .gc-btn:disabled:hover { background: rgba(219, 207, 184, 0.6); }
    .gc-section-header .gc-btn-danger { margin-left: 10px; } /* delete sits apart */
    .gc-section-header .gc-btn-danger:hover { background: rgb(252, 68, 69); color: #fff; }
    .gc-color-swatch {
      width: 16px; height: 16px;
      border-radius: 3px;
      border: 1px solid rgba(255,255,255,0.35);
      cursor: pointer;
      flex-shrink: 0;
      box-shadow: 0 0 0 1px rgba(0,0,0,0.3);
    }
    .gc-section-header .gc-color-swatch { width: 14px; height: 14px; border-radius: 50%; }
    /* Phone: name on top, buttons centred on a second row */
    @media (max-width: 640px) {
      .gc-section-header { flex-wrap: wrap; row-gap: 6px; }
      .gc-section-name { font-size: 20px; }
      .gc-section-controls { flex-basis: 100%; justify-content: center; }
      .gc-section-header .gc-btn { width: 34px; height: 34px; }
    }

    /* Space between sections so neighbouring boxes don't touch */
    .gc-has-boxes > [data-gc-section-header] ~ [data-gc-section-header] { margin-top: 14px; }

    /* ---- Unassigned: a plain label, no bar and no box ---- */
    .gc-section-header.gc-unassigned-header {
      background: none;
      min-height: 0;
      padding: 0 4px;
      margin: 14px 0 -4px;
    }
    .gc-unassigned-header .gc-section-name {
      flex: 0 0 auto;
      cursor: default;
      text-align: left;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      text-shadow: none;
      color: rgba(236, 229, 216, 0.5);
    }
    .gc-unassigned-header .gc-section-count { color: rgba(236, 229, 216, 0.4); }

    /* ---- Section box: drawn BEHIND the section's cards ----
       The cards stay direct children of the site's list (React owns them);
       the box is a separate element sized to cover title bar + cards. */
    .gc-has-boxes { position: relative; }
    .gc-has-boxes > :not(.gc-section-box) { position: relative; z-index: 1; }
    .gc-section-box {
      position: absolute;
      z-index: 0;
      pointer-events: none;
      border-radius: 6px;
      background: rgba(48, 54, 78, 0.55);
      border: 1px solid color-mix(in srgb, var(--sec-color, #888) 45%, transparent);
      box-shadow: 0 0 6px rgba(0, 0, 0, 0.6);
    }

    /* ---- Per-card section badge (strip below the name bar); click to move ---- */
    .gc-item-section-badge {
      display: block;
      width: 100%;
      box-sizing: border-box;
      font-family: 'Montserrat', sans-serif;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.3px;
      text-align: center;
      padding: 4px 8px;
      margin: 0;
      background: rgba(30, 34, 49, 0.95);
      color: rgba(236, 229, 216, 0.85);
      border: none;
      border-bottom: 2px solid color-mix(in srgb, var(--badge-sec-color, #888) 70%, transparent);
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: filter 0.15s, opacity 0.2s;
      position: relative;
      z-index: 2;
    }
    .gc-item-section-badge::before { content: "\\21C4  "; opacity: 0.6; }
    .gc-item-section-badge:hover { filter: brightness(1.25); }
    .gc-item-section-badge.unassigned {
      color: rgba(236, 229, 216, 0.55);
      border-bottom: 2px dashed rgba(255, 255, 255, 0.2);
    }
    .gc-item-section-badge.unassigned:hover { color: #ece5d8; }
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
    toggle.title = sec.collapsed ? 'Expand' : 'Collapse';
    toggle.setAttribute('role', 'button');
    toggle.setAttribute('aria-label', toggle.title);
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
    pauseBtn.textContent = '⏸';
    pauseBtn.title = 'Pause all active items in this section';
    pauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSectionPause(sec.id, true);
    });
    controls.appendChild(pauseBtn);

    const resumeBtn = document.createElement('button');
    resumeBtn.className = 'gc-btn';
    resumeBtn.textContent = '▶';
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
  // React double-buffers fibers: the fiber linked from a DOM node can be the
  // stale copy, whose props (selection, index) lag one render behind. The
  // container's root always points at the committed tree, so walk from there.
  function liveRootFiber() {
    const cands = [document.getElementById('__next'), ...Array.from(document.body.children)];
    for (const c of cands) {
      if (!c) continue;
      for (const k in c) {
        if (k.startsWith('__reactContainer$')) {
          const f = c[k];
          return (f && f.stateNode && f.stateNode.current) || f || null;
        }
      }
    }
    return null;
  }
  function isCardProps(p) {
    return !!(p && typeof p === 'object' && typeof p.index === 'number' && p.item && p.current);
  }
  // One DFS over the committed tree: finds the hub and maps each card
  // wrapper element -> its selection index.
  function scanLiveTree() {
    const out = { hub: null, indexByWrapper: new Map() };
    const root = liveRootFiber();
    if (!root) return out;
    const stack = [[root, null]];
    let steps = 0;
    while (stack.length && steps < 400000) {
      const [f, inherited] = stack.pop(); steps++;
      const p = f.memoizedProps;
      if (!out.hub && p && typeof p === 'object' && Array.isArray(p.selection) && typeof p.setSelection === 'function') out.hub = p;
      const cardProps = isCardProps(p) ? p : inherited;
      const el = f.stateNode;
      if (cardProps && typeof f.type === 'string' && el && el.nodeType === 1 &&
          String(el.className).includes('ItemPanel_itemWrapper')) {
        out.indexByWrapper.set(el, cardProps.index);
      }
      if (f.sibling) stack.push([f.sibling, inherited]);
      if (f.child) stack.push([f.child, cardProps]);
    }
    return out;
  }
  let LIVE_SCAN = null;
  function findSelectionHub() {
    LIVE_SCAN = scanLiveTree();
    if (LIVE_SCAN.hub) return LIVE_SCAN.hub;
    // Fallback: old walk-up from a card (may be one render stale).
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
  // Uses the scan made by the preceding findSelectionHub() call.
  function cardSelectionIndex(wrapper) {
    if (LIVE_SCAN && LIVE_SCAN.indexByWrapper.has(wrapper)) return LIVE_SCAN.indexByWrapper.get(wrapper);
    let n = getFiber(wrapper), d = 0;
    while (n && d < 30) {
      const p = n.memoizedProps;
      if (isCardProps(p)) return p.index;
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

    // Everyday actions live on the second button row. This menu keeps only
    // the rare or risky ones: Sync rewrites the site's real order and Import
    // replaces data, so neither should be one stray click away.
    // NOTE: the Export/Import labels deliberately avoid "Export section data" —
    // the roster script looks for that text to add its own menu entry, and
    // Roster now has its own button on the row instead.
    let any = false;
    if (S.sections && S.orderSync) {
      addItem('⇅ Sync order to planner', syncOrderToPlanner, noSections);
      if (hasOrderBackup()) addItem('↶ Undo order sync', undoOrderSync);
      any = true;
    }
    if (goalsAvailable()) {
      if (any) addSep();
      addItem('↶ Undo goal change', () => window.__gcGoals.undo(), !window.__gcGoals.canUndo());
      any = true;
    }
    if (S.sections) {
      if (any) addSep();
      addItem('⇪ Export sections', exportState);
      addItem('⇩ Import sections', importState);
      any = true;
    }
    addSep();

    if (S.sections) {
      const info = document.createElement('button');
      info.textContent = `Profile: ${currentProfileKey === DEFAULT_PROFILE ? '(default)' : currentProfileKey}`;
      info.disabled = true;
      menu.appendChild(info);
    } else if (menu.lastChild && menu.lastChild.className === 'gc-menu-sep') {
      menu.lastChild.remove();
    }

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

  // ---------- Second button row ----------
  // Measured on the live site:
  //   Farm_listWrapper   (flex COLUMN)
  //     Farm_buttons     (flex ROW, no wrap)
  //       Farm_centeredRectButtons  — desktop: 4 fixed 202px RectButtons
  //       Farm_centeredButtons      — phone:   5 fixed 50px BigIconButtons
  // A sibling of the button row would land inside Farm_buttons and sit BESIDE
  // it as a column (v2.0.0's bug). So our row is a sibling of Farm_buttons
  // instead, inside the column wrapper, which makes it a true second row. It
  // copies Farm_buttons' class (same centring) and holds a copy of each site
  // row; the site's own responsive CSS hides whichever one doesn't apply.
  function rosterAvailable() {
    return !!(window.__gcRoster && typeof window.__gcRoster.open === 'function');
  }
  function openRoster() {
    if (rosterAvailable()) window.__gcRoster.open();
  }

  // Goal Presets script (separate file): Max Goals / Next Goals buttons.
  function goalsAvailable() {
    return !!(window.__gcGoals && typeof window.__gcGoals.max === 'function');
  }

  function rowActions() {
    const a = [];
    if (S.sections && S.rowAddSection) a.push({ key: 'add', label: '＋ Section', glyph: '＋', title: 'Add section', run: handleAddSection });
    if (S.rowPauseAll) {
      a.push({ key: 'pauseall',  label: '⏸ Pause All',  glyph: '⏸', title: 'Pause all items',  run: () => toggleAllPause(true) });
      a.push({ key: 'resumeall', label: '▶ Resume All', glyph: '▶', title: 'Resume all items', run: () => toggleAllPause(false) });
    }
    if (S.sections && S.rowCollapse) {
      a.push({ key: 'collapse', label: '⊟ Collapse', glyph: '⊟', title: 'Collapse all sections', run: () => setAllCollapsed(true) });
      a.push({ key: 'expand',   label: '⊞ Expand',   glyph: '⊞', title: 'Expand all sections',   run: () => setAllCollapsed(false) });
    }
    if (goalsAvailable()) {
      if (window.__gcGoals.showMax) a.push({ key: 'maxgoals',  label: '⤒ Max Goals',  glyph: '⤒', title: 'Set active characters/weapons to Lv 90, talents 9/9/9', run: () => window.__gcGoals.max() });
      if (window.__gcGoals.showNext) a.push({ key: 'nextgoals', label: '⇡ Next Goals', glyph: '⇡', title: 'Set active characters/weapons to the next ascension star, talents +1', run: () => window.__gcGoals.next() });
    }
    if (rosterAvailable() && window.__gcRoster.showButton !== false) a.push({ key: 'roster', label: '▤ Roster', glyph: '▤', title: 'Roster tables', run: openRoster });
    // `tools` keeps data-gc-tools-btn / data-gc-tools-icon-btn. The menu holds
    // section tools and Undo goal change, so it shows when either exists.
    if (S.sections || goalsAvailable()) a.push({ key: 'tools', label: '⚙ More', glyph: '⚙', title: 'More tools', run: (e) => showToolsMenu(e) });
    return a;
  }

  // Site RectButtons size their inner/border layers to a fixed 202px. Ours are
  // narrower so seven fit in the same width, so those layers must fill the
  // button instead — otherwise they overlap their neighbours.
  function buildRectButton(proto, action) {
    const btn = cloneButtonFrom(proto, ['RectButton_inner', 'RectButton_border', 'RectButton_label'], action.label);
    btn.setAttribute(action.key === 'tools' ? 'data-gc-tools-btn' : `data-gc-${action.key}-btn`, 'true');
    btn.title = action.title;
    btn.style.height = '40px';
    const part = (p) => btn.querySelector(`[class*="${p}"]`);
    const inner = part('RectButton_inner'), border = part('RectButton_border'), label = part('RectButton_label');
    if (inner) Object.assign(inner.style, { width: 'auto', height: 'auto', left: '1px', right: '1px', top: '2px', bottom: '2px' });
    if (border) Object.assign(border.style, { width: 'auto', height: 'auto', left: '0', right: '0', top: '0', bottom: '0', boxSizing: 'border-box' });
    if (label) Object.assign(label.style, {
      width: 'auto', left: '4px', right: '4px', top: '50%', transform: 'translateY(-50%)',
      textAlign: 'center', fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
    });
    btn.addEventListener('click', action.run);
    return btn;
  }

  // Site icon buttons draw an image; ours draw a glyph, which would inherit the
  // site's light-grey text colour and look washed out on the cream button.
  function buildIconButton(proto, action) {
    const btn = cloneButtonFrom(proto, ['BigIconButton_inner', 'BigIconButton_image', 'BigIconButton_border'], null);
    btn.setAttribute(action.key === 'tools' ? 'data-gc-tools-icon-btn' : `data-gc-${action.key}-icon-btn`, 'true');
    btn.title = action.title;
    btn.style.flexShrink = '0';
    const img = btn.querySelector('[class*="BigIconButton_image"]');
    if (img) {
      Object.assign(img.style, {
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '22px', lineHeight: '1', color: '#3a2e1f'
      });
      img.textContent = action.glyph;
    }
    btn.addEventListener('click', action.run);
    return btn;
  }

  // Desktop: match the site row's width exactly and split it evenly. Re-run on
  // every pass so a resize (or a phone→desktop switch) is picked up.
  function layoutRectRow(row, siteRect) {
    const w = siteRect.getBoundingClientRect().width;
    if (!w || !row.children.length) return; // site row hidden: phone layout
    row.style.width = w + 'px';
    const bw = Math.floor(w / row.children.length) - 4; // 2px margin each side, as the site's
    // More buttons -> narrower buttons. Use the largest label size (13, 12,
    // then 11px) at which the WIDEST label still fits, measured with the
    // label's real font, so no label gets cut off with "…".
    const labels = Array.from(row.children).map(b => b.querySelector('[class*="RectButton_label"]')).filter(Boolean);
    const room = bw - 8; // label sits 4px in from each side
    let fs = 11;
    if (labels.length) {
      const cs = window.getComputedStyle(labels[0]);
      const ctx = (layoutRectRow.canvas || (layoutRectRow.canvas = document.createElement('canvas'))).getContext('2d');
      for (const size of [13, 12, 11]) {
        ctx.font = `${cs.fontWeight} ${size}px ${cs.fontFamily}`;
        const widest = Math.max(...labels.map(l => ctx.measureText(l.textContent).width));
        if (widest <= room || size === 11) { fs = size; break; }
      }
    }
    for (const b of row.children) b.style.width = bw + 'px';
    for (const l of labels) l.style.fontSize = fs + 'px';
  }

  function ensureButtonRows() {
    if (!S.row) { document.querySelectorAll('[data-gc-row2]').forEach(el => el.remove()); return; }
    const siteButtons = document.querySelector('[class*="Farm_buttons"]:not([data-gc-row2])');
    if (!siteButtons) return;
    const siteRect = siteButtons.querySelector('[class*="Farm_centeredRectButtons"]');
    const siteIcons = siteButtons.querySelector('[class*="Farm_centeredButtons"]');
    const rectProto = siteRect && siteRect.querySelector('[class*="RectButton_button"]');
    const iconProto = siteIcons && siteIcons.querySelector('[class*="BigIconButton_button"]');
    if (!rectProto && !iconProto) return;

    let wrap = siteButtons.nextElementSibling;
    if (!wrap || !wrap.hasAttribute('data-gc-row2')) {
      // First pass, or React rebuilt the site's buttons: drop any stranded copy.
      document.querySelectorAll('[data-gc-row2]').forEach(el => el.remove());
      wrap = document.createElement('div');
      wrap.className = siteButtons.className;
      wrap.setAttribute('data-gc-row2', 'true');
      wrap.style.marginTop = '6px';
      siteButtons.insertAdjacentElement('afterend', wrap);
    }

    // Rebuild only when the set of actions changes (e.g. the roster script
    // finished loading after our first pass).
    const actions = rowActions();
    if (!actions.length) { wrap.remove(); return; }
    const sig = actions.map(a => a.key).join(',');
    if (wrap.getAttribute('data-sig') !== sig) {
      wrap.innerHTML = '';
      wrap.setAttribute('data-sig', sig);
      if (rectProto) {
        const row = document.createElement('div');
        row.className = siteRect.className;
        row.setAttribute('data-gc-row2-rect', 'true');
        for (const a of actions) row.appendChild(buildRectButton(rectProto, a));
        wrap.appendChild(row);
      }
      if (iconProto) {
        const row = document.createElement('div');
        row.className = siteIcons.className;
        row.setAttribute('data-gc-row2-icons', 'true');
        Object.assign(row.style, { width: 'auto', maxWidth: '100%', flexWrap: 'wrap', justifyContent: 'center', gap: '4px' });
        for (const a of actions) row.appendChild(buildIconButton(iconProto, a));
        wrap.appendChild(row);
      }
    }

    const rectRow = wrap.querySelector('[data-gc-row2-rect]');
    if (rectRow && siteRect) layoutRectRow(rectRow, siteRect);
  }

  // Re-check periodically: React can re-render the site's buttons without
  // touching the item list, and the window can be resized. Cheap and idempotent.
  setInterval(() => {
    try { ensureButtonRows(); }
    catch (e) { console.error('[gc-sections] button row error', e); }
  }, 1500);

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
  if (S.sections) setInterval(updateBadgePausedStates, 600);

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
  if (S.panelCollapse) {
    setInterval(applyPanelCollapses, 700);
    setTimeout(applyPanelCollapses, 800);
  }

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
  if (S.wheel) document.addEventListener('wheel', handleInventoryWheel, { passive: false, capture: true });

  // ---------- Reorder + render ----------
  function reorderAndRender() {
    const list = getItemList();
    if (!list) return;
    // Toolkit: with sections off, keep only the button row up to date.
    if (!S.sections) { ensureButtonRows(); return; }
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
    ensureButtonRows();

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
    layoutSectionBoxes();
  }

  // ---------- Section boxes ----------
  // A box per section, drawn BEHIND its title bar and cards. The cards must
  // stay direct children of the site's list: React owns them, and moving them
  // into a wrapper would make React's next update fail to find them. So the
  // box is a separate absolutely-positioned element measured to cover them.
  const BOX_PAD = 6; // the site's grid gap is 12px, so 6px each side is the room there is
  function layoutSectionBoxes() {
    const list = getItemList();
    if (!list) return;
    const old = Array.from(list.querySelectorAll(':scope > .gc-section-box'));
    if (!S.sections || !state.sections.length) {
      old.forEach(e => e.remove());
      list.classList.remove('gc-has-boxes');
      return;
    }
    list.classList.add('gc-has-boxes');
    const groups = [];
    let cur = null;
    for (const k of list.children) {
      if (k.classList.contains('gc-section-box')) continue;
      if (k.hasAttribute('data-gc-section-header')) { cur = { head: k, members: [] }; groups.push(cur); continue; }
      if (k.hasAttribute('data-gc-unassigned-header')) { cur = null; continue; }
      // Collapsed members are display:none; cards borrowed by the roster's
      // panel view leave an empty slot with no height. Neither counts.
      if (cur && k.style.display !== 'none' && k.offsetHeight) cur.members.push(k);
    }
    const lr = list.getBoundingClientRect();
    groups.forEach((g, i) => {
      let top = Infinity, bottom = -Infinity;
      for (const e of [g.head, ...g.members]) {
        const r = e.getBoundingClientRect();
        if (r.top < top) top = r.top;
        if (r.bottom > bottom) bottom = r.bottom;
      }
      let box = old[i];
      if (!box) {
        box = document.createElement('div');
        box.className = 'gc-section-box';
        list.appendChild(box);
      }
      box.style.setProperty('--sec-color', g.head.style.getPropertyValue('--sec-color'));
      box.style.left = `${-BOX_PAD}px`;
      box.style.width = `${lr.width + BOX_PAD * 2}px`;
      box.style.top = `${top - lr.top - BOX_PAD}px`;
      box.style.height = `${bottom - top + BOX_PAD * 2}px`;
    });
    old.slice(groups.length).forEach(e => e.remove());
  }
  // Re-measure whenever the list changes size (cards added/removed, artifact
  // panels opening, window resizing), plus a slow safety net.
  if (S.sections) {
    let boxQueued = false;
    const queueBoxes = () => {
      if (boxQueued) return;
      boxQueued = true;
      requestAnimationFrame(() => { boxQueued = false; try { layoutSectionBoxes(); } catch (e) { /* ignore */ } });
    };
    window.addEventListener('resize', queueBoxes);
    let observedList = null;
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(queueBoxes) : null;
    setInterval(() => {
      const list = getItemList();
      if (ro && list && list !== observedList) { if (observedList) ro.unobserve(observedList); ro.observe(list); observedList = list; }
      try { layoutSectionBoxes(); } catch (e) { /* ignore */ }
    }, 1000);
  }

  // ---------- Pause / Resume ----------
  function getPauseButton(wrapper) {
    return wrapper.querySelector('[class*="ItemPanel_pauseButton"] button');
  }

  // The pause button's title ("Active"/"Paused", localized) flips the
  // instant React re-renders. The icon's opacity animates over ~0.3s (and
  // stalls in background tabs), so it's only a fallback.
  function pauseTitles() {
    try {
      const pp = window.__NEXT_DATA__ ? window.__NEXT_DATA__.props.pageProps
        : JSON.parse(document.getElementById('__NEXT_DATA__').textContent).props.pageProps;
      return (pp && pp.__namespaces && pp.__namespaces.general) || {};
    } catch (e) { return {}; }
  }
  function isItemPaused(wrapper) {
    const btn = wrapper.querySelector('[class*="ItemPanel_pauseButton"]');
    const title = btn ? (btn.getAttribute('title') || '').trim() : '';
    if (title) {
      const t = pauseTitles();
      if (t.Paused && title === t.Paused) return true;
      if (t.Active && title === t.Active) return false;
      if (title === 'Paused') return true;
      if (title === 'Active') return false;
    }
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
  window.__gcSections = tag({
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
  });
  }


  // ============================================================
  // 7. Start-up
  // ============================================================
  const run = (name, fn) => {
    try { fn(ON); } catch (e) { console.error(`[gc-toolkit] ${name} failed to start`, e); }
  };
  if (ON.goalsMax || ON.goalsNext) run('Goal Presets', moduleGoals);
  if (ON.roster) run('Roster', moduleRoster);
  if (ON.artifacts) run('Artifact Goals', moduleArtifacts);
  // Section Organizer also owns the second row, scroll-wheel editing and
  // panel collapsing, so it runs when any of those is on.
  if (ON.sections || ON.row || ON.wheel || ON.panelCollapse) run('Section Organizer', moduleSections);

  window.__gcToolkit = { version: VERSION, settings: () => Object.assign({}, SETTINGS), effective: () => Object.assign({}, ON), openOptions: openPanel };
  console.log(`[gc-toolkit] v${VERSION} loaded — on: ${ALL_OPTIONS.filter(o => ON[o.key] === true).map(o => o.key).join(', ')}`);
})();
