// Historical lifecycle logs contain database-shaped price rows. Keep their saved values.
export function priceLogSnapshot(value: unknown): Record<string, unknown> {
  const rows = (Array.isArray(value) ? value : [])
    .filter((row) => row && typeof row === 'object')
    .map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, val]) => [
          key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
          val,
        ]),
      ),
    );
  return {
    销售规格: [
      ...new Map(
        rows.map((row) => [
          row.skuId ?? row.variantKey,
          { skuId: row.skuId, variantKey: row.variantKey, variantLabel: row.variantLabel },
        ]),
      ).values(),
    ],
    指导价: rows.filter((row) => row.storeLevelId == null),
    层级价格: rows.filter((row) => row.storeLevelId != null),
  };
}
