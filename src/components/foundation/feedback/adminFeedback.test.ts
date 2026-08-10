import { beforeEach, describe, expect, it, vi } from 'vitest';

const messageMocks = vi.hoisted(() => ({
  success: vi.fn(() => Promise.resolve({ close: vi.fn() })),
  error: vi.fn(() => Promise.resolve({ close: vi.fn() })),
  warning: vi.fn(() => Promise.resolve({ close: vi.fn() })),
  info: vi.fn(() => Promise.resolve({ close: vi.fn() })),
}));

vi.mock('tdesign-vue-next', () => ({ MessagePlugin: messageMocks }));

describe('adminFeedback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    Object.values(messageMocks).forEach((mock) => mock.mockClear());
  });

  it('统一成功提示的位置、时长和样式类', async () => {
    const { adminFeedback } = await import('./adminFeedback');

    adminFeedback.success('已保存“一级分类3”');

    expect(messageMocks.success).toHaveBeenCalledWith(
      expect.objectContaining({
        className: 'zdm-admin-feedback',
        content: '已保存“一级分类3”',
        duration: 2500,
        offset: [0, -8],
        placement: 'top',
      }),
    );
  });

  it('短时间内不重复展示相同提示', async () => {
    const { adminFeedback } = await import('./adminFeedback');

    adminFeedback.warning('排序已更新');
    adminFeedback.warning('排序已更新');

    expect(messageMocks.warning).toHaveBeenCalledTimes(1);
  });

  it('按动作和对象生成明确的成功文案', async () => {
    const { buildActionSuccessText } = await import('./adminFeedback');

    expect(buildActionSuccessText('停用', '一级分类3')).toBe('已停用“一级分类3”');
    expect(buildActionSuccessText('保存')).toBe('保存已完成');
  });

  it('不向页面暴露数据库内部错误', async () => {
    const { getSafeErrorMessage } = await import('./adminFeedback');

    expect(getSafeErrorMessage(new Error('SQL constraint exception'))).toBe('请稍后重试');
    expect(getSafeErrorMessage(new Error('分类名称已存在'))).toBe('分类名称已存在');
  });
});
