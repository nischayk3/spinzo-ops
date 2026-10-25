const { test } = require('node:test');
const assert = require('node:assert');
const { taskTransition, isAwaitingPickup, checkPaymentGate, isIroningEligible, IRONING_PRIORITY_PHONES, isOrderEditable, isMachineNudgeDue, isMachineUnloadNudgeDue } = require('./dispatch');

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

const { isDeliveryDueToday, parseSlotStartMinutes, isSlotDueForDispatch } = require('./dispatch');

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

test('parseSlotStartMinutes: time format parsing', () => {
  assert.strictEqual(parseSlotStartMinutes('20:00 - 21:00'), 1200);
  assert.strictEqual(parseSlotStartMinutes('08:00 - 09:00'), 480);
  assert.strictEqual(parseSlotStartMinutes('8:00 PM - 9:00 PM'), 1200);
  assert.strictEqual(parseSlotStartMinutes('8:00 - 9:00 PM'), 1200);
  assert.strictEqual(parseSlotStartMinutes('8:00 AM - 9:00 AM'), 480);
  assert.strictEqual(parseSlotStartMinutes('12:00 PM - 1:00 PM'), 720);
  assert.strictEqual(parseSlotStartMinutes('12:00 AM'), 0);
  assert.strictEqual(parseSlotStartMinutes('Instant'), 0);
  assert.strictEqual(parseSlotStartMinutes('Anytime'), 0);
  assert.strictEqual(parseSlotStartMinutes(null), null);
});

test('isSlotDueForDispatch: instant and scheduled window validation', () => {
  const today = '2026-10-20';
  const leadTime = 15; // 15 mins buffer

  // 1. Instant pickup: ALWAYS due immediately regardless of time
  assert.strictEqual(isSlotDueForDispatch({ isInstant: true }), true);
  assert.strictEqual(isSlotDueForDispatch({ type: 'instant' }), true);

  // 2. Future day (tomorrow): NOT due
  assert.strictEqual(isSlotDueForDispatch({ scheduledDate: '2026-10-21', scheduledTime: '20:00 - 21:00' }, leadTime, { todayStr: today }), false);
  assert.strictEqual(isSlotDueForDispatch({ deliveryDate: '2026-10-22', deliveryTime: '10:00 - 11:00' }, leadTime, { todayStr: today }), false);

  // 3. Past day (overdue): ALWAYS due immediately
  assert.strictEqual(isSlotDueForDispatch({ scheduledDate: '2026-10-19', scheduledTime: '20:00 - 21:00' }, leadTime, { todayStr: today }), true);

  // 4. Today (2026-10-20), slot is 8:00 PM (1200 mins):
  // At 11:00 AM (660 mins): 540 mins away -> NOT due!
  assert.strictEqual(isSlotDueForDispatch(
    { scheduledDate: today, scheduledTime: '20:00 - 21:00' },
    leadTime,
    { todayStr: today, currentMinutesIST: 660 }
  ), false);

  // At 7:30 PM (1170 mins): 30 mins away -> NOT due (lead time is 15)!
  assert.strictEqual(isSlotDueForDispatch(
    { deliveryDate: today, deliveryTime: '20:00 - 21:00' },
    leadTime,
    { todayStr: today, currentMinutesIST: 1170 }
  ), false);

  // At 7:40 PM (1180 mins): 20 mins away -> NOT due yet (lead time is 15)
  assert.strictEqual(isSlotDueForDispatch(
    { deliveryDate: today, deliveryTime: '20:00 - 21:00' },
    leadTime,
    { todayStr: today, currentMinutesIST: 1180 }
  ), false);

  // At 7:45 PM (1185 mins): exactly 15 mins away -> DUE FOR DISPATCH!
  assert.strictEqual(isSlotDueForDispatch(
    { deliveryDate: today, deliveryTime: '20:00 - 21:00' },
    leadTime,
    { todayStr: today, currentMinutesIST: 1185 }
  ), true);

  // Default leadTime (no parameter passed): exactly 15 mins away -> DUE!
  assert.strictEqual(isSlotDueForDispatch(
    { deliveryDate: today, deliveryTime: '20:00 - 21:00' },
    undefined,
    { todayStr: today, currentMinutesIST: 1185 }
  ), true);

  // At 7:50 PM (1190 mins): 10 mins away -> DUE FOR DISPATCH!
  assert.strictEqual(isSlotDueForDispatch(
    { scheduledDate: today, scheduledTime: '8:00 PM - 9:00 PM' },
    leadTime,
    { todayStr: today, currentMinutesIST: 1190 }
  ), true);

  // At 8:15 PM (1215 mins): currently happening / running -> DUE!
  assert.strictEqual(isSlotDueForDispatch(
    { scheduledDate: today, scheduledTime: '8:00 PM - 9:00 PM' },
    leadTime,
    { todayStr: today, currentMinutesIST: 1215 }
  ), true);
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

test('isOrderEditable: allows pre-processing orders and tagging state', () => {
  // Pre-processing statuses always allowed
  assert.strictEqual(isOrderEditable({ status: 'placed' }), true);
  assert.strictEqual(isOrderEditable({ status: 'confirmed' }), true);
  assert.strictEqual(isOrderEditable({ status: 'in_transit_to_store' }), true);
  assert.strictEqual(isOrderEditable({ status: 'pickup_completed' }), true);

  // Processing status with tagging step
  assert.strictEqual(isOrderEditable({ status: 'processing', processingStep: 'tagging' }), true);

  // Processing status with process doc currently in tagging
  const liveTagging = [
    {
      id: 'p1',
      status: 'tagging',
      stages: { tagging: { startedAt: 1000 } }
    }
  ];
  assert.strictEqual(isOrderEditable({ status: 'processing' }, liveTagging), true);

  // Processing status where tagging has not completed yet
  const liveTaggingIncomplete = [
    {
      id: 'p1',
      status: 'tagging',
      stages: { tagging: { startedAt: 1000 } }
    }
  ];
  assert.strictEqual(isOrderEditable({ status: 'processing' }, liveTaggingIncomplete), true);
});

test('isOrderEditable: rejects orders that completed tagging or are post-processing', () => {
  // Physical washing started (tagging completed) -> cannot edit items
  const liveWashing = [
    {
      id: 'p1',
      status: 'getting_washed',
      stages: { tagging: { completedAt: 1000 } }
    }
  ];
  assert.strictEqual(isOrderEditable({ status: 'processing', processingStep: 'getting_washed' }, liveWashing), false);

  // Post-processing statuses
  assert.strictEqual(isOrderEditable({ status: 'ready' }), false);
  assert.strictEqual(isOrderEditable({ status: 'out_for_delivery' }), false);
  assert.strictEqual(isOrderEditable({ status: 'delivered' }), false);
  assert.strictEqual(isOrderEditable({ status: 'cancelled' }), false);

  // Invalid / null
  assert.strictEqual(isOrderEditable(null), false);
  assert.strictEqual(isOrderEditable({}), false);
});

test('isMachineNudgeDue: unstarted wash/dry tasks after 5m grace window', () => {
  const now = 1000000000;
  const fourMinAgo = now - 4 * 60 * 1000;
  const fiveMinAgo = now - 5 * 60 * 1000;
  const sixMinAgo = now - 6 * 60 * 1000;

  // Not washing or drying
  assert.strictEqual(isMachineNudgeDue({ assignee: 'u1', acceptedAt: sixMinAgo }, 'tagging', now), false);
  assert.strictEqual(isMachineNudgeDue({ assignee: 'u1', acceptedAt: sixMinAgo }, 'getting_ironed', now), false);

  // No assignee or not accepted
  assert.strictEqual(isMachineNudgeDue({ acceptedAt: sixMinAgo }, 'getting_washed', now), false);
  assert.strictEqual(isMachineNudgeDue({ assignee: 'u1' }, 'getting_washed', now), false);

  // Accepted only 4 minutes ago (within 5m grace period)
  assert.strictEqual(isMachineNudgeDue({ assignee: 'u1', acceptedAt: fourMinAgo }, 'getting_washed', now), false);
  assert.strictEqual(isMachineNudgeDue({ assignee: 'u1', acceptedAt: fourMinAgo }, 'getting_dried', now), false);

  // Accepted 5+ minutes ago, not started -> DUE
  assert.strictEqual(isMachineNudgeDue({ assignee: 'u1', acceptedAt: fiveMinAgo }, 'getting_washed', now), true);
  assert.strictEqual(isMachineNudgeDue({ assignee: 'u1', acceptedAt: sixMinAgo }, 'getting_dried', now), true);

  // Assigned 5+ minutes ago (not yet accepted), not started -> DUE
  assert.strictEqual(isMachineNudgeDue({ assignee: 'u1', assignedAt: fiveMinAgo }, 'getting_washed', now), true);
  assert.strictEqual(isMachineNudgeDue({ assignee: 'u1', assignedAt: sixMinAgo }, 'getting_dried', now), true);

  // Machine already started or completed -> NOT due
  assert.strictEqual(isMachineNudgeDue({ assignee: 'u1', acceptedAt: sixMinAgo, startedAt: now - 1000 }, 'getting_washed', now), false);
  assert.strictEqual(isMachineNudgeDue({ assignee: 'u1', acceptedAt: sixMinAgo, completedAt: now - 1000 }, 'getting_washed', now), false);

  // Snoozed 2 minutes ago -> NOT due (in snooze window)
  assert.strictEqual(isMachineNudgeDue({
    assignee: 'u1',
    acceptedAt: sixMinAgo,
    nudge: { accepted: { lastSnoozedAt: now - 2 * 60 * 1000 } }
  }, 'getting_washed', now), false);

  // Snoozed 5+ minutes ago -> DUE again
  assert.strictEqual(isMachineNudgeDue({
    assignee: 'u1',
    acceptedAt: sixMinAgo,
    nudge: { accepted: { lastSnoozedAt: now - 5 * 60 * 1000 } }
  }, 'getting_washed', now), true);

  // Server push sent 2 minutes ago -> NOT due (suppresses spamming every minute)
  assert.strictEqual(isMachineNudgeDue({
    assignee: 'u1',
    acceptedAt: sixMinAgo,
    nudge: { accepted: { lastSentAt: now - 2 * 60 * 1000 } }
  }, 'getting_washed', now), false);

  // Server push sent 5+ minutes ago -> DUE
  assert.strictEqual(isMachineNudgeDue({
    assignee: 'u1',
    acceptedAt: sixMinAgo,
    nudge: { accepted: { lastSentAt: now - 5 * 60 * 1000 } }
  }, 'getting_washed', now), true);
});

test('isMachineUnloadNudgeDue: wash cycle (35m) and dry cycle (45m) finished but not unloaded', () => {
  const now = 2000000000;
  const wash34MinAgo = now - 34 * 60 * 1000;
  const wash35MinAgo = now - 35 * 60 * 1000;
  const dry44MinAgo = now - 44 * 60 * 1000;
  const dry45MinAgo = now - 45 * 60 * 1000;

  // Not washing or drying
  assert.strictEqual(isMachineUnloadNudgeDue({ assignee: 'u1', startedAt: wash35MinAgo }, 'tagging', now), false);

  // Not started yet
  assert.strictEqual(isMachineUnloadNudgeDue({ assignee: 'u1' }, 'getting_washed', now), false);

  // Already completed (unloaded)
  assert.strictEqual(isMachineUnloadNudgeDue({ assignee: 'u1', startedAt: wash35MinAgo, completedAt: now - 1000 }, 'getting_washed', now), false);

  // Washing: started 34m ago (cycle still running) -> false
  assert.strictEqual(isMachineUnloadNudgeDue({ assignee: 'u1', startedAt: wash34MinAgo }, 'getting_washed', now), false);

  // Washing: started 35m ago (cycle finished, waiting to be unloaded) -> true
  assert.strictEqual(isMachineUnloadNudgeDue({ assignee: 'u1', startedAt: wash35MinAgo }, 'getting_washed', now), true);

  // Drying: started 44m ago (cycle still running) -> false
  assert.strictEqual(isMachineUnloadNudgeDue({ assignee: 'u1', startedAt: dry44MinAgo }, 'getting_dried', now), false);

  // Drying: started 45m ago (cycle finished, waiting to be unloaded) -> true
  assert.strictEqual(isMachineUnloadNudgeDue({ assignee: 'u1', startedAt: dry45MinAgo }, 'getting_dried', now), true);

  // Snooze suppression: snoozed 2m ago -> false
  assert.strictEqual(isMachineUnloadNudgeDue({
    assignee: 'u1',
    startedAt: wash35MinAgo,
    nudge: { started: { lastSnoozedAt: now - 2 * 60 * 1000 } }
  }, 'getting_washed', now), false);

  // Snooze expired: snoozed 5m ago -> true
  assert.strictEqual(isMachineUnloadNudgeDue({
    assignee: 'u1',
    startedAt: wash35MinAgo,
    nudge: { started: { lastSnoozedAt: now - 5 * 60 * 1000 } }
  }, 'getting_washed', now), true);

  // Sent push suppression: push sent 2m ago -> false
  assert.strictEqual(isMachineUnloadNudgeDue({
    assignee: 'u1',
    startedAt: wash35MinAgo,
    nudge: { started: { lastSentAt: now - 2 * 60 * 1000 } }
  }, 'getting_washed', now), false);

  // Push expired: push sent 5m ago -> true
  assert.strictEqual(isMachineUnloadNudgeDue({
    assignee: 'u1',
    startedAt: wash35MinAgo,
    nudge: { started: { lastSentAt: now - 5 * 60 * 1000 } }
  }, 'getting_washed', now), true);
});

test('splitOrderIntoServices: single load for <= 8kg wash_fold, wash_iron, premium_laundry', () => {
  const { splitOrderIntoServices } = require('./dispatch');
  
  const orderWF5 = { items: [{ serviceType: 'wash_fold', weight: 5 }] };
  const resWF5 = splitOrderIntoServices(orderWF5);
  assert.strictEqual(resWF5.length, 1);
  assert.strictEqual(resWF5[0].processKey, 'wash_fold');
  assert.strictEqual(resWF5[0].loadCount, 1);
  assert.strictEqual(resWF5[0].label, 'Wash & Fold');

  const orderWI8 = { items: [{ serviceType: 'wash_iron', weight: 8 }] };
  const resWI8 = splitOrderIntoServices(orderWI8);
  assert.strictEqual(resWI8.length, 1);
  assert.strictEqual(resWI8[0].processKey, 'wash_iron');
  assert.strictEqual(resWI8[0].loadCount, 1);
});

test('splitOrderIntoServices: breaks into multiple loads at 8kg machine capacity boundaries', () => {
  const { splitOrderIntoServices } = require('./dispatch');

  // 12kg Wash & Fold -> 2 loads
  const order12 = { items: [{ serviceType: 'wash_fold', weight: 12 }] };
  const res12 = splitOrderIntoServices(order12);
  assert.strictEqual(res12.length, 2);
  assert.strictEqual(res12[0].processKey, 'wash_fold__L1');
  assert.strictEqual(res12[0].tokenKey, 'wash_fold__L1');
  assert.strictEqual(res12[0].loadIndex, 1);
  assert.strictEqual(res12[0].loadCount, 2);
  assert.strictEqual(res12[0].label, 'Wash & Fold (Load 1/2)');
  assert.strictEqual(res12[1].processKey, 'wash_fold__L2');
  assert.strictEqual(res12[1].loadIndex, 2);

  // 16kg Wash & Iron -> 2 loads
  const order16 = { items: [{ serviceType: 'wash_iron', weight: 16 }] };
  const res16 = splitOrderIntoServices(order16);
  assert.strictEqual(res16.length, 2);
  assert.strictEqual(res16[0].processKey, 'wash_iron__L1');
  assert.strictEqual(res16[1].processKey, 'wash_iron__L2');

  // 20kg Wash & Fold -> 3 loads
  const order20 = { items: [{ serviceType: 'wash_fold', weight: 20 }] };
  const res20 = splitOrderIntoServices(order20);
  assert.strictEqual(res20.length, 3);
  assert.strictEqual(res20[0].processKey, 'wash_fold__L1');
  assert.strictEqual(res20[1].processKey, 'wash_fold__L2');
  assert.strictEqual(res20[2].processKey, 'wash_fold__L3');

  // 32kg Wash & Fold -> 4 loads
  const order32 = { items: [{ serviceType: 'wash_fold', weight: 32 }] };
  const res32 = splitOrderIntoServices(order32);
  assert.strictEqual(res32.length, 4);

  // Respects explicit rider load tokens
  const orderWithTokens = {
    items: [{ serviceType: 'premium_laundry', weight: 14 }],
    tokens: { premium_laundry__L1: '51', premium_laundry__L2: '52' }
  };
  const resTokens = splitOrderIntoServices(orderWithTokens);
  assert.strictEqual(resTokens.length, 2);
  assert.strictEqual(resTokens[0].tokenKey, 'premium_laundry__L1');
  assert.strictEqual(resTokens[1].tokenKey, 'premium_laundry__L2');
});

test('splitOrderIntoServices: preserves non-weight-based services as single groups', () => {
  const { splitOrderIntoServices } = require('./dispatch');
  const orderMulti = {
    items: [
      { serviceType: 'wash_fold', weight: 12 },
      { serviceType: 'blanket_wash', blanketType: 'single' },
      { serviceType: 'ironing', ironingCount: 10 }
    ]
  };
  const resMulti = splitOrderIntoServices(orderMulti);
  assert.strictEqual(resMulti.length, 4); // 2 WF loads + 1 blanket + 1 ironing
  assert.strictEqual(resMulti[0].processKey, 'wash_fold__L1');
  assert.strictEqual(resMulti[1].processKey, 'wash_fold__L2');
  assert.strictEqual(resMulti[2].processKey, 'blanket_wash_single');
  assert.strictEqual(resMulti[3].processKey, 'ironing');
});

test('stepsForServiceType: shoe_clean routes directly from tagging to packaging (no washer or dryer)', () => {
  const { stepsForServiceType, getProcessingSteps } = require('./dispatch');
  const steps = stepsForServiceType('shoe_clean');
  assert.deepStrictEqual(steps, ['tagging', 'packaging']);

  // Pure shoe cleaning orders have 0 machine production steps
  const prodSteps = getProcessingSteps({ items: [{ serviceType: 'shoe_clean' }] });
  assert.deepStrictEqual(prodSteps, []);
});

test('resolveToken: case-insensitively resolves tokens with __L1 and __l1', () => {
  const { resolveToken } = require('./dispatch');
  const tokens = { wash_fold__L1: '03', wash_fold__l2: '115' };
  assert.strictEqual(resolveToken(tokens, 'wash_fold__l1'), '03');
  assert.strictEqual(resolveToken(tokens, 'wash_fold__L1'), '03');
  assert.strictEqual(resolveToken(tokens, 'wash_fold__L2'), '115');
  assert.strictEqual(resolveToken(tokens, 'wash_fold__l2'), '115');
  assert.strictEqual(resolveToken(tokens, 'non_existent'), '');
});

test('splitOrderIntoServices: splits blanket_wash with multiple blankets or >8kg into multiple loads', () => {
  const { splitOrderIntoServices } = require('./dispatch');
  const orderBlankets = {
    items: [{ serviceType: 'blanket_wash', singleBlanketCount: 2, doubleBlanketCount: 1 }]
  };
  const res = splitOrderIntoServices(orderBlankets);
  assert.strictEqual(res.length, 2); // 3 blankets * 5kg = 15kg -> 2 loads
  assert.strictEqual(res[0].processKey, 'blanket_wash__L1');
  assert.strictEqual(res[1].processKey, 'blanket_wash__L2');
});
