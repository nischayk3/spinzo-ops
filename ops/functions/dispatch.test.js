const test = require('node:test');
const assert = require('node:assert/strict');
const { pickRider, normalizePhone, pickupGuard, taskTransition, getProcessingSteps, nextStep } = require('./dispatch');

test('normalizePhone: 10 digits -> +91', () => {
  assert.equal(normalizePhone('9108558715'), '+919108558715');
});
test('normalizePhone: 12 digits leading 91 -> +', () => {
  assert.equal(normalizePhone('919108558715'), '+919108558715');
});
test('normalizePhone: already E.164 unchanged', () => {
  assert.equal(normalizePhone('+919108558715'), '+919108558715');
});
test('normalizePhone: strips separators', () => {
  assert.equal(normalizePhone('+91 91085 58715'), '+919108558715');
});
test('normalizePhone: non-string -> empty', () => {
  assert.equal(normalizePhone(undefined), '');
});
test('normalizePhone: unresolvable format -> empty', () => {
  assert.equal(normalizePhone('911085871'), '');
  assert.equal(normalizePhone(''), '');
});

const ROSTER = {
  '+919108558715': 'supervisor',
  '+918888888888': 'rider',
  '+916666888800': 'rider',
};

test('pickRider: least-busy rider wins', () => {
  const candidates = [
    { uid: 'riderA', phone: '+918888888888', shiftStartAt: 1 },
    { uid: 'riderB', phone: '+916666888800', shiftStartAt: 1 },
  ];
  assert.equal(pickRider(candidates, { riderA: 2, riderB: 0 }, ROSTER), 'riderB');
});

test('pickRider: tie broken by earliest shiftStartAt', () => {
  const candidates = [
    { uid: 'riderA', phone: '+918888888888', shiftStartAt: 100 },
    { uid: 'riderB', phone: '+916666888800', shiftStartAt: 50 },
  ];
  assert.equal(pickRider(candidates, {}, ROSTER), 'riderB');
});

test('pickRider: candidate not a rider in roster is excluded', () => {
  const candidates = [
    { uid: 'helper', phone: '+919108558715', shiftStartAt: 1 },
    { uid: 'riderA', phone: '+918888888888', shiftStartAt: 1 },
  ];
  assert.equal(pickRider(candidates, { helper: 0, riderA: 0 }, ROSTER), 'riderA');
});

test('pickRider: phone not in roster at all -> excluded', () => {
  const candidates = [{ uid: 'ghost', phone: '+919999999999', shiftStartAt: 1 }];
  assert.equal(pickRider(candidates, {}, ROSTER), null);
});

test('pickRider: no eligible candidates -> null', () => {
  assert.equal(pickRider([], {}, ROSTER), null);
});

test('pickupGuard: ok for placed/confirmed', () => {
  assert.equal(pickupGuard('placed'), 'ok');
  assert.equal(pickupGuard('confirmed'), 'ok');
});
test('pickupGuard: alreadyDone for pickup_completed', () => {
  assert.equal(pickupGuard('pickup_completed'), 'alreadyDone');
});
test('pickupGuard: invalidState for later statuses', () => {
  for (const s of ['processing', 'ready', 'out_for_delivery', 'delivered', 'cancelled']) {
    assert.equal(pickupGuard(s), 'invalidState');
  }
});
test('pickupGuard: unknown status -> invalidState', () => {
  assert.equal(pickupGuard('something_else'), 'invalidState');
});

test('taskTransition: cancel -> task cancelled + drop queue', () => {
  assert.deepEqual(taskTransition('placed', 'cancelled'), { taskStatus: 'cancelled', dropQueue: true });
});
test('taskTransition: already cancelled -> no action', () => {
  assert.equal(taskTransition('cancelled', 'cancelled'), null);
});
test('taskTransition: pickup_completed -> task picked_up', () => {
  assert.deepEqual(taskTransition('placed', 'pickup_completed'), { taskStatus: 'picked_up' });
});
test('taskTransition: other transitions -> no action', () => {
  assert.equal(taskTransition('placed', 'processing'), null);
  assert.equal(taskTransition('ready', 'delivered'), null);
  assert.equal(taskTransition('placed', 'placed'), null);
});

test('getProcessingSteps: wash_iron -> wash + iron', () => {
  assert.deepEqual(getProcessingSteps({ items: [{ serviceType: 'wash_iron' }] }), ['getting_washed', 'getting_ironed']);
});
test('getProcessingSteps: ironing only -> just iron', () => {
  assert.deepEqual(getProcessingSteps({ items: [{ serviceType: 'ironing' }] }), ['getting_ironed']);
});
test('getProcessingSteps: wash_fold -> wash + fold', () => {
  assert.deepEqual(getProcessingSteps({ items: [{ serviceType: 'wash_fold' }] }), ['getting_washed', 'getting_folded']);
});
test('getProcessingSteps: blanket_wash -> wash + dry', () => {
  assert.deepEqual(getProcessingSteps({ items: [{ serviceType: 'blanket_wash' }] }), ['getting_washed', 'getting_dried']);
});
test('getProcessingSteps: mixed cart aggregates in wash,dry,fold,iron order', () => {
  assert.deepEqual(getProcessingSteps({ items: [{ serviceType: 'wash_fold' }, { serviceType: 'wash_iron' }, { serviceType: 'blanket_wash' }] }), ['getting_washed', 'getting_dried', 'getting_folded', 'getting_ironed']);
});
test('getProcessingSteps: empty/unknown -> fallback wash + fold', () => {
  assert.deepEqual(getProcessingSteps({}), ['getting_washed', 'getting_folded']);
  assert.deepEqual(getProcessingSteps(null), ['getting_washed', 'getting_folded']);
});
test('nextStep: advances, null when complete', () => {
  assert.equal(nextStep('getting_washed', ['getting_washed', 'getting_dried']), 'getting_dried');
  assert.equal(nextStep('getting_dried', ['getting_washed', 'getting_dried']), null);
  assert.equal(nextStep('getting_ironed', ['getting_ironed']), null);
});
