import type { SlabMarkupConfigurationRecord } from '@/services/slabMarkupConfigurations';
import type { SlabPublishOption } from '@/services/slabs';
import { formatPrice, formatRatio, toNumber } from './slabPageMapping';
import type { DrawerPriceRow, SlabItem } from './slabPageModel';

export const buildSlabPriceRows = (
  row: SlabItem,
  mode: 'detail' | 'edit',
  storeLevels: SlabPublishOption[],
  markupConfigurations: SlabMarkupConfigurationRecord[],
): DrawerPriceRow[] => {
  const activeConfigurationForLevel = (storeLevelId: number) =>
    markupConfigurations.find((item) => item.storeLevelId === storeLevelId && item.status === 'enabled');
  const sortRowsByStoreLevel = (rows: DrawerPriceRow[]) => {
    const orderById = new Map(storeLevels.map((level, index) => [level.id, index]));
    return [...rows].sort(
      (left, right) =>
        (orderById.get(left.configurationId ?? -1) ?? Number.MAX_SAFE_INTEGER) -
        (orderById.get(right.configurationId ?? -1) ?? Number.MAX_SAFE_INTEGER),
    );
  };
  const snapshots = (row.markupPrices ?? []).filter((price) =>
    storeLevels.some((level) => level.id === price.storeLevelId),
  );
  const cost = toNumber(row.price.cost);
  const guidePrice = row.price.guide;
  const guideRatio =
    row.guidePriceCoefficient != null
      ? formatRatio(row.guidePriceCoefficient)
      : cost > 0 && String(guidePrice).trim()
        ? formatRatio(toNumber(guidePrice) / cost)
        : '';
  const configuredRows: DrawerPriceRow[] = snapshots.map((snapshot) => ({
    configurationId: snapshot.storeLevelId,
    label:
      storeLevels.find((level) => level.id === snapshot.storeLevelId)?.label ||
      markupConfigurations.find((item) => item.storeLevelId === snapshot.storeLevelId)?.name ||
      snapshot.storeLevelName ||
      `门店级别${snapshot.storeLevelId}`,
    ratio: formatRatio(Number(snapshot.priceCoefficient)),
    price: String(snapshot.price),
    priceSource: snapshot.priceSource ?? 'manual',
    sourceConfigurationId: snapshot.sourceConfigurationId,
  }));
  const snapshotIds = new Set(snapshots.map((snapshot) => snapshot.storeLevelId));
  storeLevels.forEach((level) => {
    if (snapshotIds.has(level.id)) return;
    const configuration = activeConfigurationForLevel(level.id);
    const ratio = configuration == null ? '' : formatRatio(Number(configuration.priceCoefficient));
    configuredRows.push({
      configurationId: level.id,
      label: level.label,
      ratio,
      // Match the finished-stock editor: only saved prices populate the price field.
      price: mode === 'detail' && cost && ratio ? formatPrice(cost * toNumber(ratio)) : '',
      priceSource: configuration == null ? 'manual' : 'auto',
      sourceConfigurationId: configuration?.id,
    });
  });
  return [
    { label: '成本价', price: row.price.cost },
    {
      label: '指导价',
      ratio: guideRatio,
      price: guidePrice,
    },
    ...sortRowsByStoreLevel(configuredRows),
  ];
};

/** Price rows shown while publishing or editing; snapshots keep their recorded source. */
export function buildSlabSalesPriceRows(
  editingRowId: number | null,
  items: SlabItem[],
  storeLevels: SlabPublishOption[],
  markupConfigurations: SlabMarkupConfigurationRecord[],
) {
  const savedPrices = editingRowId == null ? [] : (items.find((item) => item.id === editingRowId)?.markupPrices ?? []);
  const rows: {
    id: number;
    label: string;
    priceCoefficient?: number;
    priceSource?: 'auto' | 'manual';
    sourceConfigurationId?: number;
  }[] = savedPrices
    .filter((price) => storeLevels.some((level) => level.id === price.storeLevelId))
    .map((price) => ({
      id: price.storeLevelId,
      label:
        storeLevels.find((level) => level.id === price.storeLevelId)?.label ||
        markupConfigurations.find((item) => item.storeLevelId === price.storeLevelId)?.name ||
        price.storeLevelName ||
        `门店级别${price.storeLevelId}`,
      priceCoefficient: Number(price.priceCoefficient),
      priceSource: price.priceSource ?? 'manual',
      sourceConfigurationId: price.sourceConfigurationId,
    }));
  const savedIds = new Set(rows.map((item) => item.id));
  storeLevels.forEach((level) => {
    if (savedIds.has(level.id)) return;
    const configuration = markupConfigurations.find(
      (item) => item.storeLevelId === level.id && item.status === 'enabled',
    );
    rows.push({
      id: level.id,
      label: level.label,
      priceCoefficient: configuration == null ? undefined : Number(configuration.priceCoefficient),
      priceSource: configuration == null ? 'manual' : 'auto',
      sourceConfigurationId: configuration?.id,
    });
  });
  const orderById = new Map(storeLevels.map((level, index) => [level.id, index]));
  return rows.sort(
    (left, right) =>
      (orderById.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (orderById.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  );
}
