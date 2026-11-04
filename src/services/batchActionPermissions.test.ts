import { describe, expect, it } from 'vitest';
import { canonicalBatchPermission } from './batchActionPermissions';
import { canBatchDelete } from './productBatchPermissions';
import { hasPermission } from './adminPermissions';
import { getLoginUser } from './auth';
import { fullFunctionCatalog, normalizeFunctionCatalogPermissions } from './functionCatalog';
import { batchRequestError } from './productBatchFeedback';
import { ApiError } from './http';
describe('approved batch permission consolidation', () => {
  for (const client of ['admin', 'supply-chain', 'store']) {
    for (const module of [
      'finished-stock-management',
      'accessory-management',
      ...(client === 'store' ? [] : ['slab-management']),
    ]) {
      const prefix = `${client}.${module}`;
      it(`${prefix} maps only approved actions, with no state or module leakage`, () => {
        expect(canonicalBatchPermission(`${prefix}.batch-shelf`)).toBe(`${prefix}.warehouse.shelf`);
        for (const [state, action] of [
          ['selling', 'off-shelf'],
          ['recycle', 'restore'],
          ['recycle', 'purge'],
        ]) {
          expect(canonicalBatchPermission(`${prefix}.${state}.batch-${action}`)).toBe(`${prefix}.${state}.${action}`);
        }
        expect(canonicalBatchPermission(`${prefix}.selling.delete`)).toBe(`${prefix}.selling.delete`);
        const grants = normalizeFunctionCatalogPermissions(fullFunctionCatalog, [
          `${prefix}.batch-shelf`,
          `${prefix}.recycle.batch-purge`,
        ]);
        expect(grants).toEqual(
          expect.arrayContaining([
            `${prefix}.warehouse.shelf`,
            `${prefix}.warehouse.view`,
            `${prefix}.recycle.purge`,
            `${prefix}.recycle.view`,
          ]),
        );
        expect(grants.some((grant) => grant.includes('batch-'))).toBe(false);
        expect(grants).not.toContain(`${prefix}.selling.delete`);
      });
    }
  }
  it('requires both state grants only for All batch delete; rows retain state permissions', () => {
    const base = {
      ...getLoginUser(),
      roles: ['OPERATOR'],
      clientCode: 'admin' as const,
      tenantId: undefined,
      storeId: undefined,
    };
    const prefix = 'admin.finished-stock-management';
    for (const states of [[], ['warehouse'], ['selling'], ['warehouse', 'selling']]) {
      const user = { ...base, permissions: states.map((state) => `${prefix}.${state}.delete`) };
      const can = (state: string, action: string) => hasPermission(user, `${prefix}.${state}.${action}`);
      expect(canBatchDelete('all', can)).toBe(states.length === 2);
      expect(canBatchDelete('warehouse', can)).toBe(states.includes('warehouse'));
      expect(canBatchDelete('selling', can)).toBe(states.includes('selling'));
      expect(can('warehouse', 'delete')).toBe(states.includes('warehouse'));
      expect(can('selling', 'delete')).toBe(states.includes('selling'));
      expect(canBatchDelete('recycle', can)).toBe(false);
    }
  });
  it('keeps unrelated batch grants and clears distinct', () => {
    for (const grant of [
      'store.customer-management.daily.batch-assign',
      'store.price-configuration.price.finished.batch-set',
      'admin.slab-management.recycle.clear',
    ])
      expect(canonicalBatchPermission(grant)).toBe(grant);
    expect(canonicalBatchPermission('store.customer-management.daily.batch-archive')).toBe(
      'store.customer-management.daily.archive',
    );
    expect(canonicalBatchPermission('store.customer-management.archived.batch-restore')).toBe(
      'store.customer-management.archived.restore',
    );
  });
  it('does not report an unknown request as all failed', () => {
    expect(batchRequestError(new TypeError('network'), '删除')).toContain('未能获取完整删除结果');
    expect(batchRequestError(new ApiError('无权执行', 403), '上架')).toBe('无权执行');
  });
});
