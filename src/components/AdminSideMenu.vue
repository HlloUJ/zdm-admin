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
      <template v-for="entry in visibleMenuEntries" :key="'path' in entry ? entry.path : entry.value">
        <t-menu-item
          v-if="'path' in entry"
          :value="entry.path"
          :data-menu-path="entry.path"
          class="menu-level-one-item"
        >
          <template #icon>
            <t-icon :name="entry.icon" />
          </template>
          {{ entry.label }}
        </t-menu-item>
        <t-submenu v-else :value="entry.value" :title="entry.label" class="menu-level-one">
          <template #icon>
            <t-icon :name="entry.icon" />
          </template>
          <template v-for="child in entry.children" :key="'path' in child ? child.path : child.value">
            <t-menu-item
              v-if="'path' in child"
              :value="child.path"
              :data-menu-path="child.path"
              class="menu-level-two-item"
            >
              {{ child.label }}
            </t-menu-item>
            <t-submenu v-else :value="child.value" :title="child.label" class="menu-level-two">
              <t-menu-item
                v-for="grandchild in child.children"
                :key="grandchild.path"
                :value="grandchild.path"
                :data-menu-path="grandchild.path"
                class="menu-level-three-item"
              >
                {{ grandchild.label }}
              </t-menu-item>
            </t-submenu>
          </template>
        </t-submenu>
      </template>
    </t-menu>
  </aside>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useSideMenuState } from '@/composables/useSideMenuState';
import { getLoginUser } from '@/services/auth';
import {
  adminMenuEntries,
  hasMenuPermission,
  type AdminMenuChild,
  type AdminMenuEntry,
} from '@/services/adminPermissions';

const route = useRoute();
const router = useRouter();
const { expandedMenus, handleMenuExpand } = useSideMenuState();

const activeMenu = computed(() => route.path);
const loginUser = computed(() => getLoginUser());
const visibleMenuEntries = computed<AdminMenuEntry[]>(() =>
  adminMenuEntries
    .map((entry) => {
      if (!('children' in entry)) {
        return hasMenuPermission(loginUser.value, entry.permissionPrefix) ? entry : null;
      }
      const children = entry.children.reduce<AdminMenuChild[]>((visibleChildren, child) => {
        if ('path' in child) {
          if (hasMenuPermission(loginUser.value, child.permissionPrefix)) visibleChildren.push(child);
          return visibleChildren;
        }
        const grandchildren = child.children.filter((item) =>
          hasMenuPermission(loginUser.value, item.permissionPrefix),
        );
        if (grandchildren.length) visibleChildren.push({ ...child, children: grandchildren });
        return visibleChildren;
      }, []);
      return children.length ? { ...entry, children } : null;
    })
    .filter((entry): entry is AdminMenuEntry => Boolean(entry)),
);

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
  '/slab-origin',
  '/slab-texture',
  '/slab-color',
  '/slab-grade',
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
    if (
      route.path === '/slab-variety' ||
      route.path === '/slab-origin' ||
      route.path === '/slab-texture' ||
      route.path === '/slab-color' ||
      route.path === '/slab-grade'
    ) {
      requiredExpandedMenus.push('slab-base-data-management');
    }
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

.menu :deep(.menu-level-two > .t-submenu__title) {
  padding-left: 40px !important;
}

.menu :deep(.menu-level-three-item) {
  padding-left: 64px !important;
}

.menu :deep(.t-icon) {
  flex: 0 0 18px;
}
</style>
