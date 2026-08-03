import { nextTick, ref } from 'vue';
import { describe, expect, it } from 'vitest';

import { usePermissionTabs } from './usePermissionTabs';

describe('usePermissionTabs', () => {
  it('filters tabs, hides a single tab rail, and falls back to the first accessible tab', async () => {
    const tabs = [
      { label: 'Tab A', value: 'a' as const },
      { label: 'Tab B', value: 'b' as const },
    ];
    const allowedTabs = ref<Array<'a' | 'b'>>(['a']);
    const activeTab = ref<'a' | 'b'>('b');
    const { visibleTabs, showTabRail } = usePermissionTabs({
      tabs,
      activeTab,
      canAccess: (tab) => allowedTabs.value.includes(tab.value),
    });

    expect(visibleTabs.value.map((tab) => tab.value)).toEqual(['a']);
    expect(activeTab.value).toBe('a');
    expect(showTabRail.value).toBe(false);

    allowedTabs.value = ['a', 'b'];
    await nextTick();
    expect(visibleTabs.value.map((tab) => tab.value)).toEqual(['a', 'b']);
    expect(showTabRail.value).toBe(true);

    activeTab.value = 'b';
    allowedTabs.value = ['a'];
    await nextTick();
    expect(activeTab.value).toBe('a');

    allowedTabs.value = [];
    await nextTick();
    expect(visibleTabs.value).toEqual([]);
    expect(showTabRail.value).toBe(false);
  });
});
