import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { storeOrderPrototype } from '@/pages/order/prototype/resources';
import { collectFunctionCatalogRows, type FunctionModule } from '@/services/functionCatalog';
import PermissionAssignmentMatrix from './PermissionAssignmentMatrix.vue';

const mountMatrix = (modules: FunctionModule[]) =>
  mount(PermissionAssignmentMatrix, {
    props: { modules, modelValue: [], activeModule: modules[0]!.value },
    global: {
      stubs: {
        TButton: { template: '<button><slot /></button>' },
        TCheckbox: { template: '<span><slot /></span>' },
        TTag: true,
      },
    },
  });

describe('permission assignment page descriptions', () => {
  it('omits supplementary notes for every order page while retaining page names and actions', () => {
    const rows = collectFunctionCatalogRows(storeOrderPrototype);
    expect(new Set(rows.map((row) => row.pageLabel))).toEqual(new Set(['销售订单页', '履约任务页', '款项配置页']));
    expect(rows.every((row) => !row.pageNote)).toBe(true);
    const wrapper = mountMatrix([storeOrderPrototype]);
    expect(wrapper.findAll('.permission-page-note')).toHaveLength(0);
    for (const label of ['销售订单页', '履约任务页', '款项配置页', '新增订单', '登记客户发货', '停用/启用']) {
      expect(wrapper.text()).toContain(label);
    }
    wrapper.unmount();
  });

  it('preserves supplementary notes for other modules and selection events', async () => {
    const module: FunctionModule = {
      label: '其他模块',
      value: 'other',
      menus: [
        {
          label: '菜单',
          value: 'other.menu',
          direct: false,
          pages: [
            {
              label: '页面',
              value: 'other.page',
              note: '保留其他模块说明',
              actions: [{ label: '查看', value: 'other.page.view' }],
              tabs: [],
            },
          ],
        },
      ],
    };
    const wrapper = mountMatrix([module]);
    expect(wrapper.get('.permission-page-note').text()).toBe('保留其他模块说明');
    await wrapper.findAll('button')[0]!.trigger('click');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['other.page.view']]);
    wrapper.unmount();
  });
});
