/** Shared numeric editing rules; string operations preserve significant digits. */
export const numericPattern = (places = 2, negative = false) =>
  new RegExp(`^${negative ? '-?' : ''}\\d*${places === 0 ? '' : '(?:\\.\\d*)?'}$`);

/** Editing gate only: existing values still use the non-destructive validators below. */
export const acceptsNumericInput = (text: string, places = 2, negative = false) =>
  numericPattern(places, negative).test(text) && !/^-?00/.test(text) && (text.split('.')[1]?.length ?? 0) <= places;

export function numericError(value: unknown, places = 2, negative = false, complete = true): string {
  const text = String(value ?? '');
  if (!text) return '';
  if (!numericPattern(places, true).test(text)) return places === 0 ? '请输入整数' : '请输入数字';
  if (!negative && text.startsWith('-')) return '请输入大于或等于0的数字';
  if ((text.split('.')[1]?.length ?? 0) > places) return places === 2 ? '最多输入两位小数' : `最多输入${places}位小数`;
  if (complete && !/\d/.test(text)) return places === 0 ? '请输入整数' : '请输入数字';
  return '';
}

export function normalizeNumeric(value: unknown, places = 2, negative = false): string {
  const text = String(value ?? '');
  if (!text || numericError(text, places, negative)) return text;
  const sign = text.startsWith('-') ? '-' : '';
  const [whole = '', fraction = ''] = text.replace(/^-/, '').split('.');
  const integer = whole.replace(/^0+(?=\d)/, '') || '0';
  const zero = /^0+$/.test(integer + fraction);
  return `${zero ? '' : sign}${integer}${places ? `.${fraction.padEnd(places, '0')}` : ''}`;
}

/** Number-backed fields must reject values whose significant digits cannot survive a round trip. */
export function numericNumberError(value: unknown, places = 2, negative = false): string {
  const text = String(value ?? '');
  if (!text || numericError(text, places, negative)) return '';
  const number = Number(text);
  return !Number.isFinite(number) ||
    normalizeNumeric(String(number), places, negative) !== normalizeNumeric(text, places, negative)
    ? '数值超出可准确处理的范围'
    : '';
}
