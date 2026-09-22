import { describe, expect, it } from 'vitest';
import { materializeLayeredSpec, rebuildLayeredSpecs, specIdentity } from './specModeConversion';

describe('specification identity', () => {
  it('matches combinations independent of display order and merchant code', () => {
    expect(specIdentity({ color: '白', length: '1400mm', merchantCode: 'old' }, ['color', 'length'])).toBe(
      specIdentity({ color: '白', length: '1400mm', merchantCode: 'new' }, ['length', 'color']),
    );
  });
});

describe('layered row drafts', () => {
  const groups = [
    {
      field: 'color',
      withImage: false,
      values: [
        { id: 1, value: '米白色', imageUploaded: false },
        { id: 2, value: '黑色', imageUploaded: false },
      ],
    },
    {
      field: 'size',
      withImage: false,
      values: [
        { id: 3, value: '大号', imageUploaded: false },
        { id: 4, value: '小号', imageUploaded: false },
      ],
    },
  ];
  const sources = [
    {
      id: 1,
      skuId: 951,
      cost: '10',
      guide: '20',
      guideCoefficient: '2',
      quantity: 2,
      markupPrices: { 1: { price: '35', coefficient: '3.5', priceSource: 'manual' } },
      note: '附加属性',
    },
    {
      id: 2,
      skuId: 952,
      cost: '20',
      guide: '60',
      guideCoefficient: '3',
      quantity: 3,
      markupPrices: { 1: { price: '60', coefficient: '3', priceSource: 'auto', sourceConfigurationId: 81 } },
      note: '附加属性',
    },
  ];
  it('preserves sparse rows and all prices and sources after renaming and dimension reordering', () => {
    const result = sources.map((source, index) =>
      materializeLayeredSpec(source, { color: index + 1, size: index + 3 }, [...groups].reverse()),
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      ...sources[0],
      color: '米白色',
      size: '大号',
      _specOriginFields: ['size', 'color'],
    });
    expect(result[1]).toMatchObject({ ...sources[1], color: '黑色', size: '小号' });
    result[0].markupPrices[1].price = '99';
    expect(sources[0].markupPrices[1].price).toBe('35');
  });
  it('keeps incomplete rows and duplicate value bindings without merging their SKU data', () => {
    const duplicates = [{ ...groups[0], values: groups[0].values.map((value) => ({ ...value, value: '相同名称' })) }];
    const first = materializeLayeredSpec(sources[0], { color: 1 }, duplicates);
    const second = materializeLayeredSpec(sources[1], { color: 2 }, duplicates);
    expect(first).toMatchObject({ skuId: 951, quantity: 2, _specValueIds: { color: 1 } });
    expect(second).toMatchObject({ skuId: 952, quantity: 3, _specValueIds: { color: 2 } });
    expect(materializeLayeredSpec(sources[0], {}, groups)).toMatchObject({
      skuId: 951,
      color: '',
      size: '',
      cost: '10',
      quantity: 2,
    });
  });
  const drafts = sources.map((sourceRow, index) => ({
    sourceRow,
    valueIds: { color: index + 1, size: index + 3 },
  }));
  let nextId = 100;
  const emptyRow = () => ({ id: nextId++, cost: '', quantity: null, note: '' });

  it('regenerates current combinations while retaining uniquely matched SKU attributes and commercial data', () => {
    const rows = rebuildLayeredSpecs<Record<string, unknown>>(groups, drafts, emptyRow, ['color', 'size', 'note']);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ ...sources[0], color: '米白色', size: '大号' });
    expect(rows[3]).toMatchObject({ ...sources[1], color: '黑色', size: '小号' });
    for (const index of [1, 2]) {
      expect(rows[index]).toMatchObject({ cost: '', quantity: null });
      expect(rows[index]).not.toHaveProperty('skuId');
    }
  });

  it('produces eight unique rows despite duplicate old bindings without guessing which SKU to retain', () => {
    const third = {
      field: 'finish',
      withImage: false,
      values: [
        { id: 5, value: '亮面', imageUploaded: false },
        { id: 6, value: '哑光', imageUploaded: false },
      ],
    };
    const duplicateDrafts = sources.map((sourceRow) => ({ sourceRow, valueIds: { color: 1, size: 3, finish: 5 } }));
    const rows = rebuildLayeredSpecs<Record<string, unknown>>([...groups, third], duplicateDrafts, emptyRow, [
      'color',
      'size',
      'finish',
      'note',
    ]);
    expect(rows).toHaveLength(8);
    expect(new Set(rows.map((row) => specIdentity(row, ['color', 'size', 'finish']))).size).toBe(8);
    for (const row of rows) {
      expect(row).toMatchObject({ cost: '', quantity: null });
      expect(row).not.toHaveProperty('skuId');
    }
    expect(rows[0]).toMatchObject({ note: '附加属性' });
  });

  it('fills corresponding attributes on split combinations without duplicating the original stock or SKU', () => {
    const finish = {
      field: 'finish',
      withImage: false,
      values: [
        { id: 5, value: '亮面', imageUploaded: false },
        { id: 6, value: '哑光', imageUploaded: false },
      ],
    };
    const rows = rebuildLayeredSpecs<Record<string, unknown>>([...groups, finish], drafts, emptyRow, [
      'color',
      'size',
      'finish',
      'note',
    ]);
    expect(rows).toHaveLength(8);
    for (const index of [0, 1, 6, 7]) {
      expect(rows[index]).toMatchObject({ note: '附加属性', cost: '', quantity: null });
      expect(rows[index]).not.toHaveProperty('skuId');
    }
  });

  it('matches values again after draft IDs change and excludes removed values', () => {
    const changedGroups = [{ ...groups[0], values: [{ id: 20, value: '黑色', imageUploaded: false }] }, groups[1]];
    const previous = drafts.map((draft, index) => ({
      ...draft,
      sourceRow: {
        ...draft.sourceRow,
        color: index === 0 ? '米白色' : '黑色',
        size: index === 0 ? '大号' : '小号',
      },
    }));
    const rows = rebuildLayeredSpecs<Record<string, unknown>>(changedGroups, previous, emptyRow, [
      'color',
      'size',
      'note',
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).not.toHaveProperty('skuId');
    expect(rows[1]).toMatchObject({ ...sources[1], color: '黑色', size: '小号' });
  });
});
