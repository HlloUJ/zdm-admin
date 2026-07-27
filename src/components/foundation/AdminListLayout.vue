<template>
  <section class="admin-list-layout">
    <div v-if="$slots.filters" class="admin-list-layout__filters">
      <slot name="filters" />
    </div>

    <div class="admin-list-layout__table-card">
      <div v-if="$slots.toolbar" class="admin-list-layout__toolbar">
        <slot name="toolbar" />
      </div>

      <slot name="table" />

      <div v-if="$slots.pagination" class="admin-list-layout__pagination">
        <slot name="pagination" />
      </div>
    </div>
  </section>
</template>
