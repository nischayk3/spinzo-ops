import { describe, it, expect } from 'vitest';
import { customerIndex } from '../orderFeed';

describe('customerIndex', () => {
  it('carries token fields onto customer orders', () => {
    const orders = [{
      id: 'o1', status: 'ready', customerPhone: '9999999999', customerName: 'A',
      tokens: { wash_fold: '23' }, tokenNumber: '23', items: [{ serviceType: 'wash_fold' }],
      createdAt: new Date(), totalAmount: 100,
    }];
    const idx = customerIndex(orders as any);
    const c = idx.get('9999999999')!;
    expect(c.orders[0].tokens).toEqual({ wash_fold: '23' });
    expect(c.orders[0].tokenNumber).toBe('23');
  });
});