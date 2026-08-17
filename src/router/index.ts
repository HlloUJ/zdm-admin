import { createRouter, createWebHistory } from 'vue-router';

import { getLoginUser } from '@/services/auth';
import { getAuthToken } from '@/services/http';
import { getFirstAccessiblePath, hasMenuPermission, routePermissionPrefixMap } from '@/services/adminPermissions';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/login',
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/pages/login/index.vue'),
    },
    {
      path: '/employee-invite',
      name: 'employeeInvite',
      component: () => import('@/pages/employee-invite/index.vue'),
    },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('@/pages/dashboard/index.vue'),
    },
    {
      path: '/finished-stock-management',
      name: 'finishedStockManagement',
      component: () => import('@/pages/finished-stock/management/index.vue'),
    },
    {
      path: '/finished-stock-craft',
      name: 'finishedStockCraft',
      component: () => import('@/pages/craft/finished-stock/index.vue'),
    },
    {
      path: '/employee-management',
      name: 'employeeManagement',
      component: () => import('@/pages/permission/employee/index.vue'),
    },
    {
      path: '/role-management',
      name: 'roleManagement',
      component: () => import('@/pages/role/management/index.vue'),
    },
    {
      path: '/terminal-function-allocation',
      name: 'terminalFunctionAllocation',
      component: () => import('@/pages/permission/terminal-function/index.vue'),
    },
    {
      path: '/product-category',
      name: 'productCategory',
      component: () => import('@/pages/product/category/index.vue'),
    },
    {
      path: '/product-attribute',
      name: 'productAttribute',
      component: () => import('@/pages/product/attribute/index.vue'),
    },
    {
      path: '/unit-management',
      name: 'unitManagement',
      component: () => import('@/pages/product/master-data/index.vue'),
      meta: { masterDataType: 'unit' },
    },
    {
      path: '/slab-variety',
      name: 'slabVariety',
      component: () => import('@/pages/slab/variety/index.vue'),
    },
    {
      path: '/slab-origin',
      name: 'slabOrigin',
      component: () => import('@/pages/slab/origin/index.vue'),
    },
    {
      path: '/slab-texture',
      name: 'slabTexture',
      component: () => import('@/pages/slab/texture/index.vue'),
    },
    {
      path: '/slab-color',
      name: 'slabColor',
      component: () => import('@/pages/slab/color/index.vue'),
    },
    {
      path: '/slab-grade',
      name: 'slabGrade',
      component: () => import('@/pages/slab/grade/index.vue'),
    },
    {
      path: '/slab-management',
      name: 'slabManagement',
      component: () => import('@/pages/slab/management/index.vue'),
    },
    {
      path: '/supplier-management',
      name: 'supplierManagement',
      component: () => import('@/pages/supplier/management/index.vue'),
    },
    {
      path: '/tenant-management',
      name: 'tenantManagement',
      component: () => import('@/pages/tenant/management/index.vue'),
    },
    {
      path: '/tenant-store-management',
      name: 'tenantStoreManagement',
      component: () => import('@/pages/tenant/store/index.vue'),
    },
    {
      path: '/store-level-management',
      name: 'storeLevelManagement',
      component: () => import('@/pages/store-level/management/index.vue'),
    },
    {
      path: '/store-category-management',
      name: 'storeCategoryManagement',
      component: () => import('@/pages/store-category/management/index.vue'),
    },
    {
      path: '/product-attribute-value',
      name: 'productAttributeValue',
      component: () => import('@/pages/product/attribute-value/index.vue'),
    },
    {
      path: '/category-attribute-template',
      name: 'categoryAttributeTemplate',
      component: () => import('@/pages/product/category-attribute-template/index.vue'),
    },
    { path: '/finished-stock-category', redirect: '/product-category' },
    { path: '/accessory-category', redirect: '/category-attribute-template' },
    { path: '/finished-stock-attribute', redirect: '/product-attribute' },
    { path: '/accessory-attribute', redirect: '/product-attribute-value' },
  ],
});

const publicPaths = new Set(['/login', '/employee-invite']);

router.beforeEach((to) => {
  if (publicPaths.has(to.path)) return true;

  const token = getAuthToken();
  if (!token) {
    return { path: '/login' };
  }

  const loginUser = getLoginUser();
  const permissionPrefix = routePermissionPrefixMap[to.path];
  if (!hasMenuPermission(loginUser, permissionPrefix)) {
    const nextPath = getFirstAccessiblePath(loginUser);
    if (!nextPath && to.path !== '/dashboard') return { path: '/dashboard' };
    if (nextPath && nextPath !== to.path) return { path: nextPath };
  }

  return true;
});

export default router;
