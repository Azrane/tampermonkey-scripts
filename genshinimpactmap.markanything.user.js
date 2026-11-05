// ==UserScript==
// @name         Genshin Impact Map - Mark Anything as Found
// @namespace    https://genshin-impact-map.appsample.com/
// @version      2.0.0
// @description  Lets every marker (Teleport Waypoints, Statues, Domains, etc.) be marked as found on the redesigned map.
// @author       you
// @match        https://genshin-impact-map.appsample.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

/*
 * How the site decides what is markable (redesign, Nov 2026):
 *   canMarkFound = marker => marker.level >= config.rules.progressMinLevel
 * progressMinLevel is 5; Teleport Waypoints and similar are level 4.
 * The config arrives inside the page's Next.js payload (self.__next_f.push(...)).
 *
 * Primary: rewrite progressMinLevel to 0 in that payload before the app reads it.
 * Fallback: if that misses, find the live config object after load and set it to 0.
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

  // --- Fallback: patch the live config object after hydration -------------
  function findRules() {
    const seen = new WeakSet();
    let hit = null;
    const scan = (o, depth) => {
      if (hit || !o || typeof o !== 'object' || seen.has(o) || depth > 4) return;
      seen.add(o);
      try {
        if (o.rules && typeof o.rules.progressMinLevel === 'number') { hit = o.rules; return; }
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

  let tries = 0;
  const iv = setInterval(() => {
    tries++;
    const rules = findRules();
    if (rules) {
      if (rules.progressMinLevel > TARGET_LEVEL) rules.progressMinLevel = TARGET_LEVEL;
      clearInterval(iv);
    } else if (tries > 60) {
      clearInterval(iv);
      console.warn('[MarkAnything] could not find the map config; unmarkable markers stay locked.');
    }
  }, 500);
})();
