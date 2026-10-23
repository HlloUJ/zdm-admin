import type { DefineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { Input } from 'tdesign-vue-next';
import { describe, expect, it } from 'vitest';
import ProductOperationLogTemplate from './ProductOperationLogTemplate.vue';

describe('操作日志显式搜索范围', () => {
  it.each([
    ['商品', '商品名称/ID'],
    ['大板', '大板名称/ID/大板编号'],
  ])('短标题%s显示调用方声明的%s，输入仍转交原查询字段', async (subjectLabel, keywordPlaceholder) => {
    const view = mount(
      ProductOperationLogTemplate as unknown as DefineComponent<
        InstanceType<typeof ProductOperationLogTemplate>['$props']
      >,
      {
        props: {
          visible: true,
          detailVisible: false,
          records: [],
          detail: null,
          total: 0,
          filter: { keyword: '', operationType: '', operatorName: '', dateRange: [] },
          pagination: { current: 1, pageSize: 10 },
          typeOptions: [],
          subjectLabel,
          keywordPlaceholder,
          statusLabel: (value?: string | null) => value ?? '',
          sourceLabel: () => '',
        },
        global: {
          components: { TInput: Input },
          stubs: {
            't-drawer': { template: '<section><slot /></section>' },
            't-space': { template: '<div><slot /></div>' },
            't-form': { template: '<div><slot /></div>' },
            't-form-item': { template: '<label><slot /></label>' },
            't-select': true,
            't-date-range-picker': true,
            't-button': true,
            't-table': true,
            AdminPagination: true,
            AdminDialog: true,
          },
        },
      },
    );
    const input = view.find('.operation-log-keyword-filter input');
    expect(input.attributes('placeholder')).toBe(`请输入${keywordPlaceholder}`);
    await input.setValue('原样查询 / 123');
    expect(view.emitted('filter-change')?.at(-1)).toEqual(['keyword', '原样查询 / 123']);
    expect(view.emitted('search')).toBeUndefined();
  });
});
