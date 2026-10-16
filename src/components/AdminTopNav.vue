<template>
  <header class="top-nav">
    <div class="brand">
      <div class="brand-logo">装</div>
      <div class="brand-title">装点猫</div>
    </div>
    <div class="identity-context">
      <t-select
        v-if="switchableIdentityContexts.some((context) => context.identityId !== loginUser.identityId)"
        v-model="selectedIdentityId"
        v-model:popup-visible="identitySelectorOpen"
        class="brand-context-select"
        :loading="switchingIdentity"
        :input-props="{ inputClass: 'identity-context-input' }"
        :popup-props="{ overlayInnerStyle: { minWidth: '320px', maxWidth: 'calc(100vw - 32px)' } }"
        aria-label="切换业务身份"
        @change="handleIdentityChange"
      >
        <template #valueDisplay>
          <span class="brand-context-label identity-lines">
            <span class="identity-name" :title="currentIdentityLabel">{{ currentIdentityLabel }}</span>
            <span class="identity-type">{{ currentIdentityType }}</span>
          </span>
        </template>
        <t-option
          v-for="option in identityOptions"
          :key="option.value"
          class="identity-context-option"
          :label="option.label"
          :value="option.value"
        >
          <span class="identity-option-layout">
            <span class="identity-lines">
              <span class="identity-name" :title="option.name">{{ option.name }}</span>
              <span class="identity-type">{{ option.type }}</span>
            </span>
            <t-icon
              v-if="option.value === loginUser.identityId"
              name="check"
              class="identity-current-check"
              aria-label="当前身份"
            />
          </span>
        </t-option>
      </t-select>
      <div v-else class="brand-subtitle identity-lines">
        <span class="identity-name" :title="currentIdentityLabel">{{ currentIdentityLabel }}</span>
        <span class="identity-type">{{ currentIdentityType }}</span>
      </div>
    </div>

    <div class="top-actions">
      <t-button data-button-control="notification-indicator" shape="square" variant="text" aria-label="消息通知">
        <t-icon name="notification" />
      </t-button>
      <div class="user-entry">
        <t-avatar size="small">{{ avatarText }}</t-avatar>
        <div class="user-meta">
          <span class="user-name">{{ loginUser.name }}</span>
          <span class="user-role">{{ roleText }}</span>
        </div>
      </div>
      <t-button variant="text" :theme="buttonTheme('logout')" @click="handleLogout">
        <template #icon><t-icon name="logout" /></template>
        退出登录
      </t-button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { buttonTheme } from '@/components/foundation/actions/buttonFunctions';
import { adminFeedback } from '@/components/foundation';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { getLoginUser, listIdentityContexts, logout, switchIdentity, type IdentityContext } from '@/services/auth';

const router = useRouter();
const loginUser = computed(() => getLoginUser());
const identityContexts = ref<IdentityContext[]>([]);
const selectedIdentityId = ref<number>();
const switchingIdentity = ref(false);
const identitySelectorOpen = ref(false);
const avatarText = computed(() => loginUser.value.name.trim().slice(0, 1) || '管');
const storeTypeLabels: Record<NonNullable<IdentityContext['storeType']>, string> = {
  cityPartner: '合伙人门店',
  slabSupplier: '大板供应商',
  finishedSupplier: '成品供应商',
  factory: '工厂',
};
const identityTypeLabel = (
  context: Pick<IdentityContext, 'clientCode' | 'tenantId' | 'storeId' | 'storeType' | 'storeName'>,
) => {
  if (context.clientCode === 'supply-chain') return '供应链端';
  if (context.storeName || context.storeId) {
    return context.storeType ? `门店端 · ${storeTypeLabels[context.storeType]}` : '门店端';
  }
  return context.tenantId ? '租户管理身份' : '运营端';
};
const currentIdentityType = computed(() => identityTypeLabel(loginUser.value));
const currentIdentityLabel = computed(() => {
  if (loginUser.value.clientCode === 'supply-chain') return '供应链协同系统';
  if (loginUser.value.storeName) return loginUser.value.storeName;
  return loginUser.value.tenantName ?? '运营管理平台';
});
const roleText = computed(() => {
  if (loginUser.value.roles.includes('SUPER_ADMIN')) return '超级管理员';
  return loginUser.value.roleNames?.length
    ? loginUser.value.roleNames.join('、')
    : loginUser.value.roles.join('、') || '管理后台';
});
const identityLabel = (context: IdentityContext) => {
  if (context.clientCode === 'supply-chain') return '供应链协同系统';
  if (!context.tenantId && !context.storeId) return '运营管理平台';
  if (context.identityType === 'platform_admin') return '运营管理平台';
  if (context.storeName) {
    return context.storeName;
  }
  return context.tenantName ?? '租户管理身份';
};
const switchableIdentityContexts = computed(() =>
  identityContexts.value.filter(
    (context) => !context.tenantId || context.identityType === 'platform_admin' || Boolean(context.storeId),
  ),
);
const identityOptions = computed(() =>
  switchableIdentityContexts.value.map((context) => ({
    name: identityLabel(context),
    type: identityTypeLabel(context),
    label: `${identityLabel(context)} · ${identityTypeLabel(context)}`,
    value: context.identityId,
  })),
);

const handleIdentityChange = async (value: string | number) => {
  const identityId = Number(value);
  if (!Number.isFinite(identityId) || identityId === loginUser.value.identityId) return;
  switchingIdentity.value = true;
  try {
    await switchIdentity(identityId);
    await router.replace('/dashboard');
    window.location.reload();
  } catch (error) {
    selectedIdentityId.value = loginUser.value.identityId;
    adminFeedback.error(error instanceof Error ? error.message : '业务身份切换失败');
  } finally {
    switchingIdentity.value = false;
  }
};

const handleLogout = async () => {
  await logout();
  adminFeedback.success('已退出登录');
  await router.replace('/login');
};

onMounted(async () => {
  selectedIdentityId.value = loginUser.value.identityId;
  try {
    identityContexts.value = await listIdentityContexts();
  } catch {
    identityContexts.value = [];
  }
});
</script>

<style scoped>
.identity-context {
  min-width: 0;
  max-width: 30vw;
  margin-right: var(--td-comp-margin-l);
}

.brand-context-select {
  width: 260px;
  max-width: 100%;
}

/* The native input and option only need content height for the two-line layout. */
.brand-context-select :deep(.identity-context-input) {
  height: auto;
  min-height: var(--td-comp-size-xxl);
  padding-top: var(--td-comp-paddingTB-xxs);
  padding-bottom: var(--td-comp-paddingTB-xxs);
}

.identity-lines {
  display: flex;
  min-width: 0;
  flex-direction: column;
  text-align: left;
}

.identity-name {
  overflow: hidden;
  color: var(--td-text-color-primary);
  font: var(--td-font-body-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.identity-type {
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-small);
  white-space: nowrap;
}

.t-select-option.identity-context-option {
  height: auto;
  padding-top: var(--td-comp-paddingTB-s);
  padding-bottom: var(--td-comp-paddingTB-s);
}

.identity-context-option .identity-option-layout {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
}

.identity-current-check {
  flex: none;
  color: var(--td-brand-color);
}

.user-entry {
  width: max-content;
  flex: 0 0 auto;
}

.user-meta {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--td-comp-margin-s);
  line-height: var(--td-line-height-body-medium);
  white-space: nowrap;
}

.user-name {
  color: var(--td-text-color-primary);
  font: var(--td-font-body-medium);
}

.user-role {
  color: var(--td-text-color-placeholder);
  font: var(--td-font-body-small);
  white-space: nowrap;
}
</style>
