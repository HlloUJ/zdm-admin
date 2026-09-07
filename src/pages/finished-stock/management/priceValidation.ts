// 与大板发布的价格校验一致：非负整数或最多两位小数。
export const isValidSpecPriceNumber = (value: unknown) => {
  const text = String(value ?? '').trim();
  return /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text) && Number(text) >= 0;
};
