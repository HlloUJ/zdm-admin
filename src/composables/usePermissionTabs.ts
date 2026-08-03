import { computed, watch, type Ref } from 'vue';

type TabValue = string | number;

interface PermissionTab<Value extends TabValue> {
  value: Value;
}

interface PermissionTabsOptions<Value extends TabValue, Tab extends PermissionTab<Value>> {
  tabs: readonly Tab[];
  activeTab: Ref<Value>;
  canAccess: (tab: Tab) => boolean;
}

export const usePermissionTabs = <Value extends TabValue, Tab extends PermissionTab<Value>>({
  tabs,
  activeTab,
  canAccess,
}: PermissionTabsOptions<Value, Tab>) => {
  const visibleTabs = computed(() => tabs.filter(canAccess));
  const showTabRail = computed(() => visibleTabs.value.length > 1);
  const resolveAccessibleTab = (value: Value) =>
    visibleTabs.value.some((tab) => tab.value === value) ? value : visibleTabs.value[0]?.value;

  watch(
    [visibleTabs, activeTab],
    ([currentTabs, currentValue]) => {
      const firstTab = currentTabs[0];
      if (firstTab && !currentTabs.some((tab) => tab.value === currentValue)) {
        activeTab.value = firstTab.value;
      }
    },
    { immediate: true },
  );

  return {
    visibleTabs,
    showTabRail,
    resolveAccessibleTab,
  };
};
