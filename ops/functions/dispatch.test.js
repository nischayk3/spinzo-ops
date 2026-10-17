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

const { selectHelperForStage } = require('./dispatch');

const mockHelpers = [
  { uid: 'h_abdul', name: 'Abdul', phone: '+916900311761', onShift: true },
  { uid: 'h_samsul', name: 'Samsul', phone: '+916369768237', onShift: true },
  { uid: 'h_abdur', name: 'Abdur', phone: '+917559105832', onShift: true },
];

test('selectHelperForStage (Tagging): Abdul is 1st preference', () => {
  const res = selectHelperForStage('tagging', mockHelpers, []);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.helper.uid, 'h_abdul');
});

test('selectHelperForStage (Tagging): falls back to Abdur/Samsul if Abdul is busy', () => {
  const liveProcesses = [
    {
      id: 'proc_1',
      status: 'packaging',
      steps: ['tagging', 'packaging'],
      currentIndex: 1,
      stages: { packaging: { assignee: 'h_abdul', startedAt: 1000 } }
    }
  ];
  const res = selectHelperForStage('tagging', mockHelpers, liveProcesses);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.helper.uid === 'h_abdur' || res.helper.uid === 'h_samsul', true);
});

test('selectHelperForStage (Washing): allocates Washer 1 and Washer 2, queues when full', () => {
  const res1 = selectHelperForStage('getting_washed', mockHelpers, [], { washers: 2, dryers: 2, ironingStations: 2 });
  assert.strictEqual(res1.ok, true);
  assert.strictEqual(res1.machineName, 'Washer 1');

  const live1 = [
    {
      id: 'p1',
      status: 'getting_washed',
      steps: ['getting_washed'],
      currentIndex: 0,
      stages: { getting_washed: { startedAt: 1000, machineName: 'Washer 1' } }
    }
  ];
  const res2 = selectHelperForStage('getting_washed', mockHelpers, live1, { washers: 2, dryers: 2, ironingStations: 2 });
  assert.strictEqual(res2.ok, true);
  assert.strictEqual(res2.machineName, 'Washer 2');

  const live2 = [
    ...live1,
    {
      id: 'p2',
      status: 'getting_washed',
      steps: ['getting_washed'],
      currentIndex: 0,
      stages: { getting_washed: { startedAt: 1000, machineName: 'Washer 2' } }
    }
  ];
  const res3 = selectHelperForStage('getting_washed', mockHelpers, live2, { washers: 2, dryers: 2, ironingStations: 2 });
  assert.strictEqual(res3.ok, false);
  assert.strictEqual(res3.shouldQueue, true);
});

test('selectHelperForStage (Ironing): Samsul Station 1, Abdur Station 2 parallel', () => {
  // Order 1 -> Samsul (Station 1)
  const res1 = selectHelperForStage('getting_ironed', mockHelpers, [], { washers: 2, dryers: 2, ironingStations: 2 });
  assert.strictEqual(res1.ok, true);
  assert.strictEqual(res1.helper.uid, 'h_samsul');
  assert.strictEqual(res1.machineName, 'Iron Station 1');

  // Samsul is currently ironing Order 1 -> Order 2 goes to Abdur (Station 2)
  const liveIron1 = [
    {
      id: 'p_iron_1',
      status: 'getting_ironed',
      steps: ['getting_ironed'],
      currentIndex: 0,
      stages: { getting_ironed: { assignee: 'h_samsul', startedAt: 1000, machineName: 'Iron Station 1' } }
    }
  ];
  const res2 = selectHelperForStage('getting_ironed', mockHelpers, liveIron1, { washers: 2, dryers: 2, ironingStations: 2 });
  assert.strictEqual(res2.ok, true);
  assert.strictEqual(res2.helper.uid, 'h_abdur');
  assert.strictEqual(res2.machineName, 'Iron Station 2');

  // Both Samsul and Abdur ironing -> Order 3 must queue
  const liveIron2 = [
    ...liveIron1,
    {
      id: 'p_iron_2',
      status: 'getting_ironed',
      steps: ['getting_ironed'],
      currentIndex: 0,
      stages: { getting_ironed: { assignee: 'h_abdur', startedAt: 1000, machineName: 'Iron Station 2' } }
    }
  ];
  const res3 = selectHelperForStage('getting_ironed', mockHelpers, liveIron2, { washers: 2, dryers: 2, ironingStations: 2 });
  assert.strictEqual(res3.ok, false);
  assert.strictEqual(res3.shouldQueue, true);
});

test('selectHelperForStage (Packaging): Abdul is 1st preference, falls back if busy', () => {
  const res1 = selectHelperForStage('packaging', mockHelpers, []);
  assert.strictEqual(res1.ok, true);
  assert.strictEqual(res1.helper.uid, 'h_abdul');

  const livePackaging = [
    {
      id: 'p_pack',
      status: 'packaging',
      steps: ['packaging'],
      currentIndex: 0,
      stages: { packaging: { assignee: 'h_abdul', startedAt: 1000 } }
    }
  ];
  const res2 = selectHelperForStage('packaging', mockHelpers, livePackaging);
  assert.strictEqual(res2.ok, true);
  assert.strictEqual(res2.helper.uid === 'h_abdur' || res2.helper.uid === 'h_samsul', true);
});

