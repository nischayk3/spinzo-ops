import { describe, it, expect } from 'vitest';
import { calculateItemPrice, calculateDeliveryFee, SHOE_EDIT_CATEGORIES, getIroningBreakdown, IRONING_RATES } from '../editPricing';

describe('calculateItemPrice', () => {
  it('prices wash_fold by weight plus optional ironing addon', () => {
    expect(calculateItemPrice({ serviceId: 'wash_fold', weight: 7 })).toBe(7 * 85);
    expect(
      calculateItemPrice({ serviceId: 'wash_fold', weight: 7, ironingEnabled: true, ironingCount: 3 })
    ).toBe(7 * 85 + 3 * 18);
  });

  it('keeps wash_fold credit items at their stored price', () => {
    expect(
      calculateItemPrice({ serviceId: 'wash_fold', weight: 7, isCreditItem: true, totalPrice: 999 })
    ).toBe(999);
  });

  it('prices wash_iron by weight', () => {
    expect(calculateItemPrice({ serviceId: 'wash_iron', weight: 6 })).toBe(6 * 140);
  });

  it('prices standalone ironing at ₹10/pc for flat/unspecified tiers', () => {
    expect(calculateItemPrice({ serviceId: 'ironing', ironingCount: 5 })).toBe(50);
  });

  it('prices standalone ironing with tiers (Light ₹10, Medium ₹30, Heavy ₹50)', () => {
    // 10 total: 2 heavy (₹100), 3 medium (₹90), remaining 5 light (₹50) = ₹240
    expect(
      calculateItemPrice({
        serviceId: 'ironing',
        ironingCount: 10,
        mediumCount: 3,
        heavyCount: 2,
      })
    ).toBe(240);
  });

  it('prices ironing addon at ₹18/pc', () => {
    expect(calculateItemPrice({ serviceId: 'ironing_addon', clothesCount: 5 })).toBe(5 * 18);
  });

  it('prices blanket_wash by single/double counts', () => {
    expect(
      calculateItemPrice({ serviceId: 'blanket_wash', singleBlanketCount: 2, doubleBlanketCount: 1 })
    ).toBe(2 * 299 + 1 * 399);
  });

  it('prices premium_laundry at ₹200/kg', () => {
    expect(calculateItemPrice({ serviceId: 'premium_laundry', weight: 8 })).toBe(8 * 200);
    expect(calculateItemPrice({ serviceId: 'premium_laundry', weight: undefined })).toBe(5 * 200);
  });

  it('prices shoe_clean from shoeItems plus ₹50 delivery', () => {
    const item = {
      serviceId: 'shoe_clean',
      shoeItems: [
        { type: 'canvas_sports', name: 'Canvas & Sports Shoes', quantity: 2, price: 300 },
        { type: 'crocs_sandals', name: 'Crocs & Sandals', quantity: 1, price: 150 },
      ],
    };
    // subtotal = 2*300 + 1*150 = 750, +50 delivery
    expect(calculateItemPrice(item)).toBe(800);
  });

  it('returns 0 for shoe_clean with no items', () => {
    expect(calculateItemPrice({ serviceId: 'shoe_clean', shoeItems: [] })).toBe(0);
  });

  it('falls back to stored totalPrice for unknown services', () => {
    expect(calculateItemPrice({ serviceId: 'dry_clean', totalPrice: 420 })).toBe(420);
  });
});

describe('calculateDeliveryFee', () => {
  it('is free for wash_fold / wash_iron / premium_laundry', () => {
    expect(calculateDeliveryFee([{ serviceId: 'wash_fold', weight: 5 }])).toBe(0);
    expect(calculateDeliveryFee([{ serviceId: 'wash_iron', weight: 5 }])).toBe(0);
    expect(calculateDeliveryFee([{ serviceId: 'premium_laundry', weight: 5 }])).toBe(0);
  });

  it('charges ₹80 for <20 standalone ironing pieces and ₹50 for >=20', () => {
    expect(calculateDeliveryFee([{ serviceId: 'ironing', ironingCount: 5 }])).toBe(80);
    expect(calculateDeliveryFee([{ serviceId: 'ironing', ironingCount: 20 }])).toBe(50);
  });

  it('does not treat ironing_addon as a standalone ironing fee trigger', () => {
    expect(calculateDeliveryFee([{ serviceId: 'ironing_addon', clothesCount: 5 }])).toBe(0);
  });

  it('charges ₹50 for standalone blanket_wash', () => {
    expect(calculateDeliveryFee([{ serviceId: 'blanket_wash', singleBlanketCount: 1 }])).toBe(50);
  });

  it('returns 0 for empty items', () => {
    expect(calculateDeliveryFee([])).toBe(0);
  });
});

describe('SHOE_EDIT_CATEGORIES', () => {
  it('covers the three footwear categories', () => {
    expect(SHOE_EDIT_CATEGORIES.map((c) => c.id)).toEqual([
      'canvas_sports',
      'crocs_sandals',
      'slippers',
    ]);
  });
});

describe('getIroningBreakdown', () => {
  it('defines the correct standard tier rates', () => {
    expect(IRONING_RATES).toEqual({
      light: 10,
      medium: 30,
      heavy: 50,
    });
  });

  it('defaults to all light when no medium or heavy is provided', () => {
    const res = getIroningBreakdown({ ironingCount: 7 });
    expect(res).toEqual({
      total: 7,
      light: 7,
      medium: 0,
      heavy: 0,
      amount: 70,
    });
  });

  it('correctly calculates mixed tiers', () => {
    const res = getIroningBreakdown({
      ironingCount: 12,
      mediumCount: 4,
      heavyCount: 2,
    });
    // light = 12 - 4 - 2 = 6
    // amount = 6*10 + 4*30 + 2*50 = 60 + 120 + 100 = 280
    expect(res).toEqual({
      total: 12,
      light: 6,
      medium: 4,
      heavy: 2,
      amount: 280,
    });
  });

  it('clamps medium and heavy if they exceed total', () => {
    const res = getIroningBreakdown({
      ironingCount: 5,
      mediumCount: 4,
      heavyCount: 3,
    });
    // total = 5, medium clamped to 4, heavy clamped to min(3, 5-4) = 1, light = 0
    // amount = 0*10 + 4*30 + 1*50 = 170
    expect(res).toEqual({
      total: 5,
      light: 0,
      medium: 4,
      heavy: 1,
      amount: 170,
    });
  });
});