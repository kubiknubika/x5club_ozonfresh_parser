'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const script = fs.readFileSync(require.resolve('../price-compare.user.js'), 'utf8');

function openTab(url, price, db, link = '/product/milk', beforeEval = null) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body><article class="product-card"><a ${link === null ? '' : `href="${link}"`}><img alt="Молоко Домик 1 л"></a><span class="price">${price} ₽</span></article></body></html>`, { url, runScripts: 'outside-only' });
  const w = dom.window;
  let interval;
  w.GM_getValue = (key, fallback) => db.has(key) ? db.get(key) : fallback;
  w.GM_setValue = (key, value) => db.set(key, structuredClone(value));
  w.GM_deleteValue = key => db.delete(key);
  w.GM_listValues = () => [...db.keys()];
  w.setInterval = fn => { interval = fn; return 1; };
  w.confirm = () => true;
  if (beforeEval) beforeEval(w);
  w.eval(script);
  return { w, dom, scan: () => interval() };
}

test('tabs exchange prices, refresh badges and clear the actual shared database', () => {
  const db = new Map();
  const a = openTab('https://5ka.ru/catalog', 100, db);
  const b = openTab('https://perekrestok.ru/catalog', 80, db);
  try {
    assert.equal(a.w.document.querySelector('.pc-badge'), null);
    a.scan();
    assert.match(a.w.document.querySelector('.pc-badge').textContent, /Перекрёсток: 80 ₽ \(-20%\)/);
    a.w.document.querySelector('.price').textContent = '200 ₽';
    a.scan();
    assert.match(a.w.document.querySelector('.pc-badge').textContent, /-60%/);
    const link = a.w.document.querySelector('.pc-badge a');
    assert.equal(link.href, 'https://perekrestok.ru/product/milk');
    a.w.document.querySelector('#pc-clear').click();
    assert.equal([...db.keys()].filter(key => key.startsWith('pc_offer_v1:')).length, 0);
    assert.equal(a.w.document.querySelector('.pc-badge'), null);
    b.scan();
    assert.equal(b.w.document.querySelector('.pc-badge'), null);
  } finally { a.dom.window.close(); b.dom.window.close(); }
});

test('the panel lists collected offers so the user can inspect and copy them', () => {
  const db = new Map();
  const tab = openTab('https://5ka.ru/catalog', 100, db);
  try {
    assert.match(tab.w.document.querySelector('#pc-collected-summary').textContent, /Собранные товары: 1/);
    assert.match(tab.w.document.querySelector('#pc-collected-list').textContent, /Пятёрочка · Молоко Домик 1 л — 100 ₽/);
  } finally { tab.dom.window.close(); }
});

test('a card without a product link is stored without a fabricated URL', () => {
  const db = new Map();
  const tab = openTab('https://5ka.ru/catalog', 100, db, null);
  try {
    const offer = [...db.entries()].find(([key]) => key.startsWith('pc_offer_v1:'))?.[1];
    assert.ok(offer);
    assert.equal(offer.url, null);
  } finally { tab.dom.window.close(); }
});

function getReport(tab) {
  tab.w.document.querySelector('#pc-report').click();
  return JSON.parse(tab.w.document.querySelector('#pc-report-text').value);
}

test('diagnostic report includes product data but no page URLs', () => {
  const db = new Map();
  const tab = openTab('https://5ka.ru/catalog?secret=private', 123, db);
  try {
    const report = getReport(tab);
    assert.equal(report.format, 'price-compare-diagnostics-v2');
    assert.equal(report.store, 'pyaterochka');
    assert.equal(report.lastScan.cardSource, 'selector');
    assert.equal(report.lastScan.cards, 1);
    assert.equal(report.lastScan.parsed, 1);
    assert.equal(report.lastScan.saved, 1);
    assert.equal(report.lastScan.offersByStore.pyaterochka, 1);
    assert.equal(report.events.at(-1).event, 'scan');
    const text = JSON.stringify(report);
    assert.match(text, /Молоко Домик/);
    assert.ok(report.events.some(event => event.event === 'card' && event.price === 123));
    assert.doesNotMatch(text, /private|catalog|product\/milk/);
  } finally { tab.dom.window.close(); }
});

test('diagnostics record missing fields and malformed JSON-LD', () => {
  const tab = openTab('https://5ka.ru/catalog', 123, new Map());
  try {
    tab.w.document.querySelector('.price').textContent = 'неизвестно';
    const script = tab.w.document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = '{ invalid';
    tab.w.document.body.appendChild(script);
    tab.scan();
    const report = getReport(tab);
    assert.equal(report.lastScan.noPrice, 1);
    assert.equal(report.lastScan.parsed, 0);
    assert.equal(report.lastScan.jsonScripts, 1);
    assert.equal(report.lastScan.jsonInvalid, 1);
  } finally { tab.dom.window.close(); }
});

test('storage failures are logged without error details and later scans recover', () => {
  const tab = openTab('https://5ka.ru/catalog', 123, new Map());
  try {
    const original = tab.w.GM_listValues;
    tab.w.GM_listValues = () => { throw new Error('secret product link https://example.test/user'); };
    tab.w.console.error = () => {};
    tab.scan();
    const failed = getReport(tab);
    assert.equal(failed.lastScan.phase, 'storage');
    assert.equal(failed.lastScan.error, 'Error');
    assert.equal(failed.events.at(-1).event, 'scan_error');
    assert.doesNotMatch(JSON.stringify(failed), /secret|example\.test/);
    assert.match(tab.w.document.querySelector('#pc-diagnostic-status').textContent, /не удалось|Ошибка/);
    tab.w.GM_listValues = original;
    for (let i = 0; i < 105; i++) tab.scan();
    const recovered = getReport(tab);
    assert.equal(recovered.lastScan.phase, 'complete');
    assert.equal(recovered.lastError.phase, 'storage');
  } finally { tab.dom.window.close(); }
});

test('report history is bounded and manual copying works without clipboard permissions', async () => {
  const tab = openTab('https://5ka.ru/catalog', 123, new Map());
  try {
    for (let i = 0; i < 500; i++) tab.scan();
    const report = getReport(tab);
    assert.ok(report.events.length <= 1500);
    assert.ok(report.dropped > 0);
    assert.ok(report.events.length < report.totalEvents);
    assert.equal(tab.w.document.querySelector('#pc-report-area').hidden, false);
    tab.w.document.querySelector('#pc-copy').click();
    await Promise.resolve();
    assert.match(tab.w.document.querySelector('#pc-copy-status').textContent, /вручную/);
  } finally { tab.dom.window.close(); }
});

test('diagnostics show fallback discovery and Product JSON-LD counts', () => {
  const tab = openTab('https://5ka.ru/catalog', 123, new Map());
  try {
    const card = tab.w.document.querySelector('.product-card');
    card.className = '';
    const json = tab.w.document.createElement('script');
    json.type = 'application/ld+json';
    json.textContent = JSON.stringify({ '@type': 'Product', name: 'Масло крестьянское', offers: { price: '140', priceCurrency: 'RUB' } });
    tab.w.document.body.appendChild(json);
    tab.scan();
    const s = getReport(tab).lastScan;
    assert.equal(s.cardSource, 'fallback');
    assert.ok(s.fallbackCurrencyNodes >= 1);
    assert.ok(s.fallbackParsedPriceNodes >= 1);
    assert.equal(s.jsonProducts, 1);
    assert.equal(s.jsonOffers, 1);
  } finally { tab.dom.window.close(); }
});

test('completed logs are summarized on next start while other active tabs are left alone', () => {
  const db = new Map();
  const first = openTab('https://5ka.ru/catalog', 123, db);
  const active = openTab('https://perekrestok.ru/catalog', 80, db);
  let next;
  try {
    getReport(first); // Flush detail before closing.
    first.w.dispatchEvent(new first.w.Event('pagehide'));
    const fullBefore = [...db.entries()].filter(([k]) => k.startsWith('pc_log_full_v1:'));
    assert.equal(fullBefore.length, 2);
    assert.equal(fullBefore.filter(([, v]) => v.closed).length, 1);
    next = openTab('https://ozon.ru/catalog', 200, db);
    const full = [...db.entries()].filter(([k]) => k.startsWith('pc_log_full_v1:'));
    const archived = [...db.entries()].filter(([k]) => k.startsWith('pc_log_archive_v1:'));
    assert.equal(full.length, 2);
    assert.equal(archived.length, 1);
    assert.equal(archived[0][1].store, 'pyaterochka');
    assert.equal(archived[0][1].totalScans, 1);
    assert.doesNotMatch(JSON.stringify(archived[0][1]), /Молоко|Домик/);
    assert.equal(getReport(next).archivedSessions.length, 1);
    active.scan();
    assert.ok(getReport(active).events.some(e => e.event === 'scan'));
  } finally { first.dom.window.close(); active.dom.window.close(); if (next) next.dom.window.close(); }
});

test('stale unfinished logs are archived and expired summaries are deleted', () => {
  const now = Date.now();
  const db = new Map([
    ['pc_log_full_v1:stale', { store: 'ozon', version: '1.2.0', startedAt: '2026-01-01', updatedAt: now - 25 * 3600000, closed: false, events: [{ name: 'Личные данные' }], totalEvents: 1 }],
    ['pc_log_archive_v1:expired', { store: 'ozon', endedAt: now - 31 * 86400000 }],
    ['pc_log_full_v1:live', { store: 'ozon', updatedAt: now, closed: false, events: [] }],
  ]);
  const tab = openTab('https://5ka.ru/catalog', 100, db);
  try {
    assert.equal(db.has('pc_log_full_v1:stale'), false);
    assert.equal(db.has('pc_log_archive_v1:stale'), true);
    assert.equal(db.has('pc_log_archive_v1:expired'), false);
    assert.equal(db.has('pc_log_full_v1:live'), true);
    assert.doesNotMatch(JSON.stringify(db.get('pc_log_archive_v1:stale')), /Личные данные/);
  } finally { tab.dom.window.close(); }
});

test('failed archive write keeps the original full log', () => {
  class FailingArchive extends Map {
    set(key, value) { if (key.startsWith('pc_log_archive_v1:')) throw new Error('disk full'); return super.set(key, value); }
  }
  const db = new FailingArchive();
  db.set('pc_log_full_v1:old', { store: 'ozon', updatedAt: Date.now(), closed: true, events: [{ name: 'товар' }] });
  const tab = openTab('https://5ka.ru/catalog', 100, db);
  try {
    assert.equal(db.has('pc_log_full_v1:old'), true);
    assert.equal(getReport(tab).loggingFailure.phase, 'log_maintenance');
    assert.equal(getReport(tab).lastScan.phase, 'complete');
  } finally { tab.dom.window.close(); }
});

test('a full-log storage failure leaves diagnostics in memory and does not stop collection', () => {
  class FailingLog extends Map {
    set(key, value) { if (key.startsWith('pc_log_full_v1:')) throw new Error('secret'); return super.set(key, value); }
  }
  const db = new FailingLog();
  const tab = openTab('https://5ka.ru/catalog', 100, db);
  try {
    const report = getReport(tab);
    assert.equal(report.loggingFailure.phase, 'write_log');
    assert.equal(report.lastScan.phase, 'complete');
    assert.ok(report.events.some(e => e.event === 'card'));
    assert.ok([...db.keys()].some(k => k.startsWith('pc_offer_v1:')));
    assert.doesNotMatch(JSON.stringify(report), /secret/);
  } finally { tab.dom.window.close(); }
});

test('the user can clear diagnostics without deleting product data', () => {
  const db = new Map();
  const tab = openTab('https://5ka.ru/catalog', 100, db);
  try {
    db.set('pc_log_archive_v1:old', { endedAt: Date.now(), store: 'ozon' });
    tab.w.document.querySelector('#pc-clear-logs').click();
    assert.equal(db.has('pc_log_archive_v1:old'), false);
    assert.ok([...db.keys()].some(k => k.startsWith('pc_offer_v1:')));
    const report = getReport(tab);
    assert.equal(report.events[0].event, 'logs_cleared');
    assert.equal(report.archivedSessions.length, 0);
  } finally { tab.dom.window.close(); }
});

test('storage pressure deletes old summaries but does not evict active full logs', () => {
  const db = new Map([
    ['pc_log_full_v1:live', { updatedAt: Date.now(), closed: false, filler: 'x'.repeat(1_100_000) }],
    ['pc_log_archive_v1:old', { endedAt: Date.now() - 1000, store: 'ozon' }],
  ]);
  const tab = openTab('https://5ka.ru/catalog', 100, db);
  try {
    assert.equal(db.has('pc_log_archive_v1:old'), false);
    assert.equal(db.has('pc_log_full_v1:live'), true);
  } finally { tab.dom.window.close(); }
});

test('a page-global module object does not silently stop the userscript', () => {
  const tab = openTab('https://5ka.ru/catalog', 100, new Map(), '/product/milk', w => { w.module = { exports: {} }; });
  try {
    assert.ok(tab.w.document.querySelector('#pc-panel'));
  } finally { tab.dom.window.close(); }
});

test('an unsupported site leaves a console trace and no panel', () => {
  const messages = [];
  const tab = openTab('https://example.com/catalog', 100, new Map(), '/product/milk', w => {
    w.console.info = (...args) => messages.push(args.join(' '));
  });
  try {
    assert.equal(tab.w.document.querySelector('#pc-panel'), null);
    assert.ok(messages.some(text => text.includes('[Price Compare]') && text.includes('Неподдерживаемый сайт')));
  } finally { tab.dom.window.close(); }
});

test('a supported site logs that the script started', () => {
  const messages = [];
  const tab = openTab('https://5ka.ru/catalog', 100, new Map(), '/product/milk', w => {
    w.console.info = (...args) => messages.push(args.join(' '));
  });
  try {
    assert.ok(tab.w.document.querySelector('#pc-panel'));
    assert.ok(messages.some(text => text.includes('[Price Compare]') && text.includes('Скрипт запущен')));
  } finally { tab.dom.window.close(); }
});

test('the panel still appears when the document has no head', () => {
  const tab = openTab('https://5ka.ru/catalog', 100, new Map(), '/product/milk', w => { w.document.head.remove(); });
  try {
    assert.ok(tab.w.document.querySelector('#pc-panel'));
  } finally { tab.dom.window.close(); }
});

test('an init failure shows a visible error instead of silence', () => {
  const tab = openTab('https://5ka.ru/catalog', 100, new Map(), '/product/milk', w => {
    w.console.error = () => {};
    const create = w.document.createElement.bind(w.document);
    w.document.createElement = tag => { if (tag === 'style') throw new TypeError('blocked'); return create(tag); };
  });
  try {
    assert.equal(tab.w.document.querySelector('#pc-panel'), null);
    const banner = tab.w.document.querySelector('#pc-error');
    assert.ok(banner);
    assert.match(banner.textContent, /панель не удалось создать \(TypeError\)/);
  } finally { tab.dom.window.close(); }
});

test('the script starts when body appears after DOMContentLoaded already fired', async () => {
  const tab = openTab('https://5ka.ru/catalog', 100, new Map(), '/product/milk', w => { w.document.body.remove(); });
  try {
    assert.equal(tab.w.document.querySelector('#pc-panel'), null);
    tab.w.document.documentElement.appendChild(tab.w.document.createElement('body'));
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(tab.w.document.querySelector('#pc-panel'));
  } finally { tab.dom.window.close(); }
});

test('an SPA urlchange without reload is logged so the tab rescans', () => {
  const tab = openTab('https://5ka.ru/catalog', 100, new Map());
  try {
    tab.w.dispatchEvent(new tab.w.Event('urlchange'));
    assert.ok(getReport(tab).events.some(event => event.event === 'url_changed'));
  } finally { tab.dom.window.close(); }
});

test('restoring a cached page creates a new run after finishing the old one', () => {
  const db = new Map();
  const tab = openTab('https://5ka.ru/catalog', 100, db);
  try {
    tab.w.dispatchEvent(new tab.w.Event('pagehide'));
    const old = [...db.entries()].find(([key]) => key.startsWith('pc_log_full_v1:'));
    assert.equal(old[1].closed, true);
    const event = new tab.w.Event('pageshow');
    Object.defineProperty(event, 'persisted', { value: true });
    tab.w.dispatchEvent(event);
    assert.equal(db.has(old[0]), false);
    assert.equal([...db.keys()].filter(k => k.startsWith('pc_log_archive_v1:')).length, 1);
    assert.equal(getReport(tab).events[0].event, 'resumed_from_cache');
  } finally { tab.dom.window.close(); }
});
