<template>
  <header class="top-nav">
    <div class="brand">
      <div class="brand-logo">装</div>
      <div>
        <div class="brand-title">装点猫</div>
        <div
          v-if="switchableIdentityContexts.some((context) => context.identityId !== loginUser.identityId)"
          class="brand-context-switcher"
          :class="{ 'is-open': identitySelectorOpen }"
        >
          <span class="brand-context-label" :class="{ 'is-city-partner': isCityPartnerStore }" aria-hidden="true">
            {{ currentIdentityLabel }}
            <t-tag v-if="isCityPartnerStore" class="city-partner-mark" theme="warning" variant="dark" size="small"
              >合</t-tag
            >
          </span>
          <t-select
            v-model="selectedIdentityId"
            v-model:popup-visible="identitySelectorOpen"
            class="brand-context-select"
            size="small"
            auto-width
            :loading="switchingIdentity"
            aria-label="切换业务身份"
            @change="handleIdentityChange"
          >
            <t-option v-for="option in identityOptions" :key="option.value" :label="option.label" :value="option.value">
              <span v-if="option.storeType === 'cityPartner'" class="city-partner-option">
                <span class="city-partner-option-name">{{ option.label }}</span>
                <t-tag class="city-partner-mark" theme="warning" variant="dark" size="small">合</t-tag>
              </span>
              <span v-else>{{ option.label }}</span>
            </t-option>
          </t-select>
        </div>
        <div v-else class="brand-subtitle" :class="{ 'is-city-partner': isCityPartnerStore }">
          {{ currentIdentityLabel }}
          <t-tag v-if="isCityPartnerStore" class="city-partner-mark" theme="warning" variant="dark" size="small"
            >合</t-tag
          >
        </div>
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
const identitySelectorOpen = ref(false);
const avatarText = computed(() => loginUser.value.name.trim().slice(0, 1) || '管');
const storeTypeLabels: Record<Exclude<NonNullable<IdentityContext['storeType']>, 'cityPartner'>, string> = {
  slabSupplier: '大板供应商',
  finishedSupplier: '成品供应商',
  factory: '工厂',
};
const formatStoreLabel = (storeName: string, storeType?: IdentityContext['storeType']) =>
  storeType && storeType !== 'cityPartner' ? `${storeName} · ${storeTypeLabels[storeType]}` : storeName;
const isCityPartnerStore = computed(
  () =>
    loginUser.value.clientCode !== 'supply-chain' &&
    Boolean(loginUser.value.storeName) &&
    loginUser.value.storeType === 'cityPartner',
);
const currentIdentityLabel = computed(() => {
  if (loginUser.value.clientCode === 'supply-chain') return '供应链协同系统';
  if (loginUser.value.storeName) return formatStoreLabel(loginUser.value.storeName, loginUser.value.storeType);
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
    return formatStoreLabel(context.storeName, context.storeType);
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
    label: identityLabel(context),
    value: context.identityId,
    storeType: context.storeType,
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
.city-partner-mark {
  width: 12px;
  height: 12px;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-size: 9px;
  line-height: 12px;
  text-align: center;
}

.city-partner-option {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.city-partner-option-name {
  line-height: 12px;
}

.brand-context-label.is-city-partner,
.brand-subtitle.is-city-partner {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.brand-context-switcher {
  display: grid;
  align-items: center;
  margin-top: 2px;
}

.brand-context-label,
.brand-context-select {
  grid-area: 1 / 1;
}

.brand-context-label {
  color: var(--td-text-color-placeholder);
  font: var(--td-font-body-small);
  white-space: nowrap;
}

.brand-context-select {
  opacity: 0;
}

.brand-context-switcher:hover .brand-context-select,
.brand-context-switcher:focus-within .brand-context-select,
.brand-context-switcher.is-open .brand-context-select {
  opacity: 1;
}

.brand-context-switcher:hover .brand-context-label,
.brand-context-switcher:focus-within .brand-context-label,
.brand-context-switcher.is-open .brand-context-label {
  visibility: hidden;
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
