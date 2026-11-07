'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { measureOf, analyze, parsePrice, validBarcode, match, comparison } = require('../price-compare.user.js');

test('Cyrillic measures and multipacks', () => {
  assert.deepEqual(measureOf('Напиток 6 x 330 мл'), { type: 'volume', value: 1980, display: '1980 мл' });
  assert.equal(measureOf('Молоко 0,93 л').value, 930);
  assert.equal(measureOf('Мука 1 кг').value, 1000);
  assert.equal(measureOf('Яйца 10 шт').type, 'count');
  assert.equal(measureOf('Товар 5 граммов'), null);
  assert.equal(analyze('Молоко Домик 930 мл').key, analyze('Домик молоко 1 л').key);
});

test('prices handle kopecks and grouped thousands', () => {
  for (const [s, expected] of [['129 99 ₽', 129.99], ['1 299 ₽', 1299], ['1 299 99 ₽', 1299.99], ['1 299,99 ₽', 1299.99], ['0,99 руб.', 0.99], ['199.50', 199.5]]) {
    assert.equal(parsePrice(s, s !== '199.50'), expected, s);
  }
  for (const s of ['-100 ₽', '9999999 ₽', '10 5 ₽', 'доставка 100 ₽', '1.234.56 ₽']) assert.equal(parsePrice(s), null, s);
});

test('product names must agree including flavor and fat content', () => {
  const a = { name: 'Молоко Домик 3,2% 930 мл' };
  assert.equal(match(a, { name: 'Домик молоко 3,2% 1 л' }), true);
  assert.equal(match(a, { name: 'Домик молоко 2,5% 1 л' }), false);
  assert.equal(match({ name: 'Йогурт клубника бренд 100 г' }, { name: 'Йогурт вишня бренд 100 г' }), false);
  assert.equal(match(a, { name: 'Молоко Домик 3,2% 1 кг' }), false);
});

test('validate and prioritize GTIN, without merging conflicting barcodes', () => {
  assert.equal(validBarcode('4006381333931'), '4006381333931');
  assert.equal(validBarcode('4006381333932'), null);
  assert.equal(match({ name: 'Один товар', barcode: '4006381333931' }, { name: 'Другое название', barcode: '4006381333931' }), true);
  assert.equal(match({ name: 'Одинаковый товар', barcode: '4006381333931' }, { name: 'Одинаковый товар', barcode: '5901234123457' }), false);
});

test('unit comparisons, including counts and unknown packs', () => {
  const a = { name: 'Молоко Домик 1 л', price: 100 };
  const b = { name: 'Молоко Домик 930 мл', price: 93 };
  assert.ok(Math.abs(comparison(a, b).percent) < 1e-10);
  assert.equal(comparison(a, b).basis, 'л');
  assert.equal(comparison(a, { name: 'Молоко Домик', price: 100 }), null);
  assert.equal(comparison({ name: 'Яйца марка 10 шт', price: 100 }, { name: 'Яйца марка 6 шт', price: 90 }).basis, 'шт');
  assert.equal(comparison({ name: 'Хлеб марка', price: 100 }, { name: 'Хлеб марка', price: 90 }).percent.toFixed(0), '-10');
});
