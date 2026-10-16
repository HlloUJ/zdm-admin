import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { expect, it, vi } from 'vitest';
import FinishedSalesLogTable from './FinishedSalesLogTable.vue';

vi.mock('@/services/auth', () => ({ getLoginUser: () => ({ clientCode: 'supply-chain' }) }));

it('remeasures on the containing dialog animation only and cleans up when closed', () => {
  const dialog = document.createElement('div');
  dialog.className = 't-dialog';
  document.body.append(dialog);
  const refreshTable = vi.fn();
  const wrapper = mount(FinishedSalesLogTable, {
    attachTo: dialog,
    props: { snapshot: {}, other: {} },
    global: {
      stubs: {
        't-table': defineComponent({
          setup(_, { expose }) {
            expose({ refreshTable });
            return () => h('div', { class: 'test-table' });
          },
        }),
      },
    },
  });
  wrapper.find('.test-table').element.dispatchEvent(new Event('animationend', { bubbles: true }));
  expect(refreshTable).not.toHaveBeenCalled();
  dialog.dispatchEvent(new Event('animationend', { bubbles: true }));
  expect(refreshTable).toHaveBeenCalledTimes(1);
  dialog.dispatchEvent(new Event('animationcancel', { bubbles: true }));
  expect(refreshTable).toHaveBeenCalledTimes(2);
  wrapper.unmount();
  dialog.dispatchEvent(new Event('animationend', { bubbles: true }));
  dialog.dispatchEvent(new Event('animationcancel', { bubbles: true }));
  expect(refreshTable).toHaveBeenCalledTimes(2);
  dialog.remove();
});
