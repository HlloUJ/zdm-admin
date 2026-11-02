/** Rules for source-product template attributes; prices and inventory keep their own validators. */
export interface TemplateAttributeField {
  key: string;
  label: string;
  required?: boolean;
  valueType?: string;
  type?: string;
  options?: string[];
}

function decimalParts(value: unknown) {
  const text = String(value ?? '').trim();
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) return null;
  const fraction = match[3] ?? match[4] ?? '';
  const exponent = Number(match[5] ?? 0);
  const scale = fraction.length - exponent;
  // BigDecimal uses signed 32-bit exponent and scale; never convert the significant digits to Number.
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 2147483647 || scale < -2147483648 || scale > 2147483647)
    return null;
  return { text, sign: match[1]!, integer: match[2] ?? '0', fraction, exponent, scale };
}

export function formatTemplateNumber(value: unknown): string {
  const parts = decimalParts(value);
  if (!parts || parts.scale > 2) return String(value ?? '');
  const digits = parts.integer + parts.fraction;
  const point = parts.integer.length + parts.exponent;
  // Preserve very large scientific values without allocating a gigantic expanded string.
  if (Math.abs(point) + digits.length > 10000)
    return `${parts.sign}${digits}.00e${parts.exponent - parts.fraction.length}`;
  const integer = point <= 0 ? '0' : digits.slice(0, point).padEnd(point, '0');
  const fraction = point <= 0 ? '0'.repeat(-point) + digits : digits.slice(point);
  return `${parts.sign}${integer}.${fraction.padEnd(2, '0')}`;
}

export function unchangedTemplateValue(value: unknown, previous: unknown) {
  const current = String(value ?? '');
  const old = String(previous ?? '');
  return current === old;
}

export function templateAttributeError(
  field: TemplateAttributeField,
  value: unknown,
  { legacyUnchanged = false, optional = false }: { legacyUnchanged?: boolean; optional?: boolean } = {},
): string {
  if (legacyUnchanged) return '';
  const text = String(value ?? '');
  if (!text.trim())
    return !optional && field.required ? `${field.type === 'select' ? '请选择' : '请输入'}${field.label}` : '';
  if (field.valueType === 'number') {
    const parts = decimalParts(text);
    if (!parts) return `${field.label}请输入数字`;
    if (parts.scale > 2) return `${field.label}最多输入两位小数`;
  }
  if ((field.valueType === 'select' || field.type === 'select') && !field.options?.includes(text)) {
    return `${field.label}请选择绑定版本中的有效选项`;
  }
  return '';
}

export function templateAttributeValue(field: TemplateAttributeField, value: unknown, previous?: string) {
  if (previous !== undefined && unchangedTemplateValue(value, previous)) return previous;
  const text = String(value ?? '').trim();
  return field.valueType === 'number' && text ? formatTemplateNumber(text) : text;
}
