<template>
  <div class="zdm-admin-list-layout">
    <section v-if="$slots.notice" class="zdm-admin-list-layout__notice"><slot name="notice" /></section>
    <section v-if="$slots.filters" class="zdm-admin-list-layout__filters"><slot name="filters" /></section>
    <section class="zdm-admin-list-layout__content">
      <div v-if="$slots.toolbar" class="zdm-admin-list-layout__toolbar"><slot name="toolbar" /></div>
      <slot name="table" />
      <div v-if="$slots.pagination" class="zdm-admin-list-layout__pagination"><slot name="pagination" /></div>
    </section>
  </div>
</template>
