import { describe, expect, it } from 'vitest';
import { matchSpecText, matchSpecAttributeSubset, specIdentity } from './specModeConversion';
describe('spec mode conversion', () => {
  const groups = [
    { field: 'color', values: ['中花白', '云母绿'] },
    { field: 'length', values: ['1400mm', '1600mm'] },
  ];
  it('fills only an exact complete combination of known values', () => {
    expect(matchSpecText('中花白 1400mm', groups)).toEqual({ color: '中花白', length: '1400mm' });
    expect(matchSpecText('云母绿 / 1600mm', groups)).toEqual({ color: '云母绿', length: '1600mm' });
  });
  it('does not discard unknown suffixes or guess unknown values', () => {
    expect(matchSpecText('中花白 1400mm 定制', groups)).toBeUndefined();
    expect(matchSpecText('其他颜色 1400mm', groups)).toBeUndefined();
  });
  it('rejects ambiguous divisions rather than assigning prices to a guessed row', () => {
    expect(
      matchSpecText('ABC', [
        { field: 'one', values: ['A', 'AB'] },
        { field: 'two', values: ['BC', 'C'] },
      ]),
    ).toBeUndefined();
  });
  it('matches combinations independent of display order and merchant code', () => {
    expect(specIdentity({ color: '白', length: '1400mm', merchantCode: 'old' }, ['color', 'length'])).toBe(
      specIdentity({ color: '白', length: '1400mm', merchantCode: 'new' }, ['length', 'color']),
    );
  });
  it('does not promote a populated ordinary sales attribute into a fourth dimension', () => {
    expect(
      matchSpecAttributeSubset('选项1 销售属性1 销售属性2', {
        shared1: '选项1',
        shared2: '销售属性1',
        shared3: '销售属性2',
        private1: '选项1',
      }),
    ).toEqual({ shared1: '选项1', shared2: '销售属性1', shared3: '销售属性2' });
  });
  it('rejects ambiguous attribute ownership and incomplete labels', () => {
    expect(matchSpecAttributeSubset('白色', { shared: '白色', private: '白色' })).toBeUndefined();
    expect(matchSpecAttributeSubset('白色 定制', { color: '白色' })).toBeUndefined();
  });
});
