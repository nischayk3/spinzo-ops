const { test } = require('node:test');
const assert = require('node:assert');
const { taskTransition, isAwaitingPickup, checkPaymentGate, isIroningEligible, IRONING_PRIORITY_PHONES } = require('./dispatch');

test('isIroningEligible: allows Samsul and Abdur', () => {
  assert.strictEqual(isIroningEligible('+916369768237'), true); // Samsul
  assert.strictEqual(isIroningEligible('6369768237'), true);
  assert.strictEqual(isIroningEligible('+917559105832'), true); // Abdur
  assert.strictEqual(isIroningEligible('7559105832'), true);
});

test('isIroningEligible: rejects New Helper and other phones', () => {
  assert.strictEqual(isIroningEligible('+918888888888'), false);
  assert.strictEqual(isIroningEligible('+919999999999'), false);
  assert.strictEqual(isIroningEligible(''), false);
  assert.strictEqual(isIroningEligible(null), false);
});

test('taskTransition: processing closes the pickup task', () => {
  assert.deepStrictEqual(taskTransition('pickup_completed', 'processing'), { taskStatus: 'picked_up' });
  assert.deepStrictEqual(taskTransition('confirmed', 'processing'), { taskStatus: 'picked_up' });
});

test('taskTransition: ready cleans up process docs only', () => {
  assert.deepStrictEqual(taskTransition('processing', 'ready'), { cleanupProcess: true });
});

test('taskTransition: existing transitions unchanged', () => {
  assert.deepStrictEqual(taskTransition('placed', 'cancelled'), { taskStatus: 'cancelled', dropQueue: true });
  assert.deepStrictEqual(taskTransition('placed', 'pickup_completed'), { taskStatus: 'picked_up' });
  assert.deepStrictEqual(taskTransition('out_for_delivery', 'delivered'), { taskStatus: 'delivered', dropProcess: true });
  assert.strictEqual(taskTransition('ready', 'ready'), null);
});

test('isAwaitingPickup: true for placed/confirmed/unknown, false otherwise', () => {
  assert.strictEqual(isAwaitingPickup('placed'), true);
  assert.strictEqual(isAwaitingPickup('confirmed'), true);
  assert.strictEqual(isAwaitingPickup(undefined), true);
  assert.strictEqual(isAwaitingPickup('pickup_completed'), false);
  assert.strictEqual(isAwaitingPickup('ready'), false);
});
test('checkPaymentGate: blocks unpaid delivered orders', () => {
  const order = {
    billDetails: { total: 210 },
    paymentStatus: 'pending',
    paymentMode: 'later'
  };
  const res = checkPaymentGate(order, { role: 'rider' });
  assert.strictEqual(res.allowed, false);
  assert.strictEqual(res.reason, 'payment_required');
  assert.strictEqual(res.amount, 210);
});

test('checkPaymentGate: allows paid orders', () => {
  const order = {
    billDetails: { total: 210 },
    paymentStatus: 'paid'
  };
  const res = checkPaymentGate(order, { role: 'rider' });
  assert.strictEqual(res.allowed, true);
  assert.strictEqual(res.amount, 210);
});

test('checkPaymentGate: allows zero-amount and credit orders', () => {
  const freeOrder = { billDetails: { total: 0 }, paymentStatus: 'pending' };
  assert.strictEqual(checkPaymentGate(freeOrder, { role: 'rider' }).allowed, true);

  const creditModeOrder = { billDetails: { total: 500 }, paymentMode: 'credit' };
  assert.strictEqual(checkPaymentGate(creditModeOrder, { role: 'rider' }).allowed, true);

  const creditItemsOrder = {
    total: 300,
    items: [{ isCreditItem: true }, { isCreditItem: true }]
  };
  assert.strictEqual(checkPaymentGate(creditItemsOrder, { role: 'rider' }).allowed, true);
});

test('checkPaymentGate: rider cannot override unpaid delivery', () => {
  const order = { billDetails: { total: 500 }, paymentStatus: 'pending' };
  const res = checkPaymentGate(order, { allowUnpaidDelivery: true, role: 'rider' });
  assert.strictEqual(res.allowed, false);
  assert.strictEqual(res.reason, 'payment_required');
});

test('checkPaymentGate: supervisor or admin can override unpaid delivery', () => {
  const order = { billDetails: { total: 500 }, paymentStatus: 'pending' };
  const resAdmin = checkPaymentGate(order, { allowUnpaidDelivery: true, role: 'admin' });
  assert.strictEqual(resAdmin.allowed, true);
  assert.strictEqual(resAdmin.overridden, true);

  const resSupervisor = checkPaymentGate(order, { allowUnpaidDelivery: true, role: 'supervisor' });
  assert.strictEqual(resSupervisor.allowed, true);
  assert.strictEqual(resSupervisor.overridden, true);
});
