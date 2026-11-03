import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateNumericControls } from './numericInputValidation';
const warning = vi.hoisted(() => vi.fn());
vi.mock('@/components/foundation/feedback/adminFeedback', () => ({ adminFeedback: { warning } }));
afterEach(() => {
  document.body.innerHTML = '';
  warning.mockClear();
});
function form(error: string, disabled = false) {
  const root = document.createElement('div');
  const control = document.createElement('div');
  control.dataset.numericError = error;
  const input = document.createElement('input');
  input.disabled = disabled;
  control.appendChild(input);
  root.appendChild(control);
  document.body.appendChild(root);
  return { root, control };
}
describe('数值输入提交保护仅检查本表单', () => {
  it('合法字段可以提交；另一个表单中的错误不干扰', async () => {
    form('最多输入两位小数');
    const { root } = form('');
    expect(await validateNumericControls(root)).toBe(true);
    expect(warning).not.toHaveBeenCalled();
  });
  it('精度和不完整状态阻止提交并触发已有统一反馈', async () => {
    const { root, control } = form('请输入数字');
    const touched = vi.fn();
    control.addEventListener('numeric-validate', touched);
    expect(await validateNumericControls(root)).toBe(false);
    expect(touched).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith('表单校验未通过，请检查标红字段');
  });
  it('禁用与只读字段不新增校验', async () => {
    const { root } = form('请输入数字', true);
    expect(await validateNumericControls(root)).toBe(true);
    const input = root.querySelector('input')!;
    input.disabled = false;
    input.readOnly = true;
    expect(await validateNumericControls(root)).toBe(true);
  });
});
