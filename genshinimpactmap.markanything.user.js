// ==UserScript==
// @name         Genshin Impact Map - Mark Anything as Found
// @namespace    https://genshin-impact-map.appsample.com/
// @version      2.1.0
// @description  Lets every marker (Teleport Waypoints, Statues, Domains, etc.) be marked as found on the redesigned map, and adds a "Hide found markers" toggle button to the top of the sidebar.
// @author       you
// @match        https://genshin-impact-map.appsample.com/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/Azrane/tampermonkey-scripts/main/genshinimpactmap.markanything.user.js
// @downloadURL  https://raw.githubusercontent.com/Azrane/tampermonkey-scripts/main/genshinimpactmap.markanything.user.js
// ==/UserScript==

/*
 * How the site decides what is markable (redesign, Nov 2026):
 *   canMarkFound = marker => marker.level >= config.rules.progressMinLevel
 * progressMinLevel is 5; Teleport Waypoints and similar are level 4.
 * The config arrives inside the page's Next.js payload (self.__next_f.push(...)).
 *
 * Primary: rewrite progressMinLevel to 0 in that payload before the app reads it.
 * Fallback: if that misses, find the live config object after load and set it to 0.
 *
 * Hide-found button: calls the app's own setHideFound(), the same thing the
 * "Hide found" switch under the Markers tab does, so the two stay in sync.
 */
(function () {
  'use strict';

  const TARGET_LEVEL = 0;
  const RULE_RE = /(progressMinLevel\\*"\s*:\s*)\d+/g;

  // --- Primary: patch the Next.js payload as it streams in -----------------
  function fixChunk(chunk) {
    if (!Array.isArray(chunk)) return;
    for (let i = 0; i < chunk.length; i++) {
      const v = chunk[i];
      if (typeof v === 'string' && v.indexOf('progressMinLevel') !== -1) {
        chunk[i] = v.replace(RULE_RE, (_, prefix) => prefix + TARGET_LEVEL);
      }
    }
  }

  try {
    const queue = Array.isArray(window.__next_f) ? window.__next_f : [];
    queue.forEach(fixChunk); // anything queued before we ran
    let innerPush = queue.push;
    Object.defineProperty(queue, 'push', {
      configurable: true,
      get() {
        return function (...args) {
          args.forEach(fixChunk);
          return innerPush.apply(this, args);
        };
      },
      // Next.js later replaces push with its own handler; keep wrapping it.
      set(fn) { innerPush = fn; },
    });
    window.__next_f = queue;
  } catch (e) {
    console.warn('[MarkAnything] payload hook failed, relying on fallback', e);
  }

  // --- Find live app objects through React's internal tree -----------------
  function findInReactTree(test) {
    const seen = new WeakSet();
    let hit = null;
    const scan = (o, depth) => {
      if (hit || !o || typeof o !== 'object' || seen.has(o) || depth > 4) return;
      seen.add(o);
      try {
        if (test(o)) { hit = o; return; }
        for (const k of Object.keys(o)) {
          if (k === '_owner' || k === 'return') continue;
          scan(o[k], depth + 1);
        }
      } catch (e) {}
    };
    const els = document.body ? document.body.querySelectorAll('*') : [];
    for (let i = 0; i < els.length && i < 800 && !hit; i++) {
      const el = els[i];
      const fk = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
      if (!fk) continue;
      let f = el[fk], n = 0;
      while (f && n < 60 && !hit) { scan(f.memoizedProps, 0); scan(f.memoizedState, 0); f = f.return; n++; }
    }
    return hit;
  }

  const isConfig = (o) => o.rules && typeof o.rules.progressMinLevel === 'number';
  const isController = (o) =>
    typeof o.setHideFound === 'function' && o.store && typeof o.store.getState === 'function';

  // --- Hide-found toggle button in the sidebar header ----------------------
  const BTN_ID = 'gm-hide-found-btn';
  const SVG_ATTRS = 'width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const ICON_SHOWING = `<svg ${SVG_ATTRS}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const ICON_HIDDEN = `<svg ${SVG_ATTRS}><path d="M9.9 4.2A10.4 10.4 0 0 1 12 4c6.5 0 10 8 10 8a17.6 17.6 0 0 1-2.2 3.2"/><path d="M6.6 6.6A17.4 17.4 0 0 0 2 12s3.5 8 10 8a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="m2 2 20 20"/></svg>`;

  let ctl = null;

  // The icon-button group (Sign in / Settings) to the right of the logo.
  function headerSlot() {
    const logo = document.querySelector('aside a img[src*="/logo"]');
    const row = logo && logo.closest('a') && logo.closest('a').parentElement;
    if (!row) return null;
    return [...row.children].find((c) => c.tagName === 'DIV') || null;
  }

  function renderButton(btn) {
    const s = ctl.store.getState();
    const on = !!s.hideFound;
    // Same visibility rule as the site's own switch: signed in + progress on.
    const usable = !!s.user && (typeof ctl.progressEnabled !== 'function' || ctl.progressEnabled());
    btn.style.display = usable ? '' : 'none';
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? 'Found markers hidden (click to show)' : 'Hide found markers';
    btn.setAttribute('aria-label', btn.title);
    btn.classList.toggle('btn-active', on);
    btn.classList.toggle('text-success', on);
    btn.innerHTML = on ? ICON_HIDDEN : ICON_SHOWING;
  }

  function ensureButton() {
    if (!ctl) return;
    const slot = headerSlot();
    if (!slot) return;
    let btn = document.getElementById(BTN_ID);
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.id = BTN_ID;
      btn.className = 'btn btn-ghost btn-sm btn-square';
      btn.addEventListener('click', () => {
        ctl.setHideFound(!ctl.store.getState().hideFound);
      });
    }
    if (btn.parentElement !== slot || slot.firstChild !== btn) slot.insertBefore(btn, slot.firstChild);
    renderButton(btn);
  }

  function startButton() {
    ensureButton();
    // Keep the icon in sync with the Markers-tab switch and sign-in state.
    ctl.store.subscribe(() => {
      const btn = document.getElementById(BTN_ID);
      if (btn) renderButton(btn);
    });
    // React may re-render the header and drop our button; put it back.
    let t = null;
    new MutationObserver(() => {
      if (document.getElementById(BTN_ID) && document.getElementById(BTN_ID).isConnected
          && document.getElementById(BTN_ID).parentElement === headerSlot()) return;
      clearTimeout(t);
      t = setTimeout(ensureButton, 150);
    }).observe(document.body, { childList: true, subtree: true });
  }

  // --- Startup: wait for the app, then apply fallback + add the button ----
  let rulesDone = false;
  let tries = 0;
  const iv = setInterval(() => {
    tries++;
    if (!rulesDone) {
      const cfg = findInReactTree(isConfig);
      if (cfg) {
        if (cfg.rules.progressMinLevel > TARGET_LEVEL) cfg.rules.progressMinLevel = TARGET_LEVEL;
        rulesDone = true;
      }
    }
    if (!ctl) {
      ctl = findInReactTree(isController);
      if (ctl) startButton();
    }
    if ((rulesDone && ctl) || tries > 60) {
      clearInterval(iv);
      if (!rulesDone) console.warn('[MarkAnything] could not find the map config; unmarkable markers may stay locked.');
      if (!ctl) console.warn('[MarkAnything] could not find the app controller; hide-found button not added.');
    }
  }, 500);
})();
