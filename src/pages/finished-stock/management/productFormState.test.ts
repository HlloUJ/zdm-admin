import { expect, it } from 'vitest';
import { reactive } from 'vue';
import { resetProductForm } from './productFormState';

it('新增清除上次填写和编辑回填的动态属性，下一次编辑只保留当前商品属性', () => {
  const form = reactive<Record<string, unknown>>({ name: '旧商品', attribute_1: '选项1', attribute_2: '手填值' });
  resetProductForm(form, { name: '' });
  expect(form).toEqual({ name: '' });
  Object.assign(form, { name: '商品B', attribute_3: 'B属性' });
  resetProductForm(form, { name: '' });
  Object.assign(form, { name: '商品C', attribute_1: 'C属性' });
  expect(form).toEqual({ name: '商品C', attribute_1: 'C属性' });
});
