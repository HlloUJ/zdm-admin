import { ref } from 'vue';

type MenuValue = string | number;

const STORAGE_KEY = 'zdm-admin-side-menu-expanded';

const readExpandedMenus = () => {
  if (typeof window === 'undefined') return [];

  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

const writeExpandedMenus = (value: string[]) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
};

export const useSideMenuState = () => {
  const expandedMenus = ref<string[]>(readExpandedMenus());

  const handleMenuExpand = (value: MenuValue[]) => {
    expandedMenus.value = value.map(String);
    writeExpandedMenus(expandedMenus.value);
  };

  return {
    expandedMenus,
    handleMenuExpand,
  };
};
