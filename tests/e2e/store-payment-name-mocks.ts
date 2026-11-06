import type { Page } from '@playwright/test';
import type { StorePaymentName } from '../../src/services/storePaymentNames';
export async function installPaymentNameMocks(page: Page) {
  let id = 0;
  const rows: StorePaymentName[] = [];
  await page.route('**/api/store/payment-names**', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const base = '/api/store/payment-names';
    const parts = url.pathname.slice(base.length).split('/').filter(Boolean);
    const body = request.postDataJSON() as { name?: string; enabled?: boolean; version?: number } | null;
    const reply = (data: unknown, message = 'ok', status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({ code: status === 200 ? 0 : status, message, data }),
      });
    if (request.method() === 'GET') {
      if (parts[0] === 'options')
        return reply(rows.filter((row) => row.enabled).map(({ id, name, version }) => ({ id, name, version })));
      const current = Number(url.searchParams.get('page') || 1),
        size = Number(url.searchParams.get('pageSize') || 10);
      return reply({ items: [...rows].reverse().slice((current - 1) * size, current * size), total: rows.length });
    }
    if (request.method() === 'POST') {
      if (!body?.name?.trim() || Array.from(body.name.trim()).length > 10)
        return reply(null, '名称不能超过10个字符', 400);
      if (rows.some((row) => row.name === body.name?.trim())) return reply(null, '该名称已存在', 400);
      const row: StorePaymentName = {
        id: String(++id),
        name: body.name.trim(),
        enabled: true,
        version: 1,
        createdBy: 7,
        createdByName: '原型导购',
        createdAt: `2026-11-06T10:00:${String(id % 60).padStart(2, '0')}`,
        updatedAt: '2026-11-06T10:00:00',
      };
      rows.push(row);
      return reply(row);
    }
    const index = rows.findIndex((row) => row.id === parts[0]),
      row = rows[index];
    if (!row) return reply(null, '款项名称不存在或已删除', 400);
    const version = request.method() === 'DELETE' ? Number(url.searchParams.get('version')) : body?.version;
    if (row.version !== version) return reply(null, '配置已被其他人修改，请刷新后重试', 400);
    if (request.method() === 'DELETE') {
      rows.splice(index, 1);
      return reply(null);
    }
    if (parts[1] === 'status') {
      row.enabled = Boolean(body?.enabled);
      row.version++;
      return reply(row);
    }
    if (rows.some((entry) => entry.id !== row.id && entry.name === body?.name)) return reply(null, '该名称已存在', 400);
    row.name = body!.name!;
    row.version++;
    return reply(row);
  });
}
