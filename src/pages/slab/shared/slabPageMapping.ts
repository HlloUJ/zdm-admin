import type { SlabPayload, SlabPrice } from '@/services/slabs';
import type { ProductForm, SlabItem } from './slabPageModel';

export const toNumber = (value: string) => {
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
};
export const formatPrice = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2));
export const formatRatio = (value: number) => value.toFixed(2);

export const toSlabPayload = (item: SlabItem, patch: Partial<SlabItem> = {}): SlabPayload => {
  const next = { ...item, ...patch };
  return {
    stock: next.stock,
    supplierId: next.supplierId,
    varietyId: next.varietyId,
    originId: next.originId,
    textureId: next.textureId,
    colorId: next.colorId,
    gradeId: next.gradeId,
    name: next.name,
    serialNo: next.code,
    warehouse: next.store === '-' ? undefined : next.store,
    publisherType: next.publisherType,
    mainImageMediaId: next.mainImageMediaId,
    scanImageMediaId: next.scanImageMediaId,
    designImageMediaId: next.designImageMediaId,
    videoMediaId: next.videoMediaId,
    videoCoverMediaId: next.videoCoverMediaId,
    lengthMm: next.lengthMm,
    widthMm: next.widthMm,
    thicknessMm: next.thicknessMm,
    toleranceMm: next.toleranceMm,
    corner1LengthMm: next.corner1LengthMm,
    corner1WidthMm: next.corner1WidthMm,
    corner2LengthMm: next.corner2LengthMm,
    corner2WidthMm: next.corner2WidthMm,
    corner3LengthMm: next.corner3LengthMm,
    corner3WidthMm: next.corner3WidthMm,
    corner4LengthMm: next.corner4LengthMm,
    corner4WidthMm: next.corner4WidthMm,
    areaSquareMeter: next.areaSquareMeter,
    costPrice: toNumber(next.price.cost),
    guidePrice: toNumber(next.price.guide),
    guidePriceCoefficient: next.guidePriceCoefficient,
    markupPrices: next.markupPrices,
    status: next.status,
  };
};

export const fillSlabProductForm = (
  row: SlabItem,
  form: ProductForm,
  initializePrices: (prices?: SlabPrice[]) => void,
) => {
  Object.assign(form, {
    variety: row.variety,
    origin: row.origin,
    textureId: row.textureId,
    colorId: row.colorId,
    gradeId: row.gradeId,
    length: row.lengthMm == null ? '' : String(row.lengthMm),
    width: row.widthMm == null ? '' : String(row.widthMm),
    height: row.thicknessMm == null ? '' : String(row.thicknessMm),
    tolerance: row.toleranceMm == null ? '' : String(row.toleranceMm),
    corner1Length: row.corner1LengthMm == null ? '' : String(row.corner1LengthMm),
    corner1Width: row.corner1WidthMm == null ? '' : String(row.corner1WidthMm),
    corner2Length: row.corner2LengthMm == null ? '' : String(row.corner2LengthMm),
    corner2Width: row.corner2WidthMm == null ? '' : String(row.corner2WidthMm),
    corner3Length: row.corner3LengthMm == null ? '' : String(row.corner3LengthMm),
    corner3Width: row.corner3WidthMm == null ? '' : String(row.corner3WidthMm),
    corner4Length: row.corner4LengthMm == null ? '' : String(row.corner4LengthMm),
    corner4Width: row.corner4WidthMm == null ? '' : String(row.corner4WidthMm),
    supplier: row.supplierId ? row.tenant : '',
    cost: row.price.cost,
    stock: row.stock == null ? '' : String(row.stock),
    sku: row.sku,
    guideRatio:
      row.guidePriceCoefficient != null
        ? formatRatio(row.guidePriceCoefficient)
        : row.price.cost && row.price.guide
          ? formatRatio(toNumber(row.price.guide) / toNumber(row.price.cost))
          : '',
    guidePrice: row.price.guide,
    level1Ratio: '1.45',
    level1Price: row.price.level1,
    level2Ratio: '1.30',
    level2Price: row.price.level2,
    level3Ratio: '1.18',
    level3Price: row.price.level3,
  });
  initializePrices(row.markupPrices);
};
