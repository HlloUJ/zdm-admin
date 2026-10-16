<template>
  <header class="top-nav">
    <div class="brand identity-brand">
      <div class="brand-logo">装</div>
      <div class="brand-title">装点猫</div>
    </div>
    <div class="identity-context">
      <t-select
        v-if="switchableIdentityContexts.some((context) => context.identityId !== loginUser.identityId)"
        v-model="selectedIdentityId"
        v-model:popup-visible="identitySelectorOpen"
        class="brand-context-select"
        :readonly="switchingIdentity"
        :aria-busy="switchingIdentity"
        :class="{ 'identity-pointer-focus': identityPointerFocus }"
        :input-props="{ inputClass: 'identity-context-input', borderless: true }"
        :popup-props="{
          overlayInnerClassName: 'zdm-identity-popup',
          placement: 'bottom-left',
          popperOptions: { modifiers: [{ name: 'offset', options: { offset: [48, 4] } }] },
          overlayInnerStyle: { minWidth: '340px', maxWidth: 'calc(100vw - 32px)' },
        }"
        aria-label="切换业务身份"
        @pointerdown.capture="identityPointerFocus = true"
        @keydown.capture="identityPointerFocus = false"
        @keyup.capture="identityPointerFocus = false"
        @change="handleIdentityChange"
      >
        <template #prefixIcon>
          <span class="identity-icon identity-trigger-icon"
            ><IdentityContextIcon :name="identityIcon(loginUser)"
          /></span>
        </template>
        <template #panelTopContent><div class="identity-panel-heading">切换身份</div></template>
        <template #suffixIcon><span /></template>
        <template #valueDisplay>
          <span class="brand-context-label identity-lines">
            <span class="identity-title-row">
              <span class="identity-name" :title="currentIdentityLabel">{{ currentIdentityLabel }}</span>
              <t-loading v-if="switchingIdentity" size="small" />
              <t-icon
                v-else
                name="chevron-down"
                class="identity-toggle"
                :class="{ 'identity-toggle-open': identitySelectorOpen }"
                aria-hidden="true"
              />
            </span>
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
          <span class="identity-option-layout" :class="{ 'identity-section-start': option.sectionStart }">
            <span class="identity-icon identity-option-icon"><IdentityContextIcon :name="option.icon" /></span>
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
      <div v-else class="identity-static">
        <span class="identity-icon identity-trigger-icon"><IdentityContextIcon :name="identityIcon(loginUser)" /></span>
        <span class="brand-subtitle identity-lines">
          <span class="identity-name" :title="currentIdentityLabel">{{ currentIdentityLabel }}</span>
          <span class="identity-type">{{ currentIdentityType }}</span>
        </span>
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
import IdentityContextIcon from '@/components/IdentityContextIcon.vue';
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
const identityPointerFocus = ref(false);
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
// Icons describe the existing context; they never decide access or switching scope.
const identityIcon = (
  context: Pick<IdentityContext, 'storeId' | 'storeName' | 'storeType'>,
): 'city' | 'storefront' | 'city-8' =>
  context.storeId || context.storeName ? (context.storeType === 'factory' ? 'city' : 'storefront') : 'city-8';
const identityOptions = computed(() =>
  switchableIdentityContexts.value.map((context, index, contexts) => ({
    name: identityLabel(context),
    type: identityTypeLabel(context),
    label: `${identityLabel(context)} · ${identityTypeLabel(context)}`,
    value: context.identityId,
    icon: identityIcon(context),
    sectionStart: index > 0 && Boolean(context.storeId) && !contexts[index - 1]?.storeId,
  })),
);

const handleIdentityChange = async (value: string | number) => {
  const identityId = Number(value);
  if (switchingIdentity.value || !Number.isFinite(identityId) || identityId === loginUser.value.identityId) return;
  switchingIdentity.value = true;
  try {
    await switchIdentity(identityId);
    // One document navigation preserves full identity initialization without an intermediate route render.
    window.location.replace(router.resolve('/dashboard').href);
  } catch (error) {
    selectedIdentityId.value = loginUser.value.identityId;
    adminFeedback.error(error instanceof Error ? error.message : '业务身份切换失败');
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
.top-nav .brand.identity-brand {
  width: auto;
  flex: 0 0 auto;
}

.identity-context {
  min-width: 0;
  max-width: 30vw;
  margin-left: var(--td-comp-margin-l);
  margin-right: var(--td-comp-margin-l);
  padding-left: var(--td-comp-paddingLR-l);
  border-left: 1px solid var(--td-component-stroke);
}

.brand-context-select {
  width: 240px;
  max-width: 100%;
}

/* The native input and option only need content height for the two-line layout. */
.brand-context-select :deep(.identity-context-input) {
  height: auto;
  min-height: var(--td-comp-size-xxl);
  padding-top: var(--td-comp-paddingTB-xxs);
  padding-bottom: var(--td-comp-paddingTB-xxs);
}

.brand-context-select :deep(.identity-context-input > .t-input__prefix:not(.t-input__prefix-icon)) {
  min-width: 0;
  flex: 1;
}

.brand-context-select :deep(.identity-context-input > .t-input__inner) {
  width: 0;
  flex: none;
}

.identity-icon {
  display: inline-flex;
  width: var(--td-comp-size-xl);
  height: var(--td-comp-size-xl);
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: var(--td-radius-default);
  font-size: var(--td-font-size-title-medium);
}

.identity-trigger-icon {
  width: var(--td-comp-size-m);
  height: var(--td-comp-size-m);
  margin-right: var(--td-comp-margin-s);
  color: var(--td-brand-color);
  background: #e2edfe;
}

.identity-option-icon {
  color: var(--td-text-color-secondary);
  background: #f0f2f5;
}

.identity-panel-heading {
  margin: 0 var(--td-comp-margin-s);
  padding: var(--td-comp-paddingTB-m) var(--td-comp-paddingLR-s);
  border-bottom: 1px solid var(--td-component-stroke);
  color: var(--td-text-color-primary);
  font: var(--td-font-mark-medium);
}

.identity-static {
  display: flex;
  align-items: center;
}

.identity-lines {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-comp-margin-xxs);
  text-align: left;
  max-width: 100%;
}

.identity-name {
  overflow: hidden;
  color: var(--td-text-color-primary);
  font: var(--td-font-mark-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.brand-context-label .identity-name,
.identity-static .identity-name {
  font: var(--td-font-mark-medium);
}

.brand-context-label {
  width: 100%;
}

.identity-title-row {
  display: flex;
  min-width: 0;
  width: 100%;
  max-width: 100%;
  align-items: center;
  gap: var(--td-comp-margin-l);
}

.identity-title-row .identity-name {
  min-width: 0;
  flex: 0 1 auto;
}

.identity-toggle {
  width: var(--td-comp-size-xxxs);
  height: var(--td-comp-size-xxxs);
  flex: none;
  color: var(--td-text-color-primary);
}

.identity-toggle-open {
  transform: rotate(180deg);
}

.identity-type {
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-small);
  white-space: nowrap;
}

:global(.zdm-identity-popup .t-select-option) {
  height: auto;
  position: relative;
  min-height: var(--td-comp-size-xxxxl);
  padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-m);
}

:global(.zdm-identity-popup .t-select-option > span) {
  width: 100%;
}

.identity-option-layout {
  display: flex;
  width: 100%;
  align-items: center;
  gap: var(--td-comp-margin-m);
}

.identity-option-layout > .identity-lines {
  flex: 1;
}

:global(.zdm-identity-popup .t-select-option:has(.identity-section-start)) {
  margin-top: calc(var(--td-comp-margin-s) * 2 + 1px);
}

:global(.zdm-identity-popup .t-select-option:has(.identity-section-start)::before) {
  position: absolute;
  top: calc(-1 * var(--td-comp-margin-s) - 1px);
  right: 0;
  left: 0;
  height: 1px;
  background: var(--td-component-stroke);
  content: '';
}

:global(.zdm-identity-popup .t-select-option.t-is-selected:not(.t-is-disabled)),
:global(.zdm-identity-popup .t-select-option.t-is-selected:not(.t-is-disabled):hover) {
  background-color: #ebf3fe;
  color: var(--td-brand-color);
}

:global(.zdm-identity-popup .t-is-selected .identity-name),
:global(.zdm-identity-popup .t-is-selected .identity-option-icon) {
  color: var(--td-brand-color);
}

:global(.zdm-identity-popup .t-is-selected .identity-option-icon) {
  background: #e2edfe;
}

/* Approved C uses a blue tint locally; the project theme remains unchanged. */
:global(.t-popup[data-popper-placement] .zdm-identity-popup.t-popup__content) {
  margin: 0;
  max-height: min(600px, calc(100vh - 88px));
  box-shadow: 0 4px 12px rgb(0 0 0 / 10%);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-default);
  background: var(--td-bg-color-container);
}

:global(.zdm-identity-popup .t-select__list) {
  padding: var(--td-comp-paddingTB-s);
}

:global(.zdm-identity-popup .t-select-option + .t-select-option:not(:has(.identity-section-start))) {
  margin-top: var(--td-comp-margin-xxs);
}

.brand-context-select :deep(.identity-context-input.t-input--borderless) {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
}

.brand-context-select:not(.identity-pointer-focus) :deep(.identity-context-input:has(input:focus-visible)) {
  outline: 2px solid var(--td-brand-color);
  outline-offset: 2px;
}

.identity-current-check {
  flex: none;
  width: var(--td-comp-size-xxs);
  height: var(--td-comp-size-xxs);
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
