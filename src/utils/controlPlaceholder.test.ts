import { describe, expect, it } from 'vitest';
import { controlPlaceholder } from './controlPlaceholder';

describe('global control placeholders', () => {
  it('keeps the exact field title, including units and search wording', () => {
    expect(controlPlaceholder('长度（mm）')).toBe('请输入长度（mm）');
    expect(controlPlaceholder('大板')).toBe('请输入大板');
    expect(controlPlaceholder('商品名称/ID')).toBe('请输入商品名称/ID');
    expect(controlPlaceholder('产地', 'select')).toBe('请选择产地');
  });
  it('removes only label decoration and follows changed dynamic titles', () => {
    expect(controlPlaceholder('* 产地：', 'select')).toBe('请选择产地');
    expect(controlPlaceholder('＊ 长度（mm）:')).toBe('请输入长度（mm）');
    expect(controlPlaceholder('等级名称')).toBe('请输入等级名称');
    expect(controlPlaceholder('等级')).toBe('请输入等级');
  });
});
