<template>
  <div class="zdm-admin-page-frame"><slot /></div>
</template>

<style scoped>
.zdm-admin-page-frame {
  --zdm-admin-page-padding-y: var(--td-comp-paddingTB-xl);
  --zdm-admin-page-padding-x: var(--td-comp-paddingLR-xxl);
  --zdm-admin-card-padding: 24px;
  --zdm-admin-card-radius: 6px;
  --zdm-admin-section-gap: 16px;
}
</style>
