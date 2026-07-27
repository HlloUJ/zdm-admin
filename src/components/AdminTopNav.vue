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
        <t-avatar size="small">{{ loginUser.name.slice(0, 1) }}</t-avatar>
        <div class="user-meta">
          <span class="user-name">{{ loginUser.name }}</span>
          <span class="user-role">{{ loginUser.role }}</span>
        </div>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
const loginUser = {
  name: '超级管理员',
  role: '全量权限',
};
</script>
