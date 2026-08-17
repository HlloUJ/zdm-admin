<template>
  <div class="admin-layout">
    <AdminTopNav />

    <div class="admin-shell">
      <AdminSideMenu />

      <main class="page">
        <div class="page-header">
          <div>
            <h1>工作台</h1>
            <p>平台运营最高视角，汇总租户、商品、供应商与权限配置状态。</p>
          </div>
        </div>

        <section class="metric-grid">
          <div v-for="item in metrics" :key="item.label" class="metric-card">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
            <small>{{ item.trend }}</small>
          </div>
        </section>

        <section class="dashboard-grid">
          <div class="panel">
            <div class="panel-title">整合菜单</div>
            <t-table row-key="path" :data="menuRows" :columns="menuColumns" size="medium" table-layout="fixed" />
          </div>
          <div class="panel">
            <div class="panel-title">权限动作覆盖</div>
            <t-list split>
              <t-list-item v-for="item in permissionActions" :key="item.module">
                <t-list-item-meta :title="item.module" :description="item.actions" />
              </t-list-item>
            </t-list>
          </div>
        </section>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { PrimaryTableCol } from 'tdesign-vue-next';

import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';

const metrics = [
  { label: '租户总数', value: '128', trend: '直营、合伙人、供应商统一管理' },
  { label: '商品资料', value: '4,926', trend: '成品现货与大板分实体维护' },
  { label: '供应商', value: '76', trend: '资质、状态、协同数据统一查看' },
  { label: '权限动作', value: '96', trend: '菜单与按钮权限码已保留' },
];

const menuRows = [
  { domain: '租户与门店', pages: '租户管理、门店管理、门店分类管理', path: '/tenant-management' },
  { domain: '商品管理', pages: '成品现货管理、大板管理、供应商管理', path: '/finished-stock-management' },
  {
    domain: '商品管理',
    pages: '商品分类、属性库、属性值、类目属性模板、大板品种、成品工艺',
    path: '/product-category',
  },
  { domain: '权限管理', pages: '员工管理、角色管理、终端功能分配', path: '/employee-management' },
];

const menuColumns: PrimaryTableCol[] = [
  { colKey: 'domain', title: '业务域', width: 180 },
  { colKey: 'pages', title: '已整合页面' },
  { colKey: 'path', title: '代表路径', width: 220 },
];

const permissionActions = [
  { module: '通用动作', actions: '查询、重置、新增、编辑、删除、停用/启用' },
  { module: '商品动作', actions: '发布商品、批量上架、批量下架、上下架、驳回、查看价格' },
  { module: '分类动作', actions: '新增子类目、关联属性、关联选项、设置必填、排序' },
  { module: '权限动作', actions: '邀请员工、权限管理、全选、清空、保存' },
];
</script>

<style scoped>
.page-header h1 {
  margin: 0;
  font: var(--td-font-headline-small);
}

.page-header p {
  margin: 6px 0 0;
  color: var(--td-text-color-secondary);
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--td-comp-margin-l);
  margin-bottom: var(--td-comp-margin-l);
}

.metric-card,
.panel {
  background: var(--td-bg-color-container);
  border-radius: 6px;
  box-shadow: var(--td-shadow-1);
}

.metric-card {
  min-height: 120px;
  padding: 22px 24px;
  display: grid;
  gap: 10px;
}

.metric-card span,
.metric-card small {
  color: var(--td-text-color-secondary);
}

.metric-card strong {
  font: var(--td-font-headline-medium);
}

.dashboard-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(320px, 0.8fr);
  gap: var(--td-comp-margin-l);
}

.panel {
  padding: 24px;
}

.panel-title {
  margin-bottom: 16px;
  font: var(--td-font-title-medium);
}

@media (width <= 980px) {
  .metric-grid,
  .dashboard-grid {
    grid-template-columns: 1fr;
  }
}
</style>
