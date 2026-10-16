import { describe, expect, it } from 'vitest';
import { effectScope, ref } from 'vue';
import { fieldFeedback, requiredFieldFeedback, useFormFeedback } from './formValidation';

describe('form feedback preserves existing rule decisions', () => {
  it('pairs an already detected error with its concrete message and retains help otherwise', () => {
    expect(fieldFeedback(true, '名称重复', '原帮助')).toEqual({
      class: 't-is-error',
      status: 'error',
      tips: '名称重复',
    });
    expect(fieldFeedback(false, '名称重复', '原帮助')).toEqual({ class: undefined, status: undefined, tips: '原帮助' });
  });
  it('retains the existing empty-string requirement and does not mark optional or unsubmitted fields', () => {
    expect(requiredFieldFeedback(' ', '名称', true).tips).toBe('请输入名称');
    expect(requiredFieldFeedback('', '产地', true, true).tips).toBe('请选择产地');
    expect(requiredFieldFeedback('', '名称', false).status).toBeUndefined();
    expect(requiredFieldFeedback(0, '数值', true).status).toBeUndefined();
  });
  it('keeps an error on the rejected value and releases it when that value is edited', () => {
    const feedback = useFormFeedback();
    expect(feedback.field('name', '')).toEqual({ class: undefined, status: undefined, tips: undefined });
    feedback.reject('name', '', '请输入名称');
    expect(feedback.field('name', '').status).toBe('error');
    expect(feedback.field('name', '新名称').status).toBeUndefined();
    feedback.clear();
    expect(feedback.field('name', '').status).toBeUndefined();
  });
  it('clears a captured cross-field error when the specification state changes', () => {
    const feedback = useFormFeedback();
    const value = ['layered', [{ key: 'material' }], [{ material: '木纹' }, { material: '木纹' }]];
    feedback.reject('specifications', value, '销售规格组合重复');
    expect(feedback.field('specifications', structuredClone(value)).tips).toBe('销售规格组合重复');
    expect(
      feedback.field('specifications', ['layered', [{ key: 'material' }], [{ material: '木纹' }, { material: '石纹' }]])
        .status,
    ).toBeUndefined();
  });
  it('resets errors on dialog transitions without changing any business value', () => {
    const scope = effectScope();
    const visible = ref(false);
    const value = ref('原值');
    const feedback = scope.run(() => useFormFeedback(visible))!;
    feedback.reject('name', value.value, '名称重复');
    visible.value = true;
    expect(feedback.field('name', value.value).status).toBeUndefined();
    expect(value.value).toBe('原值');
    scope.stop();
  });
});
