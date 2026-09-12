const process = {
  id: 'order123',
  orderId: 'order123',
  status: 'getting_ironed',
  currentIndex: 2,
  steps: ['getting_washed', 'getting_dried', 'getting_ironed', 'packaging'],
  stages: {}
};

function isEligible() {
  const cur = 'getting_ironed';
  const role = 'helper';
  if (role !== 'admin' && role !== 'iron' && role !== 'helper') return false;
  return true;
}

console.log('Eligible?', isEligible());
