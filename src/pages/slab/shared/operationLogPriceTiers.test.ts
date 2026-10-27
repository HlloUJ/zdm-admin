import { ref } from 'vue';
import { useSlabOperationLogPresentation } from './slabOperationLogPresentation';
import type { SlabOperationLogRecord } from '@/services/slabs';
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

it('shows missing prices with the saved reason and name without adding current levels', () => {
  const rows = buildSlabPriceTierComparison(
    null,
    [{ storeLevelId: 25, storeLevelName: '华东中心店', missingReason: '价格配置已停用，未生成价格' }],
    [{ storeLevelId: 99, name: '后来新增的级别' }],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    label: '华东中心店',
    afterCoefficient: '未填写',
    afterPrice: '价格配置已停用，未生成价格',
    afterMissingReason: '价格配置已停用，未生成价格',
  });
});

it('keeps reentry on the full snapshot path with its recorded reason', () => {
  const detail = ref({
    operationType: 'REENTRY',
    beforeStatus: null,
    changeDetails: JSON.stringify({
      价格层级: { after: [{ storeLevelId: 25, storeLevelName: '华东中心店', price: 20 }], complete: true },
      重新入仓原因: { after: '运营删除失效记录后重新入仓' },
    }),
  } as unknown as SlabOperationLogRecord);
  const view = useSlabOperationLogPresentation(
    detail,
    () => [],
    () => ({}),
  );
  expect(view.operationLogIsCreate.value).toBe(true);
  expect(view.operationLogChangeRows.value.find((row) => row.field === '重新入仓原因')?.after).toBe(
    '运营删除失效记录后重新入仓',
  );
  expect(view.operationLogChangeRows.value.find((row) => row.field === '价格层级')?.priceTiers?.[0].afterPrice).toBe(
    '20.00',
  );
});
