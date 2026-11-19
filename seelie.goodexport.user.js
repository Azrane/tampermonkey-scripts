// ==UserScript==
// @name         Seelie.me - Export Inventory (GOOD)
// @namespace    https://seelie.me/
// @version      1.0.0
// @description  Adds "Export (GOOD)" to seelie.me's inventory menu (next to Import / Clean / Sync). Downloads the current account's material inventory as a GOOD-format .json file that Genshin Center's planner can import (Manage Inventory → Import Materials).
// @author       You
// @match        https://seelie.me/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Azrane/tampermonkey-scripts/main/seelie.goodexport.user.js
// @downloadURL  https://raw.githubusercontent.com/Azrane/tampermonkey-scripts/main/seelie.goodexport.user.js
// ==/UserScript==

/*
 * How it works (read from the live site):
 *   - Seelie keeps each account's inventory as an array of
 *       { type, item, tier, value }        e.g. { type: 'mora', item: 'mora', tier: 0, value: 12345 }
 *     in localStorage under `${account}-inventory`.
 *   - Seelie's own GOOD *importer* component has a computed `good` map:
 *       GOOD key -> [type, item, tier]     e.g. HerosWit -> ['xp', 'xp'], TeachingsOfFreedom -> ['talent', 'freedom', 1]
 *     This script finds that mounted component and reverses the map, so the
 *     export always uses seelie's current item list and naming (no table to keep up to date).
 *
 * About Genshin Center's import: it REPLACES the planner inventory. Any material
 * that is missing (or 0) in the file is set to 0, except the three enhancement
 * ores, which keep their current value when the file has 0.
 */

(function () {
  'use strict';

  const LABEL = 'Export (GOOD)';

  // ---------------------------------------------------------------- Vue lookup
  function findImporter() {
    const host = [...document.querySelectorAll('body, body *')].find(e => e.__vue_app__);
    if (!host || !host._vnode) return null;
    const seen = new Set();
    let found = null;
    (function visit(v) {
      if (found || !v || typeof v !== 'object' || seen.has(v)) return;
      seen.add(v);
      const c = v.component;
      if (c) {
        if (c.type && c.type.computed && c.type.computed.good) { found = c; return; }
        visit(c.subTree);
      }
      if (Array.isArray(v.children)) v.children.forEach(visit);
      if (Array.isArray(v.dynamicChildren)) v.dynamicChildren.forEach(visit);
      if (v.suspense) visit(v.suspense.activeBranch);
    })(host._vnode);
    return found;
  }

  // ---------------------------------------------------------------- Build GOOD
  function buildGood() {
    const inst = findImporter();
    if (!inst) throw new Error('Could not find seelie\'s inventory data. Open the Inventory page and try again.');
    const p = inst.proxy;
    const map = p.good;                       // GOOD key -> [type, item, tier]
    const account = p.account || 'main';
    let inventory = p.inventory;
    if (!Array.isArray(inventory)) {
      try { inventory = JSON.parse(localStorage.getItem(`${account}-inventory`) || '[]'); } catch (e) { inventory = []; }
    }

    const have = new Map();
    for (const e of inventory) {
      if (!e || !e.type || !e.item) continue;
      have.set(`${e.type}|${e.item}|${e.tier || 0}`, Number(e.value) || 0);
    }

    const materials = {};
    let nonZero = 0;
    for (const [key, [type, item, tier]] of Object.entries(map)) {
      const v = have.get(`${type}|${item}|${tier || 0}`) || 0;
      materials[key] = v;
      if (v) nonZero++;
    }

    // Anything in seelie's inventory that has no GOOD key (so it can't be exported).
    const mapped = new Set(Object.values(map).map(([t, i, tr]) => `${t}|${i}|${tr || 0}`));
    const skipped = [...have.entries()].filter(([k, v]) => v && !mapped.has(k)).map(([k]) => k);

    return {
      account,
      nonZero,
      skipped,
      data: { format: 'GOOD', version: 2, source: 'seelie.me', characters: [], weapons: [], artifacts: [], materials }
    };
  }

  function stamp() {
    const d = new Date(), z = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}-${z(d.getHours())}-${z(d.getMinutes())}`;
  }

  function download(name, obj) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function toast(msg, bad) {
    const t = document.createElement('div');
    t.textContent = msg;
    Object.assign(t.style, {
      position: 'fixed', left: '50%', bottom: '90px', transform: 'translateX(-50%)', zIndex: 2147483000,
      maxWidth: 'min(520px, 92vw)', padding: '10px 14px', borderRadius: '8px', font: '600 14px/1.4 system-ui, sans-serif',
      color: '#fff', background: bad ? 'rgba(185,28,28,0.95)' : 'rgba(30,27,46,0.97)',
      boxShadow: '0 4px 18px rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.12)', whiteSpace: 'pre-line'
    });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), bad ? 7000 : 4500);
  }

  function exportGood() {
    try {
      const r = buildGood();
      download(`${stamp()}-${r.account}-seelie-GOOD.json`, r.data);
      let msg = `Exported ${r.nonZero} materials from "${r.account}" in GOOD format.`;
      if (r.skipped.length) msg += `\nNot exportable (no GOOD key): ${r.skipped.join(', ')}`;
      toast(msg);
      console.log('[seelie-good] exported', r);
    } catch (e) {
      console.error('[seelie-good]', e);
      toast(e.message || String(e), true);
    }
  }

  // ---------------------------------------------------------------- Menu item
  // Seelie's inventory menu holds three plain buttons: Import / Clean / Sync.
  // Labels can be translated, so find the menu through the importer component.
  function menuContainer() {
    const inst = findImporter();
    if (!inst || !inst.subTree) return null;
    const kids = Array.isArray(inst.subTree.children) ? inst.subTree.children : [inst.subTree];
    const btn = kids.map(c => c && c.el).find(el => el && el.nodeType === 1 && el.tagName === 'BUTTON');
    return btn ? { menu: btn.parentElement, importBtn: btn } : null;
  }

  // The menu is a popup: its nodes exist (detached) while closed, so only add
  // the item while it is actually on the page, and only once per menu.
  function inject() {
    const m = menuContainer();
    if (!m || !m.menu || !m.importBtn.isConnected) return;
    if (m.menu.querySelector('[data-seelie-good-export]')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = m.importBtn.className;
    b.textContent = LABEL;
    b.title = 'Download this account\'s inventory as GOOD JSON (for Genshin Center → Manage Inventory → Import Materials)';
    b.setAttribute('data-seelie-good-export', '');
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); exportGood(); });
    m.importBtn.after(b);
  }

  let pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; inject(); }, 50);
  }
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  setInterval(inject, 2000);
  inject();

  window.__seelieGood = { export: exportGood, build: buildGood };
  console.log('[seelie-good] v1.0.0 loaded');
})();
