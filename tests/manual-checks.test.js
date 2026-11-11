'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');

const visual = fs.readFileSync(require.resolve('../manual-checks/example-com-visual.user.js'), 'utf8');
const gmStore = fs.readFileSync(require.resolve('../manual-checks/example-com-gm-store.user.js'), 'utf8');

function openProbe(source, db) {
  const dom = new JSDOM('<!doctype html><html><head><title>Example Domain</title></head><body><h1>Example Domain</h1></body></html>',
    { url: 'https://example.com/', runScripts: 'outside-only' });
  const w = dom.window;
  if (db) {
    w.GM_getValue = (key, fallback) => db.has(key) ? db.get(key) : fallback;
    w.GM_setValue = (key, value) => db.set(key, value);
    w.GM_listValues = () => [...db.keys()];
  }
  w.eval(source);
  return dom;
}

test('visual probe leaves every promised trace on example.com', () => {
  const dom = openProbe(visual, null);
  try {
    const w = dom.window;
    assert.match(w.document.title, /^\[ТЕСТ OK\] Example Domain$/);
    const banner = w.document.querySelector('#tm-probe-banner');
    assert.ok(banner);
    assert.match(banner.textContent, /ВЫПОЛНИЛСЯ/);
    assert.match(w.document.body.style.cssText, /outline/);
  } finally { dom.window.close(); }
});

test('GM probe counts its runs in Tampermonkey storage across page loads', () => {
  const db = new Map();
  const first = openProbe(gmStore, db);
  const second = openProbe(gmStore, db);
  try {
    assert.match(first.window.document.querySelector('#tm-probe-gm-banner').textContent, /запуск № 1/);
    assert.match(second.window.document.querySelector('#tm-probe-gm-banner').textContent, /запуск № 2/);
    assert.match(second.window.document.title, /^\[ТЕСТ-2 OK\]/);
  } finally { first.window.close(); second.window.close(); }
});

test('GM probe reports a broken sandbox instead of failing silently', () => {
  const dom = openProbe(gmStore, null); // No GM_* functions at all.
  try {
    const banner = dom.window.document.querySelector('#tm-probe-gm-banner');
    assert.ok(banner);
    assert.match(banner.textContent, /GM-хранилище НЕ работает/);
    assert.match(dom.window.document.title, /^\[ТЕСТ-2 ОШИБКА\]/);
  } finally { dom.window.close(); }
});
