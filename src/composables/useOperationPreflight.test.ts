import { describe, it, expect, vi } from 'vitest';
import { ApiError, SessionExpiredError } from '@/services/http';
import { createOperationPreflight, blockOperation } from './useOperationPreflight';

describe('operation preflight', () => {
  const feedback = () => ({ warning: vi.fn(), error: vi.fn() });
  it('blocks confirmation immediately and merges known absence into one warning', async () => {
    const f = feedback();
    const p = createOperationPreflight(() => 'store:1', f as never);
    const confirm = vi.fn();
    if (await p.run(() => blockOperation('请先选择门店分类并完善商品售价后再上架'))) confirm();
    expect(confirm).not.toHaveBeenCalled();
    expect(f.warning).toHaveBeenCalledExactlyOnceWith('请先选择门店分类并完善商品售价后再上架');
  });
  it('serializes checks, rejects stale identity responses and permits a later check', async () => {
    let identity = 'store:1';
    let resolve!: () => void;
    const p = createOperationPreflight(() => identity, feedback() as never);
    const check = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const first = p.run(check);
    expect(await p.run(check)).toBe(false);
    expect(check).toHaveBeenCalledTimes(1);
    identity = 'store:2';
    resolve();
    expect(await first).toBe(false);
    expect(await p.run(() => undefined)).toBe(true);
  });
  it('does not show stale errors or open confirmation after disposal', async () => {
    const f = feedback();
    const p = createOperationPreflight(() => 'a', f as never);
    let reject!: (e: Error) => void;
    const pending = p.run(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    p.dispose();
    reject(new Error('network'));
    expect(await pending).toBe(false);
    expect(f.error).not.toHaveBeenCalled();
    expect(await p.run(() => undefined)).toBe(false);
  });
  it('uses warning for business rejection, error for transport failures and suppresses duplicate session messages', async () => {
    const f = feedback();
    const p = createOperationPreflight(() => 'a', f as never);
    expect(
      await p.run(() => {
        throw new ApiError('请选择门店分类', 400);
      }),
    ).toBe(false);
    expect(f.warning).toHaveBeenCalledWith('请先选择门店分类后再上架');
    expect(
      await p.run(() => {
        throw new Error();
      }),
    ).toBe(false);
    expect(f.error).toHaveBeenCalledWith('操作条件检查失败，请稍后重试');
    f.error.mockClear();
    await p.run(() => {
      throw new SessionExpiredError();
    });
    expect(f.error).not.toHaveBeenCalled();
  });
});

it('invalidates a response even when a tab switches away and back to the same value', async () => {
  const f = { warning: vi.fn(), error: vi.fn() };
  const p = createOperationPreflight(() => 'same-tab', f as never);
  let resolve!: () => void;
  const pending = p.run(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  p.invalidate();
  p.invalidate();
  resolve();
  expect(await pending).toBe(false);
  expect(f.warning).not.toHaveBeenCalled();
  expect(await p.run(() => undefined)).toBe(true);
});

it('executes one mutation at a time and releases protection after a rejection', async () => {
  const p = createOperationPreflight(() => 'a', { warning: vi.fn(), error: vi.fn() } as never);
  let resolve!: () => void;
  const mutation = vi.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const first = p.execute(mutation);
  expect(p.executing.value).toBe(true);
  const otherCheck = vi.fn();
  expect(await p.run(otherCheck)).toBe(false);
  expect(otherCheck).not.toHaveBeenCalled();
  await p.execute(mutation);
  expect(mutation).toHaveBeenCalledTimes(1);
  resolve();
  await first;
  expect(p.executing.value).toBe(false);
  await expect(
    p.execute(() => {
      throw new Error('执行失败');
    }),
  ).rejects.toThrow('执行失败');
  expect(p.executing.value).toBe(false);
  expect(await p.execute(async () => 'saved')).toBe('saved');
});
