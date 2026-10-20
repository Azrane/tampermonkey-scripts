// ==UserScript==
// @name         MapGenie – Show Only Marked Locations
// @description  Hides unmarked map markers (shows only locations you've marked as found). Composes with MapGenie's own category filters, self-heals if overwritten, and adds a Re-init button.
// @namespace    https://example.local/mapgenie-show-only-marked
// @version      0.4.0
// @author       you
// @license      MIT
// @match        https://mapgenie.io/*/maps/*
// @icon         https://cdn.mapgenie.io/favicons/mapgenie/favicon-32x32.png
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ─────────────────────────────────────────────────────────────
    // CONFIG
    //   HIDE = 'unmarked' → hide NOT-found markers (show only marked).  ← what you asked for
    //   HIDE = 'found'    → hide found markers (the common "declutter" mode).
    //   UI: a small button (bottom-left) re-initializes and toggles mode.
    //   Console: MG_reinit(), MG_hideToggle(), MG_apply(), MG_debug()
    // ─────────────────────────────────────────────────────────────
    let HIDE = 'unmarked';
    const DEBUG = true;

    const log  = (...a) => DEBUG && console.log('[MG-HideMarkers]', ...a);
    const warn = (...a) => console.warn('[MG-HideMarkers]', ...a);

    let mapRef = null;
    let rawSetFilter = null;
    let hooked = false;
    let listenersAttached = false;
    let sourceDataTimer = null;
    let targetLayers = new Set();
    let baseFilters = new Map();      // layerId -> MapGenie's own (category) filter, never our overlay
    let idAccessor = ['get', 'locationId'];
    let idIsNumeric = null;

    // ── found/marked ids ──
    function rawFoundIds() {
        const u = window.user;
        if (!u || !u.locations) return [];
        const loc = u.locations;
        return Array.isArray(loc) ? loc.slice() : Object.keys(loc).filter(k => loc[k]);
    }
    function foundIdsTyped() {
        const raw = rawFoundIds();
        let out;
        if (idIsNumeric === true)       out = raw.map(Number).filter(n => !Number.isNaN(n));
        else if (idIsNumeric === false) out = raw.map(String);
        else out = [...raw.map(Number).filter(n => !Number.isNaN(n)), ...raw.map(String)];
        return Array.from(new Set(out));
    }
    function foundSet() { return new Set(rawFoundIds().map(String)); }

    // ── locate map ──
    function isMap(m) {
        return m && typeof m.getStyle === 'function'
            && typeof m.setFilter === 'function'
            && typeof m.querySourceFeatures === 'function';
    }
    function findMap() {
        const direct = [window.map, window.mapManager && window.mapManager.map, window.MapGenie && window.MapGenie.map];
        for (const c of direct) if (isMap(c)) return c;
        for (const k in window) {
            try { const v = window[k]; if (isMap(v)) return v; if (v && isMap(v.map)) return v.map; }
            catch (e) {}
        }
        return null;
    }
    function hookConstructor() {
        try {
            const gl = window.mapboxgl;
            if (!gl || !gl.Map || gl.Map.__mgHooked) return;
            const Orig = gl.Map;
            const Patched = function (...args) {
                const inst = new Orig(...args);
                if (!mapRef) { mapRef = inst; log('captured map via mapboxgl.Map constructor'); }
                return inst;
            };
            Patched.prototype = Orig.prototype;
            for (const k of Object.keys(Orig)) { try { Patched[k] = Orig[k]; } catch (e) {} }
            Patched.__mgHooked = true;
            gl.Map = Patched;
        } catch (e) {}
    }

    // ── features ──
    function layerFeatures(map, layer) {
        let f = [];
        try {
            f = map.querySourceFeatures(layer.source, layer['source-layer'] ? { sourceLayer: layer['source-layer'] } : {}) || [];
        } catch (e) {}
        if (f.length) return f;
        try { if (map.queryRenderedFeatures) f = map.queryRenderedFeatures({ layers: [layer.id] }) || []; } catch (e) {}
        return f;
    }

    const ACCESSORS = [
        { expr: ['get', 'locationId'],  read: f => f.properties && f.properties.locationId },
        { expr: ['get', 'location_id'], read: f => f.properties && f.properties.location_id },
        { expr: ['id'],                 read: f => f.id },
        { expr: ['get', 'id'],          read: f => f.properties && f.properties.id },
    ];

    function discoverLayers(map) {
        const found = foundSet();
        const layers = (map.getStyle().layers) || [];
        const perLayer = [];
        for (const layer of layers) {
            if (!layer.source) continue;
            if (layer.type !== 'symbol' && layer.type !== 'circle') continue;
            const feats = layerFeatures(map, layer);
            if (!feats.length) continue;
            const sample = feats.slice(0, 100);
            let best = null;
            for (const acc of ACCESSORS) {
                const vals = sample.map(acc.read).filter(v => v != null);
                if (!vals.length) continue;
                const score = found.size ? vals.filter(v => found.has(String(v))).length : 0;
                const matched = found.size ? vals.find(v => found.has(String(v))) : vals[0];
                if (!best || score > best.score) best = { acc: acc.expr, score, sampleVal: matched };
            }
            if (best) perLayer.push({ layerId: layer.id, ...best });
        }
        const positive = perLayer.filter(p => p.score > 0);
        const chosen = positive.length ? positive : perLayer;
        if (chosen.length) {
            chosen.sort((a, b) => b.score - a.score);
            idAccessor = chosen[0].acc;
            if (chosen[0].sampleVal != null) idIsNumeric = (typeof chosen[0].sampleVal === 'number');
        }
        return new Set(chosen.map(p => p.layerId));
    }

    // ── filter build / compose / overlay detection ──
    function myFilter() {
        const inFound = ['in', idAccessor, ['literal', foundIdsTyped()]];
        return HIDE === 'found' ? ['!', inFound] : inFound;
    }
    function compose(base) {
        const mine = myFilter();
        return base ? ['all', base, mine] : mine;
    }
    function hasOverlay(filter) {
        if (!filter) return false;
        const s = JSON.stringify(filter);
        return s.includes(JSON.stringify(idAccessor)) && s.includes('literal');
    }

    function applyAll() {
        if (!hooked || !mapRef || !rawSetFilter) { warn('not ready — run MG_debug()'); return; }
        const n = rawFoundIds().length;
        if (HIDE === 'unmarked' && n === 0) warn('0 marked locations — "show only marked" will look empty.');
        for (const layerId of targetLayers) {
            try { rawSetFilter.call(mapRef, layerId, compose(baseFilters.get(layerId))); }
            catch (e) { warn('setFilter failed for', layerId, e); }
        }
        log('applied', HIDE, '| layers', [...targetLayers], '| marked', n, '| accessor', JSON.stringify(idAccessor), '| numeric', idIsNumeric);
    }

    // If our overlay was overwritten (MapGenie bypassing our wrapper / source reload),
    // adopt the current filter as the new base and re-apply. Self-healing.
    function reassert() {
        if (!hooked || !mapRef) return;
        let fixed = 0;
        for (const id of targetLayers) {
            let cur;
            try { cur = mapRef.getFilter(id); } catch (e) { continue; }
            if (!hasOverlay(cur)) {
                baseFilters.set(id, cur || null);
                try { rawSetFilter.call(mapRef, id, compose(cur || null)); fixed++; } catch (e) {}
            }
        }
        if (fixed) log('reasserted overlay on', fixed, 'layer(s)');
        return fixed;
    }

    // ── wrap setFilter ──
    function installFilterHook(map) {
        rawSetFilter = map.setFilter.bind(map);
        const wrapped = function (layerId, filter, options) {
            if (targetLayers.has(layerId)) {
                baseFilters.set(layerId, filter);
                return rawSetFilter(layerId, compose(filter), options);
            }
            return rawSetFilter(layerId, filter, options);
        };
        wrapped.__mgWrapped = true;
        map.setFilter = wrapped;
    }

    function installMarkWatch() {
        const open = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url) {
            try {
                if (/\/api\/v1\/user\/locations\//.test(url)) {
                    this.addEventListener('loadend', () => setTimeout(() => { if (hooked) applyAll(); }, 60));
                }
            } catch (e) {}
            return open.apply(this, arguments);
        };
    }

    function onSourceData() {
        if (sourceDataTimer) return;
        sourceDataTimer = setTimeout(() => { sourceDataTimer = null; if (!hooked) ensure(); else reassert(); }, 300);
    }
    function onIdle() { ensure(); reassert(); }

    function ensure() {
        if (!mapRef) mapRef = findMap();
        if (!mapRef) { log('waiting for map…'); return; }
        if (mapRef.isStyleLoaded && !mapRef.isStyleLoaded()) { log('waiting for style…'); return; }

        if (!listenersAttached && mapRef.on) {
            listenersAttached = true;
            mapRef.on('idle', onIdle);
            mapRef.on('sourcedata', onSourceData);
        }

        const found = discoverLayers(mapRef);
        let added = false;
        for (const id of found) {
            if (!targetLayers.has(id)) {
                try { baseFilters.set(id, mapRef.getFilter(id)); } catch (e) {}
                targetLayers.add(id);
                added = true;
            }
        }
        if (!targetLayers.size) { log('map ready but no marker layers discovered yet — will retry on load'); return; }

        if (!hooked) {
            installFilterHook(mapRef);
            hooked = true;
            log('hook installed on', [...targetLayers], '| accessor', JSON.stringify(idAccessor));
            applyAll();
        } else if (added) {
            applyAll();
        }
    }

    // ── re-initialize from scratch (manual escape hatch) ──
    function reinit() {
        setStatus('re-initializing…');
        // strip our overlay so bases read clean
        if (hooked && rawSetFilter && mapRef) {
            for (const id of targetLayers) {
                try { rawSetFilter.call(mapRef, id, baseFilters.get(id) || null); } catch (e) {}
            }
        }
        // if our wrapper is gone (new map/style reload), allow a full re-hook
        if (!mapRef || !mapRef.setFilter || !mapRef.setFilter.__mgWrapped) {
            hooked = false; rawSetFilter = null; listenersAttached = false; mapRef = null;
        }
        targetLayers = new Set();
        baseFilters = new Map();
        idIsNumeric = null;
        ensure();
        // markers may still be streaming in — give it a few more shots
        setTimeout(() => { ensure(); reportStatus(); }, 400);
        setTimeout(() => { ensure(); reportStatus(); }, 1500);
        reportStatus();
    }

    // ── console helpers ──
    window.MG_reinit = reinit;
    window.MG_apply = function () { ensure(); applyAll(); };
    window.MG_hideToggle = function () {
        if (!hooked) ensure();
        HIDE = HIDE === 'unmarked' ? 'found' : 'unmarked';
        applyAll();
        reportStatus();
        return HIDE;
    };
    window.MG_debug = function () {
        const m = mapRef || findMap();
        const rep = {
            mapFound: !!m, styleLoaded: m && m.isStyleLoaded ? m.isStyleLoaded() : null,
            userExists: !!window.user,
            userLocationsType: window.user ? (Array.isArray(window.user.locations) ? 'array' : typeof window.user.locations) : 'n/a',
            markedCount: rawFoundIds().length,
            hooked, listenersAttached, targetLayers: [...targetLayers], idAccessor, idIsNumeric, mode: HIDE,
        };
        if (m) {
            try {
                const layers = (m.getStyle().layers) || [];
                rep.totalLayers = layers.length;
                rep.symbolCircleLayers = layers.filter(l => l.type === 'symbol' || l.type === 'circle')
                    .map(l => ({ id: l.id, source: l.source, sourceLayer: l['source-layer'] }));
                const sources = Array.from(new Set(layers.map(l => l.source).filter(Boolean)));
                rep.sourceSamples = {};
                for (const s of sources) {
                    try {
                        const f = m.querySourceFeatures(s) || [];
                        const first = f[0];
                        rep.sourceSamples[s] = { count: f.length, propKeys: first && first.properties ? Object.keys(first.properties) : [], topLevelId: first ? first.id : undefined };
                    } catch (e) { rep.sourceSamples[s] = 'query failed: ' + e.message; }
                }
            } catch (e) { rep.styleError = e.message; }
        }
        console.log('[MG-HideMarkers] DEBUG report:', rep);
        return rep;
    };

    // ── UI control (fixed button; renders regardless of MapGenie's DOM) ──
    function setStatus(t) { const s = document.getElementById('mg-status'); if (s) s.textContent = t; log(t); }
    function reportStatus() {
        if (!mapRef) return setStatus('waiting for map…');
        if (!hooked || !targetLayers.size) return setStatus('no marker layers yet — let markers finish loading, then click Re-init');
        setStatus('active · ' + targetLayers.size + ' layer(s) · ' + rawFoundIds().length + ' marked · mode: ' + HIDE);
    }
    function injectControl() {
        if (typeof document === 'undefined') return;
        if (document.getElementById('mg-reinit-ctrl')) return;
        if (!document.body) return;
        const box = document.createElement('div');
        box.id = 'mg-reinit-ctrl';
        box.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:99999;font:12px/1.35 system-ui,Arial,sans-serif;background:rgba(18,20,26,.94);color:#e8eaed;border:1px solid #3a3f4b;border-radius:9px;padding:7px 9px;box-shadow:0 3px 12px rgba(0,0,0,.45);';
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:10px;align-items:center;';
        const reinitBtn = document.createElement('span');
        reinitBtn.textContent = '⟳ Re-init';
        reinitBtn.title = 'Re-scan the map and re-apply the filter';
        reinitBtn.style.cssText = 'cursor:pointer;font-weight:700;color:#8ab4f8;';
        reinitBtn.addEventListener('click', reinit);
        const modeBtn = document.createElement('span');
        modeBtn.textContent = '⇄ Mode';
        modeBtn.title = 'Toggle hide-unmarked / hide-found';
        modeBtn.style.cssText = 'cursor:pointer;font-weight:700;color:#c58af9;';
        modeBtn.addEventListener('click', () => window.MG_hideToggle());
        const status = document.createElement('div');
        status.id = 'mg-status';
        status.style.cssText = 'margin-top:5px;color:#9aa0a6;max-width:240px;';
        status.textContent = 'starting…';
        row.appendChild(reinitBtn); row.appendChild(modeBtn);
        box.appendChild(row); box.appendChild(status);
        document.body.appendChild(box);
        reportStatus();
    }

    // ── boot ──
    installMarkWatch();
    hookConstructor();
    const glPoll = setInterval(hookConstructor, 200);
    const iv = setInterval(() => {
        injectControl();
        ensure();
        if (hooked) { reportStatus(); clearInterval(iv); clearInterval(glPoll); }
    }, 800);
    setTimeout(() => { clearInterval(iv); clearInterval(glPoll); }, 180000);
    if (typeof document !== 'undefined') {
        if (document.body) injectControl();
        else document.addEventListener('DOMContentLoaded', injectControl);
    }
    ensure();
})();