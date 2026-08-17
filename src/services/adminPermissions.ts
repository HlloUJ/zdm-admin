import type { LoginUser } from './auth';

export interface AdminMenuItem {
  label: string;
  path: string;
  icon?: string;
  permissionPrefix?: string;
}

export interface AdminMenuSubgroup {
  label: string;
  value: string;
  children: AdminMenuItem[];
}

export type AdminMenuChild = AdminMenuItem | AdminMenuSubgroup;

export interface AdminMenuGroup {
  label: string;
  value: string;
  icon: string;
  children: AdminMenuChild[];
}

export type AdminMenuEntry = AdminMenuItem | AdminMenuGroup;

export const adminMenuEntries: AdminMenuEntry[] = [
  { label: '工作台', path: '/dashboard', icon: 'dashboard' },
  {
    label: '租户与门店',
    value: 'tenant-management',
    icon: 'usergroup',
    children: [
      { label: '租户管理', path: '/tenant-management', permissionPrefix: 'admin.tenant.tenant-management' },
      { label: '门店管理', path: '/tenant-store-management', permissionPrefix: 'admin.tenant.tenant-store-management' },
      {
        label: '门店基础数据',
        value: 'store-base-data-management',
        children: [
          {
            label: '店铺级别管理',
            path: '/store-level-management',
            permissionPrefix: 'admin.tenant.store-level-management',
          },
        ],
      },
    ],
  },
  {
    label: '商品管理',
    value: 'product-management',
    icon: 'layers',
    children: [
      {
        label: '成品现货管理',
        path: '/finished-stock-management',
        permissionPrefix: 'admin.finished-stock-management',
      },
      { label: '大板管理', path: '/slab-management', permissionPrefix: 'admin.slab-management' },
      {
        label: '商品公共基础数据',
        value: 'product-common-base-data',
        children: [
          { label: '商品分类管理', path: '/product-category', permissionPrefix: 'admin.product-data-center.category' },
          { label: '属性库管理', path: '/product-attribute', permissionPrefix: 'admin.product-data-center.attribute' },
          {
            label: '属性值管理',
            path: '/product-attribute-value',
            permissionPrefix: 'admin.product-data-center.attribute-value',
          },
          {
            label: '分类属性模板',
            path: '/category-attribute-template',
            permissionPrefix: 'admin.product-data-center.category-attribute-template',
          },
        ],
      },
      {
        label: '成品现货基础数据',
        value: 'finished-stock-base-data',
        children: [
          {
            label: '工艺管理',
            path: '/finished-stock-craft',
            permissionPrefix: 'admin.product-data-center.finished-stock-craft',
          },
        ],
      },
      {
        label: '大板基础数据',
        value: 'slab-base-data-management',
        children: [
          { label: '品种管理', path: '/slab-variety', permissionPrefix: 'admin.product-data-center.slab-variety' },
          { label: '产地管理', path: '/slab-origin', permissionPrefix: 'admin.product-data-center.slab-origin' },
          { label: '纹理管理', path: '/slab-texture', permissionPrefix: 'admin.product-data-center.slab-texture' },
          { label: '色系管理', path: '/slab-color', permissionPrefix: 'admin.product-data-center.slab-color' },
          { label: '等级管理', path: '/slab-grade', permissionPrefix: 'admin.product-data-center.slab-grade' },
        ],
      },
    ],
  },
  {
    label: '供应商管理',
    path: '/supplier-management',
    icon: 'usergroup',
    permissionPrefix: 'admin.supplier-management',
  },
  {
    label: '门店分类管理',
    path: '/store-category-management',
    icon: 'folder',
    permissionPrefix: 'admin.tenant.store-category-management',
  },
  {
    label: '权限管理',
    value: 'permission-management',
    icon: 'secured',
    children: [
      {
        label: '员工管理',
        path: '/employee-management',
        permissionPrefix: 'admin.permission-management.employee-management',
      },
      {
        label: '角色管理',
        path: '/role-management',
        permissionPrefix: 'admin.permission-management.role-management',
      },
      {
        label: '终端功能分配',
        path: '/terminal-function-allocation',
        permissionPrefix: 'admin.permission-management.terminal-function-allocation',
      },
    ],
  },
];

export const routePermissionPrefixMap = Object.fromEntries(
  adminMenuEntries.flatMap((entry) => {
    if ('children' in entry) {
      return entry.children.flatMap((item) =>
        'path' in item
          ? [[item.path, item.permissionPrefix]]
          : item.children.map((child) => [child.path, child.permissionPrefix]),
      );
    }
    return [[entry.path, entry.permissionPrefix]];
  }),
);

export function isSuperAdmin(user: LoginUser) {
  return user.roles.includes('SUPER_ADMIN') || user.permissions.includes('all');
}

export function hasPermission(user: LoginUser, permission: string) {
  return (
    isSuperAdmin(user) || getPermissionCandidates(permission).some((candidate) => user.permissions.includes(candidate))
  );
}

export function hasAnyPermission(user: LoginUser, permissions: string[]) {
  return isSuperAdmin(user) || permissions.some((permission) => hasPermission(user, permission));
}

export function hasPermissionPrefix(user: LoginUser, prefix?: string) {
  if (!prefix || isSuperAdmin(user)) return true;
  return user.permissions.some((permission) => permission === prefix || permission.startsWith(`${prefix}.`));
}

export function hasMenuPermission(user: LoginUser, prefix?: string) {
  if (isSuperAdmin(user)) return true;
  if (!prefix) return false;
  return user.permissions.some(
    (permission) =>
      permission === `${prefix}.view` || (permission.startsWith(`${prefix}.`) && permission.endsWith('.view')),
  );
}

export function getFirstAccessiblePath(user: LoginUser) {
  for (const entry of adminMenuEntries) {
    if ('children' in entry) {
      const firstChild = entry.children
        .flatMap((item) => ('path' in item ? [item] : item.children))
        .find((item) => hasMenuPermission(user, item.permissionPrefix));
      if (firstChild) return firstChild.path;
    } else if (hasMenuPermission(user, entry.permissionPrefix)) {
      return entry.path;
    }
  }
  return '';
}

const permissionAliases: Record<string, string[]> = {
  'admin.tenant.store-category-management.toggle-status': [
    'admin.tenant.store-category-management.disable',
    'admin.tenant.store-category-management.enable',
  ],
  ...Object.fromEntries(
    (['finished', 'accessory'] as const).map((scope) => [
      `admin.product-data-center.category.${scope}.toggle-status`,
      [`admin.product-data-center.category.${scope}.disable`, `admin.product-data-center.category.${scope}.enable`],
    ]),
  ),
  'admin.product-data-center.category-attribute-template.finished.view': [
    'admin.product-data-center.category-attribute-template.view',
  ],
  'admin.product-data-center.category-attribute-template.accessory.view': [
    'admin.product-data-center.category-attribute-template.view',
  ],
  ...Object.fromEntries(
    (['finished', 'accessory'] as const).flatMap((scope) =>
      [
        ['create', 'create'],
        ['attribute-role', 'edit'],
        ['sku-combination', 'edit'],
        ['required', 'edit'],
        ['bind-values', 'edit'],
        ['toggle-publish', 'toggle-publish'],
        ['delete', 'delete'],
      ].map(([action, legacyAction]) => [
        `admin.product-data-center.category-attribute-template.${scope}.${action}`,
        [`admin.product-data-center.category-attribute-template.${legacyAction}`],
      ]),
    ),
  ),
  'admin.permission-management.employee-management.create': [
    'admin.permission-management.employee-management.邀请员工',
  ],
  'admin.permission-management.employee-management.edit': ['admin.permission-management.employee-management.编辑员工'],
  'admin.permission-management.employee-management.toggle-status': [
    'admin.permission-management.employee-management.停用/启用',
  ],
  'admin.permission-management.employee-management.delete': ['admin.permission-management.employee-management.删除'],
};

function getPermissionCandidates(permission: string) {
  return [permission, ...(permissionAliases[permission] ?? [])];
}
