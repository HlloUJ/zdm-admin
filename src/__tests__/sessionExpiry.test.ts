import { expect, it, vi } from 'vitest';
import router from '@/router';
import { adminFeedback } from '@/components/foundation/feedback/adminFeedback';
import { SESSION_EXPIRED_MESSAGE } from '@/services/http';

vi.mock('@/components/foundation/feedback/adminFeedback', () => ({
  adminFeedback: { warning: vi.fn() },
}));

it('shows the session expiry toast and replaces the current route with login', () => {
  const replace = vi.spyOn(router, 'replace').mockResolvedValue(undefined);
  window.dispatchEvent(new Event('zdm-auth-session-cleared'));
  expect(adminFeedback.warning).toHaveBeenCalledWith(SESSION_EXPIRED_MESSAGE);
  expect(replace).toHaveBeenCalledWith('/login');
});
