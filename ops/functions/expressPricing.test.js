const { test } = require('node:test');
const assert = require('node:assert');
const { applyExpressPricing } = require('./dispatch');

test('applyExpressPricing: 5kg Wash & Fold express = 659 (Ajay Ananth case)', () => {
  const r = applyExpressPricing([{ serviceId: 'wash_fold', weight: 5, totalPrice: 425 }], { deliveryFee: 0, discount: 0 });
  assert.strictEqual(r.items[0].totalPrice, 659);
  assert.strictEqual(r.items[0].isExpress, true);
  assert.strictEqual(r.total, 659);
});

test('applyExpressPricing: 8kg Wash & Fold edited at standard rate is corrected (Dee Hangzo case)', () => {
  // Older client sent 8 x 85 = 680 and total 580 after ₹100 discount.
  const r = applyExpressPricing([{ serviceType: 'wash_fold', weight: 8, totalPrice: 680 }], { deliveryFee: 0, discount: 100, total: 580 });
  assert.strictEqual(r.items[0].totalPrice, 1054);
  assert.strictEqual(r.itemTotal, 1054);
  assert.strictEqual(r.total, 954);
});

test('applyExpressPricing: other eligible services use 1.55x', () => {
  const r = applyExpressPricing([
    { serviceId: 'wash_iron', weight: 5 },
    { serviceId: 'premium_laundry', weight: 5 },
    { serviceId: 'blanket_wash', singleBlanketCount: 1, doubleBlanketCount: 1 },
    { serviceId: 'ironing', ironingCount: 10, mediumCount: 2, heavyCount: 1 },
  ]);
  assert.deepStrictEqual(r.items.map((i) => i.totalPrice), [1085, 1550, 1082, 279]); // ironing: 7×10 + 2×30 + 1×50 = 180 → 279
});

test('applyExpressPricing: credit items and shoe cleaning are left untouched', () => {
  const r = applyExpressPricing([
    { serviceId: 'wash_fold', weight: 9, isCreditItem: true, totalPrice: 140 },
    { serviceId: 'shoe_clean', totalPrice: 350 },
  ]);
  assert.strictEqual(r.items[0].totalPrice, 140);
  assert.strictEqual(r.items[1].totalPrice, 350);
  assert.strictEqual(r.itemTotal, 490);
});
