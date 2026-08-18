<template>
  <header class="top-nav">
    <div class="brand">
      <div class="brand-logo">装</div>
      <div>
        <div class="brand-title">装点猫</div>
        <t-select
          v-if="switchableIdentityContexts.length > 1"
          v-model="selectedIdentityId"
          class="brand-context-select"
          size="small"
          borderless
          :options="identityOptions"
          :loading="switchingIdentity"
          aria-label="切换当前店铺"
          @change="handleIdentityChange"
        />
        <div v-else class="brand-subtitle">{{ currentIdentityLabel }}</div>
      </div>
    </div>

    <div class="top-actions">
      <t-button shape="square" variant="text" aria-label="消息通知">
        <t-icon name="notification" />
      </t-button>
      <div class="user-entry">
        <t-avatar size="small">{{ avatarText }}</t-avatar>
        <div class="user-meta">
          <span class="user-name">{{ loginUser.name }}</span>
          <span class="user-role">{{ roleText }}</span>
        </div>
      </div>
      <t-button variant="text" theme="default" @click="handleLogout">
        <template #icon><t-icon name="logout" /></template>
        退出登录
      </t-button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { adminFeedback } from '@/components/foundation';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { getLoginUser, listIdentityContexts, logout, switchIdentity, type IdentityContext } from '@/services/auth';

const router = useRouter();
const loginUser = computed(() => getLoginUser());
const identityContexts = ref<IdentityContext[]>([]);
const selectedIdentityId = ref<number>();
const switchingIdentity = ref(false);
const avatarText = computed(() => loginUser.value.name.trim().slice(0, 1) || '管');
const currentIdentityLabel = computed(() => loginUser.value.storeName ?? loginUser.value.tenantName ?? '运营管理平台');
const roleText = computed(() => {
  if (loginUser.value.roles.includes('SUPER_ADMIN')) return '超级管理员';
  return loginUser.value.roleNames?.length
    ? loginUser.value.roleNames.join('、')
    : loginUser.value.roles.join('、') || '管理后台';
});
const identityLabel = (context: IdentityContext) => {
  if (context.identityType === 'platform_admin') return '运营管理平台';
  if (context.storeName) return `${context.tenantName ?? '租户'} / ${context.storeName}`;
  return context.tenantName ?? '租户管理身份';
};
const switchableIdentityContexts = computed(() =>
  identityContexts.value.filter(
    (context) =>
      context.identityType === 'platform_admin' ||
      Boolean(context.storeId) ||
      context.identityId === loginUser.value.identityId,
  ),
);
const identityOptions = computed(() =>
  switchableIdentityContexts.value.map((context) => ({ label: identityLabel(context), value: context.identityId })),
);

const handleIdentityChange = async (value: string | number) => {
  const identityId = Number(value);
  if (!Number.isFinite(identityId) || identityId === loginUser.value.identityId) return;
  switchingIdentity.value = true;
  try {
    await switchIdentity(identityId);
    adminFeedback.success('已切换业务身份');
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
.brand-context-select {
  width: 168px;
  margin-top: 2px;
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
  line-height: 1;
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
