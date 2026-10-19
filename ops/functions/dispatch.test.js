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

  // Both Washer 1 (running) and Washer 2 (assigned to helper, loading) block a 3rd order
  const liveAssigned = [
    { id: 'p1', status: 'getting_washed', steps: ['getting_washed'], currentIndex: 0, stages: { getting_washed: { startedAt: 1000, machineName: 'Washer 1' } } },
    { id: 'p2', status: 'getting_washed', steps: ['getting_washed'], currentIndex: 0, stages: { getting_washed: { assignee: 'h_abdur', machineName: 'Washer 2' } } },
  ];
  const res4 = selectHelperForStage('getting_washed', mockHelpers, liveAssigned, { washers: 2, dryers: 2, ironingStations: 2 });
  assert.strictEqual(res4.ok, false);
  assert.strictEqual(res4.shouldQueue, true);
  assert.strictEqual(res4.error, 'washers_at_capacity');
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

  // When all helpers are busy with hands-on tasks, packaging MUST queue (never pile up multiple orders on Abdul!)
  const liveAllBusy = [
    { id: 'p1', status: 'packaging', steps: ['packaging'], currentIndex: 0, stages: { packaging: { assignee: 'h_abdul', startedAt: 1000 } } },
    { id: 'p2', status: 'packaging', steps: ['packaging'], currentIndex: 0, stages: { packaging: { assignee: 'h_abdur', startedAt: 1000 } } },
    { id: 'p3', status: 'getting_ironed', steps: ['getting_ironed'], currentIndex: 0, stages: { getting_ironed: { assignee: 'h_samsul', startedAt: 1000 } } },
  ];
  const res3 = selectHelperForStage('packaging', mockHelpers, liveAllBusy);
  assert.strictEqual(res3.ok, false);
  assert.strictEqual(res3.shouldQueue, true);
  assert.strictEqual(res3.error, 'all_packagers_busy');
});

const { isDeliveryDueToday } = require('./dispatch');

test('isDeliveryDueToday: customer slot validation', () => {
  const today = '2026-10-17';
  
  // Unscheduled / no slot selected yet -> never due for rider dispatch
  assert.strictEqual(isDeliveryDueToday(null, today), false);
  assert.strictEqual(isDeliveryDueToday(undefined, today), false);
  assert.strictEqual(isDeliveryDueToday('', today), false);

  // Scheduled for tomorrow or later -> not due today (stays in store holding)
  assert.strictEqual(isDeliveryDueToday('2026-10-18', today), false);
  assert.strictEqual(isDeliveryDueToday('2026-10-20', today), false);

  // Scheduled for today -> due for auto-dispatch!
  assert.strictEqual(isDeliveryDueToday('2026-10-17', today), true);

  // Overdue from a past day -> due for immediate catch-up
  assert.strictEqual(isDeliveryDueToday('2026-10-16', today), true);
});

test('selectHelperForStage (Washing): assigns free washer even when all helpers are hands-on busy', () => {
  // Abdul is packaging, Samsul is ironing, Abdur is tagging
  const liveBusy = [
    { id: 'p1', status: 'packaging', steps: ['packaging'], currentIndex: 0, stages: { packaging: { assignee: 'h_abdul', startedAt: 1000 } } },
    { id: 'p2', status: 'getting_ironed', steps: ['getting_ironed'], currentIndex: 0, stages: { getting_ironed: { assignee: 'h_samsul', startedAt: 1000 } } },
    { id: 'p3', status: 'tagging', steps: ['tagging'], currentIndex: 0, stages: { tagging: { assignee: 'h_abdur', startedAt: 1000 } } },
  ];
  const res = selectHelperForStage('getting_washed', mockHelpers, liveBusy, { washers: 2, dryers: 2, ironingStations: 2 }, { taggingAssignee: 'h_abdul' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.machineName, 'Washer 1');
  assert.strictEqual(typeof res.helper.uid, 'string');
});

test('getRunningMachines: retains running machine across multi-lot orders until completed', () => {
  const { getRunningMachines } = require('./dispatch');
  const now = Date.now();
  const past70Min = now - (70 * 60 * 1000); // 70 mins ago (e.g. 2nd lot running for 13kg order)
  const liveRunning = [
    {
      id: 'p_multilot',
      status: 'getting_washed',
      steps: ['getting_washed'],
      currentIndex: 0,
      stages: { getting_washed: { startedAt: past70Min, machineName: 'Washer 1' } }
    }
  ];
  const running = getRunningMachines('getting_washed', liveRunning);
  assert.strictEqual(running.length, 1);
  assert.strictEqual(running[0].stages.getting_washed.machineName, 'Washer 1');

  // Once completedAt is set, machine is free
  liveRunning[0].stages.getting_washed.completedAt = now;
  const runningAfter = getRunningMachines('getting_washed', liveRunning);
  assert.strictEqual(runningAfter.length, 0);
});

test('selectHelperForStage (Tagging Balancing): chooses Abdur over Abdul if Abdul has more active tasks', () => {
  // Abdul currently has an active machine task, Abdur has 0 tasks
  const live = [
    {
      id: 'p_abdul_task',
      status: 'getting_washed',
      steps: ['getting_washed'],
      currentIndex: 0,
      stages: { getting_washed: { assignee: 'h_abdul', startedAt: 1000, machineName: 'Washer 1' } }
    }
  ];
  // Both are hands-on free (machine is running), but Abdur has total=0 while Abdul has total=1
  const res = selectHelperForStage('tagging', mockHelpers, live);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.helper.uid, 'h_abdur');
});

test('selectHelperForStage (Tagging): Samsul is assigned when floor helpers are busy and no iron orders pending', () => {
  const live = [
    { id: 'p1', status: 'tagging', steps: ['tagging'], currentIndex: 0, stages: { tagging: { assignee: 'h_abdul', startedAt: 1000 } } },
    { id: 'p2', status: 'packaging', steps: ['packaging'], currentIndex: 0, stages: { packaging: { assignee: 'h_abdur', startedAt: 1000 } } },
  ];
  const res = selectHelperForStage('tagging', mockHelpers, live);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.helper.uid, 'h_samsul');
});

test('selectHelperForStage (Tagging Queue Guard): queues when all 3 helpers are busy, never overloads Abdul', () => {
  const live = [
    { id: 'p1', status: 'tagging', steps: ['tagging'], currentIndex: 0, stages: { tagging: { assignee: 'h_abdul', startedAt: 1000 } } },
    { id: 'p2', status: 'packaging', steps: ['packaging'], currentIndex: 0, stages: { packaging: { assignee: 'h_abdur', startedAt: 1000 } } },
    { id: 'p3', status: 'getting_ironed', steps: ['getting_ironed'], currentIndex: 0, stages: { getting_ironed: { assignee: 'h_samsul', startedAt: 1000 } } },
  ];
  const res = selectHelperForStage('tagging', mockHelpers, live);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.shouldQueue, true);
  assert.strictEqual(res.error, 'all_taggers_busy');
});

test('selectHelperForStage (Machine Collision Guard): helper currently loading a washer cannot be assigned dryer until started', () => {
  // Abdul is assigned Washer 1 but hasn't started it yet (startedAt is null)
  const live = [
    {
      id: 'p1',
      status: 'getting_washed',
      steps: ['getting_washed'],
      currentIndex: 0,
      stages: { getting_washed: { assignee: 'h_abdul', machineName: 'Washer 1' } }
    }
  ];
  const onlyAbdul = [{ uid: 'h_abdul', name: 'Abdul', phone: '+916900311761', onShift: true }];
  const res = selectHelperForStage('getting_dried', onlyAbdul, live);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.shouldQueue, true);
  assert.strictEqual(res.error, 'all_helpers_loading_machines');
});

test('selectHelperForStage (Ironing Overflow): assigns Abdul to Station 2 if Abdur is busy and Station 1 is occupied', () => {
  const live = [
    { id: 'p_iron1', status: 'getting_ironed', steps: ['getting_ironed'], currentIndex: 0, stages: { getting_ironed: { assignee: 'h_samsul', startedAt: 1000, machineName: 'Iron Station 1' } } },
    { id: 'p_pack', status: 'packaging', steps: ['packaging'], currentIndex: 0, stages: { packaging: { assignee: 'h_abdur', startedAt: 1000 } } },
  ];
  const res = selectHelperForStage('getting_ironed', mockHelpers, live);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.helper.uid, 'h_abdul');
  assert.strictEqual(res.machineName, 'Iron Station 2');
});

test('selectHelperForStage (Samsul Machine Flexibility): Samsul can be assigned machine micro-load while ironing', () => {
  // Abdul and Abdur are hands-on busy with 2 tasks each; Samsul is ironing with 1 task
  const live = [
    { id: 'p_iron', status: 'getting_ironed', steps: ['getting_ironed'], currentIndex: 0, stages: { getting_ironed: { assignee: 'h_samsul', startedAt: 1000, machineName: 'Iron Station 1' } } },
    { id: 'p_tag1', status: 'tagging', steps: ['tagging'], currentIndex: 0, stages: { tagging: { assignee: 'h_abdul', startedAt: 1000 } } },
    { id: 'p_wash1', status: 'getting_washed', steps: ['getting_washed'], currentIndex: 0, stages: { getting_washed: { assignee: 'h_abdul', startedAt: 1000 } } },
    { id: 'p_pack1', status: 'packaging', steps: ['packaging'], currentIndex: 0, stages: { packaging: { assignee: 'h_abdur', startedAt: 1000 } } },
    { id: 'p_dry1', status: 'getting_dried', steps: ['getting_dried'], currentIndex: 0, stages: { getting_dried: { assignee: 'h_abdur', startedAt: 1000 } } },
  ];
  const res = selectHelperForStage('getting_washed', mockHelpers, live);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.helper.uid, 'h_samsul');
  assert.strictEqual(res.isMicroTask, true);
});

test('selectHelperForStage (Packaging Parity): Samsul can be assigned packaging when free and no iron pending', () => {
  // Abdul is busy tagging, Abdur has 1 previous task, Samsul has 0 tasks
  const live = [
    { id: 'p_tag', status: 'tagging', steps: ['tagging'], currentIndex: 0, stages: { tagging: { assignee: 'h_abdul', startedAt: 1000 } } },
    { id: 'p_wash', status: 'getting_washed', steps: ['getting_washed'], currentIndex: 0, stages: { getting_washed: { assignee: 'h_abdur', startedAt: 1000 } } },
  ];
  const res = selectHelperForStage('packaging', mockHelpers, live);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.helper.uid, 'h_samsul');
});



