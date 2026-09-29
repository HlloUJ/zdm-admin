export interface PriceLevelName {
  storeLevelId: number;
  name: string;
}

export interface OperationLogPriceTierRow {
  key: string;
  label: string;
  beforeCoefficient: string;
  beforePrice: string;
  afterCoefficient: string;
  afterPrice: string;
  beforeSource?: 'auto' | 'manual';
  afterSource?: 'auto' | 'manual';
}

export const formatSlabPriceTierChanges = (value: unknown, configurations: PriceLevelName[]): string | null => {
  if (!Array.isArray(value)) return null;
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return String(item ?? '-');
      const price = item as {
        configurationId?: number;
        storeLevelId?: number;
        storeLevelName?: string;
        priceCoefficient?: number;
        markupRate?: number;
        price?: number;
      };
      const levelId = price.storeLevelId ?? price.configurationId;
      const label =
        price.storeLevelName ||
        configurations.find((configuration) => configuration.storeLevelId === levelId)?.name ||
        `门店级别 ${levelId ?? '-'}`;
      const coefficient =
        price.priceCoefficient == null
          ? price.markupRate == null
            ? '-'
            : (1 + Number(price.markupRate) / 100).toFixed(2)
          : Number(price.priceCoefficient).toFixed(2);
      const formattedPrice = price.price == null ? '-' : Number(price.price).toFixed(2);
      return `${label}：价格系数 ${coefficient}，价格 ${formattedPrice}`;
    })
    .join('；');
};

const normalizePriceTierChanges = (value: unknown, configurations: PriceLevelName[]) => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const price = item as {
      configurationId?: number;
      storeLevelId?: number;
      storeLevelName?: string;
      priceCoefficient?: number;
      markupRate?: number;
      price?: number;
      priceSource?: 'auto' | 'manual';
    };
    const levelId = price.storeLevelId ?? price.configurationId;
    const key = String(levelId ?? 'unknown');
    return [
      {
        key,
        source: price.priceSource,
        label:
          price.storeLevelName ||
          configurations.find((configuration) => configuration.storeLevelId === levelId)?.name ||
          `门店级别 ${levelId ?? '-'}`,
        coefficient:
          price.priceCoefficient == null
            ? price.markupRate == null
              ? '未填写'
              : (1 + Number(price.markupRate) / 100).toFixed(2)
            : Number(price.priceCoefficient).toFixed(2),
        price: price.price == null ? '未填写' : Number(price.price).toFixed(2),
      },
    ];
  });
};
export const buildSlabPriceTierComparison = (
  before: unknown,
  after: unknown,
  configurations: PriceLevelName[],
): OperationLogPriceTierRow[] => {
  const beforeTiers = normalizePriceTierChanges(before, configurations);
  const afterTiers = normalizePriceTierChanges(after, configurations);
  const keys = [...new Set([...beforeTiers.map((item) => item.key), ...afterTiers.map((item) => item.key)])];
  return keys.map((key) => {
    const beforeTier = beforeTiers.find((item) => item.key === key);
    const afterTier = afterTiers.find((item) => item.key === key);
    return {
      key,
      label: afterTier?.label || beforeTier?.label || `价格层级 ${key}`,
      beforeCoefficient: beforeTier?.coefficient || '未填写',
      beforePrice: beforeTier?.price || '未填写',
      afterCoefficient: afterTier?.coefficient || '未填写',
      afterPrice: afterTier?.price || '未填写',
      beforeSource: beforeTier?.source,
      afterSource: afterTier?.source,
    };
  });
};
