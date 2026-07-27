import type { Page, Route } from '@playwright/test';

const apiOk = (data: unknown) => ({
  code: 0,
  message: 'ok',
  data,
});

const fulfillJson = (route: Route, data: unknown) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(apiOk(data)),
  });

const tenants = [
  {
    id: 1,
    name: '装点猫直营租户',
    contactName: '超级管理员',
    contactPhone: '15926626945',
    status: 'enabled',
    businessTypes: 'cityPartner,slabSupplier,finishedSupplier,factory',
    remark: '系统内置平台租户',
    createdAt: '2026-07-27T09:00:00',
  },
];

const stores = [
  {
    id: 1,
    tenantId: 1,
    name: '杭州体验门店',
    type: 'cityPartner',
    shopLevel: 'level1',
    manager: '超级管理员',
    region: 'zhejiang/hangzhou/xihu',
    detailAddress: '样例地址 1 号',
    address: '浙江省杭州市西湖区样例地址 1 号',
    status: 'enabled',
    remark: '系统内置门店',
    createdAt: '2026-07-27T09:00:00',
  },
];

const suppliers = [
  {
    id: 1,
    name: '装点猫大板供应商',
    type: 'slab',
    contactName: '供应商联系人',
    contactPhone: '15926626946',
    qualificationStatus: 'approved',
    status: 'enabled',
    remark: '系统内置供应商',
    createdAt: '2026-07-27T09:00:00',
  },
  {
    id: 2,
    name: '装点猫成品供应商',
    type: 'finished',
    contactName: '成品联系人',
    contactPhone: '15926626947',
    qualificationStatus: 'approved',
    status: 'enabled',
    remark: 'E2E 成品供应商',
    createdAt: '2026-07-27T09:00:00',
  },
];

const roles = [
  {
    id: 1,
    name: '超级管理员',
    code: 'SUPER_ADMIN',
    category: 'operation-platform',
    clientCode: 'admin',
    dataScope: 'all',
    status: 'enabled',
    remark: '系统内置角色',
    functionPermissions:
      'admin.tenant.tenant-management.view,admin.tenant.tenant-store-management.view,admin.permission.employee-management.view',
    createdAt: '2026-07-27T09:00:00',
  },
  {
    id: 2,
    name: '运营管理平台角色',
    code: 'OPERATION_MANAGER',
    category: 'operation-platform',
    clientCode: 'admin',
    dataScope: 'all',
    status: 'enabled',
    remark: 'E2E 运营角色',
    functionPermissions: 'admin.permission.role-management.view',
    createdAt: '2026-07-27T09:00:00',
  },
];

const employees = [
  {
    id: 1,
    tenantId: 1,
    storeId: 1,
    name: '超级管理员',
    gender: 'male',
    phone: '15926626945',
    status: 'enabled',
    roleIds: '1,2',
    dataPermission: 'all',
    remark: '系统内置超管',
    createdAt: '2026-07-27T09:00:00',
  },
];

const productCategories = [
  {
    id: 1,
    scope: 'finished',
    name: '成品现货',
    sortOrder: 1,
    productCount: 1,
    status: 'enabled',
    createdAt: '2026-07-27T09:00:00',
  },
  {
    id: 2,
    parentId: 1,
    scope: 'finished',
    name: '岩板餐桌',
    sortOrder: 1,
    productCount: 1,
    status: 'enabled',
    createdAt: '2026-07-27T09:00:00',
  },
];

const finishedProducts = [
  {
    id: 1,
    categoryId: 2,
    supplierId: 2,
    name: '意式轻奢岩板餐桌',
    sku: 'FP-20260727-001',
    publisherType: 'platform',
    totalStock: 12,
    guidePrice: 2999,
    status: 'warehouse',
    createdAt: '2026-07-27T09:00:00',
  },
];

const inventoryMovements = [
  {
    id: 1,
    inventoryType: 'finished_product',
    inventoryId: 1,
    movementType: 'initial',
    quantity: 12,
    beforeQuantity: 0,
    afterQuantity: 12,
    reason: 'E2E 初始入库',
    remark: '系统初始化',
    createdAt: '2026-07-27T09:00:00',
  },
];

export async function installAdminApiMocks(page: Page) {
  await mockCollection(page, '**/api/admin/tenants', tenants);
  await mockCollection(page, '**/api/admin/stores', stores);
  await mockCollection(page, '**/api/admin/suppliers', suppliers);
  await mockCollection(page, '**/api/admin/roles', roles);
  await mockCollection(page, '**/api/admin/employees', employees);
  await mockCollection(page, '**/api/admin/product-categories', productCategories);
  await mockCollection(page, '**/api/admin/finished-products', finishedProducts);
  await mockCollection(page, '**/api/admin/inventory-movements', inventoryMovements);
}

async function mockCollection(page: Page, pattern: string, records: unknown[]) {
  await page.route(pattern, async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillJson(route, records);
      return;
    }
    await fulfillJson(route, records[0] ?? {});
  });

  await page.route(`${pattern}/**`, async (route) => {
    if (route.request().method() === 'DELETE') {
      await fulfillJson(route, true);
      return;
    }
    await fulfillJson(route, records[0] ?? {});
  });
}
