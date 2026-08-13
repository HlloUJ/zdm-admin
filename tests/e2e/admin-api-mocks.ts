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
    createdBy: '韩健',
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
    createdByName: '韩健',
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
    createdByName: '韩健',
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
    functionPermissions: 'all',
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
    functionPermissions: 'admin.permission-management.role-management.operation-platform.view',
    createdAt: '2026-07-27T09:00:00',
  },
  {
    id: 3,
    name: '未配置权限角色',
    code: 'EMPTY_PERMISSION_ROLE',
    category: 'operation-platform',
    clientCode: 'admin',
    dataScope: 'all',
    status: 'enabled',
    remark: 'E2E 未配置权限角色',
    functionPermissions: '',
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
    remark: '系统内置超管，负责平台权限、员工账号、租户门店等后台核心管理事项',
    createdByName: '韩健',
    createdAt: '2026-07-27T09:00:00',
  },
  {
    id: 2,
    tenantId: 1,
    storeId: 1,
    name: '待启用员工',
    gender: 'female',
    phone: '15926628888',
    status: 'disabled',
    roleIds: '',
    dataPermission: '',
    remark: '待超级管理员补齐权限',
    createdByName: '韩健',
    createdAt: '2026-07-27T09:00:00',
  },
  {
    id: 3,
    tenantId: 1,
    storeId: 1,
    name: '测试员工',
    gender: 'male',
    phone: '15926627777',
    status: 'enabled',
    roleIds: '2',
    dataPermission: 'all',
    remark: '统一提示验收数据',
    createdByName: '韩健',
    createdAt: '2026-08-07T09:00:00',
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
    createdByName: '韩健',
    createdAt: '2026-07-27T09:00:00',
  },
  {
    id: 2,
    parentId: 1,
    scope: 'finished',
    name: '岩板餐桌',
    sortOrder: 1,
    productCount: 1,
    status: 'disabled',
    createdByName: '韩健',
    createdAt: '2026-07-27T09:00:00',
  },
];

const storeCategories = [
  {
    id: 1,
    parentId: null,
    name: '石材',
    sortOrder: 1,
    productCount: 0,
    status: 'enabled',
    createdByName: '韩健',
    createdAt: '2026-08-07T09:00:00',
  },
  {
    id: 2,
    parentId: 1,
    name: '大理石',
    sortOrder: 1,
    productCount: 0,
    status: 'enabled',
    createdByName: '韩健',
    createdAt: '2026-08-07T09:10:00',
  },
];

const productAttributes = [
  {
    id: 1,
    scope: 'shared',
    name: 'E2E 共享属性',
    valueType: 'select',
    attributeRole: 'basic',
    templateCount: 2,
    status: 'enabled',
    createdByName: '韩健',
    createdAt: '2026-08-04T09:00:00',
  },
  {
    id: 2,
    scope: 'finished',
    name: 'E2E 成品现货专属属性',
    valueType: 'select',
    attributeRole: 'basic',
    templateCount: 1,
    status: 'enabled',
    createdByName: '韩健',
    createdAt: '2026-08-04T09:10:00',
  },
];

const productAttributeValues = [
  {
    id: 1,
    attributeId: 1,
    scope: 'shared',
    value: 'E2E 共享属性值',
    code: 'e2e-shared-value',
    useCount: 2,
    status: 'enabled',
    createdByName: '韩健',
    createdAt: '2026-08-04T09:20:00',
  },
  {
    id: 2,
    attributeId: 2,
    scope: 'finished',
    value: 'E2E 成品现货专属值',
    code: 'e2e-finished-value',
    useCount: 1,
    status: 'enabled',
    createdByName: '韩健',
    createdAt: '2026-08-04T09:30:00',
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

const crafts = [
  {
    id: 1,
    name: 'E2E 边工艺',
    type: '边工艺',
    width: '12',
    imageUrl: '',
    remark: '按钮权限测试数据',
    status: 'enabled',
    createdByName: '韩健',
    createdAt: '2026-07-31T09:00:00',
  },
];

const slabVarieties = [
  {
    id: 1,
    name: '潘多拉',
    code: 'pandora',
    originId: 1,
    remark: '按钮权限测试数据',
    status: 'enabled',
    createdByName: '韩健',
    createdAt: '2026-07-27T09:00:00',
  },
];

const slabs = [
  {
    id: 6,
    supplierId: 1,
    varietyId: 1,
    name: '雪花白大板 06',
    serialNo: 'SLAB-E2E-006',
    warehouse: '云浮仓',
    publisherType: '平台发布',
    lengthMm: 3200,
    widthMm: 1800,
    thicknessMm: 18,
    areaSquareMeter: 5.76,
    costPrice: 6800,
    guidePrice: 9800,
    status: 'warehouse',
    createdAt: '2026-07-27T09:00:00',
  },
  {
    id: 7,
    supplierId: 1,
    varietyId: 1,
    name: '回收站大板 07',
    serialNo: 'SLAB-E2E-007',
    warehouse: '云浮仓',
    publisherType: '平台发布',
    lengthMm: 3000,
    widthMm: 1700,
    thicknessMm: 18,
    areaSquareMeter: 5.1,
    costPrice: 6200,
    guidePrice: 9000,
    status: 'recycle',
    createdAt: '2026-07-27T09:10:00',
  },
  {
    id: 8,
    supplierId: 1,
    varietyId: 1,
    name: '回收站大板 08',
    serialNo: 'SLAB-E2E-008',
    warehouse: '云浮仓',
    publisherType: '平台发布',
    lengthMm: 2800,
    widthMm: 1600,
    thicknessMm: 18,
    areaSquareMeter: 4.48,
    costPrice: 5800,
    guidePrice: 8500,
    status: 'recycle',
    createdAt: '2026-07-27T09:20:00',
  },
];

const slabOrigins = [
  {
    id: 1,
    name: '巴西',
    remark: '从现有大板品种迁移',
    status: 'enabled',
    createdByName: '韩健',
    createdAt: '2026-07-27T09:00:00',
  },
];

const slabTextures = [
  { id: 1, name: '细纹', remark: '', status: 'enabled', createdByName: '韩健', createdAt: '2026-08-12T09:00:00' },
  { id: 2, name: '直纹', remark: '', status: 'enabled', createdByName: '韩健', createdAt: '2026-08-12T08:00:00' },
];

const slabColorCategories = [
  { id: 1, name: '白色系', remark: '白色及浅灰色', createdByName: '韩健', createdAt: '2026-08-13T09:00:00' },
];

const slabColors = [
  {
    id: 1,
    categoryId: 1,
    categoryName: '白色系',
    name: '奶白',
    remark: '',
    status: 'enabled',
    createdByName: '韩健',
    createdAt: '2026-08-13T09:10:00',
  },
  {
    id: 2,
    categoryId: 1,
    categoryName: '白色系',
    name: '冷白',
    remark: '',
    status: 'enabled',
    createdByName: '韩健',
    createdAt: '2026-08-13T09:05:00',
  },
];

const slabGrades = [
  {
    id: 1,
    code: 'A+',
    name: '超精品料',
    remark: '',
    status: 'enabled',
    createdByName: '韩健',
    createdAt: '2026-08-13T10:10:00',
  },
  {
    id: 2,
    code: 'A',
    name: '精品料',
    remark: '',
    status: 'enabled',
    createdByName: '韩健',
    createdAt: '2026-08-13T10:05:00',
  },
  {
    id: 3,
    code: 'B',
    name: '标准料',
    remark: '',
    status: 'enabled',
    createdByName: '韩健',
    createdAt: '2026-08-13T10:00:00',
  },
];

const slabTextureAliases: Record<number, Array<Record<string, unknown>>> = {
  1: [{ id: 1, textureId: 1, name: '幼纹', status: 'enabled', createdAt: '2026-08-12T09:10:00' }],
  2: [],
};

export async function installAdminApiMocks(page: Page) {
  await mockEmployeeInvites(page);
  await mockCollection(page, '**/api/admin/tenants', tenants);
  await mockCollection(page, '**/api/admin/stores', stores);
  await mockCollection(page, '**/api/admin/suppliers', suppliers);
  await mockCollection(page, '**/api/admin/roles', roles);
  await mockCollection(page, '**/api/admin/employees', employees);
  await mockCollection(page, '**/api/admin/store-categories', storeCategories);
  await mockCollection(page, '**/api/admin/product-categories', productCategories);
  await mockCollection(page, '**/api/admin/product-attributes', productAttributes);
  await mockCollection(page, '**/api/admin/product-attribute-values', productAttributeValues);
  await page.route('**/api/admin/product-attribute-values/attribute-options', async (route) => {
    await fulfillJson(
      route,
      productAttributes.filter((attribute) => attribute.valueType === 'select'),
    );
  });
  await mockCollection(page, '**/api/admin/finished-products', finishedProducts);
  await mockCollection(page, '**/api/admin/inventory-movements', inventoryMovements);
  await mockCollection(page, '**/api/admin/crafts', crafts);
  await mockCollection(page, '**/api/admin/slab-varieties', slabVarieties);
  await mockCollection(page, '**/api/admin/slabs', slabs);
  await mockCollection(page, '**/api/admin/slab-origins', slabOrigins);
  await mockCollection(page, '**/api/admin/slab-textures', slabTextures);
  await mockCollection(page, '**/api/admin/slab-colors', slabColors);
  await mockCollection(page, '**/api/admin/slab-colors/categories', slabColorCategories);
  await mockCollection(page, '**/api/admin/slab-grades', slabGrades);
  await page.route('**/api/admin/slab-textures/*/aliases**', async (route) => {
    const parts = new URL(route.request().url()).pathname.split('/').filter(Boolean);
    const textureId = Number(parts[3]);
    const aliasId = parts.length > 5 ? Number(parts[5]) : null;
    const records = slabTextureAliases[textureId] ?? (slabTextureAliases[textureId] = []);
    if (route.request().method() === 'GET') return fulfillJson(route, records);
    if (route.request().method() === 'DELETE' && aliasId) {
      const index = records.findIndex((item) => Number(item.id) === aliasId);
      if (index >= 0) records.splice(index, 1);
      return fulfillJson(route, true);
    }
    const payload = route.request().postDataJSON() as { name: string };
    if (route.request().method() === 'POST') {
      const record = { id: Date.now(), textureId, name: payload.name, status: 'enabled' };
      records.push(record);
      return fulfillJson(route, record);
    }
    const record = records.find((item) => Number(item.id) === aliasId);
    if (record) record.name = payload.name;
    return fulfillJson(route, record ?? {});
  });
}

async function mockEmployeeInvites(page: Page) {
  await page.route('**/api/open/employee-invites/e2e-invite-token/request-code', async (route) => {
    const payload = route.request().postDataJSON() as { phone?: string };
    if (payload.phone === '15926626945') {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ code: 400, message: '该手机号已是当前组织员工', data: null }),
      });
      return;
    }
    await fulfillJson(route, true);
  });

  await page.route('**/api/admin/employee-invites', async (route) => {
    await fulfillJson(route, {
      token: 'e2e-invite-token',
      expiresAt: '2026-08-04T09:00:00',
    });
  });

  await page.route('**/api/open/employee-invites/e2e-invite-token', async (route) => {
    await fulfillJson(route, {
      token: 'e2e-invite-token',
      expiresAt: '2026-08-04T09:00:00',
    });
  });

  await page.route('**/api/open/employee-invites/e2e-invite-token/verify-code', async (route) => {
    let payload: { verifyCode?: string };
    try {
      payload = route.request().postDataJSON() as { verifyCode?: string };
    } catch {
      payload = {};
    }
    if (payload.verifyCode !== '888888') {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ code: 400, message: '验证码错误', data: null }),
      });
      return;
    }
    await fulfillJson(route, true);
  });

  await page.route('**/api/open/employee-invites/e2e-invite-token/register', async (route) => {
    await fulfillJson(route, {
      employeeId: 2,
      status: 'disabled',
    });
  });
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
    if (route.request().method() === 'PUT' || route.request().method() === 'PATCH') {
      const pathParts = new URL(route.request().url()).pathname.split('/').filter(Boolean);
      const id = Number(
        ['permissions', 'status'].includes(pathParts.at(-1) ?? '') ? pathParts.at(-2) : pathParts.at(-1),
      );
      const targetIndex = records.findIndex((record) => {
        if (!record || typeof record !== 'object' || !('id' in record)) return false;
        return Number(record.id) === id;
      });
      if (targetIndex !== -1) {
        const payload = route.request().postDataJSON() as Record<string, unknown>;
        records[targetIndex] = { ...(records[targetIndex] as Record<string, unknown>), ...payload };
        await fulfillJson(route, records[targetIndex]);
        return;
      }
    }
    await fulfillJson(route, records[0] ?? {});
  });
}
