import type { FinishedProductPrice } from '@/services/finishedProducts';
import type { SpecMode, SpecRow, StockItem } from './finishedStockPageModel';

interface PriceLevel {
  id: number;
  configurationId?: number;
  priceCoefficient?: number;
}

export const useFinishedStockSpecRows = (
  createDraftId: () => number,
  getSpecMode: () => SpecMode,
  getGuideCoefficient: () => number | null | undefined,
  getPriceLevels: () => PriceLevel[],
) => {
  const createMarkupEditors = (prices: FinishedProductPrice[] = []) => {
    const existingById = new Map(prices.map((item) => [item.storeLevelId, item]));
    return Object.fromEntries(
      getPriceLevels().map((configuration) => {
        const existing = existingById.get(configuration.id);
        const coefficient = existing ? Number(existing.priceCoefficient) : configuration.priceCoefficient;
        return [
          configuration.id,
          {
            coefficient: coefficient == null ? '' : coefficient.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''),
            price: existing ? String(existing.price) : '',
            priceSource: existing
              ? (existing.priceSource ?? 'manual')
              : configuration.configurationId
                ? ('auto' as const)
                : ('manual' as const),
            sourceConfigurationId:
              existing?.sourceConfigurationId ?? (existing ? undefined : configuration.configurationId),
          },
        ];
      }),
    );
  };
  const defaultGuideCoefficient = () =>
    getGuideCoefficient() == null ? '' : Number(getGuideCoefficient()).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  const createBaseSpecRow = (partial: Partial<SpecRow>): SpecRow => ({
    id: createDraftId(),
    mode: getSpecMode(),
    specText: '',
    specImage: false,
    material: '',
    materialImage: false,
    length: '',
    lengthImage: false,
    color: '',
    colorImage: false,
    size: '',
    sizeImage: false,
    costCoefficient: '',
    cost: '',
    guideCoefficient: defaultGuideCoefficient(),
    guide: '',
    level1Coefficient: '',
    level1: '',
    level2Coefficient: '',
    level2: '',
    level3Coefficient: '',
    level3: '',
    quantity: null,
    markupPrices: createMarkupEditors(),
    ...partial,
  });
  const createEditSpecRows = (row: StockItem): SpecRow[] => {
    if (row.variants.length) {
      return row.variants.map((variant, index) => {
        const markupPrices = row.markupPrices?.filter((price) => price.skuId === variant.id) ?? [];
        const guidePrice = row.guidePrices?.find((price) => price.skuId === variant.id);
        return createBaseSpecRow({
          id: row.id * 100 + index + 1,
          mode: variant.displayMode,
          specText: variant.displayMode === 'single' ? variant.variantLabel : '',
          ...variant.salesAttributes,
          material: variant.material || '',
          length: variant.lengthValue || '',
          color: variant.color || '',
          size: variant.sizeValue || '',
          costCoefficient: '1',
          cost: String(variant.costPrice ?? guidePrice?.costPrice ?? markupPrices[0]?.costPrice ?? ''),
          guideCoefficient: guidePrice == null ? '' : String(Number(guidePrice.priceCoefficient)),
          guide: guidePrice == null ? '' : String(guidePrice.price),
          quantity: variant.stock,
          skuId: variant.id,
          markupPrices: createMarkupEditors(markupPrices),
        });
      });
    }
    return [
      createBaseSpecRow({
        id: row.id * 10 + 1,
        mode: 'single',
        specText: row.name,
        guideCoefficient: '',
        guide: row.guidePrice == null ? '' : String(row.guidePrice),
        quantity: row.stock,
        merchantCode: row.code,
      }),
    ];
  };
  return { createMarkupEditors, createBaseSpecRow, createEditSpecRows };
};
