<template>
  <div class="admin-layout">
    <AdminTopNav />

    <div class="admin-shell">
      <AdminSideMenu />

      <main class="page">
        <header class="page-header">
          <div>
            <t-breadcrumb>
              <t-breadcrumb-item>权限管理</t-breadcrumb-item>
              <t-breadcrumb-item>终端功能分配</t-breadcrumb-item>
            </t-breadcrumb>
          </div>
          <t-tag theme="primary" variant="light">平台统一下放</t-tag>
        </header>

        <section class="allocation-card">
          <t-tabs v-model="activeTerminal" class="terminal-tabs" :list="terminalTabs" @change="handleTerminalChange" />

          <PermissionAssignmentMatrix
            v-model="checkedValues"
            v-model:active-module="activeModuleValue"
            :modules="currentModules"
          />

          <footer class="page-actions">
            <t-button
              v-if="canSave"
              theme="primary"
              :loading="loading"
              :disabled="!currentModules.length"
              @click="saveAllocation"
            >
              保存
            </t-button>
            <t-button theme="default" variant="base" :disabled="loading" @click="resetAllocation">重置</t-button>
          </footer>
        </section>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getLoginUser } from '@/services/auth';
import { hasPermission } from '@/services/adminPermissions';
import { adminFeedback } from '@/components/foundation';
import { computed, onMounted, reactive, ref, watch } from 'vue';

import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import PermissionAssignmentMatrix from '@/components/permission/PermissionAssignmentMatrix.vue';
import {
  initialAllocationValues,
  normalizeTerminalPermissions,
  terminalFunctionTrees,
  terminalTabs,
  type FunctionModule,
  type TerminalType,
} from '@/services/functionCatalog';
import {
  listTerminalFunctionPolicies,
  saveTerminalFunctionPolicy,
  type TerminalFunctionPolicyRecord,
} from '@/services/terminalFunctionPolicies';

const canSave = computed(() =>
  hasPermission(getLoginUser(), 'admin.permission-management.terminal-function-allocation.save'),
);

const activeTerminal = ref<TerminalType>('store');
const activeModuleValue = ref(terminalFunctionTrees.store[0]?.value ?? '');
const checkedValues = ref<string[]>([]);
const loading = ref(false);
const savedAllocationValues = reactive<Record<TerminalType, string[]>>({
  store: [...initialAllocationValues.store],
  supplier: [...initialAllocationValues.supplier],
  'supply-chain': [...initialAllocationValues['supply-chain']],
});
const terminalPolicies = reactive<Partial<Record<TerminalType, TerminalFunctionPolicyRecord>>>({});

const currentTree = computed(() => terminalFunctionTrees[activeTerminal.value]);

const currentModules = computed<FunctionModule[]>(() => currentTree.value);

const handleTerminalChange = () => {
  checkedValues.value = [...savedAllocationValues[activeTerminal.value]];
  activeModuleValue.value = terminalFunctionTrees[activeTerminal.value][0]?.value ?? '';
};

const parsePermissions = (value?: string) => value?.split(',').filter(Boolean) ?? [];

const loadAllocation = async () => {
  loading.value = true;
  try {
    const policies = await listTerminalFunctionPolicies();
    (['store', 'supplier', 'supply-chain'] as TerminalType[]).forEach((terminal) => {
      const policy = policies.find((item) => item.terminal === terminal);
      if (policy) {
        terminalPolicies[terminal] = policy;
        savedAllocationValues[terminal] = normalizeTerminalPermissions(
          terminal,
          parsePermissions(policy.functionPermissions),
        );
      }
    });
    checkedValues.value = [...savedAllocationValues[activeTerminal.value]];
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '终端功能配置加载失败');
  } finally {
    loading.value = false;
  }
};

const resetAllocation = () => {
  checkedValues.value = [...savedAllocationValues[activeTerminal.value]];
  adminFeedback.info('已重置为上次保存状态');
};

const saveAllocation = async () => {
  if (!canSave.value) return;
  const terminal = activeTerminal.value;
  loading.value = true;
  try {
    const saved = await saveTerminalFunctionPolicy(terminal, checkedValues.value.join(','));
    terminalPolicies[terminal] = saved;
    savedAllocationValues[terminal] = normalizeTerminalPermissions(
      terminal,
      parsePermissions(saved.functionPermissions),
    );
    checkedValues.value = [...savedAllocationValues[terminal]];
    adminFeedback.success('终端功能分配已保存');
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '保存失败');
  } finally {
    loading.value = false;
  }
};

watch(
  activeTerminal,
  () => {
    checkedValues.value = [...savedAllocationValues[activeTerminal.value]];
    activeModuleValue.value = terminalFunctionTrees[activeTerminal.value][0]?.value ?? '';
  },
  { immediate: true },
);

onMounted(loadAllocation);
</script>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
  margin-bottom: var(--td-comp-margin-l);
}

.allocation-card {
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-border);
  border-radius: 6px;
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xl);
}

.terminal-tabs {
  margin-bottom: var(--td-comp-margin-l);
}

.terminal-tabs :deep(.t-tabs__nav-item) {
  color: var(--td-text-color-secondary);
}

.terminal-tabs :deep(.t-is-active) {
  color: var(--td-brand-color);
}

.page-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--td-comp-margin-s);
  margin-top: var(--td-comp-margin-l);
  padding-top: var(--td-comp-paddingTB-l);
}

@media (max-width: 960px) {
  .page-header,
  .page-actions {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
