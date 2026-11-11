// ==UserScript==
// @name         ПРОВЕРКА-2: GM-хранилище Tampermonkey (example.com)
// @namespace    x5club-price-compare-manual-checks
// @version      1.0.0
// @description  Временный проверочный скрипт: проверяет песочницу GM_* так же, как основной скрипт сравнения цен
// @match        https://example.com/*
// @match        https://*.example.com/*
// @match        https://example.org/*
// @match        https://*.example.org/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // Основной скрипт сравнения цен работает не в контексте страницы, а в
  // песочнице Tampermonkey с GM_getValue/GM_setValue. Этот тест повторяет
  // ровно этот способ: считает свои запуски в хранилище Tampermonkey.
  // При каждой перезагрузке example.com число на плашке должно расти:
  // это значит, что и внедрение, и GM-хранилище работают.
  var runs = null, failure = null;
  try {
    runs = (GM_getValue('tm_probe_runs', 0) || 0) + 1;
    GM_setValue('tm_probe_runs', runs);
    GM_listValues();
  } catch (error) {
    failure = error && error.name ? error.name : 'unknown';
  }

  console.info('[ПРОВЕРКА-2] GM-песочница: ' + (failure ? 'ОШИБКА ' + failure : 'запуск № ' + runs));
  document.title = (failure ? '[ТЕСТ-2 ОШИБКА] ' : '[ТЕСТ-2 OK] ') + document.title;

  function showBanner() {
    var banner = document.createElement('div');
    banner.id = 'tm-probe-gm-banner';
    banner.style.cssText = 'position:fixed;top:16px;left:16px;z-index:2147483647;max-width:320px;' +
      'padding:16px 20px;color:white;border-radius:12px;font:16px/1.4 Arial,sans-serif;' +
      'box-shadow:0 4px 20px rgba(0,0,0,.35);background:' + (failure ? '#b3261e' : '#1565c0');
    banner.textContent = failure
      ? '❌ ПРОВЕРКА-2: GM-хранилище НЕ работает (' + failure + '). Внедрение есть, песочница - нет.'
      : '✅ ПРОВЕРКА-2: GM-песочница работает. Это запуск № ' + runs +
        ' - перезагрузите страницу, число должно вырасти. Проверочный скрипт можно удалять.';
    document.body.appendChild(banner);
  }

  if (document.body) showBanner();
  else document.addEventListener('DOMContentLoaded', showBanner);
})();
