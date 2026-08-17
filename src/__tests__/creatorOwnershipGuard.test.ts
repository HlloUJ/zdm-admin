import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminFeedback } from '@/components/foundation';
import { CREATOR_OWNERSHIP_MESSAGE, requireCreatorOwnership } from '@/composables/useCreatorOwnershipGuard';
import { setLoginUser } from '@/services/auth';

describe('requireCreatorOwnership', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setLoginUser({
      id: 3,
      name: '张飞',
      phone: '15900000001',
      roles: ['ADMIN'],
      permissions: ['all'],
      dataPermission: 'self',
    });
    vi.restoreAllMocks();
  });

  it('以稳定账号 ID 判断归属，不受创建人显示名变更影响', () => {
    expect(requireCreatorOwnership({ createdByAccountId: 3, createdByName: '旧名称' })).toBe(true);
  });

  it('点击他人数据时立即显示统一提示', () => {
    const warning = vi.spyOn(adminFeedback, 'warning').mockImplementation(() => Promise.resolve(undefined as never));

    expect(requireCreatorOwnership({ createdByAccountId: 4, createdByName: '貂蝉' })).toBe(false);
    expect(warning).toHaveBeenCalledWith(CREATOR_OWNERSHIP_MESSAGE);
  });

  it('历史数据缺少账号 ID 时按创建人姓名兼容', () => {
    expect(requireCreatorOwnership({ createdByName: '张飞' })).toBe(true);
  });
});
