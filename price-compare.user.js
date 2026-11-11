// ==UserScript==
// @name         Сравнение цен: Пятёрочка, Перекрёсток, Ozon
// @namespace    x5club-ozonfresh-price-compare
// @version      1.4.1
// @description  Сохраняет увиденные товары и осторожно сравнивает цены между магазинами
// @match        https://5ka.ru/*
// @match        https://*.5ka.ru/*
// @match        https://perekrestok.ru/*
// @match        https://*.perekrestok.ru/*
// @match        https://vprok.ru/*
// @match        https://*.vprok.ru/*
// @match        https://ozon.ru/*
// @match        https://*.ozon.ru/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        window.onurlchange
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const STORES = {
    pyaterochka: 'Пятёрочка', perekrestok: 'Перекрёсток', ozon: 'Ozon'
  };
  const PREFIX = 'pc_offer_v1:';
  const ENABLED_KEY = 'pc_enabled_v1';
  const TTL = 3 * 24 * 60 * 60 * 1000;
  const INTERVAL = 5000;
  const MEASURE = '(кг|гр|г|мл|л|шт|штук)';
  // JS \b does not recognize Cyrillic letters. Explicit letter boundaries do.
  const MULTI_RE = new RegExp('(\\d+(?:[.,]\\d+)?)\\s*[xх×*]\\s*(\\d+(?:[.,]\\d+)?)\\s*' + MEASURE + '(?![a-zа-яё])', 'i');
  const SINGLE_RE = new RegExp('(\\d+(?:[.,]\\d+)?)\\s*' + MEASURE + '(?![a-zа-яё])', 'i');
  // Stores sell ranged packs as "0,9-1 кг" and price them by the upper bound.
  const RANGE_RE = new RegExp('(\\d+(?:[.,]\\d+)?)\\s*[-–—]\\s*(\\d+(?:[.,]\\d+)?)\\s*' + MEASURE + '(?![a-zа-яё])', 'i');
  const MULTI_RE_G = new RegExp(MULTI_RE.source, 'gi');
  const SINGLE_RE_G = new RegExp(SINGLE_RE.source, 'gi');
  const RANGE_RE_G = new RegExp(RANGE_RE.source, 'gi');

  // Promo labels are not product names, however title-like their markup is:
  // installment captions ("0% до 140 дней") and marketing badges.
  const PROMO_NAME_RE = /\d+(?:[.,]\d+)?%\s*(?:до|на)\s*\d+\s*(?:дней|дня|мес)|рассроч|без переплат|оплатить позже|цена что надо/i;
  function isPromoName(text) { return PROMO_NAME_RE.test(String(text || '')); }

  function toMeasure(n, unit) {
    if (!Number.isFinite(n) || n <= 0) return null;
    const type = ['кг', 'г', 'гр'].includes(unit) ? 'weight' : ['л', 'мл'].includes(unit) ? 'volume' : 'count';
    const value = n * (unit === 'кг' || unit === 'л' ? 1000 : 1);
    return { type, value, display: value + ' ' + (type === 'weight' ? 'г' : type === 'volume' ? 'мл' : 'шт') };
  }

  function measureOf(name) {
    const text = String(name || '').toLowerCase();
    let m = text.match(RANGE_RE);
    if (m) return toMeasure(Number(m[2].replace(',', '.')), m[3]);
    m = text.match(MULTI_RE);
    const multiplier = m ? Number(m[1].replace(',', '.')) : 1;
    if (!m) m = text.match(SINGLE_RE);
    if (!m) return null;
    return toMeasure(Number((m[m.length - 2]).replace(',', '.')) * multiplier, m[m.length - 1]);
  }

  // The same product is named differently across stores: "Голень цыплёнка"
  // in one, "Голень куриная 0,9-1 кг" in another. Normalize only well-known
  // variants; every other word and number must still agree exactly.
  const TOKEN_SYNONYMS = {
    'куриная': 'курица', 'куриный': 'курица', 'куриное': 'курица', 'куриные': 'курица',
    'цыпленка': 'курица', 'цыпленок': 'курица', 'цыплята': 'курица', 'цыплят': 'курица'
  };
  function normalizeToken(token) {
    if (token.startsWith('охлажден')) return 'охлажден';
    if (token.startsWith('заморож')) return 'заморож';
    return TOKEN_SYNONYMS[token] || token;
  }

  function analyze(name) {
    const measure = measureOf(name);
    const cleaned = String(name || '').toLowerCase().replace(/ё/g, 'е')
      .replace(RANGE_RE_G, ' ').replace(MULTI_RE_G, ' ').replace(SINGLE_RE_G, ' ')
      .replace(/(\d)\s*%/g, '$1%');
    // Keep every meaningful word and number: flavor and fat percentage matter.
    const tokens = (cleaned.match(/[a-zа-я]+|\d+(?:[.,]\d+)?%?/g) || []).map(normalizeToken);
    return { measure, tokens: tokens.sort(), key: tokens.sort().join(' ') };
  }

  function parsePrice(input, requireCurrency = true) {
    const text = String(input == null ? '' : input).replace(/[\u00a0\u202f]/g, ' ').trim();
    if (requireCurrency && !/(?:₽|руб)/i.test(text)) return null;
    let raw = text.split(/₽|руб/i)[0].trim();
    if (!/^[\d\s.,]+$/.test(raw)) return null;
    let value;
    if (/[.,]/.test(raw)) {
      // The final comma/dot is the decimal separator; spaces may group thousands.
      raw = raw.replace(/\s/g, '').replace(',', '.');
      if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
      value = Number(raw);
    } else {
      const groups = raw.split(/\s+/);
      if (!groups.every((g, i) => i === 0 ? /^\d+$/.test(g) : /^\d{3}$/.test(g) || (i === groups.length - 1 && /^\d{2}$/.test(g)))) return null;
      const decimals = groups.length > 1 && groups[groups.length - 1].length === 2 ? groups.pop() : null;
      value = Number(groups.join('')) + (decimals === null ? 0 : Number(decimals) / 100);
    }
    return Number.isFinite(value) && value > 0 && value <= 999999 ? value : null;
  }

  function validBarcode(value) {
    const code = String(value || '').trim();
    if (!/^(?:\d{8}|\d{12,14})$/.test(code)) return null;
    let sum = 0;
    for (let i = code.length - 2, factor = 3; i >= 0; i--, factor = factor === 3 ? 1 : 3) sum += Number(code[i]) * factor;
    return (10 - sum % 10) % 10 === Number(code[code.length - 1]) ? code : null;
  }

  function match(a, b) {
    const aa = analyze(a.name), bb = analyze(b.name);
    if (aa.measure && bb.measure && aa.measure.type !== bb.measure.type) return false;
    const ab = validBarcode(a.barcode), bc = validBarcode(b.barcode);
    if (ab && bc) return ab === bc;
    // Exact token equality is intentionally conservative, not proof of identity.
    return aa.tokens.length >= 2 && aa.key === bb.key;
  }

  function comparison(a, b) {
    const am = measureOf(a.name), bm = measureOf(b.name);
    if (!am && !bm) return { percent: (b.price / a.price - 1) * 100, basis: '' };
    if (!am || !bm || am.type !== bm.type) return null;
    const basis = am.type === 'weight' ? 'кг' : am.type === 'volume' ? 'л' : 'шт';
    return { percent: ((b.price / bm.value) / (a.price / am.value) - 1) * 100,
      basis: am.value !== bm.value ? basis : '' };
  }

  // Pure helpers can be tested under Node without a browser or Tampermonkey.
  // The window check matters in a browser: a page or another script manager
  // can expose a global `module`, and that must not silently stop the script.
  if (typeof window === 'undefined' && typeof module !== 'undefined' && module.exports) {
    module.exports = { measureOf, analyze, parsePrice, validBarcode, match, comparison };
    return;
  }

  function storeForHost(host) {
    const inDomain = d => host === d || host.endsWith('.' + d);
    if (inDomain('5ka.ru')) return 'pyaterochka';
    if (inDomain('perekrestok.ru') || inDomain('vprok.ru')) return 'perekrestok';
    if (inDomain('ozon.ru')) return 'ozon';
    return null;
  }
  const store = storeForHost(location.hostname);
  // Never leave silently before the panel exists: with no trace anywhere this
  // looks exactly like the browser not injecting the script at all. Only the
  // store id is logged, never the page address.
  if (!store) { console.info('[Price Compare] Неподдерживаемый сайт, скрипт остановлен.'); return; }
  if (window.top !== window.self) { console.info('[Price Compare] Вложенная рамка (iframe), скрипт остановлен.'); return; }
  console.info('[Price Compare] Скрипт запущен, магазин: ' + STORES[store] +
    '. Если этой строки нет в консоли, браузер не внедрил скрипт — см. раздел «Если ничего не появилось» в README.');

  const selectors = {
    pyaterochka: '[data-testid*="product-card" i], [class*="product-card" i], [class*="ProductCard"]',
    perekrestok: '.product-card, [data-testid*="product-card" i], [class*="product-card" i], [class*="ProductCard"]',
    ozon: '.tile-root, [class*="tile-root" i]'
  };
  const VERSION = '1.4.1';
  const LOG_FULL = 'pc_log_full_v1:';
  const LOG_ARCHIVE = 'pc_log_archive_v1:';
  const MAX_LOG_BYTES = 256 * 1024; // Estimated UTF-16 bytes, per session.
  const MAX_EVENTS = 1500;
  const LOG_BUDGET = 2 * 1024 * 1024; // Best effort; never evict an active session.
  const STALE_SESSION = 24 * 60 * 60 * 1000;
  const ARCHIVE_TTL = 30 * 24 * 60 * 60 * 1000;
  const MAINTENANCE_INTERVAL = 30 * 60 * 1000;
  let log = [], logBytes = 0, dropped = 0, totalEvents = 0, totalScans = 0, totalScanErrors = 0;
  let startedAt, runId, lastScan = null, lastError = null, loggingFailure = null;
  let logTimer = null, logClosed = false, lastMaintenance = 0, scanId = 0;
  let offers = new Map(), enabled = true, timer;

  function errorKind(error) {
    const allowed = ['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'SecurityError', 'QuotaExceededError'];
    return error && allowed.includes(error.name) ? error.name : 'unknown';
  }
  function newRunId() {
    // Unique per tab/run; no shared writable log key across tabs.
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-' + Math.random().toString(36).slice(2);
  }
  function startLog() {
    runId = newRunId(); startedAt = new Date().toISOString();
    log = []; logBytes = 0; dropped = 0; totalEvents = 0; totalScans = 0; totalScanErrors = 0;
    lastScan = null; lastError = null; logClosed = false; scanId = 0;
  }
  function bytes(value) { return JSON.stringify(value).length * 2; }
  function logEvent(event, details = {}) {
    if (logClosed) return;
    const entry = { time: new Date().toISOString(), event, ...details };
    const size = bytes(entry);
    totalEvents++;
    if (event === 'scan' || event === 'scan_error') totalScans++;
    if (event === 'scan_error') totalScanErrors++;
    if (event === 'error' || event === 'scan_error') lastError = entry;
    if (size <= MAX_LOG_BYTES) { log.push(entry); logBytes += size; }
    else dropped++;
    while (log.length > MAX_EVENTS || logBytes > MAX_LOG_BYTES) {
      logBytes -= bytes(log.shift()); dropped++;
    }
    if (!logTimer) logTimer = setTimeout(() => { logTimer = null; flushLog(); }, 1000);
  }
  function flushLog(closed = false) {
    if (logTimer) { clearTimeout(logTimer); logTimer = null; }
    try {
      const key = LOG_FULL + runId;
      GM_setValue(key, { version: VERSION, store, startedAt, updatedAt: Date.now(), closed,
        totalEvents, dropped, totalScans, totalScanErrors, lastScan, lastError, events: log });
      if (loggingFailure && loggingFailure.phase === 'write_log') loggingFailure = null;
      return true;
    } catch (error) {
      // Logging must not break product collection. Keep the current log in memory.
      loggingFailure = { phase: 'write_log', error: errorKind(error) };
      return false;
    }
  }
  function summarize(record) {
    return { version: record.version, store: record.store, startedAt: record.startedAt,
      endedAt: record.updatedAt, totalEvents: record.totalEvents || 0, dropped: record.dropped || 0,
      totalScans: record.totalScans || 0, totalScanErrors: record.totalScanErrors || 0,
      lastScan: record.lastScan || null, lastError: record.lastError || null };
  }
  function maintainLogs() {
    const now = Date.now();
    const keys = GM_listValues();
    // A full log is archived only when its page closed normally, or after 24h of inactivity.
    // Save the summary before deleting the full log. Re-check to reduce cross-tab races.
    for (const key of keys) {
      if (!key.startsWith(LOG_FULL) || key === LOG_FULL + runId) continue;
      const record = GM_getValue(key, null);
      if (!record || !Number.isFinite(record.updatedAt)) continue;
      if (!record.closed && now - record.updatedAt < STALE_SESSION) continue;
      const archiveKey = LOG_ARCHIVE + key.slice(LOG_FULL.length);
      GM_setValue(archiveKey, summarize(record));
      const savedSummary = GM_getValue(archiveKey, null);
      const check = GM_getValue(key, null);
      if (savedSummary && check && check.updatedAt === record.updatedAt && check.closed === record.closed) GM_deleteValue(key);
    }
    let records = [];
    for (const key of GM_listValues()) {
      if (!key.startsWith(LOG_FULL) && !key.startsWith(LOG_ARCHIVE)) continue;
      const value = GM_getValue(key, null);
      if (!value) continue;
      if (key.startsWith(LOG_ARCHIVE) && Number.isFinite(value.endedAt) && now - value.endedAt > ARCHIVE_TTL) {
        GM_deleteValue(key); continue;
      }
      records.push({ key, value, size: bytes(value) });
    }
    let total = records.reduce((sum, item) => sum + item.size, 0);
    // Under pressure delete the oldest archived summaries first, never active logs.
    records = records.filter(item => item.key.startsWith(LOG_ARCHIVE)).sort((a, b) => a.value.endedAt - b.value.endedAt);
    for (const item of records) {
      if (total <= LOG_BUDGET) break;
      GM_deleteValue(item.key); total -= item.size;
    }
    lastMaintenance = now;
  }
  function tryMaintenance() {
    try {
      maintainLogs();
      if (loggingFailure && loggingFailure.phase === 'log_maintenance') loggingFailure = null;
    } catch (error) { loggingFailure = { phase: 'log_maintenance', error: errorKind(error) }; }
  }
  function archives() {
    try {
      const result = GM_listValues().filter(key => key.startsWith(LOG_ARCHIVE))
        .map(key => GM_getValue(key, null)).filter(Boolean)
        .sort((a, b) => b.endedAt - a.endedAt).slice(0, 20);
      if (loggingFailure && loggingFailure.phase === 'read_archives') loggingFailure = null;
      return result;
    } catch (error) {
      loggingFailure = { phase: 'read_archives', error: errorKind(error) };
      return [];
    }
  }
  function report() {
    const history = archives();
    return JSON.stringify({ format: 'price-compare-diagnostics-v2', version: VERSION,
      store, startedAt, exportedAt: new Date().toISOString(), enabled, loggingFailure,
      totalEvents, dropped, totalScans, totalScanErrors, lastScan, lastError, events: log,
      archivedSessions: history }, null, 2);
  }
  // A storage/logging failure must not prevent the panel from appearing:
  // without a panel the user has no way to see or report what went wrong.
  try {
    startLog();
    tryMaintenance();
    try { enabled = GM_getValue(ENABLED_KEY, true) !== false; }
    catch (error) { logEvent('error', { phase: 'read_settings', error: errorKind(error) }); }
    logEvent('started', { version: VERSION, store });
    flushLog();
    window.addEventListener('pagehide', () => {
      if (logClosed) return;
      logEvent('finished');
      flushLog(true);
      logClosed = true;
    });
    window.addEventListener('pageshow', event => {
      if (!event.persisted) return;
      startLog();
      tryMaintenance();
      logEvent('resumed_from_cache', { version: VERSION, store });
      flushLog();
      scan();
    });
  } catch (error) {
    console.error('[Price Compare] Ошибка подготовки, панель всё равно будет создана:', errorKind(error));
  }

  function readOffers() {
    const next = new Map();
    for (const key of GM_listValues()) {
      if (!key.startsWith(PREFIX)) continue;
      const offer = GM_getValue(key, null);
      if (!offer || !STORES[offer.store] || typeof offer.name !== 'string' || !Number.isFinite(offer.price) || offer.price <= 0 || !Number.isFinite(offer.ts)) continue;
      if (Date.now() - offer.ts > TTL) { GM_deleteValue(key); continue; }
      next.set(key, offer);
    }
    offers = next;
  }

  function safeProductUrl(url) {
    if (typeof url !== 'string' || !url.trim()) return null;
    try {
      const u = new URL(url, location.href);
      if (u.protocol !== 'https:' || storeForHost(u.hostname) !== store) return null;
      u.hash = '';
      return u.href;
    } catch (_) { return null; }
  }

  function saveOffer(data) {
    if (!data.name || !data.price || isPromoName(data.name) || analyze(data.name).tokens.length < 2) return 'rejected';
    const offer = { store, name: data.name, price: data.price, url: safeProductUrl(data.url), barcode: validBarcode(data.barcode), ts: Date.now() };
    // Independent records prevent an unrelated tab from overwriting the entire DB.
    const key = PREFIX + store + ':' + encodeURIComponent(offer.url || offer.name);
    const old = offers.get(key);
    if (old && old.name === offer.name && old.price === offer.price && old.url === offer.url && old.barcode === offer.barcode && offer.ts - old.ts < 15 * 60 * 1000) return 'unchanged';
    GM_setValue(key, offer);
    offers.set(key, offer);
    return 'saved';
  }

  function usableName(text) {
    return !!text && text.length >= 4 && text.length <= 180 && !/₽/.test(text) &&
      !/^(в корзину|купить|акция|скидка|новинка)$/i.test(text) && !isPromoName(text);
  }
  function nameOf(card) {
    const selector = '[data-testid*="title" i], [data-testid*="name" i], [class*="title" i], [class*="name" i], a[title], img[alt]';
    const candidates = [];
    for (const el of card.querySelectorAll(selector)) {
      if (el.closest('.pc-badge')) continue;
      const text = (el.getAttribute('title') || el.getAttribute('alt') || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (usableName(text)) candidates.push({ text, el });
    }
    if (candidates.length) {
      // A product title is (inside) a product link; an installment caption or
      // a badge is not. Among unlinked candidates the longest text wins: real
      // titles are longer than labels. First-in-DOM used to pick the promo.
      const linked = candidates.find(candidate => candidate.el.closest('a[href]'));
      if (linked) return linked.text;
      candidates.sort((a, b) => b.text.length - a.text.length);
      return candidates[0].text;
    }
    for (const el of card.querySelectorAll('a[href]')) {
      if (el.closest('.pc-badge')) continue;
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (usableName(text)) return text;
    }
    return null;
  }

  function priceOf(card, samples) {
    const candidates = [];
    for (const el of card.querySelectorAll('span,div,p,b,strong')) {
      // Prices are often split into ruble/kopeck/currency spans, so a price
      // block may have several children; its full text must still parse below.
      if (el.closest('.pc-badge, #pc-panel') || el.children.length > 6) continue;
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      // Limited raw price-like text helps diagnose markup/format changes.
      if (text.length <= 80 && /₽|руб/i.test(text) && samples.length < 5 && !samples.includes(text)) samples.push(text);
      if (text.length > 35 || (text.match(/₽|руб/gi) || []).length !== 1 || /\/\s*(?:кг|л|100|шт)/i.test(text)) continue;
      const price = parsePrice(text);
      if (price) candidates.push({ price, el });
    }
    candidates.sort((a, b) => a.price - b.price);
    return candidates[0] || null;
  }

  function getCards(stats) {
    let cards = [...document.querySelectorAll(selectors[store])];
    stats.selectorNodes = cards.length;
    cards = cards.filter(card => !cards.some(other => card !== other && card.contains(other)));
    // Fallback is deliberately limited to ancestors of plausible price elements.
    if (cards.length) { stats.cardSource = 'selector'; return cards; }
    stats.cardSource = 'fallback';
    const found = new Set();
    for (const el of document.querySelectorAll('span,div,p')) {
      if (el.closest('.pc-badge, #pc-panel')) continue;
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length > 35) continue;
      if (/₽|руб/i.test(text)) stats.fallbackCurrencyNodes++;
      if (!parsePrice(text)) continue;
      stats.fallbackParsedPriceNodes++;
      let node = el;
      for (let i = 0; i < 6 && node && node !== document.body; i++, node = node.parentElement) {
        if ((node.textContent.match(/₽/g) || []).length > 4) break;
        if (node.querySelector('img') && node.querySelector('a[href]')) { found.add(node); break; }
      }
    }
    return [...found];
  }

  function parseCard(card, stats) {
    const samples = [];
    const name = nameOf(card), price = priceOf(card, samples);
    const link = card.querySelector('a[href]');
    logEvent('card', { scanId, tag: card.tagName, name: name || null, priceSamples: samples,
      price: price ? price.price : null, hasLink: !!link, hasImage: !!card.querySelector('img') });
    if (!name) stats.noName++;
    if (!price) stats.noPrice++;
    if (!name || !price) return null;
    return { card, name, price: price.price, priceEl: price.el, url: link ? link.href : null };
  }

  function fmt(n) { return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }); }
  function buildIndex() {
    const names = new Map(), barcodes = new Map();
    function add(map, key, offer) {
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(offer);
    }
    for (const offer of offers.values()) {
      add(names, analyze(offer.name).key, offer);
      add(barcodes, validBarcode(offer.barcode), offer);
    }
    return { names, barcodes };
  }
  function annotate(data, index) {
    let badge = data.card.querySelector('.pc-badge');
    const byStore = {};
    const candidates = new Set([...(index.names.get(analyze(data.name).key) || []), ...(index.barcodes.get(validBarcode(data.barcode)) || [])]);
    for (const offer of candidates) {
      if (offer.store === store || !match(data, offer)) continue;
      // Prefer equal packs, then the freshest offer; do not pick the cheapest unrelated pack.
      const a = measureOf(data.name), b = measureOf(offer.name);
      const distance = a && b ? Math.abs(Math.log(a.value / b.value)) : a || b ? Infinity : 0;
      const old = byStore[offer.store];
      if (!old || distance < old.distance || (distance === old.distance && offer.ts > old.offer.ts)) byStore[offer.store] = { offer, distance };
    }
    const matches = Object.values(byStore);
    logEvent('matching', { scanId, name: data.name, price: data.price, candidates: candidates.size,
      matches: matches.map(({ offer }) => ({ store: offer.store, name: offer.name.slice(0, 180), price: offer.price })), shown: enabled && matches.length > 0 });
    if (!matches.length || !enabled) { if (badge) badge.remove(); return matches.length; }
    const signature = JSON.stringify([data.name, data.price, matches.map(m => m.offer)]);
    if (badge && badge.dataset.signature === signature && badge.previousElementSibling === data.priceEl) return matches.length;
    if (badge) badge.remove();
    badge = document.createElement('div');
    badge.className = 'pc-badge';
    badge.dataset.signature = signature;
    badge.title = 'Предположительное совпадение. Проверьте товар, фасовку, адрес и условия скидки.';
    for (const { offer } of matches) {
      const row = document.createElement(offer.url ? 'a' : 'div');
      if (offer.url) { row.href = offer.url; row.target = '_blank'; row.rel = 'noopener noreferrer'; row.addEventListener('click', e => e.stopPropagation()); }
      const m = measureOf(offer.name), here = measureOf(data.name), cmp = comparison(data, offer);
      let text = STORES[offer.store] + ': ' + fmt(offer.price) + ' ₽';
      if (m && (!here || m.value !== here.value || m.type !== here.type)) text += ' (' + m.display + ')';
      if (cmp) text += ' (' + (cmp.percent > 0 ? '+' : '') + Math.round(cmp.percent) + '%' + (cmp.basis ? ' за ' + cmp.basis : '') + ')';
      else text += ' (фасовка неизвестна)';
      row.textContent = text;
      badge.appendChild(row);
    }
    data.priceEl.insertAdjacentElement('afterend', badge);
    return matches.length;
  }

  function readStructuredData(stats) {
    // Only explicitly marked Product JSON-LD is accepted, not arbitrary API objects.
    const visit = (obj, depth) => {
      if (!obj || typeof obj !== 'object' || depth > 8) return;
      if (Array.isArray(obj)) { obj.forEach(item => visit(item, depth + 1)); return; }
      const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
      if (types.some(t => typeof t === 'string' && /(?:^|\/)Product$/i.test(t)) && typeof obj.name === 'string') {
        stats.jsonProducts++;
        const items = Array.isArray(obj.offers) ? obj.offers : [obj.offers];
        for (const item of items) {
          if (!item || typeof item !== 'object' || (item.priceCurrency && item.priceCurrency !== 'RUB')) continue;
          const price = parsePrice(item.price, false);
          if (price) {
            stats.jsonOffers++;
            const result = saveOffer({ name: obj.name, price, url: item.url || obj.url || location.href, barcode: obj.gtin13 || obj.gtin || obj.ean });
            stats[result]++;
            logEvent('json_offer', { scanId, name: obj.name.slice(0, 180), price, result });
          }
        }
      }
      for (const value of Object.values(obj)) if (value && typeof value === 'object') visit(value, depth + 1);
    };
    for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
      stats.jsonScripts++;
      if (el.textContent.length > 2_000_000) { stats.jsonTooLarge++; continue; }
      let data;
      try { data = JSON.parse(el.textContent); } catch (_) { stats.jsonInvalid++; continue; }
      visit(data, 0);
    }
  }

  function collectedText() {
    // Newest first; this exact text is what "Скопировать список" sends to the clipboard.
    return [...offers.values()].sort((a, b) => b.ts - a.ts)
      .map(offer => STORES[offer.store] + ' · ' + offer.name + ' — ' + fmt(offer.price) + ' ₽').join('\n');
  }
  function updatePanel() {
    const stats = document.getElementById('pc-stats');
    if (!stats) return;
    const values = [...offers.values()];
    stats.textContent = Object.entries(STORES).map(([id, name]) => name + ': ' + values.filter(o => o.store === id).length).join(' · ');
    const summary = document.getElementById('pc-collected-summary');
    if (summary) summary.textContent = 'Собранные товары: ' + values.length;
    const list = document.getElementById('pc-collected-list');
    if (list) list.textContent = values.length ? collectedText() : 'Пока ничего не собрано. Откройте каталог и полистайте.';
  }

  function updateDiagnosticStatus() {
    const status = document.getElementById('pc-diagnostic-status');
    if (!status) return;
    if (loggingFailure) { status.textContent = 'Журнал не удалось сохранить или обработать. Откройте отчёт.'; return; }
    if (!lastScan) { status.textContent = 'Сканирование ещё не выполнялось.'; return; }
    if (lastScan.error) {
      status.textContent = 'Ошибка на этапе ' + lastScan.phase + '. Откройте отчёт.';
    } else {
      status.textContent = 'Карточек: ' + lastScan.cards + ', распознано: ' + lastScan.parsed +
        ', совпадений: ' + lastScan.matchedCards + '.';
    }
  }
  function scan() {
    if (logClosed) return;
    if (Date.now() - lastMaintenance >= MAINTENANCE_INTERVAL) tryMaintenance();
    scanId++;
    logEvent('scan_started', { scanId });
    const started = Date.now();
    const stats = { phase: 'storage', selectorNodes: 0, cardSource: 'not_started', cards: 0,
      fallbackCurrencyNodes: 0, fallbackParsedPriceNodes: 0,
      noName: 0, noPrice: 0, parsed: 0, saved: 0, unchanged: 0, rejected: 0,
      jsonScripts: 0, jsonInvalid: 0, jsonTooLarge: 0, jsonProducts: 0, jsonOffers: 0,
      matchedCards: 0, shownCards: 0, offersByStore: {}, durationMs: 0 };
    try {
      readOffers();
      stats.phase = 'cards';
      const cards = getCards(stats);
      stats.cards = cards.length;
      const parsed = cards.map(card => parseCard(card, stats)).filter(Boolean);
      stats.parsed = parsed.length;
      stats.phase = 'save_cards';
      for (const item of parsed) {
        const result = saveOffer(item);
        stats[result]++;
        logEvent('card_offer', { scanId, name: item.name, price: item.price, result });
      }
      stats.phase = 'json_ld';
      readStructuredData(stats);
      stats.phase = 'matching';
      const index = buildIndex();
      for (const item of parsed) {
        if (annotate(item, index)) { stats.matchedCards++; if (enabled) stats.shownCards++; }
      }
      for (const id of Object.keys(STORES)) stats.offersByStore[id] = 0;
      for (const offer of offers.values()) stats.offersByStore[offer.store]++;
      stats.phase = 'panel';
      updatePanel();
      stats.phase = 'complete';
    } catch (error) {
      stats.error = errorKind(error);
      // Do not expose raw exception messages or stack traces: they may contain user data.
      console.error('[Price Compare] Scan failed:', stats.phase, stats.error);
    }
    stats.durationMs = Date.now() - started;
    lastScan = stats;
    logEvent(stats.error ? 'scan_error' : 'scan', { scanId, ...stats });
    updateDiagnosticStatus();
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(scan, 800); }
  function clear() {
    if (!window.confirm('Удалить все цены, собранные этим скриптом?')) return;
    try {
      for (const key of GM_listValues()) if (key.startsWith(PREFIX)) GM_deleteValue(key);
      offers.clear();
      document.querySelectorAll('.pc-badge').forEach(el => el.remove());
      updatePanel();
      logEvent('cleared');
    } catch (error) {
      logEvent('error', { phase: 'clear', error: errorKind(error) });
      window.alert('Не удалось полностью очистить базу. Подробности в отчёте диагностики.');
    }
    // Open tabs can collect visible products again on their next scan.
  }
  function clearLogs() {
    if (!window.confirm('Удалить все журналы и архивные сводки этого скрипта? Открытые вкладки могут создать новые записи.')) return;
    try {
      if (logTimer) { clearTimeout(logTimer); logTimer = null; }
      for (const key of GM_listValues()) {
        if (key.startsWith(LOG_FULL) || key.startsWith(LOG_ARCHIVE)) GM_deleteValue(key);
      }
      startLog();
      logEvent('logs_cleared', { version: VERSION, store });
      flushLog();
      updateDiagnosticStatus();
    } catch (error) {
      loggingFailure = { phase: 'clear_logs', error: errorKind(error) };
      updateDiagnosticStatus();
      window.alert('Не удалось полностью удалить журналы.');
    }
  }
  function init() {
    if (document.getElementById('pc-panel')) return; // Already running (e.g. duplicate copy installed).
    const style = document.createElement('style');
    style.textContent = '.pc-badge{display:block;margin:4px 0;padding:4px 8px;border:1px solid #dadce0;border-radius:8px;background:#f8f9fa;color:#202124;font:12px/1.4 Arial,sans-serif}.pc-badge a{display:block;color:#176b39;text-decoration:none}.pc-badge a:hover{text-decoration:underline}#pc-panel{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:245px;max-height:calc(100vh - 32px);overflow-y:auto;box-sizing:border-box;padding:12px;background:white;color:#202124;border:1px solid #dadce0;border-radius:12px;box-shadow:0 4px 20px #0003;font:13px/1.4 Arial,sans-serif}#pc-panel button{margin-top:8px}#pc-panel textarea{box-sizing:border-box;width:100%;height:120px;font:11px monospace}#pc-panel details{margin-top:8px}';
    // document.head can be missing on unusual documents; the panel matters more.
    (document.head || document.documentElement).appendChild(style);
    const panel = document.createElement('div');
    panel.id = 'pc-panel';
    panel.innerHTML = '<strong>Сравнение цен</strong><div>Сейчас: ' + STORES[store] + '</div><div id="pc-stats"></div><small>Листайте каталоги. Цены и совпадения нужно проверять.</small><details><summary id="pc-collected-summary">Собранные товары</summary><div id="pc-collected-list" style="white-space:pre-wrap;max-height:180px;overflow-y:auto"></div><button id="pc-copy-collected" type="button">Скопировать список</button><span id="pc-copy-collected-status" role="status"></span></details><label style="display:block"><input id="pc-enabled" type="checkbox"> Показывать подсказки</label><button id="pc-clear" type="button">Очистить базу</button><details id="pc-diagnostics"><summary>Диагностика</summary><div id="pc-diagnostic-status"></div><small>Журнал содержит названия и цены товаров. Проверьте его перед отправкой.</small><div><button id="pc-report" type="button">Подготовить отчёт</button> <button id="pc-clear-logs" type="button">Очистить журналы</button></div><div id="pc-report-area" hidden><small>Нажмите «Копировать» или выделите текст вручную.</small><textarea id="pc-report-text" readonly aria-label="Отчёт диагностики"></textarea><button id="pc-copy" type="button">Копировать</button><span id="pc-copy-status" role="status"></span></div></details>';
    document.body.appendChild(panel);
    const checkbox = panel.querySelector('#pc-enabled');
    checkbox.checked = enabled;
    checkbox.addEventListener('change', () => {
      enabled = checkbox.checked;
      try { GM_setValue(ENABLED_KEY, enabled); }
      catch (error) { logEvent('error', { phase: 'save_settings', error: errorKind(error) }); }
      logEvent('visibility_changed', { enabled });
      scan();
    });
    panel.querySelector('#pc-clear').addEventListener('click', clear);
    const copyListStatus = panel.querySelector('#pc-copy-collected-status');
    panel.querySelector('#pc-copy-collected').addEventListener('click', async () => {
      try {
        if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error();
        await navigator.clipboard.writeText(collectedText());
        copyListStatus.textContent = ' Скопировано — вставьте список в чат (Ctrl+V).';
      } catch (_) {
        copyListStatus.textContent = ' Не удалось скопировать. Список виден выше; для отладки пришлите отчёт из «Диагностики».';
      }
    });
    panel.querySelector('#pc-clear-logs').addEventListener('click', clearLogs);
    const reportText = panel.querySelector('#pc-report-text');
    const copyStatus = panel.querySelector('#pc-copy-status');
    panel.querySelector('#pc-report').addEventListener('click', () => {
      if (!logClosed) flushLog();
      reportText.value = report();
      updateDiagnosticStatus();
      panel.querySelector('#pc-report-area').hidden = false;
      copyStatus.textContent = '';
      reportText.focus();
      reportText.select();
    });
    panel.querySelector('#pc-copy').addEventListener('click', async () => {
      try {
        if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error();
        await navigator.clipboard.writeText(reportText.value);
        copyStatus.textContent = ' Скопировано';
      } catch (_) {
        reportText.focus(); reportText.select();
        copyStatus.textContent = ' Скопируйте выделенный текст вручную (Ctrl+C).';
      }
    });
    new MutationObserver(mutations => {
      if (mutations.some(m => {
        const target = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        if (target && target.closest('.pc-badge, #pc-panel')) return false;
        const nodes = [...m.addedNodes, ...m.removedNodes];
        return !nodes.length || nodes.some(n => !(n.nodeType === 1 && (n.matches('.pc-badge, #pc-panel') || n.closest('.pc-badge, #pc-panel'))));
      })) schedule();
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener('scroll', schedule, { passive: true });
    // SPA stores change the URL without reloading, and Tampermonkey does not
    // re-inject then. This already-running copy rescans right away instead of
    // waiting for the interval. Needs the window.onurlchange grant above and
    // is a no-op in managers that never fire the event.
    window.addEventListener('urlchange', () => { logEvent('url_changed', { store }); schedule(); });
    setInterval(scan, INTERVAL);
    scan();
  }
  let uiStarted = false;
  function showInitError(kind) {
    // Last-resort visible trace: previously an init failure was written only
    // to the log inside the panel that had just failed to appear.
    try {
      if (!document.body || document.getElementById('pc-error')) return;
      const banner = document.createElement('div');
      banner.id = 'pc-error';
      banner.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:280px;padding:12px;background:white;color:#202124;border:2px solid #d93025;border-radius:12px;font:13px/1.4 Arial,sans-serif';
      banner.textContent = 'Сравнение цен: скрипт запущен, но панель не удалось создать (' + kind + '). ' +
        'Нажмите F12, откройте Console и найдите строки «[Price Compare]» — пришлите их вместе с описанием проблемы.';
      document.body.appendChild(banner);
    } catch (_) { /* The console message remains the fallback. */ }
  }
  function startUI() {
    if (uiStarted) return;
    uiStarted = true;
    try { init(); }
    catch (error) {
      const kind = errorKind(error);
      try { logEvent('error', { phase: 'init', error: kind }); flushLog(); } catch (_) {}
      console.error('[Price Compare] Initialization failed:', kind);
      showInitError(kind);
    }
  }
  function startWhenReady() {
    if (document.body) { startUI(); return; }
    // DOMContentLoaded may already have fired if the manager injected the
    // script late; waiting only for it would silently never start.
    document.addEventListener('DOMContentLoaded', startUI, { once: true });
    if (document.documentElement) {
      const observer = new MutationObserver(() => {
        if (!document.body) return;
        observer.disconnect();
        startUI();
      });
      observer.observe(document.documentElement, { childList: true });
    }
  }
  startWhenReady();
})();
