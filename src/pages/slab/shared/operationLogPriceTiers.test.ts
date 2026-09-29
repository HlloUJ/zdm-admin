import { describe, expect, it } from 'vitest';
import { buildSlabPriceTierComparison, formatSlabPriceTierChanges } from './operationLogPriceTiers';

const levels = [{ storeLevelId: 4, name: '合伙人门店' }];

describe('slab operation log price tiers', () => {
  it('keeps the saved display name and legacy markup-rate calculation', () => {
    expect(formatSlabPriceTierChanges(null, levels)).toBeNull();
    expect(formatSlabPriceTierChanges([{ storeLevelId: 4, markupRate: 20, price: 50 }], levels)).toBe(
      '合伙人门店：价格系数 1.20，价格 50.00',
    );
  });

  it('compares before and after tiers with source and stable order', () => {
    expect(
      buildSlabPriceTierComparison(
        [{ storeLevelId: 4, priceCoefficient: 1.2, price: 50, priceSource: 'auto' }],
        [
          { storeLevelId: 4, priceCoefficient: 1.5, price: 60, priceSource: 'manual' },
          { storeLevelId: 5, priceCoefficient: 2, price: 80 },
        ],
        levels,
      ),
    ).toEqual([
      {
        key: '4',
        label: '合伙人门店',
        beforeCoefficient: '1.20',
        beforePrice: '50.00',
        afterCoefficient: '1.50',
        afterPrice: '60.00',
        beforeSource: 'auto',
        afterSource: 'manual',
      },
      {
        key: '5',
        label: '门店级别 5',
        beforeCoefficient: '未填写',
        beforePrice: '未填写',
        afterCoefficient: '2.00',
        afterPrice: '80.00',
        beforeSource: undefined,
        afterSource: undefined,
      },
    ]);
  });
});
