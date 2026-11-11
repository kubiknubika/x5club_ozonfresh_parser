// ==UserScript==
// @name         ПРОВЕРКА: внедрение Tampermonkey (example.com, наглядная)
// @namespace    x5club-price-compare-manual-checks
// @version      1.0.0
// @description  Временный проверочный скрипт: ничего полезного не делает, только оставляет видимые следы на example.com
// @match        https://example.com/*
// @match        https://*.example.com/*
// @match        https://example.org/*
// @match        https://*.example.org/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // Способ увидеть № 1: строка в консоли (F12 -> Console).
  var stamp = new Date().toLocaleTimeString('ru-RU');
  console.info('[ПРОВЕРКА] Скрипт выполнился, время: ' + stamp);

  // Способ увидеть № 2: заголовок вкладки меняется на "[ТЕСТ OK] Example Domain".
  document.title = '[ТЕСТ OK] ' + document.title;

  function showBanner() {
    // Способ увидеть № 3: зелёная рамка вокруг всей страницы.
    document.body.style.outline = '6px solid #2e7d32';
    document.body.style.outlineOffset = '-6px';

    // Способ увидеть № 4: большая зелёная плашка в правом верхнем углу.
    var banner = document.createElement('div');
    banner.id = 'tm-probe-banner';
    banner.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;max-width:320px;' +
      'padding:16px 20px;background:#2e7d32;color:white;border-radius:12px;' +
      'font:16px/1.4 Arial,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,.35)';
    banner.textContent = '✅ ПРОВЕРКА: скрипт Tampermonkey ВЫПОЛНИЛСЯ на этой странице (' + stamp + '). ' +
      'Значит, внедрение работает. Этот проверочный скрипт можно удалять.';
    document.body.appendChild(banner);

    // Способ увидеть № 5 (самый громкий, по желанию): всплывающее окно.
    // Если раздражает - удалите следующую строку, остальных следов достаточно.
    window.alert('ПРОВЕРКА: скрипт Tampermonkey выполнился (' + stamp + ')');
  }

  if (document.body) showBanner();
  else document.addEventListener('DOMContentLoaded', showBanner);

  // Способ увидеть № 6 - без самой страницы: после выполнения на значке
  // Tampermonkey появится число запущенных скриптов, а в его меню этот
  // скрипт перестанет быть серым и будет "выполнялся 1 раз" вместо
  // "Ещё не выполнялся".
})();
