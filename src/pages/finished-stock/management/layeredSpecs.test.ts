import { describe, expect, it } from 'vitest';
import { reactive } from 'vue';
import { copySpecDimensions, editableSalesFields, layeredCellSpan, orderLayeredRows } from './layeredSpecs';

const dimensions = [
  { key: 'attribute_2', name: '尺寸', values: ['大', '小'] },
  { key: 'attribute_1', name: '颜色', values: ['白', '黑'] },
];

describe('分层规格保存与回填', () => {
  it('保留非模板顺序和选项顺序，支持从响应式商品读取，草稿修改不污染原记录', () => {
    const saved = reactive(JSON.parse(JSON.stringify(dimensions)));
    const restored = copySpecDimensions(saved);
    expect(restored).toEqual(dimensions);
    restored.reverse();
    restored[0].values.reverse();
    expect(saved).toEqual(dimensions);
  });

  it('按属性和选项的嵌套顺序恢复行，价格库存编码保持绑定', () => {
    const rows = [
      { attribute_2: '小', attribute_1: '黑', merchantCode: '4', cost: '40', quantity: 4 },
      { attribute_2: '大', attribute_1: '黑', merchantCode: '2', cost: '20', quantity: 2 },
      { attribute_2: '小', attribute_1: '白', merchantCode: '3', cost: '30', quantity: 3 },
      { attribute_2: '大', attribute_1: '白', merchantCode: '1', cost: '10', quantity: 1 },
    ];
    const ordered = orderLayeredRows(rows, dimensions);
    expect(ordered.map((row) => row.merchantCode)).toEqual(['1', '2', '3', '4']);
    expect(ordered[0]).toBe(rows[3]);
    expect(ordered[0].quantity).toBe(1);
    expect(ordered[0].cost).toBe('10');
    expect(rows[0].merchantCode).toBe('4');
  });

  it('批量填写排除组合属性，非组合属性可填写，单层保持原行为', () => {
    const fields = ['attribute_1', 'attribute_2', 'attribute_3'].map((key) => ({ key }));
    expect(
      editableSalesFields(
        fields,
        dimensions.map((item) => item.key),
      ),
    ).toEqual([{ key: 'attribute_3' }]);
    expect(editableSalesFields(fields, [])).toEqual(fields);
  });
});

describe('价格编辑器分层单元格', () => {
  it('只在相同上级属性内合并，不跨尺寸合并颜色，不合并价格列', () => {
    const values = [
      ['大', '白'],
      ['大', '黑'],
      ['小', '黑'],
      ['小', '白'],
    ];
    expect(layeredCellSpan(values, 0, 0)).toEqual({ rowspan: 2, colspan: 1 });
    expect(layeredCellSpan(values, 1, 0)).toEqual({ rowspan: 0, colspan: 0 });
    expect(layeredCellSpan(values, 2, 0)).toEqual({ rowspan: 2, colspan: 1 });
    expect(layeredCellSpan(values, 1, 1)).toEqual({ rowspan: 1, colspan: 1 });
    expect(layeredCellSpan(values, 2, 1)).toEqual({ rowspan: 1, colspan: 1 });
    expect(layeredCellSpan(values, 0, -1)).toEqual({});
  });
});
