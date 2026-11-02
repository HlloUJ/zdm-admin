import { describe, expect, it } from 'vitest';
import { normalizeNumeric, numericError, numericPattern, acceptsNumericInput } from './numericInput';
describe('数值输入唯一规则', () => {
  it.each(['12a3', '+1', '1e2', '1,000', '1 2', '-1', '1..2'])('默认拒绝非法输入 %s', (value) => {
    expect(numericPattern().test(value)).toBe(false);
  });
  it.each(['0', '00', '0012', '12.', '.5', '12.345'])('保留合法输入过程 %s', (value) => {
    expect(numericPattern().test(value)).toBe(true);
  });
  it('整数没有小数点，小数超限保留原文，零值不被清空', () => {
    expect(numericPattern(0).test('12.00')).toBe(false);
    expect(normalizeNumeric('0012', 0)).toBe('12');
    expect(normalizeNumeric('000')).toBe('0.00');
    expect(normalizeNumeric('.5')).toBe('0.50');
    expect(normalizeNumeric('12.345')).toBe('12.345');
    expect(numericError('12.345')).toBe('最多输入两位小数');
    expect(numericError('.', 2, false, false)).toBe('');
    expect(numericError('.')).toBe('请输入数字');
    expect(normalizeNumeric('')).toBe('');
  });
  it('负数只能通过显式配置开启，规范化不丢精度', () => {
    expect(numericPattern(2, true).test('-.5')).toBe(true);
    expect(normalizeNumeric('-000.5', 2, true)).toBe('-0.50');
    expect(normalizeNumeric('-0.00', 2, true)).toBe('0.00');
    expect(normalizeNumeric('9007199254740993.1')).toBe('9007199254740993.10');
  });
});

describe('输入阶段阻止超精度和连续前导零', () => {
  it.each(['00', '000', '0012', '00.5', '12.345'])('拒绝整次编辑 %s', (value) => {
    expect(acceptsNumericInput(value)).toBe(false);
  });
  it.each(['', '0', '0.', '0.00', '.5', '12.', '12.34', '10', '100', '01'])('保留合法编辑 %s', (value) => {
    expect(acceptsNumericInput(value)).toBe(true);
  });
  it('整数、负值例外和特殊精度分别判断，不改历史校验', () => {
    expect(acceptsNumericInput('0', 0)).toBe(true);
    expect(acceptsNumericInput('0.', 0)).toBe(false);
    expect(acceptsNumericInput('-0', 2, true)).toBe(true);
    expect(acceptsNumericInput('-00', 2, true)).toBe(false);
    expect(acceptsNumericInput('-0.50', 2, true)).toBe(true);
    expect(acceptsNumericInput('-0.50')).toBe(false);
    expect(acceptsNumericInput('1.234', 3)).toBe(true);
    expect(acceptsNumericInput('1.2345', 3)).toBe(false);
    expect(numericError('12.345')).toBe('最多输入两位小数');
  });
});
