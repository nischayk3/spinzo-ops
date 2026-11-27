const { test } = require('node:test');
const assert = require('node:assert');
const { taskTransition, isAwaitingPickup, checkPaymentGate, isIroningEligible, IRONING_PRIORITY_PHONES, isOrderEditable, isMachineNudgeDue, isMachineUnloadNudgeDue } = require('./dispatch');

test('isIroningEligible: allows Samsul and Abdur only (matches client IRONING_PRIORITY_PHONES)', () => {
  const { SAMSUL_PHONE, ABDUR_PHONE, ABDUL_PHONE, TAHIRUL_PHONE } = require('./dispatch');
  assert.deepStrictEqual(IRONING_PRIORITY_PHONES, [SAMSUL_PHONE, ABDUR_PHONE]);
  assert.strictEqual(isIroningEligible('+916369768237'), true); // Samsul
  assert.strictEqual(isIroningEligible('6369768237'), true);
  assert.strictEqual(isIroningEligible('+917559105832'), true); // Abdur
  assert.strictEqual(isIroningEligible('7559105832'), true);
  assert.strictEqual(isIroningEligible(ABDUL_PHONE), false);
  assert.strictEqual(isIroningEligible(TAHIRUL_PHONE), false);
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

  // Default leadTime (20 mins): 21 mins away -> NOT due, 20 mins away -> DUE!
  assert.strictEqual(isSlotDueForDispatch(
    { deliveryDate: today, deliveryTime: '20:00 - 21:00' },
    undefined,
    { todayStr: today, currentMinutesIST: 1179 }
  ), false);
  assert.strictEqual(isSlotDueForDispatch(
    { deliveryDate: today, deliveryTime: '20:00 - 21:00' },
    undefined,
    { todayStr: today, currentMinutesIST: 1180 }
  ), true);

  // Supports DD/MM/YYYY, Today, Tomorrow, and Firestore Timestamps
  assert.strictEqual(isSlotDueForDispatch(
    { scheduledDate: '20/10/2026', scheduledTime: '20:00 - 21:00' },
    20,
    { todayStr: today, currentMinutesIST: 1180 }
  ), true);
  assert.strictEqual(isSlotDueForDispatch(
    { scheduledDate: '21/10/2026', scheduledTime: '10:00 - 11:00' },
    20,
    { todayStr: today, currentMinutesIST: 1180 }
  ), false);
  assert.strictEqual(isSlotDueForDispatch(
    { scheduledDate: 'Tomorrow', scheduledTime: '10:00 - 11:00' },
    20,
    { todayStr: today, currentMinutesIST: 600 }
  ), false);
  assert.strictEqual(isSlotDueForDispatch(
    { scheduledDate: 'Today', scheduledTime: '10:00 - 11:00' },
    20,
    { todayStr: today, currentMinutesIST: 585 }
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

test('selectHelperForStage (Tagging Tier 1 Balancing): balances between Abdul and Tahirul, keeping Abdur free for Iron Station 2', () => {
  const helpersWithTahirul = [
    ...mockHelpers,
    { uid: 'h_tahirul', name: 'Tahirul', phone: '+919707275674', onShift: true },
  ];
  // Abdul currently has an active running washer (total=1), Tahirul has total=0, Abdur has total=0
  const live = [
    {
      id: 'p_abdul_task',
      status: 'getting_washed',
      steps: ['getting_washed'],
      currentIndex: 0,
      stages: { getting_washed: { assignee: 'h_abdul', startedAt: 1000, machineName: 'Washer 1' } }
    }
  ];
  // Tier 1 (Abdul & Tahirul) picks Tahirul because Tahirul has lower total workload
  const res = selectHelperForStage('tagging', helpersWithTahirul, live);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.helper.uid, 'h_tahirul');

  // If Tahirul is busy tagging, Tier 1 still prefers hands-on-free Abdul over Tier 2 Abdur
  const liveTahirulBusy = [
    ...live,
    { id: 'p_tahirul_tag', status: 'tagging', steps: ['tagging'], currentIndex: 0, stages: { tagging: { assignee: 'h_tahirul', startedAt: 1000 } } },
  ];
  const res2 = selectHelperForStage('tagging', helpersWithTahirul, liveTahirulBusy);
  assert.strictEqual(res2.ok, true);
  assert.strictEqual(res2.helper.uid, 'h_abdul');

  // When both Tier 1 helpers (Abdul & Tahirul) are hands-on busy, Tier 2 Abdur steps in
  const liveTier1Busy = [
    { id: 'p_abdul_tag', status: 'tagging', steps: ['tagging'], currentIndex: 0, stages: { tagging: { assignee: 'h_abdul', startedAt: 1000 } } },
    { id: 'p_tahirul_pkg', status: 'packaging', steps: ['packaging'], currentIndex: 0, stages: { packaging: { assignee: 'h_tahirul', startedAt: 1000 } } },
  ];
  const res3 = selectHelperForStage('tagging', helpersWithTahirul, liveTier1Busy);
  assert.strictEqual(res3.ok, true);
  assert.strictEqual(res3.helper.uid, 'h_abdur');
});

test('selectHelperForStage (Tahirul Packaging, Washing, Drying & Ironing Block)', () => {
  const helpersWithTahirul = [
    ...mockHelpers,
    { uid: 'h_tahirul', name: 'Tahirul', phone: '+919707275674', onShift: true },
  ];

  // 1. Packaging: balances to Tahirul when Abdul is busy
  const liveAbdulTagging = [
    { id: 'p_tag', status: 'tagging', steps: ['tagging'], currentIndex: 0, stages: { tagging: { assignee: 'h_abdul', startedAt: 1000 } } },
  ];
  const pkgRes = selectHelperForStage('packaging', helpersWithTahirul, liveAbdulTagging);
  assert.strictEqual(pkgRes.ok, true);
  assert.strictEqual(pkgRes.helper.uid, 'h_tahirul');

  // 2. Washing & Drying: Tahirul gets previousAssignee continuity and machine assignment
  const washRes = selectHelperForStage('getting_washed', helpersWithTahirul, [], { washers: 2, dryers: 2, ironingStations: 2 }, { previousAssignee: 'h_tahirul' });
  assert.strictEqual(washRes.ok, true);
  assert.strictEqual(washRes.helper.uid, 'h_tahirul');
  assert.strictEqual(washRes.machineName, 'Washer 1');

  const dryRes = selectHelperForStage('getting_dried', helpersWithTahirul, [], { washers: 2, dryers: 2, ironingStations: 2 }, { previousAssignee: 'h_tahirul' });
  assert.strictEqual(dryRes.ok, true);
  assert.strictEqual(dryRes.helper.uid, 'h_tahirul');
  assert.strictEqual(dryRes.machineName, 'Dryer 1');

  // 3. Ironing: Tahirul is STRICTLY BLOCKED even when Samsul, Abdur, and Abdul are all busy
  const liveAllIronEligibleBusy = [
    { id: 'p_i1', status: 'getting_ironed', steps: ['getting_ironed'], currentIndex: 0, stages: { getting_ironed: { assignee: 'h_samsul', startedAt: 1000, machineName: 'Iron Station 1' } } },
    { id: 'p_pkg', status: 'packaging', steps: ['packaging'], currentIndex: 0, stages: { packaging: { assignee: 'h_abdur', startedAt: 1000 } } },
    { id: 'p_tag', status: 'tagging', steps: ['tagging'], currentIndex: 0, stages: { tagging: { assignee: 'h_abdul', startedAt: 1000 } } },
  ];
  const ironRes = selectHelperForStage('getting_ironed', helpersWithTahirul, liveAllIronEligibleBusy);
  assert.strictEqual(ironRes.ok, false);
  assert.strictEqual(ironRes.shouldQueue, true);
  assert.strictEqual(ironRes.error, 'iron_specialists_busy');
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

test('selectHelperForStage (Ironing Overflow): queues by default when Samsul & Abdur are busy; assigns Abdul to Station 2 when enabled via helperRules', () => {
  const live = [
    { id: 'p_iron1', status: 'getting_ironed', steps: ['getting_ironed'], currentIndex: 0, stages: { getting_ironed: { assignee: 'h_samsul', startedAt: 1000, machineName: 'Iron Station 1' } } },
    { id: 'p_pack', status: 'packaging', steps: ['packaging'], currentIndex: 0, stages: { packaging: { assignee: 'h_abdur', startedAt: 1000 } } },
  ];
  const defaultRes = selectHelperForStage('getting_ironed', mockHelpers, live);
  assert.strictEqual(defaultRes.ok, false);
  assert.strictEqual(defaultRes.shouldQueue, true);

  const overrideRes = selectHelperForStage(
    'getting_ironed',
    mockHelpers,
    live,
    { washers: 2, dryers: 2, ironingStations: 2 },
    {},
    { '+916900311761': { getting_ironed: true } }
  );
  assert.strictEqual(overrideRes.ok, true);
  assert.strictEqual(overrideRes.helper.uid, 'h_abdul');
  assert.strictEqual(overrideRes.machineName, 'Iron Station 2');
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

test('isMachineUnloadNudgeDue: wash cycle (36m) and dry cycle (40m) finished but not unloaded', () => {
  const now = 2000000000;
  const wash35MinAgo = now - 35 * 60 * 1000;
  const wash36MinAgo = now - 36 * 60 * 1000;
  const dry39MinAgo = now - 39 * 60 * 1000;
  const dry40MinAgo = now - 40 * 60 * 1000;

  // Not washing or drying
  assert.strictEqual(isMachineUnloadNudgeDue({ assignee: 'u1', startedAt: wash36MinAgo }, 'tagging', now), false);

  // Not started yet
  assert.strictEqual(isMachineUnloadNudgeDue({ assignee: 'u1' }, 'getting_washed', now), false);

  // Already completed (unloaded)
  assert.strictEqual(isMachineUnloadNudgeDue({ assignee: 'u1', startedAt: wash36MinAgo, completedAt: now - 1000 }, 'getting_washed', now), false);

  // Washing: started 35m ago (cycle still running) -> false
  assert.strictEqual(isMachineUnloadNudgeDue({ assignee: 'u1', startedAt: wash35MinAgo }, 'getting_washed', now), false);

  // Washing: started 36m ago (cycle finished, waiting to be unloaded) -> true
  assert.strictEqual(isMachineUnloadNudgeDue({ assignee: 'u1', startedAt: wash36MinAgo }, 'getting_washed', now), true);

  // Drying: started 39m ago (cycle still running) -> false
  assert.strictEqual(isMachineUnloadNudgeDue({ assignee: 'u1', startedAt: dry39MinAgo }, 'getting_dried', now), false);

  // Drying: started 40m ago (cycle finished, waiting to be unloaded) -> true
  assert.strictEqual(isMachineUnloadNudgeDue({ assignee: 'u1', startedAt: dry40MinAgo }, 'getting_dried', now), true);

  // Snooze suppression: snoozed 2m ago -> false
  assert.strictEqual(isMachineUnloadNudgeDue({
    assignee: 'u1',
    startedAt: wash36MinAgo,
    nudge: { started: { lastSnoozedAt: now - 2 * 60 * 1000 } }
  }, 'getting_washed', now), false);

  // Snooze expired: snoozed 5m ago -> true
  assert.strictEqual(isMachineUnloadNudgeDue({
    assignee: 'u1',
    startedAt: wash36MinAgo,
    nudge: { started: { lastSnoozedAt: now - 5 * 60 * 1000 } }
  }, 'getting_washed', now), true);

  // Sent push suppression: push sent 2m ago -> false
  assert.strictEqual(isMachineUnloadNudgeDue({
    assignee: 'u1',
    startedAt: wash36MinAgo,
    nudge: { started: { lastSentAt: now - 2 * 60 * 1000 } }
  }, 'getting_washed', now), false);

  // Push expired: push sent 5m ago -> true
  assert.strictEqual(isMachineUnloadNudgeDue({
    assignee: 'u1',
    startedAt: wash36MinAgo,
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

test('premium_laundry: routes through tagging -> getting_washed -> getting_dried -> getting_ironed -> packaging', () => {
  const { stepsForServiceType, getProcessingSteps, opsStepsForOrder } = require('./dispatch');
  assert.deepStrictEqual(
    stepsForServiceType('premium_laundry'),
    ['tagging', 'getting_washed', 'getting_dried', 'getting_ironed', 'packaging']
  );
  assert.deepStrictEqual(
    getProcessingSteps({ items: [{ serviceType: 'premium_laundry', weight: 5 }] }),
    ['getting_washed', 'getting_dried', 'getting_ironed']
  );
  assert.deepStrictEqual(
    opsStepsForOrder({ items: [{ serviceType: 'premium_laundry', weight: 5 }] }),
    ['tagging', 'getting_washed', 'getting_dried', 'getting_ironed', 'packaging']
  );
});

test('break & lunch gating: skips helpers and riders on lunch, short_break, or off', () => {
  const { isStaffAvailableForAutoAssign, pickRider } = require('./dispatch');
  assert.strictEqual(isStaffAvailableForAutoAssign({ onShift: true, onBreak: false, attendanceStatus: 'working' }), true);
  assert.strictEqual(isStaffAvailableForAutoAssign({ onShift: true, onBreak: true, attendanceStatus: 'lunch' }), false);
  assert.strictEqual(isStaffAvailableForAutoAssign({ onShift: true, attendanceStatus: 'short_break' }), false);
  assert.strictEqual(isStaffAvailableForAutoAssign({ onShift: false, attendanceStatus: 'working' }), false);

  const roster = { '+919000000001': 'rider', '+919000000002': 'rider' };
  const selected = pickRider(
    [
      { uid: 'r1', phone: '+919000000001', onShift: true, onBreak: true, attendanceStatus: 'lunch' },
      { uid: 'r2', phone: '+919000000002', onShift: true, onBreak: false, attendanceStatus: 'working' },
    ],
    { r1: 0, r2: 2 },
    roster
  );
  assert.strictEqual(selected, 'r2');

  const helpersWithBreak = [
    { uid: 'h_abdul', name: 'Abdul', phone: '+916900311761', onShift: true, onBreak: true, attendanceStatus: 'lunch' },
    { uid: 'h_abdur', name: 'Abdur', phone: '+917559105832', onShift: true, onBreak: false, attendanceStatus: 'working' },
  ];
  const stageDecision = selectHelperForStage('tagging', helpersWithBreak, []);
  assert.strictEqual(stageDecision.ok, true);
  assert.strictEqual(stageDecision.helper.uid, 'h_abdur');
});

test('isSlotDueForDispatch: dispatches Express 6-8h orders immediately when scheduled for today, holds future-day Express orders', () => {
  const { isSlotDueForDispatch } = require('./dispatch');
  const opts = { todayStr: '2026-11-07', currentMinutesIST: 10 * 60 }; // 10:00 AM IST

  // Standard scheduled order at 16:00 today -> held (360m > 20m lead time)
  assert.strictEqual(
    isSlotDueForDispatch({ scheduledDate: '2026-11-07', scheduledTime: '16:00 - 17:00', isExpress: false }, 20, opts),
    false
  );

  // Express 6-8h order placed for 16:00 today -> DUE IMMEDIATELY so ops starts catering right away!
  assert.strictEqual(
    isSlotDueForDispatch({ scheduledDate: '2026-11-07', scheduledTime: '16:00 - 17:00', isExpress: true }, 20, opts),
    true
  );

  // Express 6-8h order explicitly booked for tomorrow -> held until tomorrow
  assert.strictEqual(
    isSlotDueForDispatch({ scheduledDate: '2026-11-08', scheduledTime: '10:00 - 11:00', isExpress: true }, 20, opts),
    false
  );
});

test('washerChemicalNudgeDue: detergent at 3m and softener at 21m on 36m wash cycle', () => {
  const { washerChemicalNudgeDue } = require('./dispatch');
  const now = 3000000000;
  const twoMinAgo = now - 2 * 60 * 1000;
  const threeMinAgo = now - 3 * 60 * 1000;
  const twentyMinAgo = now - 20 * 60 * 1000;
  const twentyOneMinAgo = now - 21 * 60 * 1000;

  // Before 3m -> no chemical nudge
  assert.strictEqual(washerChemicalNudgeDue({ assignee: 'u1', startedAt: twoMinAgo }, now), null);

  // At 3m -> detergent due
  assert.strictEqual(washerChemicalNudgeDue({ assignee: 'u1', startedAt: threeMinAgo }, now), 'detergent');

  // After detergent added, at 20m -> null (softener not due yet)
  assert.strictEqual(washerChemicalNudgeDue({ assignee: 'u1', startedAt: twentyMinAgo, detergentAddedAt: now - 15 * 60 * 1000 }, now), null);

  // At 21m -> softener due
  assert.strictEqual(washerChemicalNudgeDue({ assignee: 'u1', startedAt: twentyOneMinAgo, detergentAddedAt: now - 15 * 60 * 1000 }, now), 'softener');

  // Both added -> null
  assert.strictEqual(washerChemicalNudgeDue({ assignee: 'u1', startedAt: twentyOneMinAgo, detergentAddedAt: now - 15 * 60 * 1000, softenerAddedAt: now - 1000 }, now), null);
});

test('isHandsOnStageNudgeDue: tagging & packaging 10m initial, 5m repeat, respects completion & snooze', () => {
  const { isHandsOnStageNudgeDue } = require('./dispatch');
  const now = 4000000000;
  const nineMinAgo = now - 9 * 60 * 1000;
  const tenMinAgo = now - 10 * 60 * 1000;

  // Non-hands-on steps -> false
  assert.strictEqual(isHandsOnStageNudgeDue({ assignee: 'u1', assignedAt: tenMinAgo }, 'getting_washed', now), false);
  assert.strictEqual(isHandsOnStageNudgeDue({ assignee: 'u1', assignedAt: tenMinAgo }, 'getting_ironed', now), false);

  // Before 10m -> false
  assert.strictEqual(isHandsOnStageNudgeDue({ assignee: 'u1', assignedAt: nineMinAgo }, 'tagging', now), false);
  assert.strictEqual(isHandsOnStageNudgeDue({ assignee: 'u1', acceptedAt: nineMinAgo }, 'packaging', now), false);

  // At 10m -> true
  assert.strictEqual(isHandsOnStageNudgeDue({ assignee: 'u1', assignedAt: tenMinAgo }, 'tagging', now), true);
  assert.strictEqual(isHandsOnStageNudgeDue({ assignee: 'u1', acceptedAt: tenMinAgo }, 'packaging', now), true);

  // Completed -> false
  assert.strictEqual(isHandsOnStageNudgeDue({ assignee: 'u1', assignedAt: tenMinAgo, completedAt: now - 1000 }, 'tagging', now), false);

  // Sent 3m ago -> false; sent 5m ago -> true
  assert.strictEqual(isHandsOnStageNudgeDue({
    assignee: 'u1',
    assignedAt: tenMinAgo,
    nudge: { hands_on: { lastSentAt: now - 3 * 60 * 1000 } }
  }, 'tagging', now), false);
  assert.strictEqual(isHandsOnStageNudgeDue({
    assignee: 'u1',
    assignedAt: tenMinAgo,
    nudge: { hands_on: { lastSentAt: now - 5 * 60 * 1000 } }
  }, 'tagging', now), true);

  // Snoozed via snoozedUntil (in future) -> false; expired snoozedUntil -> true
  assert.strictEqual(isHandsOnStageNudgeDue({
    assignee: 'u1',
    assignedAt: tenMinAgo,
    nudge: { hands_on: { snoozedUntil: now + 2 * 60 * 1000 } }
  }, 'packaging', now), false);
  assert.strictEqual(isHandsOnStageNudgeDue({
    assignee: 'u1',
    assignedAt: tenMinAgo,
    nudge: { hands_on: { snoozedUntil: now - 1000 } }
  }, 'packaging', now), true);
});

test('isHelperAllowedForStage & selectHelperForStage: respects dynamic helperAssignmentRules with fallback', () => {
  const { isHelperAllowedForStage, TAHIRUL_PHONE, ABDUL_PHONE } = require('./dispatch');

  // Fallback when helperRules missing
  assert.strictEqual(isHelperAllowedForStage(TAHIRUL_PHONE, 'getting_ironed', null), false);
  assert.strictEqual(isHelperAllowedForStage(TAHIRUL_PHONE, 'tagging', null), true);
  assert.strictEqual(isHelperAllowedForStage(ABDUL_PHONE, 'tagging', undefined), true);

  // Custom rules: enable ironing for Tahirul (+91 key) and disable tagging for Abdul (10-digit key)
  const customRules = {
    '+919707275674': { getting_ironed: true },
    '6900311761': { tagging: false },
  };
  assert.strictEqual(isHelperAllowedForStage(TAHIRUL_PHONE, 'getting_ironed', customRules), true);
  assert.strictEqual(isHelperAllowedForStage(ABDUL_PHONE, 'tagging', customRules), false);
  assert.strictEqual(isHelperAllowedForStage(ABDUL_PHONE, 'packaging', customRules), true);

  const helpersWithTahirul = [
    ...mockHelpers,
    { uid: 'h_tahirul', name: 'Tahirul', phone: TAHIRUL_PHONE, onShift: true },
  ];

  // With tagging disabled for Abdul, tagging picks Tahirul instead of Abdul
  const tagRes = selectHelperForStage('tagging', helpersWithTahirul, [], undefined, {}, customRules);
  assert.strictEqual(tagRes.ok, true);
  assert.strictEqual(tagRes.helper.uid, 'h_tahirul');

  // With ironing enabled for Tahirul, Tahirul can be assigned Iron Station 2 when Samsul/Abdur/Abdul are busy
  const liveIronBusy = [
    { id: 'p_i1', status: 'getting_ironed', steps: ['getting_ironed'], currentIndex: 0, stages: { getting_ironed: { assignee: 'h_samsul', startedAt: 1000, machineName: 'Iron Station 1' } } },
    { id: 'p_pkg', status: 'packaging', steps: ['packaging'], currentIndex: 0, stages: { packaging: { assignee: 'h_abdur', startedAt: 1000 } } },
    { id: 'p_tag', status: 'tagging', steps: ['tagging'], currentIndex: 0, stages: { tagging: { assignee: 'h_abdul', startedAt: 1000 } } },
  ];
  const ironRes = selectHelperForStage('getting_ironed', helpersWithTahirul, liveIronBusy, { washers: 2, dryers: 2, ironingStations: 2 }, {}, customRules);
  assert.strictEqual(ironRes.ok, true);
  assert.strictEqual(ironRes.helper.uid, 'h_tahirul');
  assert.strictEqual(ironRes.machineName, 'Iron Station 2');
});

test('isWashRequiringService: identifies all wash-requiring services accurately', () => {
  const { isWashRequiringService } = require('./dispatch');
  const washServices = [
    'wash_fold',
    'wash_iron',
    'blanket_wash',
    'blanket_wash_single',
    'blanket_wash_double',
    'premium_laundry',
    'dry_clean',
  ];
  for (const svc of washServices) {
    assert.strictEqual(isWashRequiringService(svc), true, `Expected ${svc} to require wash`);
  }
  assert.strictEqual(isWashRequiringService('ironing'), false);
  assert.strictEqual(isWashRequiringService('shoe_clean'), false);
  assert.strictEqual(isWashRequiringService(''), false);
  assert.strictEqual(isWashRequiringService(null), false);
  assert.strictEqual(isWashRequiringService(undefined), false);
});

test('selectHelperForStage (Washer Starvation Override): pulls packaging helper for wash services when washer empty, respects guards', () => {
  const { ABDUL_PHONE, SAMSUL_PHONE, ABDUR_PHONE } = require('./dispatch');
  const helpers = [
    { uid: 'h_abdul', name: 'Abdul', phone: ABDUL_PHONE, onShift: true },
    { uid: 'h_abdur', name: 'Abdur', phone: ABDUR_PHONE, onShift: true },
    { uid: 'h_samsul', name: 'Samsul', phone: SAMSUL_PHONE, onShift: true },
  ];

  // All 3 helpers are hands-on busy: Abdul tagging, Abdur packaging, Samsul ironing; 0 washers occupied, 0 waiting in wash queue
  const liveWasherStarving = [
    { id: 'p_tag', status: 'tagging', steps: ['tagging'], currentIndex: 0, stages: { tagging: { assignee: 'h_abdul', assignedAt: 1000 } } },
    { id: 'p_pkg', status: 'packaging', steps: ['packaging'], currentIndex: 0, stages: { packaging: { assignee: 'h_abdur', assignedAt: 1000 } } },
    { id: 'p_iron', status: 'getting_ironed', steps: ['getting_ironed'], currentIndex: 0, stages: { getting_ironed: { assignee: 'h_samsul', startedAt: 1000, machineName: 'Iron Station 1' } } },
  ];

  // 1. Pulls packaging helper (Abdur) for wash_fold, wash_iron, blanket_wash, premium_laundry
  for (const svc of ['wash_fold', 'wash_iron', 'blanket_wash', 'premium_laundry']) {
    const res = selectHelperForStage('tagging', helpers, liveWasherStarving, { washers: 2, dryers: 2, ironingStations: 2 }, { serviceType: svc });
    assert.strictEqual(res.ok, true, `Expected starvation override for ${svc}`);
    assert.strictEqual(res.helper.uid, 'h_abdur', `Expected packaging helper Abdur to be pulled for ${svc}`);
    assert.strictEqual(res.isStarvationOverride, true);
  }

  // 2. Does NOT pull for ironing-only orders
  const ironOnlyRes = selectHelperForStage('tagging', helpers, liveWasherStarving, { washers: 2, dryers: 2, ironingStations: 2 }, { serviceType: 'ironing' });
  assert.strictEqual(ironOnlyRes.ok, false);
  assert.strictEqual(ironOnlyRes.shouldQueue, true);

  // 3. Does NOT pull when all washers are occupied (2/2 running)
  const liveWashersFull = [
    ...liveWasherStarving,
    { id: 'p_w1', status: 'getting_washed', steps: ['getting_washed'], currentIndex: 0, stages: { getting_washed: { assignee: 'h_abdul', startedAt: 1000, machineName: 'Washer 1' } } },
    { id: 'p_w2', status: 'getting_washed', steps: ['getting_washed'], currentIndex: 0, stages: { getting_washed: { assignee: 'h_abdur', startedAt: 1000, machineName: 'Washer 2' } } },
  ];
  const fullRes = selectHelperForStage('tagging', helpers, liveWashersFull, { washers: 2, dryers: 2, ironingStations: 2 }, { serviceType: 'wash_fold' });
  assert.strictEqual(fullRes.ok, false);
  assert.strictEqual(fullRes.shouldQueue, true);

  // 4. Does NOT pull when an unassigned/unstarted getting_washed order is already waiting in queue
  const liveWashQueued = [
    ...liveWasherStarving,
    { id: 'p_wq', status: 'getting_washed', steps: ['getting_washed'], currentIndex: 0, stages: { getting_washed: { assignee: null } } },
  ];
  const queuedWashRes = selectHelperForStage('tagging', helpers, liveWashQueued, { washers: 2, dryers: 2, ironingStations: 2 }, { serviceType: 'wash_fold' });
  assert.strictEqual(queuedWashRes.ok, false);
  assert.strictEqual(queuedWashRes.shouldQueue, true);

  // 5. Does NOT double-assign someone already doing tagging (even if everyone is tagging)
  const liveAllTagging = [
    { id: 'p_t1', status: 'tagging', steps: ['tagging'], currentIndex: 0, stages: { tagging: { assignee: 'h_abdul', assignedAt: 1000 } } },
    { id: 'p_t2', status: 'tagging', steps: ['tagging'], currentIndex: 0, stages: { tagging: { assignee: 'h_abdur', assignedAt: 1000 } } },
    { id: 'p_t3', status: 'tagging', steps: ['tagging'], currentIndex: 0, stages: { tagging: { assignee: 'h_samsul', assignedAt: 1000 } } },
  ];
  const allTaggingRes = selectHelperForStage('tagging', helpers, liveAllTagging, { washers: 2, dryers: 2, ironingStations: 2 }, { serviceType: 'wash_fold' });
  assert.strictEqual(allTaggingRes.ok, false);
  assert.strictEqual(allTaggingRes.shouldQueue, true);
});

test('pickRider (Spatial Batching): clusters nearby order onto Rider A over distant Rider B, while respecting 5-task cap', () => {
  const { pickRider, haversineMeters } = require('./dispatch');

  // HSR Sector 2 order location
  const hsrOrderGeo = { lat: 12.9081, lng: 77.6476 };
  // ~400m away in HSR Sector 2
  const hsrNearbyStop = { lat: 12.9112, lng: 77.6494 };
  // ~5km away (Koramangala / Bellandur)
  const distantLoc = { lat: 12.9530, lng: 77.6476 };

  const distNear = haversineMeters(hsrOrderGeo, hsrNearbyStop);
  const distFar = haversineMeters(hsrOrderGeo, distantLoc);
  assert.ok(distNear < 500, `Expected nearby stop < 500m, got ${distNear}`);
  assert.ok(distFar > 4500, `Expected distant stop > 4500m, got ${distFar}`);

  const rosterPhones = {
    '+919000000001': 'rider',
    '+919000000002': 'rider',
  };
  const candidates = [
    { uid: 'rider_a', phone: '+919000000001', onShift: true, shiftStartAt: 1000, lastLocation: hsrNearbyStop },
    { uid: 'rider_b', phone: '+919000000002', onShift: true, shiftStartAt: 1000, lastLocation: distantLoc },
  ];
  const riderStopCoords = {
    rider_a: [hsrNearbyStop],
    rider_b: [],
  };

  // Rider A has 1 stop 400m away (score: 1800 + ~395 - 1500 = 695)
  // Rider B has 0 stops 5km away (score: 0 + ~4993 = 4993) -> Rider A wins via spatial batching!
  const clustered = pickRider(candidates, { rider_a: 1, rider_b: 0 }, rosterPhones, hsrOrderGeo, riderStopCoords);
  assert.strictEqual(clustered, 'rider_a');

  // Capacity cap: if Rider A already has 5 active tasks (+10000 overflow penalty, no cluster bonus), Rider B wins!
  const capped = pickRider(candidates, { rider_a: 5, rider_b: 0 }, rosterPhones, hsrOrderGeo, riderStopCoords);
  assert.strictEqual(capped, 'rider_b');

  // Backwards-compatibility: when orderGeo is omitted/null, least-busy Rider B (0 tasks) wins over Rider A (1 task)
  const legacy = pickRider(candidates, { rider_a: 1, rider_b: 0 }, rosterPhones);
  assert.strictEqual(legacy, 'rider_b');
});

test('extractHelperRulesFromDoc: parses top-level flat map and legacy nested .rules, ignoring metadata', () => {
  const { extractHelperRulesFromDoc } = require('./dispatch');

  assert.strictEqual(extractHelperRulesFromDoc(null), null);
  assert.strictEqual(extractHelperRulesFromDoc(undefined), null);
  assert.strictEqual(extractHelperRulesFromDoc({}), null);
  assert.strictEqual(extractHelperRulesFromDoc({ updatedAt: { toMillis: () => 1234 }, updatedBy: 'sup_1' }), null);

  // Top-level flat map written by client helperRulesStore
  const flatDoc = {
    '+916900311761': { tagging: true, getting_washed: false, getting_dried: true, getting_ironed: false, packaging: true },
    '+919707275674': { getting_ironed: true },
    updatedAt: { toMillis: () => 999999 },
    updatedBy: 'supervisor_uid',
  };
  assert.deepStrictEqual(extractHelperRulesFromDoc(flatDoc), {
    '+916900311761': { tagging: true, getting_washed: false, getting_dried: true, getting_ironed: false, packaging: true },
    '+919707275674': { getting_ironed: true },
  });

  // Legacy nested .rules shape
  const legacyDoc = {
    rules: {
      '+916369768237': { tagging: false, packaging: false },
    },
    updatedBy: 'admin_1',
  };
  assert.deepStrictEqual(extractHelperRulesFromDoc(legacyDoc), {
    '+916369768237': { tagging: false, packaging: false },
  });
  assert.strictEqual(extractHelperRulesFromDoc({ rules: {} }), null);
});

test('extractCleanTokens & extractCleanTokenNumber: supports alphanumeric tokens, multi-bag lists, rolled-up maps, and rejects random IDs', () => {
  const { extractCleanTokens, extractCleanTokenNumber } = require('./dispatch');

  assert.strictEqual(extractCleanTokenNumber('T-39'), '39');
  assert.strictEqual(extractCleanTokenNumber('t-39'), '39');
  assert.strictEqual(extractCleanTokenNumber('Token #108'), '108');
  assert.strictEqual(extractCleanTokenNumber('Token B102'), 'B102');
  assert.strictEqual(extractCleanTokenNumber('T108'), 'T108'); // bare T + digits preserved
  assert.strictEqual(extractCleanTokenNumber('#149'), '149');
  assert.strictEqual(extractCleanTokenNumber('  #T-42  '), '42');
  assert.strictEqual(extractCleanTokenNumber('108'), '108');
  assert.strictEqual(extractCleanTokenNumber('03'), '03');
  assert.strictEqual(extractCleanTokenNumber('B102'), 'B102');
  assert.strictEqual(extractCleanTokenNumber('b-102'), 'B-102');
  assert.strictEqual(extractCleanTokenNumber('P98'), 'P98');
  assert.strictEqual(extractCleanTokenNumber('P108'), 'P108');
  assert.strictEqual(extractCleanTokenNumber('1a'), '1A');
  assert.strictEqual(extractCleanTokenNumber('1b108'), '1B108');
  assert.strictEqual(extractCleanTokenNumber('39A'), '39A');
  assert.strictEqual(extractCleanTokenNumber('39-1'), '39-1');
  assert.strictEqual(extractCleanTokenNumber('2A45'), '2A45');
  assert.strictEqual(extractCleanTokenNumber(88), '88');

  // Multi-token lists split on comma/slash/semicolon/&/और and deduplicated case-insensitively
  assert.deepStrictEqual(extractCleanTokens('1A, B102'), ['1A', 'B102']);
  assert.deepStrictEqual(extractCleanTokens('1a / b102; 1A & P98 और p98'), ['1A', 'B102', 'P98']);

  // Falls back to tokensMap and deduplicates rolled-up entries preserving order
  assert.strictEqual(extractCleanTokenNumber('', { wash_fold: 'T-51', ironing: '52' }), '51, 52');
  assert.strictEqual(extractCleanTokenNumber(null, { wash_fold: '', wash_iron: '#77' }), '77');
  assert.deepStrictEqual(
    extractCleanTokens('', { wash_fold__L1: '23', wash_fold__L2: '24', wash_fold: '23, 24' }),
    ['23', '24']
  );

  // Rejects empty / random alphanumeric order IDs (>8 chars or non-token prefixes)
  assert.strictEqual(extractCleanTokenNumber(''), '');
  assert.strictEqual(extractCleanTokenNumber(null), '');
  assert.strictEqual(extractCleanTokenNumber('aBcDeFg123456'), '');
  assert.strictEqual(extractCleanTokenNumber('ORD1234'), '');
  assert.strictEqual(extractCleanTokenNumber('ORD123456'), '');
  assert.strictEqual(extractCleanTokenNumber('order123'), '');
  assert.strictEqual(extractCleanTokenNumber('pickup'), '');
  assert.strictEqual(extractCleanTokenNumber('7kX9mP2qR4'), '');
  assert.strictEqual(extractCleanTokenNumber('123456789'), '');
  assert.strictEqual(extractCleanTokenNumber('abc123'), '');
  assert.strictEqual(extractCleanTokenNumber('ORD999999999', { wash_fold: 'T-64' }), '64');
});

test('formatTokenForHindiSpeech: converts alphanumeric tokens to phonetic Devanagari speech', () => {
  const { formatTokenForHindiSpeech } = require('./dispatch');

  assert.strictEqual(formatTokenForHindiSpeech('B102'), 'बी 102');
  assert.strictEqual(formatTokenForHindiSpeech('B-102'), 'बी 102');
  assert.strictEqual(formatTokenForHindiSpeech('1A'), '1 ए');
  assert.strictEqual(formatTokenForHindiSpeech('1B108'), '1 बी 108');
  assert.strictEqual(formatTokenForHindiSpeech('P98'), 'पी 98');
  assert.strictEqual(formatTokenForHindiSpeech('P108'), 'पी 108');
  assert.strictEqual(formatTokenForHindiSpeech('108'), '108');
});

test('buildHindiVoicePrompt: generates exact Devanagari Hindi scripts with phonetic tokens for all alert scenarios', () => {
  const { buildHindiVoicePrompt } = require('./dispatch');

  // New order
  assert.strictEqual(buildHindiVoicePrompt({ kind: 'new_order' }), 'नया ऑर्डर आया है');

  // Helper assignments (numeric, alphanumeric, multi-token, rolled-up tokensMap, and without token)
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'tagging', tokenNumber: 'T-39' }),
    'टोकन 39 की टैगिंग करनी है'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'tagging', tokenNumber: '1A, B102' }),
    'टोकन 1 ए और बी 102 की टैगिंग करनी है'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({
      kind: 'helper_assignment',
      step: 'tagging',
      tokensMap: { wash_fold__L1: '23', wash_fold__L2: '24', wash_fold: '23, 24' },
    }),
    'टोकन 23 और 24 की टैगिंग करनी है'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'getting_washed', tokenNumber: 'B102' }),
    'टोकन बी 102 को वॉशर में डालिए'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'getting_dried', tokenNumber: '1B108' }),
    'टोकन 1 बी 108 को ड्रायर में डालिए'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'getting_ironed', tokenNumber: 'P98' }),
    'टोकन पी 98 का नया आयरनिंग का ऑर्डर आया है'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'packaging', tokenNumber: 'P108' }),
    'टोकन पी 108 की पैकेजिंग करनी है'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'unknown_step', tokenNumber: '108' }),
    'टोकन 108 का नया काम आया है'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'tagging' }),
    'टैगिंग करनी है'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'getting_washed' }),
    'कपड़े वॉशर में डालिए'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'getting_dried' }),
    'कपड़े ड्रायर में डालिए'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'getting_ironed' }),
    'नया आयरनिंग का ऑर्डर आया है'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'packaging' }),
    'पैकेजिंग करनी है'
  );

  // Machine start / unload & chemical nudges
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'nudge', step: 'getting_washed', phase: 'detergent', tokenNumber: 'B102' }),
    'टोकन बी 102 में डिटर्जेंट डालिए'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'nudge', step: 'getting_washed', phase: 'detergent' }),
    'वॉशर में डिटर्जेंट डालिए'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'nudge', step: 'getting_washed', phase: 'softener', tokenNumber: '108' }),
    'टोकन 108 में सॉफ्टनर डालिए'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'nudge', step: 'getting_washed', phase: 'softener' }),
    'वॉशर में सॉफ्टनर डालिए'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'nudge', step: 'getting_washed', phase: 'accepted', tokenNumber: '1A' }),
    'टोकन 1 ए का वॉशर चालू करिए'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'nudge', step: 'getting_washed', phase: 'started', tokenNumber: '1B108' }),
    'टोकन 1 बी 108 को वॉशर से निकालिए'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'nudge', step: 'getting_washed', phase: 'started' }),
    'वॉशर से कपड़े निकालिए'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'nudge', step: 'getting_dried', phase: 'accepted', tokenNumber: 'P98' }),
    'टोकन पी 98 का ड्रायर चालू करिए'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'nudge', step: 'getting_dried', phase: 'started', tokenNumber: 'P108' }),
    'टोकन पी 108 को ड्रायर से निकालिए'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'nudge', step: 'getting_dried', phase: 'started' }),
    'ड्रायर से कपड़े निकालिए'
  );

  // Tagging & packaging hands-on nudges
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'nudge', step: 'tagging', phase: 'hands_on', tokenNumber: '18' }),
    'टोकन 18 की टैगिंग जल्दी पूरी करिए'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'nudge', step: 'packaging', phase: 'hands_on', tokenNumber: '18' }),
    'टोकन 18 की पैकेजिंग जल्दी पूरी करिए'
  );

  // Idle machine autopilot alerts
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'idle_alert', step: 'getting_washed' }),
    'वॉशर खाली है, कपड़े डालिए'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'idle_alert', step: 'getting_dried' }),
    'ड्रायर खाली है, कपड़े डालिए'
  );

  // Rider pickup & delivery
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'pickup', isExpress: false }),
    'नया पिकअप आया है'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'pickup', isExpress: true }),
    'एक्सप्रेस पिकअप आया है'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'pickup', isExpress: false, locality: 'HSR Sector 2' }),
    'नया पिकअप आया है, HSR Sector 2'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'pickup', isExpress: false, locality: 'LOCAL' }),
    'नया पिकअप आया है'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'pickup', isExpress: true, locality: 'store' }),
    'एक्सप्रेस पिकअप आया है'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'pickup', isExpress: true, locality: 'A very long locality name exceeding twenty-five characters' }),
    'एक्सप्रेस पिकअप आया है'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'delivery', tokenNumber: '1A, B102', isExpress: false }),
    'टोकन 1 ए और बी 102 की डिलीवरी के लिए जाना है'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'delivery', isExpress: true }),
    'एक्सप्रेस डिलीवरी के लिए जाना है'
  );
  assert.strictEqual(
    buildHindiVoicePrompt({ kind: 'delivery', isExpress: false }),
    'नई डिलीवरी आई है'
  );
});


