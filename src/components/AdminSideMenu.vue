<template>
  <aside class="side-nav" @click.capture="handleSideNavClick">
    <t-menu
      :value="activeMenu"
      class="menu"
      theme="light"
      :expanded="expandedMenus"
      @change="handleMenuChange"
      @expand="handleMenuExpand"
    >
      <t-menu-item value="/dashboard" class="menu-level-one-item">
        <template #icon>
          <t-icon name="dashboard" />
        </template>
        工作台
      </t-menu-item>
      <t-submenu value="tenant-management" title="租户与门店" class="menu-level-one">
        <template #icon>
          <t-icon name="usergroup" />
        </template>
        <t-menu-item value="/tenant-management" class="menu-level-two-item">租户管理</t-menu-item>
        <t-menu-item value="/tenant-store-management" class="menu-level-two-item">门店管理</t-menu-item>
      </t-submenu>
      <t-menu-item
        value="/finished-stock-management"
        data-menu-path="/finished-stock-management"
        class="menu-level-one-item"
      >
        <template #icon>
          <t-icon name="shop" />
        </template>
        成品现货管理
      </t-menu-item>
      <t-menu-item value="/slab-management" class="menu-level-one-item">
        <template #icon>
          <t-icon name="image" />
        </template>
        大板管理
      </t-menu-item>
      <t-menu-item value="/supplier-management" class="menu-level-one-item">
        <template #icon>
          <t-icon name="usergroup" />
        </template>
        供应商管理
      </t-menu-item>
      <t-menu-item value="/store-category-management" class="menu-level-one-item">
        <template #icon>
          <t-icon name="folder" />
        </template>
        门店分类管理
      </t-menu-item>
      <t-submenu value="product-data-center" title="商品基础数据中心" class="menu-level-one">
        <template #icon>
          <t-icon name="layers" />
        </template>
        <t-menu-item value="/product-category" class="menu-level-two-item">商品分类管理</t-menu-item>
        <t-menu-item value="/product-attribute" class="menu-level-two-item">属性库管理</t-menu-item>
        <t-menu-item value="/product-attribute-value" class="menu-level-two-item">属性值管理</t-menu-item>
        <t-menu-item value="/category-attribute-template" class="menu-level-two-item">类目属性模板</t-menu-item>
        <t-menu-item value="/slab-variety" class="menu-level-two-item">大板品种管理</t-menu-item>
        <t-menu-item value="/finished-stock-craft" class="menu-level-two-item">成品现货工艺管理</t-menu-item>
      </t-submenu>
      <t-submenu value="permission-management" title="权限管理" class="menu-level-one">
        <template #icon>
          <t-icon name="secured" />
        </template>
        <t-menu-item value="/employee-management" class="menu-level-two-item">员工管理</t-menu-item>
        <t-menu-item value="/role-management" class="menu-level-two-item">角色管理</t-menu-item>
        <t-menu-item value="/terminal-function-allocation" class="menu-level-two-item">终端功能分配</t-menu-item>
      </t-submenu>
    </t-menu>
  </aside>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useSideMenuState } from '@/composables/useSideMenuState';

const route = useRoute();
const router = useRouter();
const { expandedMenus, handleMenuExpand } = useSideMenuState();

const activeMenu = computed(() => route.path);

const baseInfoPaths = new Set([
  '/product-category',
  '/product-attribute',
  '/product-attribute-value',
  '/category-attribute-template',
  '/unit-management',
  '/finished-stock-category',
  '/accessory-category',
  '/finished-stock-attribute',
  '/accessory-attribute',
  '/slab-variety',
  '/finished-stock-craft',
]);

const tenantManagementPaths = new Set(['/tenant-management', '/tenant-store-management']);
const permissionManagementPaths = new Set([
  '/employee-management',
  '/role-management',
  '/terminal-function-allocation',
]);

watch(
  () => route.path,
  () => {
    const requiredExpandedMenus = [];
    if (tenantManagementPaths.has(route.path)) requiredExpandedMenus.push('tenant-management');
    if (baseInfoPaths.has(route.path)) requiredExpandedMenus.push('product-data-center');
    if (permissionManagementPaths.has(route.path)) requiredExpandedMenus.push('permission-management');

    const missingExpandedMenus = requiredExpandedMenus.filter((item) => !expandedMenus.value.includes(item));
    if (missingExpandedMenus.length) {
      const nextExpandedMenus = [...expandedMenus.value, ...missingExpandedMenus];
      handleMenuExpand(nextExpandedMenus);
    }
  },
  { immediate: true },
);

const handleMenuChange = (value: string | number) => {
  const target = String(value);
  if (target !== route.path) {
    router.push(target);
  } else if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('admin-menu-reselect', { detail: { path: target } }));
  }
};

const handleCurrentMenuClick = (target: string) => {
  if (target === route.path && typeof window !== 'undefined') {
    router.replace(target);
    window.dispatchEvent(new CustomEvent('admin-menu-reselect', { detail: { path: target } }));
  }
};

const handleSideNavClick = (event: MouseEvent) => {
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-menu-path]');
  const path = target?.dataset.menuPath;
  if (path) {
    handleCurrentMenuClick(path);
  }
};
</script>

<style scoped>
.side-nav {
  width: 248px;
  flex: 0 0 248px;
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-s) 0;
  background: var(--td-bg-color-container);
  border-right: 1px solid var(--td-component-border);
}

.menu {
  width: 224px;
  margin: 0 auto;
  border-right: 0;
}

.menu :deep(.t-menu__item),
.menu :deep(.t-submenu__title) {
  min-height: 40px;
  justify-content: flex-start;
  border-radius: 6px;
  padding-right: var(--td-comp-paddingLR-m) !important;
}

.menu :deep(.t-menu__content) {
  min-width: 0;
  justify-content: flex-start;
}

.menu :deep(.menu-level-one > .t-submenu__title),
.menu :deep(.menu-level-one-item) {
  padding-left: 16px !important;
}

.menu :deep(.menu-level-two-item) {
  padding-left: 40px !important;
}

.menu :deep(.t-icon) {
  flex: 0 0 18px;
}
</style>
