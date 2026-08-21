import { describe, expect, it } from 'vitest';

import { chinaRegionKeys, chinaRegionOptions, getChinaRegionLabel, normalizeChinaRegionCode } from './chinaRegions';

describe('chinaRegions', () => {
  it('provides nationwide province, city, and district cascader data', () => {
    expect(chinaRegionOptions).toHaveLength(34);
    expect(chinaRegionOptions.every((province) => province.children?.length)).toBe(true);
    expect(chinaRegionOptions.every((province) => province.children?.every((city) => city.children?.length))).toBe(
      true,
    );
    expect(chinaRegionKeys).toEqual({ label: 'text', value: 'value', children: 'children' });
  });

  it('resolves a selected district code to the complete three-level address', () => {
    expect(getChinaRegionLabel('440106')).toBe('广东省广州市天河区');
    expect(getChinaRegionLabel('110101')).toBe('北京市北京市东城区');
    expect(getChinaRegionLabel('810101')).toBe('香港特别行政区香港岛中西区');
  });

  it('keeps existing store records editable by normalizing legacy region values', () => {
    expect(normalizeChinaRegionCode('tianhe')).toBe('440106');
    expect(normalizeChinaRegionCode('440106')).toBe('440106');
  });
});
