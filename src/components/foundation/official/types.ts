import type { ButtonProps, SelectProps } from 'tdesign-vue-next';

export type FilterValues = Record<string, string | number | undefined>;
export interface ListFilter {
  key: string;
  label: string;
  kind?: 'input' | 'select';
  options?: SelectProps['options'];
  filterable?: boolean;
}
export interface ListAction {
  id: string;
  label: string;
  theme?: ButtonProps['theme'];
  icon?: string;
  disabled?: boolean;
}
export interface ListTab {
  value: string;
  label: string;
}
