<template>
  <header class="top-nav">
    <div class="brand">
      <div class="brand-logo">装</div>
      <div>
        <div class="brand-title">装点猫</div>
        <div class="brand-subtitle">管理后台</div>
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
import { MessagePlugin } from 'tdesign-vue-next';
import { computed } from 'vue';
import { useRouter } from 'vue-router';

import { getLoginUser, logout } from '@/services/auth';

const router = useRouter();
const loginUser = computed(() => getLoginUser());
const avatarText = computed(() => loginUser.value.name.trim().slice(0, 1) || '管');
const roleText = computed(() => {
  if (loginUser.value.roles.includes('SUPER_ADMIN')) return '超级管理员';
  return loginUser.value.roleNames?.length
    ? loginUser.value.roleNames.join('、')
    : loginUser.value.roles.join('、') || '管理后台';
});

const handleLogout = async () => {
  logout();
  MessagePlugin.success('已退出登录');
  await router.replace('/login');
};
</script>

<style scoped>
.user-meta {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
  line-height: 1;
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
