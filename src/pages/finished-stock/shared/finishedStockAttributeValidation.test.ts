import { describe, expect, it } from 'vitest';
import {
  formatTemplateNumber,
  templateAttributeError,
  templateAttributeValue,
} from './finishedStockAttributeValidation';
const number = { key: 'attribute_2', label: '数字属性', required: true, valueType: 'number' };
describe('template attribute type and precision rules', () => {
  it.each(['0', '-12.5', '+12', '.5', '12.', '1e2', '1e-2', '9007199254740993.12'])(
    'accepts existing numeric syntax without price/inventory constraints: %s',
    (value) => {
      expect(templateAttributeError(number, value)).toBe('');
    },
  );
  it.each(['文字', 'NaN', 'Infinity', '0x10', '--1', '1e9999999999'])('rejects invalid decimal values: %s', (value) => {
    expect(templateAttributeError(number, value)).toBe('请输入数字');
  });
  it.each(['1.234', '-0.001', '1e-3', '1.2300'])('rejects excessive precision without rounding: %s', (value) => {
    expect(templateAttributeError(number, value)).toBe('最多输入两位小数');
    expect(formatTemplateNumber(value)).toBe(value);
  });
  it('formats legal values exactly without floating point loss', () => {
    expect(formatTemplateNumber('12')).toBe('12.00');
    expect(formatTemplateNumber('12.5')).toBe('12.50');
    expect(formatTemplateNumber('9007199254740993.1')).toBe('9007199254740993.10');
    expect(formatTemplateNumber('-1e-2')).toBe('-0.01');
    expect(formatTemplateNumber('1e10001')).toBe('1.00e10001');
  });
  it('keeps required, optional batch and bound selection semantics separate', () => {
    expect(templateAttributeError(number, '')).toBe('请输入数字属性');
    expect(templateAttributeError(number, '', { optional: true })).toBe('');
    expect(
      templateAttributeError({ ...number, valueType: 'select', type: 'select', options: ['旧选项'] }, '新选项'),
    ).toBe('请选择有效选项');
  });
  it('only exempts unchanged historical values and preserves their raw representation', () => {
    expect(templateAttributeError(number, ' 旧文字 ', { legacyUnchanged: true })).toBe('');
    expect(templateAttributeValue(number, ' 旧文字 ', ' 旧文字 ')).toBe(' 旧文字 ');
    expect(templateAttributeValue(number, '1.234', '1.234')).toBe('1.234');
    expect(templateAttributeError(number, '1.234')).toContain('两位');
    expect(templateAttributeValue(number, '1', '1')).toBe('1');
    expect(templateAttributeValue(number, '1.00', '1')).toBe('1.00');
  });
});
