import { numericError, normalizeNumeric } from '@/utils/numericInput';
/** Rules for source-product template attributes; prices and inventory keep their own validators. */
export interface TemplateAttributeField {
  key: string;
  label: string;
  required?: boolean;
  valueType?: string;
  type?: string;
  options?: string[];
}

export function formatTemplateNumber(value: unknown): string {
  return normalizeNumeric(value);
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
    const error = numericError(text);
    if (error) return error;
  }
  if ((field.valueType === 'select' || field.type === 'select') && !field.options?.includes(text)) {
    return '请选择有效选项';
  }
  return '';
}

export function templateAttributeValue(field: TemplateAttributeField, value: unknown, previous?: string) {
  if (previous !== undefined && unchangedTemplateValue(value, previous)) return previous;
  const text = String(value ?? '').trim();
  return field.valueType === 'number' && text ? formatTemplateNumber(text) : text;
}
