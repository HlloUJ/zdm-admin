import type { PrimaryTableCol } from 'tdesign-vue-next';
import type { CenterDetail } from '@/services/storeSelectionCenter';
import { orderLayeredRows } from '@/pages/finished-stock/management/layeredSpecs';
export function selectionSalesModel(info: CenterDetail['information']) {
  const dimensions = info.specDimensions ?? [];
  const layered = info.skus.length > 0 && info.skus.every((s) => s.displayMode === 'layered') ? dimensions : [];
  const extra = [...new Set(info.skus.flatMap((s) => Object.keys(s.salesAttributes ?? {})))].filter(
    (k) => !dimensions.some((d) => d.key === k),
  );
  const order = info.attributeDisplayOrder?.sales ?? [];
  extra.sort(
    (a, b) =>
      (order.indexOf(a) < 0 ? Infinity : order.indexOf(a)) - (order.indexOf(b) < 0 ? Infinity : order.indexOf(b)),
  );
  const columns: PrimaryTableCol[] = [
    ...(!layered.length
      ? [
          { colKey: 'label', title: '商品规格' },
          { colKey: 'price', title: '价格' },
        ]
      : []),
    ...dimensions.map((d) => ({ colKey: d.key, title: info.attributeNames[d.key] || d.name })),
    ...(layered.length ? [{ colKey: 'price', title: '价格' }] : []),
    ...extra.map((key) => ({ colKey: key, title: info.attributeNames[key] || key })),
    { colKey: 'stock', title: '可供库存' },
  ];
  const rows = orderLayeredRows(
    info.skus.map((sku) => ({
      material: sku.material,
      length: sku.lengthValue,
      color: sku.color,
      size: sku.sizeValue,
      ...(sku.salesAttributes ?? {}),
      skuId: sku.skuId,
      label: sku.label,
      stock: sku.stock,
      price: sku.partnerPrice == null ? '—' : `¥ ${Number(sku.partnerPrice).toLocaleString('zh-CN')}`,
    })),
    layered,
  );
  return {
    columns: columns.map((column) => ({
      ...column,
      thClassName: 'selection-sales-heading',
      className: 'selection-sales-cell',
    })),
    rows,
  };
}
export function selectionAttributes(info: CenterDetail['information']) {
  const order = info.attributeDisplayOrder?.product ?? [];
  return [...info.attributes].sort((a, b) => {
    const position = (id: number) => {
      const index = order.findIndex((key) => key === String(id) || key === `attribute_${id}`);
      return index < 0 ? Infinity : index;
    };
    return position(a.attributeId) - position(b.attributeId);
  });
}
