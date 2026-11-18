// ==UserScript==
// @name         Genshin Center - Goal Presets
// @namespace    https://genshin-center.com/
// @version      1.0.0
// @description  Two goal presets for every ACTIVE (unpaused) character and weapon on the Ascension Planner: "Max Goals" sets level 90 and talents 9/9/9; "Next Goals" sets each goal one ascension star past the current level and each talent one level up (never past 9). Shows what will change and asks first, and keeps an Undo. Buttons appear on Section Organizer's second row.
// @author       You
// @match        https://genshin-center.com/planner*
// @match        https://genshin-center.com/*/planner*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Azrane/tampermonkey-scripts/main/genshincenter.goalpresets.user.js
// @downloadURL  https://raw.githubusercontent.com/Azrane/tampermonkey-scripts/main/genshincenter.goalpresets.user.js
// ==/UserScript==

/*
 * How the planner stores goals (read from the live site):
 *   hub.selection[i] = { id, itemId, type, data }   (type 0 = character, 1 = weapon)
 *     or, for custom characters, { custom: true, item, type, current: { data }, data }
 *   data = { level, ascension, paused, checklist, talents? , event? }   <- the GOAL
 *     level and talents are 0-indexed (level 89 = Lv 90, talent 8 = 9).
 *   Current values: hub.itemList[entry.id].data, or entry.current.data for customs.
 *   hub.setSelection(newArray) saves; the site's own Edit dialog does exactly this
 *   with a deep copy where only data.level / data.ascension / data.talents change.
 *
 * This script does the same: deep copy, change only those three fields on active
 * entries, check nothing else moved, save. Order, pause state, checklists, custom
 * items and everything else pass through untouched.
 */

(function () {
  'use strict';

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
  window.__gcGoals = {
    version: '1.0.0',
    max: () => run('max'),
    next: () => run('next'),
    undo,
    canUndo: () => !!savedUndo(),
    preview: (kind) => {           // for debugging in the console
      const p = plan(kind === 'max' ? 'max' : 'next');
      return p.error ? p.error : p.changes.map(c =>
        `${c.name}: ${fmtGoal(c.before, c.isWeapon)} -> ${fmtGoal(c.after, c.isWeapon)}`);
    }
  };

  console.log('[gc-goals] v1.0.0 loaded');
})();
