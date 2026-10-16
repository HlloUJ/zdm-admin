import { describe, expect, it } from 'vitest';
import {
  buttonTheme,
  buttonFunctionFor,
  actionButtonProps,
  cancelButtonProps,
  type ButtonFunction,
} from './buttonFunctions';
import registry from './button-functions.json';
describe('registered button function colors', () => {
  it('uses one semantic mapping for all registered functions and explicit dynamic aliases', () => {
    for (const id of Object.keys(registry.functions) as ButtonFunction[])
      expect(buttonTheme(id)).toBe(
        registry.categories[registry.functions[id].category as keyof typeof registry.categories].theme,
      );
    expect(buttonTheme(buttonFunctionFor('customer', 'archive'))).toBe('warning');
    expect(buttonTheme(buttonFunctionFor('stock', 'batchRestore'))).toBe('success');
    expect(buttonTheme(buttonFunctionFor('stock', 'batchPurge'))).toBe('danger');
    expect(() => buttonTheme('unregistered' as ButtonFunction)).toThrow();
    expect(() => buttonFunctionFor('stock', 'unknown')).toThrow();
  });
  it('confirmation follows its actual action and retains content, loading, disabled state and callbacks', () => {
    const click = () => {};
    const original = { content: '提交', theme: 'primary' as const, disabled: true, loading: true, onClick: click };
    expect(actionButtonProps('off-shelf', original)).toEqual({ ...original, theme: 'warning' });
    expect(original.theme).toBe('primary');
    expect(actionButtonProps('purge', '确认彻底删除')).toEqual({ content: '确认彻底删除', theme: 'danger' });
    expect(actionButtonProps('restore-stock', '确认放回仓库')?.theme).toBe('success');
  });
  it('keeps hidden cancellation hidden and preserves all cancellation behavior', () => {
    const click = () => {};
    expect(cancelButtonProps(null)).toBeNull();
    expect(cancelButtonProps({ content: '取消', disabled: true, loading: true, onClick: click })).toEqual({
      content: '取消',
      disabled: true,
      loading: true,
      onClick: click,
      theme: 'default',
    });
    expect(cancelButtonProps()).toEqual({ content: '取消', theme: 'default' });
  });
});
