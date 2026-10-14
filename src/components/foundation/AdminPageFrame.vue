<template>
  <div class="zdm-admin-page-frame"><slot /></div>
</template>

<style scoped>
.zdm-admin-page-frame {
  --zdm-admin-page-padding-y: var(--td-comp-paddingTB-xl);
  --zdm-admin-page-padding-x: var(--td-comp-paddingLR-xl);
  --zdm-admin-card-padding: var(--td-comp-paddingLR-xxl);
  --zdm-admin-card-radius: var(--td-radius-medium);
  --zdm-admin-section-gap: var(--td-comp-margin-xxl);
}
</style>
