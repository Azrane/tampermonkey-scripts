// ==UserScript==
// @name         Genshin Center - Roster Tables
// @namespace    https://genshin-center.com/
// @version      2.5.0
// @description  Popup tables of the characters and weapons on your Ascension Planner. Separate tabs with their own columns and filters: element, weapon type, rarity, constellation/refinement, levels, talents, domain days, and material progress. Jump to a card or pause/resume from the table.
// @author       You
// @match        https://genshin-center.com/planner*
// @match        https://genshin-center.com/*/planner*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ============================================================
  // User config
  // ============================================================
  // Keyboard shortcut to open/close (set HOTKEY to null to disable).
  const HOTKEY = { key: 'r', alt: true, ctrl: false, shift: false };

  // Tab shown when the popup opens: 'characters' or 'weapons'
  const DEFAULT_TAB = 'characters';

  // Hide paused entries by default.
  const DEFAULT_ACTIVE_ONLY = true;

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

  function findItemProps(el) {
    let node = getFiber(el);
    let depth = 0;
    while (node && depth < 30) {
      const p = node.memoizedProps;
      if (p && typeof p === 'object' && p.item && p.current &&
          typeof p.current === 'object' && typeof p.current.level === 'number') {
        return p;
      }
      node = node.return;
      depth++;
    }
    return null;
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
    const host = document.getElementById('__next') || document.body;
    let root = null;
    for (const k in host) {
      if (k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$')) { root = host[k]; break; }
    }
    while (root && root.return) root = root.return;
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
    while (queue.length && steps < 40000) {
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
      font: inherit; font-size: 12.5px; font-weight: 700;
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
      border-radius: 4px; cursor: pointer; font: inherit; font-size: 12px; padding: 3px 9px;
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
      font-size: 9.5px; opacity: 0.5; width: 58px; flex-shrink: 0;
      letter-spacing: 0.6px; font-weight: 700;
    }
    .gcr-chip {
      font-size: 11px; padding: 3px 9px; border-radius: 10px;
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
      font-size: 10px; letter-spacing: 0.4px;
    }
    .gcr-matsearch-wrap { position: relative; display: inline-block; }
    .gcr-matsearch {
      background: rgba(0,0,0,0.3);
      border: 1px solid rgba(255,255,255,0.25);
      color: #ece5d8; border-radius: 10px;
      font-family: inherit; font-size: 11px; padding: 3px 9px; width: 150px;
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
      font-family: inherit; font-size: 11.5px; padding: 5px 8px;
      border-radius: 4px; cursor: pointer;
    }
    .gcr-matopt:hover { background: rgba(255,255,255,0.12); }
    .gcr-matcount { font-size: 10px; opacity: 0.55; flex-shrink: 0; }
    .gcr-matnone { padding: 6px 8px; font-size: 11px; opacity: 0.5; }
    .gcr-clear {
      font-size: 10px; margin-left: auto; background: none; border: none;
      color: rgba(236,229,216,0.5); cursor: pointer; font-family: inherit; text-decoration: underline;
    }
    .gcr-clear:hover { color: #ece5d8; }
    .gcr-scroll { overflow: auto; flex: 1; }
    .gcr-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .gcr-table th {
      position: sticky; top: 0; background: rgba(28, 40, 68, 0.99);
      text-align: left; font-weight: 700; font-size: 10.5px; letter-spacing: 0.5px;
      padding: 7px 7px; border-bottom: 1px solid rgba(255,255,255,0.15);
      cursor: pointer; user-select: none; white-space: nowrap;
    }
    .gcr-table th:hover { background: rgba(40, 56, 92, 0.99); }
    .gcr-table th.num, .gcr-table td.num { text-align: right; }
    .gcr-table th.sorted { color: #ffd7a0; }
    .gcr-arrow { font-size: 9px; opacity: 0.9; }
    .gcr-table td { padding: 6px 7px; border-bottom: 1px solid rgba(255,255,255,0.06); white-space: nowrap; }
    .gcr-row { cursor: pointer; }
    .gcr-row:hover td { background: rgba(255,255,255,0.07); }
    .gcr-row.paused td { opacity: 0.45; }
    .gcr-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
    .gcr-star { color: #ffd7a0; font-size: 10px; }
    .gcr-arrowto { opacity: 0.45; margin: 0 2px; }
    .gcr-rar { font-weight: 700; font-size: 11px; }
    .gcr-cons, .gcr-ref {
      display: inline-block; min-width: 22px; padding: 1px 5px; border-radius: 3px;
      background: rgba(255,255,255,0.09); font-size: 10.5px; font-weight: 700; letter-spacing: 0.3px;
    }
    .gcr-cons.max, .gcr-ref.max { background: rgba(255,215,160,0.22); color: #ffd7a0; }
    .gcr-days { font-size: 10.5px; opacity: 0.8; letter-spacing: 0.3px; }
    .gcr-days .on { color: #ffd7a0; font-weight: 700; opacity: 1; }
    .gcr-bar {
      display: inline-block; width: 42px; height: 5px; border-radius: 3px;
      background: rgba(255,255,255,0.14); overflow: hidden; vertical-align: middle; margin-right: 5px;
    }
    .gcr-bar > i { display: block; height: 100%; background: #7ddc7d; }
    .gcr-bar.part > i { background: #e0c060; }
    .gcr-pw {
      background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
      color: #ece5d8; border-radius: 4px; cursor: pointer; font: inherit;
      font-size: 11px; padding: 1px 7px; line-height: 16px;
    }
    .gcr-pw:hover { background: rgba(255,255,255,0.22); }
    .gcr-foot {
      padding: 8px 12px; border-top: 1px solid rgba(255,255,255,0.12);
      display: flex; align-items: center; gap: 10px; flex-shrink: 0; font-size: 11px; opacity: 0.8;
    }
    .gcr-btn {
      background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
      color: #ece5d8; border-radius: 4px; cursor: pointer; font: inherit;
      font-size: 11px; font-weight: 600; padding: 4px 10px;
    }
    .gcr-btn:hover { background: rgba(255,255,255,0.22); }
    .gcr-empty { padding: 24px 14px; text-align: center; opacity: 0.6; font-size: 12px; }
    /* --- Weekly boss table (single table so columns align across bosses) --- */
    .gcr-wt {
      width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed;
    }
    .gcr-wt col.c-mat { width: auto; }
    .gcr-wt col.c-num { width: 86px; }
    .gcr-wt th {
      position: sticky; top: 0; z-index: 1;
      background: rgba(28, 40, 68, 0.99);
      font-size: 9.5px; letter-spacing: 0.6px; opacity: 0.75; font-weight: 700;
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
      font-size: 12.5px; font-weight: 700; letter-spacing: 0.4px; color: #ffd7a0;
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
    .gcr-net-big { font-size: 13px; }
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
    .gcr-pv-note { font-size: 11px; opacity: 0.6; }
    .gcr-sel {
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.2);
      color: #ece5d8; border-radius: 4px;
      font: inherit; font-size: 11px; padding: 2px 4px; margin-left: 4px;
    }
    .gcr-sel option { background: #141d34; color: #ece5d8; }
  `;
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ============================================================
  // View state
  // ============================================================
  let overlay = null;
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
    x.className = 'gcr-x';
    x.style.marginLeft = '6px';
    x.textContent = 'Close';
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

  // The dialog mounts into #editor. Wait for it to appear and then close,
  // so we can refresh the numbers with whatever was just entered.
  function watchDialogThen(cb) {
    const editor = document.getElementById('editor');
    if (!editor) { setTimeout(cb, 900); return; }
    let opened = false, ticks = 0;
    const iv = setInterval(() => {
      ticks++;
      const has = editor.children.length > 0;
      if (has) opened = true;
      if ((opened && !has) || ticks > 200) { clearInterval(iv); cb(); }
    }, 300);
  }

  function openMaterialDialog(img, name) {
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
          ? `<span class="gcr-matlink" data-img="${escapeHtml(r.img || '')}" data-name="${escapeHtml(r.name)}" ` +
            `title="Open this material\u2019s inventory dialog">${escapeHtml(r.name)}</span>`
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
    scroll.appendChild(t);
    modal.appendChild(scroll);
  }

  function render() {
    if (!overlay) return;
    const modal = overlay.querySelector('.gcr-modal');
    modal.innerHTML = '';

    // ---- Head / tabs ----
    const head = document.createElement('div');
    head.className = 'gcr-head';
    const tabDefs = [
      ['characters', 'Characters'],
      ['weapons', 'Weapons'],
      ['weekly', 'Weekly bosses']
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
    x.className = 'gcr-x';
    x.textContent = 'Close';
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

    filters.appendChild(buildMaterialPicker(v, activeTab));

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
      const thAct = document.createElement('th');
      thAct.className = 'num';
      thAct.style.cursor = 'default';
      htr.appendChild(thAct);
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
        const tdAct = document.createElement('td');
        tdAct.className = 'num';
        const pw = document.createElement('button');
        pw.className = 'gcr-pw';
        pw.textContent = r.paused ? '▶' : '⏸';
        pw.title = r.paused ? 'Resume' : 'Pause';
        pw.addEventListener('click', (e) => { e.stopPropagation(); togglePause(r); });
        tdAct.appendChild(pw);
        tr.appendChild(tdAct);
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
    foot.appendChild(openPanels);

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
    if (sectionsScriptPresent()) removeOwnButtons(); else ensureOwnButtons();
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
      if (!e.key || e.key.toLowerCase() !== HOTKEY.key) return;
      if (!!HOTKEY.alt !== e.altKey) return;
      if (!!HOTKEY.ctrl !== (e.ctrlKey || e.metaKey)) return;
      if (!!HOTKEY.shift !== e.shiftKey) return;
      e.preventDefault();
      toggleModal();
    });
  }

  window.__gcRoster = {
    open: openModal,
    close: closeModal,
    scrape: () => scrapeAll(),
    // Dump a weapon panel's raw props so the refinement field can be pinned down
    dumpWeaponProps: () => {
      const list = document.querySelector('[class*="Farm_itemList"]');
      if (!list) return 'planner list not found';
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
  };

  console.log('[gc-roster] v2.0.0 loaded' + (HOTKEY ? ` (hotkey: ${HOTKEY.alt ? 'Alt+' : ''}${HOTKEY.key.toUpperCase()})` : ''));
})();