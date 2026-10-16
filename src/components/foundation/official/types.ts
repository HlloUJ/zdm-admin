import type { SelectProps } from 'tdesign-vue-next';

import type { ButtonFunction } from '../actions/buttonFunctions';

export type FilterValues = Record<string, string | number | undefined>;
export interface ListFilter {
  key: string;
  label: string;
  /** Explicit search scope for a compound query input; never inferred from its label. */
  searchScope?: string;
  kind?: 'input' | 'select';
  options?: SelectProps['options'];
  filterable?: boolean;
}
export interface ListAction {
  /** Caller marks permission-filtered actions that operate on selected rows. */
  batch?: boolean;
  id: string;
  label: string;
  function: ButtonFunction;
  icon?: string;
  disabled?: boolean;
}
export interface ListTab {
  value: string;
  label: string;
}
