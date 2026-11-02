import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { useFinishedStockPriceEditor } from './finishedStockPriceEditor';
import { useFinishedStockSpecRows } from './finishedStockSpecRows';
import { buildFinishedOperationsPricePayload } from './finishedStockPayload';
import type { BatchFillForm, StockItem } from './finishedStockPageModel';

describe('one guide source per SKU without store-level dimensions', () => {
  const rows = (coefficient?: number) =>
    useFinishedStockSpecRows(
      () => 1,
      () => 'single',
      () => coefficient,
      () => [],
    );
  it('defaults new rows by configuration and keeps stored manual and legacy modes', () => {
    expect(rows(2).createBaseSpecRow({}).guidePriceSource).toBe('auto');
    expect(rows().createBaseSpecRow({}).guidePriceSource).toBe('manual');
    const product = {
      id: 1,
      variants: [{ id: 10, displayMode: 'single', stock: 1, costPrice: 10 }],
      guidePrices: [{ skuId: 10, priceCoefficient: 3, price: 30 }],
    } as unknown as StockItem;
    const legacy = rows(2).createEditSpecRows(product)[0]!;
    expect(legacy).toMatchObject({ guidePriceSource: 'manual', guideCoefficient: '3', guide: '30' });
    const payload = buildFinishedOperationsPricePayload({
      name: '商品',
      status: 'warehouse',
      specRows: [legacy],
      priceLevels: [],
      variantLabel: () => '规格',
    });
    expect(payload.guidePrices).toEqual([
      { skuId: 10, variantLabel: '规格', costPrice: 10, priceCoefficient: 3, price: 30, priceSource: 'manual' },
    ]);
    expect(payload.markupPrices).toEqual([]);
  });
  it('switching to manual retains amounts and switching back uses current configuration for this SKU only', () => {
    const editor = useFinishedStockPriceEditor(
      () => [],
      {} as BatchFillForm,
      ref({}),
      () => 4,
    );
    const first = rows(2).createBaseSpecRow({ cost: '10', guideCoefficient: '2', guide: '20' });
    const second = rows(2).createBaseSpecRow({
      cost: '20',
      guideCoefficient: '3',
      guide: '60',
      guidePriceSource: 'manual',
    });
    editor.toggleGuidePriceSource(first);
    expect(first).toMatchObject({ guidePriceSource: 'manual', guideCoefficient: '2', guide: '20' });
    editor.toggleGuidePriceSource(first);
    expect(first).toMatchObject({ guidePriceSource: 'auto', guideCoefficient: '4', guide: '40.00' });
    expect(second).toMatchObject({ guidePriceSource: 'manual', guideCoefficient: '3', guide: '60' });
    editor.markGuidePriceManual(first);
    expect(first.guidePriceSource).toBe('manual');
  });
  it('does not manufacture a follow coefficient without configuration', () => {
    const editor = useFinishedStockPriceEditor(() => [], {} as BatchFillForm, ref({}));
    const row = rows().createBaseSpecRow({ cost: '10', guideCoefficient: '3', guide: '30' });
    editor.toggleGuidePriceSource(row);
    expect(row).toMatchObject({ guidePriceSource: 'manual', guideCoefficient: '3', guide: '30' });
  });
});
